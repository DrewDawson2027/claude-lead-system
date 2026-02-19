#!/bin/bash
# Universal Session Registry — registers EVERY Claude Code session with full metadata
# Triggered by SessionStart hook
# Captures transcript_path so the lead can read other sessions' conversations
INPUT=$(cat)

mkdir -p ~/.claude/terminals

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
CWD=$(echo "$INPUT" | jq -r '.cwd // "unknown"')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // "unknown"')
SOURCE=$(echo "$INPUT" | jq -r '.source // "startup"')

# Structured debug logging — no raw input (avoids logging sensitive data)
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) session=${SESSION_ID:0:8} cwd=$CWD source=$SOURCE" >> ~/.claude/terminals/debug-session-register.log

PROJECT=$(basename "$CWD")
BRANCH=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null || echo "none")

# Append to session log
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
jq -n \
  --arg ts "$NOW" \
  --arg session "${SESSION_ID:0:8}" \
  --arg source "$SOURCE" \
  --arg project "$PROJECT" \
  --arg branch "$BRANCH" \
  --arg cwd "$CWD" \
  --arg transcript "$TRANSCRIPT" \
  '{ts:$ts,session:$session,event:"start",source:$source,project:$project,branch:$branch,cwd:$cwd,transcript:$transcript}' \
  >> ~/.claude/terminals/sessions.jsonl

# Capture TTY for reliable tab targeting by coord_wake_session
# Hooks run in pipe context so tty always fails — use ps to get parent's TTY
RAW_TTY=$(ps -o tty= -p $PPID 2>/dev/null | sed 's/ //g')
TTY=""
[ -n "$RAW_TTY" ] && [ "$RAW_TTY" != "??" ] && TTY="/dev/$RAW_TTY"
# Write per-session status file for quick lookup by lead
SESSION_FILE=~/.claude/terminals/session-"${SESSION_ID:0:8}".json
jq -n \
  --arg session "${SESSION_ID:0:8}" \
  --arg project "$PROJECT" \
  --arg branch "$BRANCH" \
  --arg cwd "$CWD" \
  --arg transcript "$TRANSCRIPT" \
  --arg started "$NOW" \
  --arg last_active "$NOW" \
  --arg tty "$TTY" \
  '
  {
    session: $session,
    status: "active",
    project: $project,
    branch: $branch,
    cwd: $cwd,
    transcript: $transcript,
    started: $started,
    last_active: $last_active
  } |
  (if $tty != "" then .tty = $tty else . end)
  ' > "$SESSION_FILE"

# Auto-truncate sessions log
LINES=$(wc -l < ~/.claude/terminals/sessions.jsonl 2>/dev/null || echo 0)
if [ "$LINES" -gt 200 ]; then
  tail -150 ~/.claude/terminals/sessions.jsonl > ~/.claude/terminals/sessions.tmp
  mv ~/.claude/terminals/sessions.tmp ~/.claude/terminals/sessions.jsonl
fi

# Fix 1: Set terminal tab title to session ID for wake targeting by coord_wake_session
printf '\e]0;claude-%s\a' "${SESSION_ID:0:8}"

exit 0
