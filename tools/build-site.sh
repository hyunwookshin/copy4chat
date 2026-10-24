#!/usr/bin/env bash
# Build the copy4chat.com landing page into site/dist/.
#
# The demo runs the extension's real code rather than a copy that can drift:
# mask/extract/render/render-boxed are taken straight from src/content at
# build time. They contain no chrome.* calls, so they run unmodified in an
# ordinary page — the same property test/run-fixtures.js relies on.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT=site/dist

rm -rf "$OUT"
mkdir -p "$OUT/lib" "$OUT/vendor"

# Extension code, verbatim. main.js and clipboard.js are deliberately excluded:
# main.js self-executes against the page selection, which is not what the demo
# wants, and clipboard.js is unused here.
for f in mask extract render render-boxed; do
  cp "src/content/$f.js" "$OUT/lib/$f.js"
done

cp site/vendor/turndown.js site/vendor/turndown-plugin-gfm.js site/vendor/NOTICE.txt "$OUT/vendor/"
cp site/styles.css "$OUT/styles.css"
cp icons/icon128.png "$OUT/icon.png"
[ -f site/og.png ] && cp site/og.png "$OUT/og.png"

# Stamp the version so the badge always matches what is published.
sed "s/>v0\.0\.0</>v${VERSION}</" site/index.html > "$OUT/index.html"
sed "s/__VERSION__/${VERSION}/" site/app.js > "$OUT/app.js"

echo "built $OUT (v$VERSION)"
find "$OUT" -type f | sort | sed 's/^/  /'
