#!/bin/bash
# Universal Terminal Heartbeat v2 — rate-limited, self-healing, versioned
# Triggered by PostToolUse on Edit|Write|Bash|Read
# Tracks: activity log, session liveness, files touched, tool counts, recent ops
#
# RATE LIMIT: Max 1 full heartbeat per 5 seconds per session.
# Between beats, only the activity log is appended (cheap).

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
if [ "$TOOL_NAME" = "Bash" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.command // "unknown"' | head -1 | cut -c1-80 | tr '"\\' '_')
else
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // "unknown"')
fi
CWD=$(echo "$INPUT" | jq -r '.cwd // "unknown"')
PROJECT=$(basename "$CWD")
SID8="${SESSION_ID:0:8}"

mkdir -p ~/.claude/terminals

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ─── ACTIVITY LOG (always fires, very cheap) ───
jq -n --arg ts "$NOW" --arg session "$SID8" --arg tool "$TOOL_NAME" \
      --arg file "$(basename "$FILE_PATH")" --arg path "$FILE_PATH" --arg project "$PROJECT" \
      '{ts:$ts,session:$session,tool:$tool,file:$file,path:$path,project:$project}' \
  >> ~/.claude/terminals/activity.jsonl

# ─── RATE LIMIT CHECK ───
# Use a lock file with mtime as the rate limiter (5-second cooldown)
LOCK_FILE="/tmp/claude-heartbeat-${SID8}.lock"
COOLDOWN=5  # seconds

if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0) ))
  if [ "$LOCK_AGE" -lt "$COOLDOWN" ]; then
    exit 0  # Skip full heartbeat, activity log already written
  fi
fi
touch "$LOCK_FILE"

# ─── FULL HEARTBEAT (rate-limited to 1 per 5s) ───

# Capture TTY
RAW_TTY=$(ps -o tty= -p $PPID 2>/dev/null | sed 's/ //g')
CURR_TTY=""
[ -n "$RAW_TTY" ] && [ "$RAW_TTY" != "??" ] && CURR_TTY="/dev/$RAW_TTY"

SESSION_FILE=~/.claude/terminals/session-${SID8}.json
SCHEMA_VERSION=2  # Increment when adding new fields

if [ -f "$SESSION_FILE" ]; then
  TMP=$(mktemp)
  TTY_UPDATE=""
  [ -n "$CURR_TTY" ] && TTY_UPDATE=' | .tty = "'"$CURR_TTY"'"'

  # Build the jq update expression
  JQ_EXPR='.last_active = "'"$NOW"'" | .last_tool = "'"$TOOL_NAME"'" | .last_file = "'"$(basename "$FILE_PATH")"'" | .schema_version = '"$SCHEMA_VERSION"''

  # TTY update
  JQ_EXPR="$JQ_EXPR$TTY_UPDATE"

  # Tool counts
  JQ_EXPR="$JQ_EXPR"' | .tool_counts = (.tool_counts // {}) | .tool_counts["'"$TOOL_NAME"'"] = ((.tool_counts["'"$TOOL_NAME"'"] // 0) + 1)'

  # Files touched (Write/Edit only, deduplicated, last 30)
  if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
    JQ_EXPR="$JQ_EXPR"' | .files_touched = (((.files_touched // []) | map(select(. != "'"$FILE_PATH"'"))) + ["'"$FILE_PATH"'"]) | .files_touched = .files_touched[-30:]'
  fi

  # Recent operations (last 10)
  JQ_EXPR="$JQ_EXPR"' | .recent_ops = (((.recent_ops // []) + [{"t":"'"$NOW"'","tool":"'"$TOOL_NAME"'","file":"'"$(basename "$FILE_PATH")"'"}])[-10:])'

  jq "$JQ_EXPR" "$SESSION_FILE" > "$TMP" 2>/dev/null && mv "$TMP" "$SESSION_FILE"
