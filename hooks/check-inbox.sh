#!/bin/bash
# PreToolUse inbox check — surfaces messages from lead/other terminals
# Runs before EVERY tool call. If inbox has messages, prints them so the model sees them.
umask 077

# Load portable utilities
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/portable.sh
# shellcheck disable=SC1091
source "$HOOK_DIR/lib/portable.sh"
require_jq

INPUT=$(cat)
RAW_SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
if ! [[ "$RAW_SESSION_ID" =~ ^[A-Za-z0-9_-]{8,64}$ ]]; then
  echo "BLOCKED: Invalid session_id in check-inbox payload." >&2
  exit 2
fi
SESSION_ID="${RAW_SESSION_ID:0:8}"
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')

# ─── PERMISSION MODE ENFORCEMENT (physically blocks tools per worker mode) ───
# Matches Claude's agent type tool restrictions: readOnly, editOnly, planOnly, acceptEdits
WORKER_TASK_ID="${CLAUDE_WORKER_TASK_ID:-}"
PERMISSION_MODE="${CLAUDE_WORKER_PERMISSION_MODE:-acceptEdits}"

# readOnly mode: blocks Edit/Write/Bash entirely (research/exploration workers)
if [ "$PERMISSION_MODE" = "readOnly" ]; then
  case "$TOOL_NAME" in
    Edit|Write|Bash)
      echo "BLOCKED: This worker is in readOnly mode. Only Read/Grep/Glob/WebSearch allowed."
      exit 2
      ;;
  esac
fi

# editOnly mode: blocks Bash (safe editing, no command execution)
if [ "$PERMISSION_MODE" = "editOnly" ]; then
  case "$TOOL_NAME" in
    Bash)
      echo "BLOCKED: This worker is in editOnly mode. Bash commands not allowed. Use Read/Edit/Write."
      exit 2
      ;;
  esac
fi

# planOnly mode: blocks Edit/Write/Bash until plan approved (enforced plan-first)
if [ "$PERMISSION_MODE" = "planOnly" ] || { [ -n "$WORKER_TASK_ID" ] && [ "$PERMISSION_MODE" = "acceptEdits" ]; }; then
  if [ -n "$WORKER_TASK_ID" ]; then
    META_FILE=~/.claude/terminals/results/${WORKER_TASK_ID}.meta.json
    if [ -f "$META_FILE" ]; then
      REQUIRE_PLAN=$(jq -r '.require_plan // false' "$META_FILE" 2>/dev/null)
      IS_PLAN_MODE="false"
      [ "$PERMISSION_MODE" = "planOnly" ] && IS_PLAN_MODE="true"
      [ "$REQUIRE_PLAN" = "true" ] && IS_PLAN_MODE="true"
      if [ "$IS_PLAN_MODE" = "true" ]; then
        case "$TOOL_NAME" in
          Edit|Write|Bash)
            APPROVAL_FILE=~/.claude/terminals/results/${WORKER_TASK_ID}.approval
            if [ ! -f "$APPROVAL_FILE" ]; then
              echo "BLOCKED: Plan approval required before editing. Write your plan to results/${WORKER_TASK_ID}.plan.md, then notify lead and wait for '[APPROVED]' in your inbox."
              exit 2
            fi
            APPROVAL_STATUS=$(jq -r '.status // ""' "$APPROVAL_FILE" 2>/dev/null)
            if [ "$APPROVAL_STATUS" != "approved" ]; then
              echo "BLOCKED: Plan not yet approved (status: ${APPROVAL_STATUS}). Wait for lead approval before making edits."
              exit 2
            fi
            ;;
        esac
      fi
    fi
  fi
