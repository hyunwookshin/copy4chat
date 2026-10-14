// Run the real extractor against the fixture pages in a real browser.
//
// Everything up to now has tested the renderer against hand-built IR. The
// extractor has never been exercised against actual computed styles, actual
// getBoundingClientRect values, or actual selection ranges — which is where
// axisOf, the visibility filter and heading scoping all live.
//
// Headless Chrome loads each fixture with the content scripts appended, runs
// a selection over the whole body, and prints the result via --dump-dom. No
// CDP client or npm dependency needed.
//
//   node test/run-fixtures.js [name ...] [--ir]

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const CHROME =
  process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SCRIPTS = [
  "mask.js",
  "extract.js",
  "render.js",
  "render-boxed.js",
];

const showIR = process.argv.includes("--ir");
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function decode(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function run(fixture) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "c4c-fix-"));
  try {
    for (const s of SCRIPTS) {
      fs.copyFileSync(path.join(ROOT, "src/content", s), path.join(stage, s));
    }

    // Driver runs synchronously at end of body rather than on load, so
    // --dump-dom cannot race it.
    const driver = `
<script>
(function () {
  const out = [];
  const push = (tag, body) => out.push("<<<" + tag + ">>>\\n" + body);
  try {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    push("PLAIN", sel.toString());

    const doc = C4C.extract(range);
    if (!doc) {
      push("ERROR", "extract() returned null");
    } else {
      push("BOXED", C4C.render.boxed(doc));
      push("TEXT", C4C.render.text(doc));
      push("IR", JSON.stringify(doc, (k, v) => (k === "el" ? undefined : v), 1));
    }
  } catch (e) {
    push("ERROR", (e && e.stack) || String(e));
  }
  const pre = document.createElement("pre");
  pre.id = "c4c-result";
  pre.textContent = out.join("\\n") + "\\n<<<END>>>";
  document.documentElement.appendChild(pre);
})();
</script>`;

    const html =
      fs.readFileSync(path.join(ROOT, "test/fixtures", fixture), "utf8") +
      SCRIPTS.map((s) => `\n<script src="${s}"></script>`).join("") +
      driver;
    fs.writeFileSync(path.join(stage, "page.html"), html);

    const dom = cp.execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        `--user-data-dir=${path.join(stage, "chrome")}`,
        "--force-device-scale-factor=1",
        "--window-size=1280,900",
        "--virtual-time-budget=2000",
        "--dump-dom",
        `file://${path.join(stage, "page.html")}`,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );

    const m = dom.match(/<pre id="c4c-result">([\s\S]*?)<\/pre>/);
    if (!m) return { error: "driver produced no output (page may not have run)" };

    const body = decode(m[1]);
    const sections = {};
    for (const part of body.split(/<<<(\w+)>>>\n/).slice(1).reduce((a, v, i, arr) => {
      if (i % 2 === 0) a.push([v, arr[i + 1] ?? ""]);
      return a;
    }, [])) {
      sections[part[0]] = part[1].replace(/\n<<<END>>>\n?$/, "").replace(/\n$/, "");
    }
    return sections;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

const fixtures = fs
  .readdirSync(path.join(ROOT, "test/fixtures"))
  .filter((f) => f.endsWith(".html"))
  .filter((f) => !wanted.length || wanted.some((w) => f.includes(w)));

let failed = 0;
for (const fixture of fixtures) {
  console.log("\n" + "=".repeat(74));
  console.log(fixture);
  console.log("=".repeat(74));

  const r = run(fixture);
  if (r.error || r.ERROR) {
    failed++;
    console.log("\n--- FAILED ---\n" + (r.error || r.ERROR));
    continue;
  }
  console.log("\n--- Copy4Chat (boxed) ---\n" + r.BOXED);
  console.log("\n--- Copy4Chat (text) ---\n" + r.TEXT);
  console.log("\n--- control: selection.toString() ---\n" + r.PLAIN);
  if (showIR) console.log("\n--- IR ---\n" + r.IR);
}

process.exit(failed ? 1 : 0);
