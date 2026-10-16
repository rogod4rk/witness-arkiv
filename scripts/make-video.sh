#!/usr/bin/env bash
# Builds demo.mp4 (1080p) from the live app: screenshots + macOS say narration + ffmpeg, captions burned in.
# Usage: scripts/make-video.sh   (env: APP_URL, DEMO_TX, VOICE, RATE)
set -euo pipefail
cd "$(dirname "$0")/.."
FFMPEG=${FFMPEG:-/opt/homebrew/bin/ffmpeg}
VOICE=${VOICE:-Samantha}
RATE=${RATE:-175}
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

node scripts/capture.mjs "$W"

i=0
: > "$W/list.txt"
while IFS=$'\t' read -r png text; do
  i=$((i + 1))
  say -v "$VOICE" -r "$RATE" -o "$W/$i.aiff" "$text" < /dev/null
  # 0.35s of silence after each sentence so cuts do not feel clipped
  "$FFMPEG" -nostdin -v error -y -loop 1 -framerate 25 -i "$W/$png" -i "$W/$i.aiff" \
    -af "apad=pad_dur=0.35" -shortest -c:v libx264 -preset veryfast -pix_fmt yuv420p \
    -vf "scale=1920:1080" -c:a aac -ar 44100 -ac 2 "$W/$i.mp4"
  echo "file '$W/$i.mp4'" >> "$W/list.txt"
done < "$W/manifest.tsv"

"$FFMPEG" -v error -y -f concat -safe 0 -i "$W/list.txt" -c copy -movflags +faststart demo.mp4
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4)
echo "demo.mp4 duration ${D}s"
awk -v d="$D" 'BEGIN { exit !(d > 180) }' && { echo "over 3 minutes, raise RATE" >&2; exit 1; } || true
