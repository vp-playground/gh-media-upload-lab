#!/bin/bash
# Record one macOS window to MP4 with the built-in recorder.
#
# Window-scoped on purpose. `screencapture -R<rect>` records whatever is
# visually on top of that screen rectangle, which will silently capture an
# unrelated app if the target is behind one. `-l<windowid>` records only the
# target window's own pixels, so nothing else can leak into the file.
#
#   ./scripts/record-window.sh <app-name-or-PID:nnn> <window-title-substring> <seconds> <out.mov>
set -euo pipefail

TARGET="${1:?app name or PID:nnnn}"
TITLE="${2:-}"
SECONDS_LIMIT="${3:-20}"
OUT="${4:-out/window.mov}"

if [[ "$TARGET" == PID:* ]]; then
  SELECTOR=(--pid "${TARGET#PID:}")
else
  SELECTOR=(--app "$TARGET")
fi

WID=$(peekaboo window list "${SELECTOR[@]}" --json \
  | TITLE="$TITLE" python3 -c '
import json, os, sys
want = os.environ["TITLE"]
windows = (json.load(sys.stdin).get("data") or {}).get("windows") or []
match = next((w for w in windows if want in (w.get("window_title") or "")), None)
print(match["window_id"] if match else "")')

if [[ -z "$WID" ]]; then
  echo "no window matching '${TITLE}' for ${TARGET}" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
echo "recording window ${WID} for ${SECONDS_LIMIT}s -> ${OUT}"
# -C composites the real cursor, -k draws the click highlight, -x mutes shutter
# sounds. Output is H.264 at a 60 fps timebase, variable frame rate, native 2x.
screencapture -v -k -C -x -l"$WID" -V "$SECONDS_LIMIT" "$OUT"
echo "done: $(du -h "$OUT" | cut -f1)"
