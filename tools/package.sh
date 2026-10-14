#!/usr/bin/env bash
# Build the Chrome Web Store upload.
#
# Stages the runtime files into a clean temp directory and zips from there, so
# the archive contains exactly what is listed below with manifest.json at the
# root — no tests, no tooling, no screenshots, no VCS metadata, and none of
# macOS's resource-fork noise.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/copy4chat-${VERSION}.zip"

# Everything the extension needs at runtime, and nothing else.
INCLUDE=(
  manifest.json
  src
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

for path in "${INCLUDE[@]}"; do
  [ -e "$path" ] || { echo "missing: $path" >&2; exit 1; }
  mkdir -p "$STAGE/$(dirname "$path")"
  cp -R "$path" "$STAGE/$(dirname "$path")/"
done

find "$STAGE" -name '.DS_Store' -delete

mkdir -p dist
rm -f "$OUT"
( cd "$STAGE" && zip -r -X -q "$OLDPWD/$OUT" . )

echo "$OUT  ($(du -h "$OUT" | cut -f1))"
node tools/verify-package.js "$OUT"
echo
unzip -l "$OUT"
