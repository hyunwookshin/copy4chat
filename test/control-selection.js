// Selections inside <input> and <textarea>, in a real browser.
//
// window.getSelection() does not report these — it comes back collapsed — so
// the extension did nothing at all and left the previous clipboard contents
// in place. Users hit it on form fields and, less obviously, on GitHub code:
// its viewer overlays a transparent read-only <textarea> on the highlighted
// source, so selecting code selects inside that textarea.
//
// run-fixtures.js cannot cover this: it selects document.body, which is the
// one case that already worked.
//
//   node test/control-selection.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const CHROME =
  process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PAGE = `<!doctype html><meta charset="utf-8">
<body>
<textarea id="code" rows="4" cols="40">const x = 1;
if (x) { console.log("hi"); }</textarea>
<input id="pw" type="password" value="hunter2-secret">
<input id="plain" name="City" value="Lisbon">
<script src="mask.js"></script>
<script src="extract.js"></script>
<script src="render.js"></script>
<script src="render-boxed.js"></script>
<script src="clipboard.js"></script>
<script>
  // Capture rather than touching the real clipboard.
  C4C.clipboard.write = async (t) => { window.__captured = t; return "stub"; };
  const which = new URLSearchParams(location.search).get("case");
  const el = document.getElementById(which === "none" ? "plain" : which);
  el.focus();
  el.setSelectionRange(0, which === "none" ? 0 : el.value.length);
</script>
<script src="main.js"></script>
<script>
  setTimeout(() => {
    const toast = [...document.querySelectorAll("div")]
      .find((d) => d.style.position === "fixed");
    const pre = document.createElement("pre");
    pre.id = "r";
    // JSON.stringify escapes newlines, so this stays on one line.
    pre.textContent = "<<<" + JSON.stringify({
      clip: window.__captured ?? null,
      toast: toast ? toast.textContent : null,
    }) + ">>>";
    document.body.appendChild(pre);
  }, 150);
</script>`;

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "c4c-ctl-"));
for (const f of fs.readdirSync(path.join(ROOT, "src/content"))) {
  fs.copyFileSync(path.join(ROOT, "src/content", f), path.join(stage, f));
}
fs.writeFileSync(path.join(stage, "probe.html"), PAGE);

function runCase(name) {
  const dom = cp.execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      `--user-data-dir=${path.join(stage, "chrome-" + name)}`,
      "--virtual-time-budget=1500",
      "--dump-dom",
      `file://${path.join(stage, "probe.html")}?case=${name}`,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
  );
  const m = dom.match(/&lt;&lt;&lt;([\s\S]*?)&gt;&gt;&gt;/);
  if (!m) throw new Error(name + ": probe produced no result");
  const json = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return JSON.parse(json);
}

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("ok    " + name);
    return;
  }
  failed++;
  console.error("FAIL  " + name + (detail ? "\n      " + detail : ""));
}

try {
  const code = runCase("code");
  check(
    "textarea: code copied verbatim",
    !!code.clip && code.clip.includes("const x = 1;") && code.clip.includes("console.log"),
    JSON.stringify(code)
  );
  check("textarea: fenced for pasting into a chat", !!code.clip && code.clip.startsWith("```"), code.clip);

  const pw = runCase("pw");
  check("password: value never leaves the field", !!pw.clip && !pw.clip.includes("hunter2"), pw.clip);
  check("password: masking reported to the user", /masked/.test(pw.toast || ""), pw.toast);

  const plain = runCase("plain");
  check("input: value copied", !!plain.clip && plain.clip.includes("Lisbon"), plain.clip);
  check("input: field name kept as context", !!plain.clip && plain.clip.includes("City"), plain.clip);

  const none = runCase("none");
  check("empty selection: nothing written to the clipboard", none.clip == null, String(none.clip));
  check(
    "empty selection: says so rather than failing silently",
    /nothing selected/i.test(none.toast || ""),
    none.toast
  );
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

if (failed) {
  console.error("\n" + failed + " check(s) failed");
  process.exit(1);
}
console.log("\nControl-selection handling verified.");
