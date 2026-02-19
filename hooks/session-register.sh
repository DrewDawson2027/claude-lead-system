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
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"session\":\"${SESSION_ID:0:8}\",\"event\":\"start\",\"source\":\"$SOURCE\",\"project\":\"$PROJECT\",\"branch\":\"$BRANCH\",\"cwd\":\"$CWD\",\"transcript\":\"$TRANSCRIPT\"}" \
  >> ~/.claude/terminals/sessions.jsonl

# Capture TTY for reliable tab targeting by coord_wake_session
# Hooks run in pipe context so tty always fails — use ps to get parent's TTY
RAW_TTY=$(ps -o tty= -p $PPID 2>/dev/null | sed 's/ //g')
TTY=""
[ -n "$RAW_TTY" ] && [ "$RAW_TTY" != "??" ] && TTY="/dev/$RAW_TTY"
TTY_JSON=""
[ -n "$TTY" ] && TTY_JSON=",\"tty\":\"$TTY\""

# Write per-session status file for quick lookup by lead
echo "{\"session\":\"${SESSION_ID:0:8}\",\"status\":\"active\",\"project\":\"$PROJECT\",\"branch\":\"$BRANCH\",\"cwd\":\"$CWD\",\"transcript\":\"$TRANSCRIPT\",\"started\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"last_active\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"$TTY_JSON}" \
  > ~/.claude/terminals/session-${SESSION_ID:0:8}.json

# Auto-truncate sessions log
LINES=$(wc -l < ~/.claude/terminals/sessions.jsonl 2>/dev/null || echo 0)
if [ "$LINES" -gt 200 ]; then
  tail -150 ~/.claude/terminals/sessions.jsonl > ~/.claude/terminals/sessions.tmp
  mv ~/.claude/terminals/sessions.tmp ~/.claude/terminals/sessions.jsonl
fi

# Fix 1: Set terminal tab title to session ID for wake targeting by coord_wake_session
printf '\e]0;claude-%s\a' "${SESSION_ID:0:8}"

exit 0
