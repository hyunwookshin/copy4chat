#!/usr/bin/env bash
# Render the 440x280 Chrome Web Store small promo tile.
#
# Same headless-Chrome pipeline as the icons, so the artwork stays in one
# place and the tile can be regenerated after a brand tweak.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cat > "$STAGE/promo.html" <<'HTML'
<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:440px;height:280px;overflow:hidden}
  /* Opaque: the store rejects transparency in promo tiles. */
  body{
    background:linear-gradient(135deg,#0C1424 0%,#16233F 100%);
    font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;
    color:#F8FAFC;
    display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box;
  }
  /* Fixed widths rather than flex growth: the monospace block has an exact
     pixel width and must not be the thing that gets squeezed off the edge. */
  .left{width:196px;flex:0 0 196px}
  .word{font-size:36px;font-weight:700;letter-spacing:-.5px;line-height:1;margin-top:12px}
  .tag{margin-top:9px;font-size:14px;line-height:1.35;color:#93A7C4}
  .out{
    flex:0 0 auto;
    font-family:"SF Mono",Menlo,monospace;font-size:11px;line-height:1.5;
    color:#7FB3FF;white-space:pre;
  }
</style>
<div class="left">
  <svg width="44" height="44" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="28" fill="#10182B"/>
    <g stroke="#F8FAFC" stroke-width="8" fill="none" stroke-linecap="square">
      <path d="M34 44 V34 H44"/><path d="M84 34 H94 V44"/>
      <path d="M94 84 V94 H84"/><path d="M44 94 H34 V84"/>
    </g>
    <rect x="46" y="55" width="36" height="8" rx="4" fill="#60A5FA"/>
    <rect x="46" y="70" width="22" height="8" rx="4" fill="#60A5FA"/>
  </svg>
  <div class="word">Copy4Chat</div>
  <div class="tag">Paste what you&rsquo;re actually looking at.</div>
</div>
<div class="out">┌─ Pickup ─────────┐
│ [ San Jose SJC ] │
│ ( noon ▾ )       │
│ ☑ Same return    │
└──────────────────┘</div>
HTML

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$STAGE/chrome" \
  --force-device-scale-factor=1 \
  --window-size=440,280 \
  --screenshot="store/promo-440x280.png" \
  "file://$STAGE/promo.html" >/dev/null 2>&1

echo "store/promo-440x280.png"
