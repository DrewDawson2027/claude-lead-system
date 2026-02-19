#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_HOME=$(mktemp -d)
export HOME="$TMP_HOME"

mkdir -p "$HOME/.claude/terminals"
mkdir -p "$HOME/project with \"quotes\""

session_input=$(jq -n \
  --arg sid "abcd1234efgh5678" \
  --arg cwd "$HOME/project with \"quotes\"" \
  --arg transcript "$HOME/transcripts/with \"quotes\".jsonl" \
  --arg source "startup" \
  '{session_id:$sid,cwd:$cwd,transcript_path:$transcript,source:$source}')

printf '%s' "$session_input" | bash "$ROOT/hooks/session-register.sh"

SESSION_FILE="$HOME/.claude/terminals/session-abcd1234.json"
[ -f "$SESSION_FILE" ]

jq -e '.session == "abcd1234" and .status == "active" and (.cwd | contains("quotes"))' "$SESSION_FILE" >/dev/null

heartbeat_input=$(jq -n \
  --arg sid "abcd1234efgh5678" \
  --arg cwd "$HOME/project with \"quotes\"" \
  '{session_id:$sid, tool_name:"Edit", cwd:$cwd, tool_input:{file_path:"src/main.ts"}}')

printf '%s' "$heartbeat_input" | bash "$ROOT/hooks/terminal-heartbeat.sh"

jq -e '.tool_counts.Edit >= 1 and (.files_touched | index("src/main.ts")) != null' "$SESSION_FILE" >/dev/null

echo "hooks smoke tests passed"
