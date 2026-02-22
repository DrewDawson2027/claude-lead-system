#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_HOME=$(mktemp -d)
export HOME="$TMP_HOME"

mkdir -p "$HOME/.claude/hooks" "$HOME/.claude/mcp-coordinator" "$HOME/.claude/terminals"
cp "$ROOT/hooks/terminal-heartbeat.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/session-register.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/check-inbox.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/session-end.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/teammate-lifecycle.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/token-guard.py" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/read-efficiency-guard.py" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/hook_utils.py" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/health-check.sh" "$HOME/.claude/hooks/"
chmod +x "$HOME/.claude/hooks/"*.sh
cp "$ROOT/mcp-coordinator/index.js" "$HOME/.claude/mcp-coordinator/index.js"

# Required agent fixtures for health-check
mkdir -p "$HOME/.claude/agents" "$HOME/.claude/master-agents"
for agent in master-coder master-researcher master-architect master-workflow; do
  cat > "$HOME/.claude/agents/${agent}.md" <<MD
# $agent
MD
done
cat > "$HOME/.claude/master-agents/MANIFEST.md" <<MD
# manifest
MD

# Required global hook registration fixtures
cat > "$HOME/.claude/settings.json" <<JSON
{
  "hooks": {
    "PreToolUse": [
      {"matcher":"Task","hooks":[{"command":"~/.claude/hooks/token-guard.py"}]},
      {"matcher":"Read","hooks":[{"command":"~/.claude/hooks/read-efficiency-guard.py"}]}
    ]
  }
}
JSON

# 1) Placeholder must fail
cat > "$HOME/.claude/settings.local.json" <<JSON
{
  "hooks": {
    "PreToolUse": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/check-inbox.sh"}]}],
    "PostToolUse": [{"matcher":"Edit|Write|Bash|Read","hooks":[{"command":"~/.claude/hooks/terminal-heartbeat.sh"}]}],
    "TeammateIdle": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TeammateIdle"}]}],
    "TaskCompleted": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TaskCompleted"}]}]
  },
  "mcpServers": {"coordinator": {"command":"node","args":["__HOME__/.claude/mcp-coordinator/index.js"]}}
}
JSON

if bash "$HOME/.claude/hooks/health-check.sh" >/tmp/hc-out-1.txt 2>&1; then
  echo "expected placeholder config to fail"
  exit 1
fi
grep -q "unresolved __HOME__ placeholder" /tmp/hc-out-1.txt

# 2) Valid config should pass
cat > "$HOME/.claude/settings.local.json" <<JSON
{
  "hooks": {
    "PreToolUse": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/check-inbox.sh"}]}],
    "PostToolUse": [{"matcher":"Edit|Write|Bash|Read","hooks":[{"command":"~/.claude/hooks/terminal-heartbeat.sh"}]}],
    "TeammateIdle": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TeammateIdle"}]}],
    "TaskCompleted": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TaskCompleted"}]}]
  },
  "mcpServers": {"coordinator": {"command":"node","args":["$HOME/.claude/mcp-coordinator/index.js"]}}
}
JSON

bash "$HOME/.claude/hooks/health-check.sh" >/tmp/hc-out-2.txt 2>&1
grep -q "STATUS: HEALTHY" /tmp/hc-out-2.txt

echo "health-check regression tests passed"
