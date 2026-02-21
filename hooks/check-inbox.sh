#!/bin/bash
# PreToolUse inbox check — surfaces messages from lead/other terminals
# Runs before EVERY tool call. If inbox has messages, prints them so the model sees them.
umask 077

# Load portable utilities
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/portable.sh
source "$HOOK_DIR/lib/portable.sh"
require_jq

INPUT=$(cat)
RAW_SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
if ! [[ "$RAW_SESSION_ID" =~ ^[A-Za-z0-9_-]{8,64}$ ]]; then
  echo "BLOCKED: Invalid session_id in check-inbox payload." >&2
  exit 2
fi
SESSION_ID="${RAW_SESSION_ID:0:8}"
INBOX_DIR=~/.claude/terminals/inbox
INBOX="${INBOX_DIR}/${SESSION_ID}.jsonl"

mkdir -p "$INBOX_DIR"

# Route completed worker output to an explicit target inbox.
RESULTS_DIR=~/.claude/terminals/results
for donefile in "$RESULTS_DIR"/*.meta.json.done; do
  [ -f "$donefile" ] || continue
  TASK_ID=$(basename "$donefile" .meta.json.done)
  REPORTED="$RESULTS_DIR/${TASK_ID}.reported"
  [ -f "$REPORTED" ] && continue
  ROUTE_LOCK="$RESULTS_DIR/${TASK_ID}.route.lock"
  if ! mkdir "$ROUTE_LOCK" 2>/dev/null; then
    continue
  fi

  META_FILE="$RESULTS_DIR/${TASK_ID}.meta.json"
  TARGET_SESSION=""
  if [ -f "$META_FILE" ]; then
    TARGET_SESSION=$(jq -r '.notify_session_id // .requested_by // empty' "$META_FILE" 2>/dev/null || true)
  fi

  ROUTED=false
  if [[ "$TARGET_SESSION" =~ ^[A-Za-z0-9_-]{8}$ ]]; then
    TARGET_INBOX="${INBOX_DIR}/${TARGET_SESSION}.jsonl"
    if [ -L "$TARGET_INBOX" ]; then
      rmdir "$ROUTE_LOCK" 2>/dev/null || true
      continue
    fi
    DONE_SUMMARY=$(tr -d '\000-\010\013\014\016-\037\177\200-\237' < "$donefile" | head -c 4000)
    RESULT_TAIL=$(tail -20 "$RESULTS_DIR/${TASK_ID}.txt" 2>/dev/null | tr -d '\000-\010\013\014\016-\037\177\200-\237' | head -c 12000)
    if jq -n \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg task "$TASK_ID" \
      --arg done "$DONE_SUMMARY" \
      --arg tail "$RESULT_TAIL" \
      '
      {
        ts: $ts,
        from: "coordinator",
        priority: "normal",
        content: (
          "[WORKER COMPLETED] " + $task + "\n" + $done +
          (if $tail != "" then "\n\n" + $tail else "" end)
        )
      }
      ' >> "$TARGET_INBOX"; then
      ROUTED=true
    fi
  fi

  if [ "$ROUTED" = true ]; then
    touch "$REPORTED"
  fi
  rmdir "$ROUTE_LOCK" 2>/dev/null || true
done

# Crash-safe drain: copy inbox to temp, display, then delete original.
# If hook crashes after copy but before delete, messages are still in the original file
# and will be re-delivered next time (idempotent delivery > lost messages).
if [ -f "$INBOX" ] && [ -s "$INBOX" ]; then
  TMP_INBOX=$(mktemp)
  cp "$INBOX" "$TMP_INBOX"
  echo "--- INCOMING MESSAGES FROM COORDINATOR ---"
  tr -d '\000-\010\013\014\016-\037\177\200-\237' < "$TMP_INBOX"
  echo "--- END MESSAGES ---"
  # Only delete after successful display
  rm -f "$INBOX" "$TMP_INBOX"
fi

exit 0
