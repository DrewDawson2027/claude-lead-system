#!/bin/bash
# Hooks smoke test — verifies all hook files have valid syntax and expected structure.
# Runs from any directory; uses the repo root via the script's own location.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Hooks Smoke Test ==="
echo ""

echo "Shell syntax:"
check "terminal-heartbeat.sh" bash -n "$REPO_ROOT/hooks/terminal-heartbeat.sh"
check "session-register.sh"   bash -n "$REPO_ROOT/hooks/session-register.sh"
check "check-inbox.sh"        bash -n "$REPO_ROOT/hooks/check-inbox.sh"
check "session-end.sh"        bash -n "$REPO_ROOT/hooks/session-end.sh"
check "health-check.sh"       bash -n "$REPO_ROOT/hooks/health-check.sh"
check "install.sh"            bash -n "$REPO_ROOT/install.sh"

echo ""
echo "Python syntax:"
check "token-guard.py"          python3 -m py_compile "$REPO_ROOT/hooks/token-guard.py"
check "read-efficiency-guard.py" python3 -m py_compile "$REPO_ROOT/hooks/read-efficiency-guard.py"

echo ""
echo "Node.js syntax:"
check "mcp-coordinator/index.js" node --check "$REPO_ROOT/mcp-coordinator/index.js"
check "mcp-coordinator/lib.js"   node --check "$REPO_ROOT/mcp-coordinator/lib.js"

echo ""
echo "File structure:"
check "hooks/ dir exists"          test -d "$REPO_ROOT/hooks"
check "mcp-coordinator/ dir exists" test -d "$REPO_ROOT/mcp-coordinator"
check "commands/lead.md exists"     test -f "$REPO_ROOT/commands/lead.md"
check "settings/ dir exists"        test -d "$REPO_ROOT/settings"
check "settings.local.json valid"   node -e "JSON.parse(require('fs').readFileSync('$REPO_ROOT/settings/settings.local.json','utf-8'))"

echo ""
echo "No private references:"
# Fail if private project paths are found in hook scripts
if grep -rqE "Desktop/Atlas|atlas-betting|atlas-terminals|trust-engine|ssrn-researcher|statusline-setup" "$REPO_ROOT/hooks/" 2>/dev/null; then
  echo "  FAIL  private project references found in hooks/"
  FAIL=$((FAIL + 1))
else
  echo "  PASS  no private project references in hooks/"
  PASS=$((PASS + 1))
fi
# Fail if private project references appear in commands/
if grep -rqE "trust-engine|atlas-betting|ssrn-researcher|/Users/drewdawson" "$REPO_ROOT/commands/" 2>/dev/null; then
  echo "  FAIL  private references found in commands/"
  FAIL=$((FAIL + 1))
else
  echo "  PASS  no private references in commands/"
  PASS=$((PASS + 1))
fi
# Fail if personal paths like /Users/drewdawson are found in settings
if grep -qE "/Users/drewdawson|Atlas Strategic|ATLAS STRATEGIC|ATLAS" "$REPO_ROOT/settings/settings.local.json" 2>/dev/null; then
  echo "  FAIL  private personal references found in settings/settings.local.json"
  FAIL=$((FAIL + 1))
else
  echo "  PASS  no private personal references in settings/settings.local.json"
  PASS=$((PASS + 1))
fi

echo ""
echo "─────────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  STATUS: FAILED"
  exit 1
else
  echo "  STATUS: PASSED"
  exit 0
fi
