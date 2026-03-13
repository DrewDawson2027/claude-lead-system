#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${1:-${TMPDIR:-/tmp}/claude-lead-conflict-hero}"
RECORDING_DIR="$PROJECT_DIR/.demo-artifacts/recording"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Project directory not found: $PROJECT_DIR" >&2
  echo "Run assets/demo/prepare_conflict_hero_demo.sh first." >&2
  exit 1
fi

if [ ! -d "$RECORDING_DIR" ]; then
  echo "Recording bundle not found: $RECORDING_DIR" >&2
  echo "Run assets/demo/prepare_conflict_hero_demo.sh first." >&2
  exit 1
fi

for required in \
  "$RECORDING_DIR/worker-a-prompt.txt" \
  "$RECORDING_DIR/worker-b-prompt.txt" \
  "$RECORDING_DIR/lead-commands.txt" \
  "$RECORDING_DIR/operator-script.md"; do
  if [ ! -f "$required" ]; then
    echo "Missing required recording file: $required" >&2
    exit 1
  fi
done

if ! command -v osascript >/dev/null 2>&1; then
  echo "This helper requires macOS osascript." >&2
  exit 1
fi

osascript <<APPLESCRIPT
tell application "iTerm2"
  activate
  set newWindow to (create window with default profile)
  tell current session of current tab of newWindow
    write text "cd '$PROJECT_DIR' && clear"
    set workerA to (split horizontally with default profile)
  end tell
  tell workerA
    write text "cd '$PROJECT_DIR' && clear"
    set workerB to (split vertically with default profile)
  end tell
  tell workerB
    write text "cd '$PROJECT_DIR' && clear"
  end tell
end tell
APPLESCRIPT

cat <<EOF
Three-pane conflict-hero layout ready.

Pane choreography:
  Left pane: lead
  Top-right pane: worker-a
  Bottom-right pane: worker-b

Next:
  1. In worker-a, paste: $RECORDING_DIR/worker-a-prompt.txt
  2. In worker-b, paste: $RECORDING_DIR/worker-b-prompt.txt
  3. Wait until both have visibly inspected or touched src/auth.ts
  4. In lead, use commands from: $RECORDING_DIR/lead-commands.txt
  5. Follow the operator script: $RECORDING_DIR/operator-script.md
EOF
