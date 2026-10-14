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
// By default it compares against the golden snapshots in test/snapshots/ and
// fails on any difference. That is the regression guard: nothing else asserts
// on what the extractor and renderers actually produce.
//
//   node test/run-fixtures.js                 # check against snapshots
//   node test/run-fixtures.js --update        # re-record them
//   node test/run-fixtures.js kanban --print  # show one fixture
//   node test/run-fixtures.js --ir            # include the IR

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
const update = process.argv.includes("--update");
const print = process.argv.includes("--print") || showIR;
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SNAP = path.join(__dirname, "snapshots");

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

// The IR is deliberately not snapshotted: it carries a temp-directory URL and
// is an implementation detail. Output is what must not regress.
function asSnapshot(r) {
  return [
    "=== boxed ===",
    r.BOXED,
    "",
    "=== text ===",
    r.TEXT,
    "",
    "=== control: selection.toString() ===",
    r.PLAIN,
    "",
  ].join("\n");
}

function diff(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push("  - " + a[i]);
    if (b[i] !== undefined) out.push("  + " + b[i]);
    if (out.length > 40) {
      out.push("  ... (truncated)");
      break;
    }
  }
  return out.join("\n");
}

fs.mkdirSync(SNAP, { recursive: true });

let failed = 0;
let changed = 0;

for (const fixture of fixtures) {
  const r = run(fixture);

  if (r.error || r.ERROR) {
    failed++;
    console.error("FAIL  " + fixture + "\n" + (r.error || r.ERROR).replace(/^/gm, "      "));
    continue;
  }

  if (print) {
    console.log("\n" + "=".repeat(74) + "\n" + fixture + "\n" + "=".repeat(74));
    console.log("\n--- Copy4Chat (boxed) ---\n" + r.BOXED);
    console.log("\n--- Copy4Chat (text) ---\n" + r.TEXT);
    console.log("\n--- control: selection.toString() ---\n" + r.PLAIN);
    if (showIR) console.log("\n--- IR ---\n" + r.IR);
    continue;
  }

  const file = path.join(SNAP, fixture.replace(/\.html$/, "") + ".txt");
  const actual = asSnapshot(r);

  if (update) {
    const prior = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    fs.writeFileSync(file, actual);
    if (prior !== actual) {
      changed++;
      console.log((prior === null ? "new   " : "upd   ") + fixture);
    } else {
      console.log("same  " + fixture);
    }
    continue;
  }

  if (!fs.existsSync(file)) {
    failed++;
    console.error("FAIL  " + fixture + " - no snapshot; run with --update");
    continue;
  }

  const expected = fs.readFileSync(file, "utf8");
  if (expected === actual) {
    console.log("ok    " + fixture);
  } else {
    failed++;
    console.error("FAIL  " + fixture + " - output changed\n" + diff(expected, actual));
  }
}

if (print) process.exit(0);
if (update) {
  console.log("\n" + changed + " snapshot(s) written.");
  process.exit(0);
}
if (failed) {
  console.error(
    "\n" + failed + " fixture(s) differ. If the change is intended, re-record" +
    " with --update and review the diff in the commit."
  );
  process.exit(1);
}
console.log("\n" + fixtures.length + " fixture(s) match their snapshots.");
