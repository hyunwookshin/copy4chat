#!/usr/bin/env bash
# Render the widget artwork to PNG.
#
# Illustrated rather than photographic, but built from real scene structure —
# horizon, atmosphere, light falloff, silhouettes — so a thumbnail reads as a
# picture of something instead of a coloured rectangle. Generated locally and
# committed, so the page still makes no network requests.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
cp tools/art.html "$STAGE/art.html"

# Headless Chrome clamps the window to a minimum width, so a small window
# yields a slice of a wider layout rather than the whole scene. Render big,
# then resize down to the asset size we actually want (2x the CSS box).
shot () { # name css-width css-height
  w=$(( $2 * 2 )); h=$(( $3 * 2 ))
  bw=1200; bh=$(( 1200 * h / w ))
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --user-data-dir="$STAGE/c-$1" --force-device-scale-factor=1 \
    --window-size="$bw,$bh" --virtual-time-budget=2500 \
    --screenshot="$STAGE/$1-big.png" "file://$STAGE/art.html?s=$1" >/dev/null 2>&1
  sips -z "$h" "$w" "$STAGE/$1-big.png" --out "site/art/$1.png" >/dev/null
  echo "  site/art/$1.png  ${w}x${h}"
}

shot ridge   272 160
shot convoy  272 160
shot lake    272 160
shot shoe    300 300
shot poster  200 280

echo "done"
