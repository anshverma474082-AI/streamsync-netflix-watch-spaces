#!/usr/bin/env bash
# Downloads the open-license Blender open-movie clips used as StreamSync test
# content into server/media/. These files are large and intentionally NOT
# committed to git (see .gitignore). Run this once before `npm run seed`.
set -euo pipefail

cd "$(dirname "$0")/../server/media"

echo "Downloading open-license test clips into $(pwd)"

fetch() {
  local url="$1" out="$2"
  if [ -s "$out" ]; then
    echo "  already present: $out"
    return
  fi
  echo "  fetching: $out"
  curl -L --fail --retry 3 --progress-bar "$url" -o "$out"
}

fetch "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4" "big-buck-bunny.mp4"
fetch "https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4"                            "elephants-dream.mp4"
fetch "https://ia600704.us.archive.org/23/items/Sintel/sintel-2048-surround_512kb.mp4"            "sintel.mp4"

echo "Done. Clips ready under /media (served by the API on port 4000, proxied by Vite in dev)."