fi
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
      --arg done_summary "$DONE_SUMMARY" \
      --arg tail "$RESULT_TAIL" \
      '
      {
        ts: $ts,
        from: "coordinator",
        priority: "normal",
        content: (
          "[WORKER COMPLETED] " + $task + "\n" + $done_summary +
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

# ─── Plan Approval Check ───
# If this worker has a pending approval file, check and deliver it
RESULTS_DIR_CHECK=~/.claude/terminals/results
for approval_file in "$RESULTS_DIR_CHECK"/*.approval; do
  [ -f "$approval_file" ] || continue
  APPROVAL_TASK=$(basename "$approval_file" .approval)
  APPROVAL_REPORTED="$RESULTS_DIR_CHECK/${APPROVAL_TASK}.approval.reported"
  [ -f "$APPROVAL_REPORTED" ] && continue
  # Check if this approval is for our session (match by checking meta notify_session_id)
  META_CHECK="$RESULTS_DIR_CHECK/${APPROVAL_TASK}.meta.json"
  if [ -f "$META_CHECK" ]; then
    NOTIFY_SID=$(jq -r '.notify_session_id // empty' "$META_CHECK" 2>/dev/null || true)
    # If this worker IS the approval target or we can't determine, deliver it
    if [ "$NOTIFY_SID" = "$SESSION_ID" ] || [ -z "$NOTIFY_SID" ]; then
      APPROVAL_STATUS=$(jq -r '.status // "unknown"' "$approval_file" 2>/dev/null || echo "unknown")
      APPROVAL_MSG=$(jq -r '.message // .feedback // ""' "$approval_file" 2>/dev/null || true)
      echo "--- PLAN APPROVAL UPDATE ---"
      echo "Task: $APPROVAL_TASK"
      echo "Status: $APPROVAL_STATUS"
      [ -n "$APPROVAL_MSG" ] && echo "Message: $APPROVAL_MSG"
      echo "--- END APPROVAL ---"
      touch "$APPROVAL_REPORTED"
    fi
  fi
done

# ─── Task Board Suggestions (for interactive workers) ───
# Check for unassigned, unblocked pending tasks and suggest them
TASKS_DIR=~/.claude/terminals/tasks
if [ -d "$TASKS_DIR" ]; then
  PENDING_TASKS=""
  for tf in "$TASKS_DIR"/*.json; do
    [ -f "$tf" ] || continue
    T_STATUS=$(jq -r '.status // ""' "$tf" 2>/dev/null)
    T_ASSIGNEE=$(jq -r '.assignee // ""' "$tf" 2>/dev/null)
    [ "$T_STATUS" != "pending" ] && continue
    [ -n "$T_ASSIGNEE" ] && continue
    # Check not blocked
    T_BLOCKERS=$(jq -r '.blocked_by // [] | length' "$tf" 2>/dev/null || echo "0")
    [ "$T_BLOCKERS" -gt 0 ] && continue
    T_ID=$(jq -r '.task_id // ""' "$tf" 2>/dev/null)
    T_SUBJECT=$(jq -r '.subject // ""' "$tf" 2>/dev/null)
    PENDING_TASKS="${PENDING_TASKS}  - ${T_ID}: ${T_SUBJECT}\n"
  done
  if [ -n "$PENDING_TASKS" ]; then
    echo "--- AVAILABLE TASKS (unassigned, unblocked) ---"
    printf "%b" "$PENDING_TASKS"
    echo "Claim with: coord_update_task task_id=<ID> assignee=<your_name> status=in_progress"
    echo "--- END AVAILABLE TASKS ---"
  fi
fi

# Crash-safe drain: copy inbox to temp, display, then delete original.
# If hook crashes after copy but before delete, messages are still in the original file
# and will be re-delivered next time (idempotent delivery > lost messages).
if [ -f "$INBOX" ] && [ -s "$INBOX" ]; then
  TMP_INBOX=$(mktemp)
  cp "$INBOX" "$TMP_INBOX"
  # Check for shutdown requests — surface them as a distinct block
  if grep -q "SHUTDOWN_REQUEST" "$TMP_INBOX" 2>/dev/null; then
    echo "--- SHUTDOWN REQUEST ---"
    echo "The project lead has requested you shut down gracefully."
    echo "If you have unsaved work, finish it now."
    echo "To approve shutdown, notify the lead that you are done."
    echo "To reject, continue working and notify the lead why."
    echo "--- END SHUTDOWN REQUEST ---"
  fi
  echo "--- INCOMING MESSAGES FROM COORDINATOR ---"
  tr -d '\000-\010\013\014\016-\037\177\200-\237' < "$TMP_INBOX"
  echo "--- END MESSAGES ---"
  # Only delete after successful display
  rm -f "$INBOX" "$TMP_INBOX"
fi

exit 0
