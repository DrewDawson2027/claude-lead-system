#!/bin/bash
# Session End — marks session as closed with final stats preserved
# Triggered by SessionEnd hook
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

SESSION_FILE=~/.claude/terminals/session-${SESSION_ID:0:8}.json
if [ -f "$SESSION_FILE" ]; then
  TMP=$(mktemp)
  ENDED_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  # Mark closed but preserve files_touched, tool_counts, recent_ops for lead review
  jq --arg ended "$ENDED_TS" '.status = "closed" | .ended = $ended' "$SESSION_FILE" > "$TMP" && mv "$TMP" "$SESSION_FILE"
fi

# Clean per-session guard state to avoid unbounded growth over time.
STATE_DIR=~/.claude/hooks/session-state
rm -f "$STATE_DIR/${SESSION_ID}.json" \
      "$STATE_DIR/${SESSION_ID}.json.lock" \
      "$STATE_DIR/${SESSION_ID}-reads.json" \
      "$STATE_DIR/${SESSION_ID}-reads.json.lock" 2>/dev/null || true

exit 0
