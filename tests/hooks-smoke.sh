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

# Invalid session IDs must fail closed before filesystem writes.
bad_session_input=$(jq -n --arg sid "../../bad-session" --arg cwd "$HOME/project with \"quotes\"" '{session_id:$sid,cwd:$cwd}')
if printf '%s' "$bad_session_input" | bash "$ROOT/hooks/session-register.sh" >/tmp/session-register-invalid.out 2>/tmp/session-register-invalid.err; then
  echo "session-register should reject invalid session IDs"
  exit 1
fi
grep -q "Invalid session_id" /tmp/session-register-invalid.err

if printf '%s' '{"session_id":"../../bad-heartbeat","tool_name":"Edit","cwd":"/tmp","tool_input":{"file_path":"src/main.ts"}}' | bash "$ROOT/hooks/terminal-heartbeat.sh" >/tmp/heartbeat-invalid.out 2>/tmp/heartbeat-invalid.err; then
  echo "terminal-heartbeat should reject invalid session IDs"
  exit 1
fi
grep -q "Invalid session_id" /tmp/heartbeat-invalid.err

if printf '%s' '{"tool_name":"Task","session_id":"../../bad-task","tool_input":{"subagent_type":"builder"}}' | python3 "$ROOT/hooks/token-guard.py" >/tmp/token-guard-invalid.out 2>/tmp/token-guard-invalid.err; then
  echo "token-guard should reject invalid session IDs"
  exit 1
fi
grep -q "Invalid session_id" /tmp/token-guard-invalid.err

if printf '%s' '{"tool_name":"Read","session_id":"../../bad-read","tool_input":{"file_path":"README.md"}}' | python3 "$ROOT/hooks/read-efficiency-guard.py" >/tmp/read-guard-invalid.out 2>/tmp/read-guard-invalid.err; then
  echo "read-efficiency-guard should reject invalid session IDs"
  exit 1
fi
grep -q "Invalid session_id" /tmp/read-guard-invalid.err

if printf '%s' '{"session_id":"../../bad-inbox"}' | bash "$ROOT/hooks/check-inbox.sh" >/tmp/check-inbox-invalid.out 2>/tmp/check-inbox-invalid.err; then
  echo "check-inbox should reject invalid session IDs"
  exit 1
fi
grep -q "Invalid session_id" /tmp/check-inbox-invalid.err

if printf '%s' '{"session_id":"../../bad-end"}' | bash "$ROOT/hooks/session-end.sh" >/tmp/session-end-invalid.out 2>/tmp/session-end-invalid.err; then
  echo "session-end should reject invalid session IDs"
  exit 1
fi
grep -q "Invalid session_id" /tmp/session-end-invalid.err

# Worker completions are routed to a target inbox, not broadcast globally.
mkdir -p "$HOME/.claude/terminals/inbox" "$HOME/.claude/terminals/results"
cat > "$HOME/.claude/terminals/results/WROUTE.meta.json" <<JSON
{"task_id":"WROUTE","notify_session_id":"abcd1234","status":"running"}
JSON
cat > "$HOME/.claude/terminals/results/WROUTE.meta.json.done" <<JSON
{"status":"completed","task_id":"WROUTE"}
JSON
cat > "$HOME/.claude/terminals/results/WROUTE.txt" <<TXT
line-1
line-2
TXT

other_session_input=$(jq -n --arg sid "efgh5678ijkl9999" '{session_id:$sid}')
printf '%s' "$other_session_input" | bash "$ROOT/hooks/check-inbox.sh" >/tmp/check-inbox-other.out 2>/tmp/check-inbox-other.err
if grep -q "WORKER COMPLETED" /tmp/check-inbox-other.out; then
  echo "worker completion output should not be broadcast to unrelated sessions"
  exit 1
fi
grep -q "\[WORKER COMPLETED\] WROUTE" "$HOME/.claude/terminals/inbox/abcd1234.jsonl"
[ -f "$HOME/.claude/terminals/results/WROUTE.reported" ]

# If no target session is declared, completion must not be dropped as reported.
cat > "$HOME/.claude/terminals/results/WUNTARGETED.meta.json" <<JSON
{"task_id":"WUNTARGETED","status":"running"}
JSON
cat > "$HOME/.claude/terminals/results/WUNTARGETED.meta.json.done" <<JSON
{"status":"completed","task_id":"WUNTARGETED"}
JSON
cat > "$HOME/.claude/terminals/results/WUNTARGETED.txt" <<TXT
untargeted
TXT
printf '%s' "$other_session_input" | bash "$ROOT/hooks/check-inbox.sh" >/tmp/check-inbox-untargeted.out 2>/tmp/check-inbox-untargeted.err
[ ! -f "$HOME/.claude/terminals/results/WUNTARGETED.reported" ]

echo "hooks smoke tests passed"
