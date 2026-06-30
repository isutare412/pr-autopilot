#!/usr/bin/env bash
# Regenerate the committed icon assets from their masters:
#   build/trayTemplate.png     (18x18)  <- build/trayTemplate.svg
#   build/trayTemplate@2x.png  (36x36)  <- build/trayTemplate.svg
#   build/icon.png  (1024x1024 RGBA)    <- build/icon-master.png  (Apple superellipse + 80% inset)
# Requires: rsvg-convert, magick (ImageMagick 7), node.
set -euo pipefail
BUILD="$(cd "$(dirname "$0")/../build" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- Menu-bar template (style A steering wheel) ---
rsvg-convert -w 18 -h 18 "$BUILD/trayTemplate.svg" -o "$BUILD/trayTemplate.png"
rsvg-convert -w 36 -h 36 "$BUILD/trayTemplate.svg" -o "$BUILD/trayTemplate@2x.png"

# --- App icon: Apple superellipse (n=5) mask + 80% safe-area inset ---
# 1) emit a superellipse path SVG for an 824px body
node -e 'const n=5,S=824,c=S/2,p=[];for(let i=0;i<=1440;i++){const t=i/1440*2*Math.PI,ct=Math.cos(t),st=Math.sin(t);p.push((c+c*Math.sign(ct)*Math.pow(Math.abs(ct),2/n)).toFixed(2)+","+(c+c*Math.sign(st)*Math.pow(Math.abs(st),2/n)).toFixed(2));}require("fs").writeFileSync(process.argv[1],`<svg xmlns="http://www.w3.org/2000/svg" width="824" height="824" viewBox="0 0 824 824"><path d="M${p.join(" L")} Z" fill="#fff"/></svg>`);' "$TMP/mask.svg"
# 2) render the mask at the master's resolution
MW="$(magick identify -format '%w' "$BUILD/icon-master.png")"
rsvg-convert -w "$MW" -h "$MW" "$TMP/mask.svg" -o "$TMP/mask.png"
# 3) mask the master to the squircle (full color, transparent outside) — STEP ONE
magick "$BUILD/icon-master.png" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite "$TMP/squircle.png"
# 4) inset onto a 1024 transparent canvas (80% body) — STEP TWO; PNG32 forces RGBA
magick "$TMP/squircle.png" -resize 824x824 -background none -gravity center -extent 1024x1024 PNG32:"$BUILD/icon.png"

echo "regenerated: trayTemplate.png (18) trayTemplate@2x.png (36) icon.png (1024 RGBA)"
