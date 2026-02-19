#!/bin/bash
# Hook Health Check — validates all hooks are working
# Run manually: bash ~/.claude/hooks/health-check.sh
# Or call from /lead: "health check"

echo ""
echo "=== Claude Code Hook Health Check ==="
echo ""

PASS=0
FAIL=0
WARN=0

check() {
  local name="$1" file="$2" required="$3"
  if [ ! -f "$file" ]; then
    if [ "$required" = "required" ]; then
      echo "  FAIL  $name — file missing: $file"
      FAIL=$((FAIL + 1))
    else
      echo "  SKIP  $name — not installed"
    fi
    return
  fi
  if [ ! -x "$file" ] && [[ "$file" == *.sh ]]; then
    echo "  FAIL  $name — not executable: $file"
    FAIL=$((FAIL + 1))
    return
  fi
  # Check syntax
  if [[ "$file" == *.sh ]]; then
    if bash -n "$file" 2>/dev/null; then
      echo "  PASS  $name"
      PASS=$((PASS + 1))
    else
      echo "  FAIL  $name — syntax error"
      FAIL=$((FAIL + 1))
    fi
  elif [[ "$file" == *.py ]]; then
    if python3 -c "import py_compile; py_compile.compile('$file', doraise=True)" 2>/dev/null; then
      echo "  PASS  $name"
      PASS=$((PASS + 1))
    else
      echo "  FAIL  $name — syntax error"
      FAIL=$((FAIL + 1))
    fi
  elif [[ "$file" == *.js ]]; then
    if node --check "$file" 2>/dev/null; then
      echo "  PASS  $name"
      PASS=$((PASS + 1))
    else
      echo "  FAIL  $name — syntax error"
      FAIL=$((FAIL + 1))
    fi
  fi
}

echo "Hooks:"
check "terminal-heartbeat" ~/.claude/hooks/terminal-heartbeat.sh required
check "session-register" ~/.claude/hooks/session-register.sh required
check "check-inbox" ~/.claude/hooks/check-inbox.sh required
check "session-end" ~/.claude/hooks/session-end.sh required
check "token-guard" ~/.claude/hooks/token-guard.py optional
check "read-efficiency-guard" ~/.claude/hooks/read-efficiency-guard.py optional

echo ""
echo "MCP Coordinator:"
check "coordinator" ~/.claude/mcp-coordinator/index.js required

echo ""
echo "Dependencies:"
if command -v jq &>/dev/null; then
  echo "  PASS  jq installed ($(jq --version 2>/dev/null))"
  PASS=$((PASS + 1))
else
  echo "  FAIL  jq not installed — heartbeat won't work"
  FAIL=$((FAIL + 1))
fi

if command -v node &>/dev/null; then
  echo "  PASS  node installed ($(node --version 2>/dev/null))"
  PASS=$((PASS + 1))
else
  echo "  FAIL  node not installed — MCP coordinator won't work"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Settings:"
if [ -f ~/.claude/settings.local.json ]; then
  # Check heartbeat is registered (nested structure: .hooks.PostToolUse[].hooks[].command)
  if jq -e '.hooks.PostToolUse[].hooks[]? | select(.command | contains("terminal-heartbeat"))' ~/.claude/settings.local.json &>/dev/null; then
    echo "  PASS  heartbeat registered in PostToolUse"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  heartbeat NOT registered in PostToolUse"
    FAIL=$((FAIL + 1))
  fi
  if jq -e '.hooks.PreToolUse[].hooks[]? | select(.command | contains("check-inbox"))' ~/.claude/settings.local.json &>/dev/null; then
    echo "  PASS  inbox hook registered in PreToolUse"
    PASS=$((PASS + 1))
  else
    # Also check global settings
    if jq -e '.hooks.PreToolUse[].hooks[]? | select(.command | contains("check-inbox"))' ~/.claude/settings.json &>/dev/null 2>/dev/null; then
      echo "  PASS  inbox hook registered in global settings"
      PASS=$((PASS + 1))
    else
      echo "  WARN  inbox hook not found (messaging may not work)"
      WARN=$((WARN + 1))
    fi
  fi
else
  echo "  FAIL  settings.local.json not found"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Session Files:"
ACTIVE=$(ls ~/.claude/terminals/session-*.json 2>/dev/null | wc -l | tr -d ' ')
echo "  INFO  $ACTIVE session file(s) on disk"

echo ""
echo "Activity Log:"
if [ -f ~/.claude/terminals/activity.jsonl ]; then
  LINES=$(wc -l < ~/.claude/terminals/activity.jsonl | tr -d ' ')
  LAST=$(tail -1 ~/.claude/terminals/activity.jsonl 2>/dev/null | jq -r '.ts // "unknown"' 2>/dev/null)
  echo "  INFO  $LINES entries, last: $LAST"
else
  echo "  WARN  no activity log yet"
  WARN=$((WARN + 1))
fi

echo ""
echo "─────────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed, $WARN warnings"
if [ "$FAIL" -gt 0 ]; then
  echo "  STATUS: UNHEALTHY — fix the failures above"
  exit 1
else
  echo "  STATUS: HEALTHY"
  exit 0
fi
