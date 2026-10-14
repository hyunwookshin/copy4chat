// Verify a built ZIP rather than trusting the INCLUDE list in package.sh.
//
// Adding a content script and forgetting to stage it produces an extension
// that installs cleanly and then silently does nothing — exactly the failure
// a store reviewer would hit first.
//
//   node tools/verify-package.js dist/copy4chat-0.1.0.zip

const fs = require("fs");
const cp = require("child_process");

const zip = process.argv[2];
if (!zip) {
  console.error("usage: node tools/verify-package.js <zip>");
  process.exit(2);
}

const names = cp
  .execSync(`unzip -Z1 "${zip}"`, { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((n) => !n.endsWith("/"));
const have = new Set(names);

let bad = 0;
const need = (f, why) => {
  if (!have.has(f)) {
    console.error(`MISSING  ${f}  (${why})`);
    bad++;
  }
};

// The Web Store rejects an archive whose manifest is not at the root.
need("manifest.json", "must sit at the archive root");

const tmp = fs.mkdtempSync("/tmp/c4c-verify-");
try {
  cp.execSync(`unzip -q -o "${zip}" -d "${tmp}"`);
  const m = JSON.parse(fs.readFileSync(`${tmp}/manifest.json`, "utf8"));

  need(m.background.service_worker, "service worker");
  for (const [size, p] of Object.entries(m.icons || {})) need(p, `icon ${size}`);

  // Content scripts are injected by path at runtime, so a missing one stays
  // invisible until a user right-clicks.
  const sw = fs.readFileSync(`${tmp}/${m.background.service_worker}`, "utf8");
  for (const g of sw.matchAll(/"(src\/content\/[^"]+)"/g)) {
    need(g[1], "injected at runtime");
  }

  const forbidden = names.filter((n) =>
    /^(test|tools|img|store|\.git|__MACOSX)\/|\.DS_Store$|\.md$|\.svg$/.test(n)
  );
  if (forbidden.length) {
    console.error(`SHOULD NOT SHIP  ${forbidden.join(", ")}`);
    bad++;
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (bad) {
  console.error(`\n${bad} problem(s)`);
  process.exit(1);
}
console.log(`verified: ${names.length} files, all references resolve`);
