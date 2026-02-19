#!/bin/bash
# Health-check regression test — verifies that key behaviors and file contracts
# remain consistent across code changes. Runs in CI without requiring installed hooks.
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

check_contains() {
  local name="$1" file="$2" pattern="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (pattern '$pattern' not found in $file)"
    FAIL=$((FAIL + 1))
  fi
}

check_not_contains() {
  local name="$1" file="$2" pattern="$3"
  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (unexpected pattern '$pattern' found in $file)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Health-Check Regression Test ==="
echo ""

echo "Package manifest:"
check "package.json valid JSON"   node -e "JSON.parse(require('fs').readFileSync('$REPO_ROOT/mcp-coordinator/package.json','utf-8'))"
check "package.json has name"     node -e "const p=JSON.parse(require('fs').readFileSync('$REPO_ROOT/mcp-coordinator/package.json','utf-8')); if(!p.name) process.exit(1)"
check "package.json has engines"  node -e "const p=JSON.parse(require('fs').readFileSync('$REPO_ROOT/mcp-coordinator/package.json','utf-8')); if(!p.engines) process.exit(1)"
check "package.json has scripts"  node -e "const p=JSON.parse(require('fs').readFileSync('$REPO_ROOT/mcp-coordinator/package.json','utf-8')); if(!p.scripts||!p.scripts['test:unit']) process.exit(1)"
check "package-lock.json exists"  test -f "$REPO_ROOT/mcp-coordinator/package-lock.json"

echo ""
echo "Settings contract:"
check_contains "settings has coordinator MCP"       "$REPO_ROOT/settings/settings.local.json" '"coordinator"'
check_contains "settings has terminal-heartbeat"    "$REPO_ROOT/settings/settings.local.json" "terminal-heartbeat"
check_contains "settings has check-inbox"           "$REPO_ROOT/settings/settings.local.json" "check-inbox"
check_contains "settings has session-register"      "$REPO_ROOT/settings/settings.local.json" "session-register"
check_contains "settings has session-end"           "$REPO_ROOT/settings/settings.local.json" "session-end"
check_not_contains "no personal paths in settings"  "$REPO_ROOT/settings/settings.local.json" "/Users/drewdawson"
check_not_contains "no Atlas prompt in settings"    "$REPO_ROOT/settings/settings.local.json" "ATLAS"

echo ""
echo "Heartbeat hook contract:"
check_not_contains "no atlas-terminals ref"   "$REPO_ROOT/hooks/terminal-heartbeat.sh" "atlas-terminals"
check_not_contains "no Desktop/Atlas ref"     "$REPO_ROOT/hooks/terminal-heartbeat.sh" "Desktop/Atlas"
check_contains     "has jq safe-args"         "$REPO_ROOT/hooks/terminal-heartbeat.sh" "jq --arg"
check_contains     "has rate-limit logic"     "$REPO_ROOT/hooks/terminal-heartbeat.sh" "COOLDOWN"

echo ""
echo "MCP coordinator contract:"
check_contains "sanitizeId exported in lib"   "$REPO_ROOT/mcp-coordinator/lib.js" "export function sanitizeId"
check_contains "sanitizeModel exported"       "$REPO_ROOT/mcp-coordinator/lib.js" "export function sanitizeModel"
check_contains "index imports sanitizeId"     "$REPO_ROOT/mcp-coordinator/index.js" "sanitizeId"
check_contains "index imports sanitizeModel"  "$REPO_ROOT/mcp-coordinator/index.js" "sanitizeModel"

echo ""
echo "CI workflow:"
check "ci.yml exists" test -f "$REPO_ROOT/.github/workflows/ci.yml"
check_contains "ci has unit test job"       "$REPO_ROOT/.github/workflows/ci.yml" "test:unit"
check_contains "ci has smoke test job"      "$REPO_ROOT/.github/workflows/ci.yml" "hooks-smoke"
check_contains "ci has regression test job" "$REPO_ROOT/.github/workflows/ci.yml" "health-check-regression"

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
