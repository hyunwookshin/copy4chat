// Geometry invariants for the boxed renderer.
//
// The United regression was not a tuning problem — it was torn box borders,
// a frame wrapped onto a second line, and a URL escaping its cell. Those are
// all checkable properties, so they are checked here rather than eyeballed.
//
//   node test/render-invariants.js

const fs = require("fs");
const path = require("path");

global.window = global;
require("../src/content/render.js");
require("../src/content/render-boxed.js");

const { render } = globalThis.C4C;
const { width, MAX } = render._boxed;

let failures = 0;
function check(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${name}`);
  if (detail) console.error(detail.replace(/^/gm, "      "));
}

const CORNERS = { "┌": "└", "┐": "┘" };

function verify(name, doc) {
  const out = render.boxed(doc);
  const lines = out.split("\n").slice(1, -1); // strip the fence

  // 1. Nothing exceeds the global budget. A line over MAX means some block
  //    was composed without respecting the budget handed to it.
  //
  //    Footnote lines are the deliberate exception: a tracking URL can run to
  //    hundreds of characters, and wrapping it is what the footnotes exist to
  //    avoid. They sit below every frame, so an over-long one cannot disturb
  //    any box geometry.
  const isFootnote = (l) => /^\[\d+\] \S+$/.test(l);
  const over = lines.filter((l) => width(l) > MAX && !isFootnote(l));
  check(`${name}: within ${MAX} columns`, over.length === 0, over.join("\n"));

  // 2. Every opening corner has a closing corner in the same column. This is
  //    what catches a wrapped border: the top of a box survives, the bottom
  //    lands somewhere else, and the columns stop matching.
  for (const [open, close] of Object.entries(CORNERS)) {
    // Display column, not string index — with CJK in the content the two
    // diverge, and the whole point of the check is visual alignment.
    const cols = (ch) => {
      const seen = [];
      lines.forEach((l) => {
        let col = 0;
        for (const c of l) {
          if (c === ch) seen.push(col);
          col += width(c);
        }
      });
      return seen.sort((a, b) => a - b).join(",");
    };
    check(`${name}: ${open} columns match ${close}`, cols(open) === cols(close),
      `${open}: ${cols(open)}\n${close}: ${cols(close)}`);
  }

  // 3. Box-drawing characters never appear at the start of a continuation —
  //    i.e. no line is a bare fragment of a border.
  const orphan = lines.filter((l) => /^[─│┘┐]+\s*$/.test(l) && !/^[│]/.test(l));
  check(`${name}: no orphaned border fragments`, orphan.length === 0, orphan.join("\n"));

  // 4. Vertical bars line up: every | in a framed row has a partner.
  const unbalanced = lines.filter((l) => {
    const bars = [...l].filter((c) => c === "│").length;
    return bars % 2 !== 0;
  });
  check(`${name}: vertical bars balanced`, unbalanced.length === 0, unbalanced.join("\n"));

  return out;
}

// ---------------------------------------------------------------- fixtures

const t = (text, o = {}) => ({ kind: "text", text, block: true, ...o });
const f = (o) => ({ kind: "field", states: [], ...o });

const cases = {
  "login form": {
    kind: "doc", context: [], children: [
      { kind: "group", name: "", axis: "column", children: [
        t("Welcome back"),
        f({ label: "Email address", value: "james@example.com", control: "text" }),
        f({ label: "Password", value: "••••••", control: "text" }),
        f({ label: "Remember me", control: "checkbox", states: ["checked"] }),
        f({ label: "Sign in", value: "Sign in", control: "button" }),
        t("⚠ Incorrect email or password"),
      ]},
    ],
  },

  // Deliberately hostile: a URL far longer than the budget, nested three deep.
  "unbreakable url, deeply nested": {
    kind: "doc", context: [], children: [
      { kind: "group", name: "Outer", axis: "column", children: [
        { kind: "group", name: "Middle", axis: "column", children: [
          { kind: "group", name: "Inner", axis: "column", children: [
            f({ label: "Go", value: "Go", control: "button" }),
            t("fees for optional services", { href: "https://www.united.com/en/US/fly/products/upgrades-and-optional-service-charges.html" }),
          ]},
        ]},
      ]},
    ],
  },

  // Three framed siblings marked row that cannot possibly fit across.
  "oversized row falls back to stack": {
    kind: "doc", context: [], children: [
      { kind: "group", name: "", axis: "row", children: [1, 2, 3].map((i) => ({
        kind: "group", name: `Section number ${i}`, axis: "column", children: [
          t(`A description for section ${i} that is quite long indeed`),
          f({ label: `Act on section ${i} right now`, value: `Act on section ${i} right now`, control: "button" }),
        ],
      }))},
    ],
  },

  "wide glyphs": {
    kind: "doc", context: [], children: [
      { kind: "group", name: "東京行き", axis: "column", children: [
        f({ label: "出発地", value: "東京駅", control: "text" }),
        f({ label: "検索", value: "検索", control: "button" }),
      ]},
    ],
  },
};

const irDir = path.join(__dirname, "ir");
for (const file of fs.existsSync(irDir) ? fs.readdirSync(irDir) : []) {
  if (file.endsWith(".json")) {
    cases[file] = JSON.parse(fs.readFileSync(path.join(irDir, file), "utf8"));
  }
}

const show = process.argv.includes("--print");
for (const [name, doc] of Object.entries(cases)) {
  const out = verify(name, doc);
  if (show) console.log(`\n===== ${name} =====\n${out}`);
}

if (failures) {
  console.error(`\n${failures} invariant failure(s)`);
  process.exit(1);
}
console.log(`All invariants hold across ${Object.keys(cases).length} fixtures.`);
