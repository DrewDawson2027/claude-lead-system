#!/bin/bash
# Spawn an autonomous Claude Code worker in a new iTerm2 pane
# Usage: spawn_worker.sh <directory> <prompt> [model] [task_id] [layout]

DIR="${1:?Usage: spawn_worker.sh <directory> <prompt> [model] [task_id] [layout]}"
PROMPT="${2:?Missing prompt}"
MODEL="${3:-sonnet}"
TASK_ID="${4:-W$(date +%s)}"
LAYOUT="${5:-split}"

RESULTS_DIR="$HOME/.claude/terminals/results"
mkdir -p "$RESULTS_DIR"

RESULT_FILE="$RESULTS_DIR/${TASK_ID}.txt"
PID_FILE="$RESULTS_DIR/${TASK_ID}.pid"
META_FILE="$RESULTS_DIR/${TASK_ID}.meta.json"
PROMPT_FILE="$RESULTS_DIR/${TASK_ID}.prompt"

# Write metadata
cat > "$META_FILE" << METAEOF
{
  "task_id": "$TASK_ID",
  "directory": "$DIR",
  "prompt": "$(echo "$PROMPT" | head -c 500)",
  "model": "$MODEL",
  "spawned": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "running"
}
METAEOF

# Write prompt file
echo "$PROMPT" > "$PROMPT_FILE"

# Build worker command
ESCAPED_DIR=$(echo "$DIR" | sed "s/'/'\\\\''/g")
WORKER_CMD="cd '${ESCAPED_DIR}' && echo 'Worker ${TASK_ID} starting at \$(date)' > '${RESULT_FILE}' && echo \$\$ > '${PID_FILE}' && env -u CLAUDECODE claude -p --model ${MODEL} < '${PROMPT_FILE}' >> '${RESULT_FILE}' 2>&1 && echo '{\"status\":\"completed\",\"finished\":\"'\$(date -u +%Y-%m-%dT%H:%M:%SZ)'\",\"task_id\":\"${TASK_ID}\"}' > '${META_FILE}.done' && rm -f '${PID_FILE}'"

# Spawn in iTerm2
ESCAPED_CMD=$(echo "$WORKER_CMD" | sed 's/"/\\"/g')

if [ "$LAYOUT" = "split" ]; then
  osascript -e "tell application \"iTerm2\" to tell current session of current window to split vertically with default profile" \
            -e "tell application \"iTerm2\" to tell current session of current window to write text \"$ESCAPED_CMD\"" 2>/dev/null
else
  osascript -e "tell application \"iTerm2\" to tell current window to create tab with default profile" \
            -e "tell application \"iTerm2\" to tell current session of current window to write text \"$ESCAPED_CMD\"" 2>/dev/null
fi

echo "Worker spawned: $TASK_ID"
echo "- Directory: $DIR"
echo "- Model: $MODEL"
echo "- Layout: $LAYOUT via iTerm2"
echo "- Results: $RESULT_FILE"
echo ""
echo "Check with: bash ~/.claude/lead-tools/get_result.sh $TASK_ID"
