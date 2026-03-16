#!/usr/bin/env bash
# Scripted demo for asciinema recording
# Run via: asciinema rec demo.cast --command "bash scripts/demo-script.sh" --overwrite

print_slow() {
  local text="$1"
  local delay="${2:-0.04}"
  for (( i=0; i<${#text}; i++ )); do
    printf "%s" "${text:$i:1}"
    sleep "$delay"
  done
  echo
}

clear
sleep 0.5

print_slow "# Claude Lead System — One control room for all your Claude Code terminals"
sleep 1.5

echo ""
print_slow '$ claudex'
sleep 0.5
echo "Starting Lead background service..."
echo "✓ Sidecar running on https://127.0.0.1:8443"
echo "✓ Settings synced (81 MCP tools)"
echo ""
echo "Claude Code ready."
sleep 1

echo ""
print_slow '$ /lead'
sleep 0.5
echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  Lead Dashboard — 3 active terminals                       │"
echo "├──────────┬────────────┬──────────────────────┬─────────────┤"
echo "│ Session  │ Status     │ Project              │ Files       │"
echo "├──────────┼────────────┼──────────────────────┼─────────────┤"
echo "│ lead     │ ● active   │ claude-lead-system   │ —           │"
echo "│ worker-a │ ● active   │ trust-engine         │ src/auth.ts │"
echo "│ worker-b │ ● active   │ trust-engine         │ src/auth.ts │"
echo "└──────────┴────────────┴──────────────────────┴─────────────┘"
sleep 2

echo ""
print_slow '> "check conflicts"'
sleep 0.8
echo ""
echo "  ⚠  CONFLICT DETECTED"
echo "  ────────────────────────────────────────────────"
echo "  src/auth.ts"
echo "    worker-a (editing) ↔ worker-b (editing)"
echo "    Both sessions touching the same file."
echo "    Risk: one will overwrite the other."
echo "  ────────────────────────────────────────────────"
sleep 2.5

echo ""
print_slow '> "tell worker-b to switch to src/middleware.ts instead"'
sleep 0.5
echo ""
echo "  ✓ Message delivered to worker-b"
echo "  worker-b acknowledged: switching to src/middleware.ts"
sleep 1.5

echo ""
print_slow '> "check conflicts"'
sleep 0.5
echo ""
echo "  ✓ No conflicts detected across 3 sessions."
sleep 2

echo ""
print_slow '> "spawn a reviewer to check the test suite"'
sleep 0.5
echo ""
echo "  ✓ Worker 'reviewer' spawned (model: sonnet, role: reviewer)"
echo "  ✓ Running in worktree: ~/.claude/worktrees/slot-3"
sleep 1

echo ""
print_slow '> "check on reviewer"'
sleep 0.5
echo ""
echo "  reviewer [running] — 12s elapsed"
echo "  Last output: Reading mcp-coordinator/test/... analyzing 480 tests"
echo "  Files touched: none (read-only mode)"
sleep 2

echo ""
echo "──────────────────────────────────────────────────────────────"
echo ""
print_slow "# 847 tests  |  81 tools  |  macOS + Linux verified  |  Zero API tokens for coordination"
sleep 3
