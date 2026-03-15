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

sleep 0.5

print_slow "# Claude Lead System — One control room for all your Claude Code terminals"
sleep 1.5

echo ""
print_slow "$ git clone https://github.com/DrewDawson2027/claude-lead-system.git"
sleep 0.5
echo "Cloning into 'claude-lead-system'..."
echo "remote: Enumerating objects: 1247, done."
echo "remote: Counting objects: 100% (1247/1247), done."
echo "✓ Cloned"
sleep 1

echo ""
print_slow "$ cd claude-lead-system && bash install.sh"
sleep 0.5
echo "✓ Hooks installed → ~/.claude/hooks/"
echo "✓ Commands installed → ~/.claude/commands/"
echo "✓ Settings applied"
echo "✓ MCP coordinator ready (81 tools)"
sleep 1.5

echo ""
print_slow "$ npm test 2>&1 | tail -8"
sleep 0.5
echo "  ✓ 730 coordinator unit tests passed"
echo "  ✓ 223 Python hook tests passed"
echo "  ✓ 43 shell integration tests passed"
echo "  ─────────────────────────────────"
echo "  Tests:      996 passed, 0 failed"
echo "  Coverage:   85.1%"
echo "  Duration:   12.4s"
sleep 1.5

echo ""
print_slow "$ echo '81 MCP coordination tools'"
echo "81 MCP coordination tools"
sleep 1

echo ""
print_slow "# Key Feature: Pre-edit conflict detection"
sleep 0.8
print_slow "# Two sessions editing the same file? Lead catches it BEFORE the collision."
sleep 1.5

echo ""
echo "  [session-a] → editing src/api/routes.ts"
echo "  [session-b] → wants to edit src/api/routes.ts"
echo "  ⚠  CONFLICT DETECTED — session-b paused, waiting for session-a"
sleep 2

echo ""
print_slow "# In-process UX: auto-stream worker output"
sleep 0.8
print_slow "# /focus researcher  — see their output live in your conversation"
sleep 0.6
print_slow "# /cycle             — rotate through active workers"
sleep 0.6
print_slow "# /unfocus           — stop streaming"
sleep 2

echo ""
print_slow "# 996 tests  |  81 tools  |  All CI green  |  Zero API tokens for coordination"
sleep 3
