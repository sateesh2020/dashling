#!/bin/bash
# Turns a folder of raw screenshot captures into the README images (docs/img/*.jpg and the tour GIF). Needs ffmpeg.
#   1. npm run demo
#   2. open the stage page for each shot (see the comment at the top of scripts/demo/stage.html) and save a capture named:
#        home-glass system-cyber computer-graphite time-light personal-glass news-terminal code-graphite ai-cyber media-cyber stocks-dots phones-trio themes-grid   (.png)
#   3. scripts/demo/make-media.sh <folder with those PNGs>
set -euo pipefail
src="${1:?usage: make-media.sh <folder with the raw PNG captures>}"
out="$(cd "$(dirname "$0")/../.." && pwd)/docs/img"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required"; exit 1; }
mkdir -p "$out"

# stills: JPEG at a quality that keeps UI text crisp (about 100-240 KB each)
for pair in home-glass:home system-cyber:system computer-graphite:computer time-light:time personal-glass:personal news-terminal:news code-graphite:code ai-cyber:ai media-cyber:media stocks-dots:stocks phones-trio:phones themes-grid:themes; do
  [ -f "$src/${pair%%:*}.png" ] || { echo "missing $src/${pair%%:*}.png"; exit 1; }
  ffmpeg -loglevel error -y -i "$src/${pair%%:*}.png" -q:v 3 "$out/${pair##*:}.jpg"
done

# tour GIF: hard cuts, 1.8 s per page, 1200 px wide, one shared palette
list=$(mktemp)
for n in home-glass system-cyber computer-graphite time-light personal-glass news-terminal code-graphite ai-cyber media-cyber; do printf "file '%s'\nduration 1.8\n" "$src/$n.png" >> "$list"; done
printf "file '%s'\n" "$src/home-glass.png" >> "$list"       # the concat demuxer needs the last file repeated
ffmpeg -loglevel error -y -f concat -safe 0 -i "$list" \
  -vf "fps=8,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=full:max_colors=256[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "$out/tour.gif"
rm -f "$list"
du -ch "$out"/*.jpg "$out/tour.gif" | tail -1
