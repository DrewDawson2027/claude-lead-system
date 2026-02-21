#!/bin/bash
# Check worker output and completion status
# Usage: get_result.sh <task_id> [tail_lines]

TASK_ID="${1:?Usage: get_result.sh <task_id> [tail_lines]}"
TAIL_LINES="${2:-100}"

RESULTS_DIR="$HOME/.claude/terminals/results"
RESULT_FILE="$RESULTS_DIR/${TASK_ID}.txt"
PID_FILE="$RESULTS_DIR/${TASK_ID}.pid"
META_FILE="$RESULTS_DIR/${TASK_ID}.meta.json"
DONE_FILE="${META_FILE}.done"

if [ ! -f "$META_FILE" ]; then
  echo "Task $TASK_ID not found."
  exit 1
fi

# Check status
IS_DONE=false
IS_RUNNING=false

if [ -f "$DONE_FILE" ]; then
  IS_DONE=true
fi

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    IS_RUNNING=true
  fi
fi

if $IS_DONE; then
  STATUS="completed"
elif $IS_RUNNING; then
  STATUS="running"
else
  STATUS="unknown"
fi

echo "## Worker $TASK_ID"
echo ""
echo "- Status: $STATUS"
python3 -c "
import json
with open('$META_FILE') as f: m = json.load(f)
print(f\"- Directory: {m.get('directory', '?')}\")
print(f\"- Model: {m.get('model', '?')}\")
print(f\"- Spawned: {m.get('spawned', '?')}\")
" 2>/dev/null

if $IS_DONE && [ -f "$DONE_FILE" ]; then
  python3 -c "
import json
with open('$DONE_FILE') as f: d = json.load(f)
print(f\"- Finished: {d.get('finished', '?')}\")
" 2>/dev/null
fi

echo ""
echo "### Output"
echo '```'
if [ -f "$RESULT_FILE" ]; then
  tail -n "$TAIL_LINES" "$RESULT_FILE"
else
  echo "(no output yet)"
fi
echo '```'
