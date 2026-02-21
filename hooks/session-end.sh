#!/bin/bash
# Session End — marks session as closed with final stats preserved
# Triggered by SessionEnd hook
umask 077

# Load portable utilities
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/portable.sh
source "$HOOK_DIR/lib/portable.sh"
require_jq

INPUT=$(cat)
RAW_SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
if ! [[ "$RAW_SESSION_ID" =~ ^[A-Za-z0-9_-]{8,64}$ ]]; then
  echo "BLOCKED: Invalid session_id in session-end payload." >&2
  exit 2
fi
SESSION_ID="${RAW_SESSION_ID:0:8}"

SESSION_FILE=~/.claude/terminals/session-${SESSION_ID}.json
if [ -f "$SESSION_FILE" ]; then
  TMP=$(mktemp)
  # Mark closed but preserve files_touched, tool_counts, recent_ops for lead review
  jq '.status = "closed" | .ended = "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"' "$SESSION_FILE" > "$TMP" && mv "$TMP" "$SESSION_FILE"
fi

exit 0
