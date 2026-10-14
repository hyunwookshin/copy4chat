#!/usr/bin/env bash
# Everything that can fail, in one command. Run before committing.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== syntax =="
for f in src/background.js src/content/*.js test/*.js tools/*.js; do
  node --check "$f"
done
echo "ok"

echo
echo "== renderer geometry invariants =="
node test/render-invariants.js

echo
echo "== fixture snapshots (real browser) =="
node test/run-fixtures.js

echo
echo "== package =="
./tools/package.sh >/dev/null
node tools/verify-package.js "dist/copy4chat-$(node -p "require('./manifest.json').version").zip"

echo
echo "All checks passed."
