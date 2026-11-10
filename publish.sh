#!/bin/sh
# Publish the current gridlock.html to the gallery and bump the card's ?v= so browsers never serve a stale copy.
# Usage: ./publish.sh [/path/to/gallery-clone]   (clone defaults to ../gallery)
set -e
G="${1:-../gallery}"; V="$(date +%Y%m%d%H%M)"
[ -d "$G/.git" ] || { echo "No gallery clone at $G"; exit 1; }
cp gridlock.html "$G/gridlock.html"
sed -i -E "s#href=\"gridlock.html(\?v=[0-9a-z]+)?\"#href=\"gridlock.html?v=$V\"#" "$G/index.html"
cd "$G" && git add gridlock.html index.html && git commit -m "Update gridlock.html (v=$V)" && git push origin HEAD:main
echo "Published v=$V"
