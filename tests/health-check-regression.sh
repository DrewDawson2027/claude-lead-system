#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_HOME=$(mktemp -d)
export HOME="$TMP_HOME"

mkdir -p "$HOME/.claude/hooks" "$HOME/.claude/mcp-coordinator" "$HOME/.claude/terminals" "$HOME/.claude/commands" "$HOME/.claude/lead-sidecar/bin" "$HOME/.local/bin"
cp "$ROOT/hooks/terminal-heartbeat.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/session-register.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/check-inbox.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/session-end.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/teammate-lifecycle.sh" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/token-guard.py" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/model-router.py" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/read-efficiency-guard.py" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/hook_utils.py" "$HOME/.claude/hooks/"
cp "$ROOT/hooks/health-check.sh" "$HOME/.claude/hooks/"
chmod +x "$HOME/.claude/hooks/"*.sh
cp "$ROOT/mcp-coordinator/index.js" "$HOME/.claude/mcp-coordinator/index.js"

cat > "$HOME/.claude/commands/lead.md" <<MD
# /lead
MD

cat > "$HOME/.claude/lead-sidecar/bin/claudex" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat > "$HOME/.claude/lead-sidecar/bin/sidecarctl" <<'SH'
#!/usr/bin/env bash
exit 0
SH

chmod +x "$HOME/.claude/lead-sidecar/bin/claudex" "$HOME/.claude/lead-sidecar/bin/sidecarctl"
ln -sf "$HOME/.claude/lead-sidecar/bin/claudex" "$HOME/.local/bin/claudex"
ln -sf "$HOME/.claude/lead-sidecar/bin/sidecarctl" "$HOME/.local/bin/sidecarctl"

# Install marker so health-check runs in "installed" mode
printf '{"installed_at":"2026-01-01T00:00:00Z","mode":"full","ref":"test"}\n' > "$HOME/.claude/.lead-system-install.json"

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
      {"matcher":"*","hooks":[{"command":"~/.claude/hooks/check-inbox.sh"}]},
      {"matcher":"Task","hooks":[{"command":"~/.claude/hooks/token-guard.py"},{"command":"~/.claude/hooks/model-router.py"}]},
      {"matcher":"Read","hooks":[{"command":"~/.claude/hooks/read-efficiency-guard.py"}]}
    ],
    "PostToolUse": [
      {"matcher":"Edit|Write|Bash|Read","hooks":[{"command":"~/.claude/hooks/terminal-heartbeat.sh"}]}
    ],
    "TeammateIdle": [
      {"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TeammateIdle"}]}
    ],
    "TaskCompleted": [
      {"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TaskCompleted"}]}
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

# 2) Effective global settings should pass
cat > "$HOME/.claude/settings.local.json" <<JSON
{
  "mcpServers": {"coordinator": {"command":"node","args":["$HOME/.claude/mcp-coordinator/index.js"]}}
}
JSON

bash "$HOME/.claude/hooks/health-check.sh" >/tmp/hc-out-2.txt 2>&1
grep -q "heartbeat registered in settings" /tmp/hc-out-2.txt
grep -q "STATUS: HEALTHY" /tmp/hc-out-2.txt

# 3) Valid local config should pass
rm -f "$HOME/.claude/settings.json"
cat > "$HOME/.claude/settings.local.json" <<JSON
{
  "hooks": {
    "PreToolUse": [
      {"matcher":"*","hooks":[{"command":"~/.claude/hooks/check-inbox.sh"}]},
      {"matcher":"Task","hooks":[{"command":"python3 ~/.claude/hooks/token-guard.py"},{"command":"python3 ~/.claude/hooks/model-router.py"}]}
    ],
    "PostToolUse": [
      {"matcher":"Read","hooks":[{"command":"python3 ~/.claude/hooks/read-efficiency-guard.py"}]},
      {"matcher":"Edit|Write|Bash|Read","hooks":[{"command":"~/.claude/hooks/terminal-heartbeat.sh"}]}
    ],
    "TeammateIdle": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TeammateIdle"}]}],
    "TaskCompleted": [{"matcher":"*","hooks":[{"command":"~/.claude/hooks/teammate-lifecycle.sh TaskCompleted"}]}]
  },
  "mcpServers": {"coordinator": {"command":"node","args":["$HOME/.claude/mcp-coordinator/index.js"]}}
}
JSON

bash "$HOME/.claude/hooks/health-check.sh" >/tmp/hc-out-3.txt 2>&1
grep -q "STATUS: HEALTHY" /tmp/hc-out-3.txt

# 4) Node <18 should fail with a clear runtime floor error
REAL_NODE="$(command -v node)"
FAKE_NODE_BIN=$(mktemp -d "${TMPDIR:-/tmp}/hc-node-XXXXXX")
cat > "$FAKE_NODE_BIN/node" <<SH
#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--version" ]; then
  echo "v16.20.2"
  exit 0
fi
if [ "\${1:-}" = "--check" ]; then
  exit 0
fi
exec "$REAL_NODE" "\$@"
SH
chmod +x "$FAKE_NODE_BIN/node"

if PATH="$FAKE_NODE_BIN:$PATH" bash "$HOME/.claude/hooks/health-check.sh" >/tmp/hc-out-4.txt 2>&1; then
  echo "expected Node <18 to fail"
  exit 1
fi
grep -q "node version unsupported (v16.20.2) — require >=18" /tmp/hc-out-4.txt

echo "health-check regression tests passed"
