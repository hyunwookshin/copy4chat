#!/usr/bin/env bash
# Render icons/icon.svg to the PNG sizes Chrome wants.
#
# Chrome itself is the rasteriser — no ImageMagick or librsvg needed, and it
# renders the SVG exactly as the browser will.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME" >&2; exit 1; }

PROFILE=$(mktemp -d)
trap 'rm -rf "$PROFILE"' EXIT

for size in 16 32 48 128; do
  cat > "$PROFILE/icon.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${size}px;height:${size}px}</style>
<img src="icon.svg">
HTML
  cp icons/icon.svg "$PROFILE/icon.svg"

  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --user-data-dir="$PROFILE/chrome" \
    --default-background-color=00000000 \
    --force-device-scale-factor=1 \
    --window-size="${size},${size}" \
    --screenshot="icons/icon${size}.png" \
    "file://$PROFILE/icon.html" >/dev/null 2>&1

  echo "icons/icon${size}.png"
done