else
  # Fallback: create session file from PostToolUse context
  BRANCH=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null || echo "none")
  TTY_JSON=""
  [ -n "$CURR_TTY" ] && TTY_JSON=",\"tty\":\"$CURR_TTY\""
  cat > "$SESSION_FILE" <<ENDJSON
{"session":"$SID8","status":"active","project":"$PROJECT","branch":"$BRANCH","cwd":"$CWD","transcript":"unknown","started":"$NOW","last_active":"$NOW","last_tool":"$TOOL_NAME","last_file":"$(basename "$FILE_PATH")","source":"heartbeat-fallback","schema_version":$SCHEMA_VERSION,"tool_counts":{"$TOOL_NAME":1},"files_touched":[],"recent_ops":[{"t":"$NOW","tool":"$TOOL_NAME","file":"$(basename "$FILE_PATH")"}]$TTY_JSON}
ENDJSON
fi

# Track plan file writes
case "$FILE_PATH" in
  */.claude/plans/*.md)
    if [ -f "$SESSION_FILE" ]; then
      TMP=$(mktemp)
      jq '.plan_file = "'"$FILE_PATH"'"' "$SESSION_FILE" > "$TMP" && mv "$TMP" "$SESSION_FILE"
    fi
    ;;
esac

# ─── AUTO-STALE: Mark other sessions stale if inactive >1h ───
# Only check every 60s (not every heartbeat) by using a separate lock
STALE_LOCK="/tmp/claude-stale-check.lock"
STALE_COOLDOWN=60

DO_STALE=false
if [ ! -f "$STALE_LOCK" ]; then
  DO_STALE=true
else
  STALE_AGE=$(( $(date +%s) - $(stat -f %m "$STALE_LOCK" 2>/dev/null || stat -c %Y "$STALE_LOCK" 2>/dev/null || echo 0) ))
  [ "$STALE_AGE" -gt "$STALE_COOLDOWN" ] && DO_STALE=true
fi

if $DO_STALE; then
  touch "$STALE_LOCK"
  NOW_EPOCH=$(date +%s)
  for sf in ~/.claude/terminals/session-*.json; do
    [ -f "$sf" ] || continue
    [ "$sf" = "$SESSION_FILE" ] && continue

    SF_STATUS=$(jq -r '.status // "unknown"' "$sf" 2>/dev/null)
    [ "$SF_STATUS" != "active" ] && continue

    SF_LAST=$(jq -r '.last_active // "1970-01-01T00:00:00Z"' "$sf" 2>/dev/null)
    SF_EPOCH=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$SF_LAST" +%s 2>/dev/null || date -d "$SF_LAST" +%s 2>/dev/null || echo 0)

    AGE=$(( NOW_EPOCH - SF_EPOCH ))
    if [ "$AGE" -gt 3600 ]; then
      TMP=$(mktemp)
      jq '.status = "stale"' "$sf" > "$TMP" 2>/dev/null && mv "$TMP" "$sf"
    fi
  done
fi

# ─── Atlas backward compat ───
case "$CWD" in
  */Desktop/Atlas*|*/atlas-betting*)
    mkdir -p ~/.claude/atlas-terminals
    echo "{\"ts\":\"$NOW\",\"session\":\"$SID8\",\"tool\":\"$TOOL_NAME\",\"file\":\"$(basename "$FILE_PATH")\",\"path\":\"$FILE_PATH\",\"cwd\":\"$CWD\"}" >> ~/.claude/atlas-terminals/activity.jsonl
    ALINES=$(wc -l < ~/.claude/atlas-terminals/activity.jsonl 2>/dev/null || echo 0)
    [ "$ALINES" -gt 250 ] && tail -200 ~/.claude/atlas-terminals/activity.jsonl > ~/.claude/atlas-terminals/activity.tmp && mv ~/.claude/atlas-terminals/activity.tmp ~/.claude/atlas-terminals/activity.jsonl
    ;;
esac

# Auto-truncate activity log
LINES=$(wc -l < ~/.claude/terminals/activity.jsonl 2>/dev/null || echo 0)
[ "$LINES" -gt 600 ] && tail -500 ~/.claude/terminals/activity.jsonl > ~/.claude/terminals/activity.tmp && mv ~/.claude/terminals/activity.tmp ~/.claude/terminals/activity.jsonl

exit 0
