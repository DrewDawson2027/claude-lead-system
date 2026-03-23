#!/usr/bin/env bash
# check-claim-drift.sh — Verify README claims match reality.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
README="$REPO_ROOT/README.md"

PASS=0
FAIL=0
WARN=0

log_ok()   { echo "  OK:   $*"; PASS=$((PASS + 1)); }
log_fail() { echo "  FAIL: $*" >&2; FAIL=$((FAIL + 1)); }
log_warn() { echo "  WARN: $*"; WARN=$((WARN + 1)); }

echo "Checking README claim drift..."
echo ""

# 1. All docs/*.md links in README resolve to existing files
echo "Checking doc links..."
doc_refs=$(grep -oE '\(docs/[A-Za-z0-9_.-]+\.md\)' "$README" | tr -d '()' | sort -u || true)
for ref in $doc_refs; do
  if [ -f "$REPO_ROOT/$ref" ]; then
    log_ok "$ref exists"
  else
    log_fail "$ref referenced in README but file missing"
  fi
done

# 2. Lead-exclusive capability table has exactly 9 rows
echo ""
echo "Checking feature table row count..."
feature_rows=$(sed -n '/^| # | Capability | Detail |$/,/^$/p' "$README" | grep -c '^|'; true)
feature_rows=${feature_rows:-0}
# Subtract 2 for header + separator rows
feature_count=$((feature_rows - 2))
if [ "$feature_count" -eq 9 ]; then
  log_ok "Lead-exclusive capability table has $feature_count rows (matches README)"
elif [ "$feature_count" -gt 0 ]; then
  log_warn "Lead-exclusive capability table has $feature_count rows (README currently expects 9)"
else
  log_warn "Could not parse lead-exclusive capability table"
fi

# 3. bench/latest-results.json exists and is valid JSON
echo ""
echo "Checking benchmark artifacts..."
BENCH_FILE="$REPO_ROOT/bench/latest-results.json"
if [ -f "$BENCH_FILE" ]; then
  if python3 -c "import json; json.load(open('$BENCH_FILE'))" 2>/dev/null; then
    log_ok "bench/latest-results.json is valid JSON"
  else
    log_fail "bench/latest-results.json is invalid JSON"
  fi
else
  log_warn "bench/latest-results.json not found (may not exist until first benchmark run)"
fi

# 4. Legacy cost totals (if present) must match methodology doc
echo ""
echo "Checking cost comparison consistency..."
METHODOLOGY="$REPO_ROOT/docs/COMPARISON_METHODOLOGY.md"
readme_total_at=$(grep -c '\$8\.10' "$README"; true)
readme_total_at=${readme_total_at:-0}
readme_total_ls=$(grep -c '\$3\.51' "$README"; true)
readme_total_ls=${readme_total_ls:-0}

if [ "$readme_total_at" -eq 0 ] && [ "$readme_total_ls" -eq 0 ]; then
  log_ok "Legacy fixed cost totals are intentionally absent from README"
else
  if [ -f "$METHODOLOGY" ]; then
    method_total_at=$(grep -c '\$8\.10' "$METHODOLOGY"; true)
    method_total_at=${method_total_at:-0}
    method_total_ls=$(grep -c '\$3\.51' "$METHODOLOGY"; true)
    method_total_ls=${method_total_ls:-0}
    if [ "$readme_total_at" -gt 0 ] && [ "$method_total_at" -gt 0 ]; then
      log_ok "Agent Teams total (\$8.10) consistent between README and methodology"
    else
      log_fail "Agent Teams cost total claim present in README but missing from methodology"
    fi
    if [ "$readme_total_ls" -gt 0 ] && [ "$method_total_ls" -gt 0 ]; then
      log_ok "Lead System total (\$3.51) consistent between README and methodology"
    else
      log_fail "Lead System cost total claim present in README but missing from methodology"
    fi
  else
    log_fail "docs/COMPARISON_METHODOLOGY.md missing while README contains fixed cost claims"
  fi
fi

# 5. CLAIM_PROVENANCE.md exists
echo ""
echo "Checking claim provenance..."
if [ -f "$REPO_ROOT/docs/CLAIM_PROVENANCE.md" ]; then
  log_ok "docs/CLAIM_PROVENANCE.md exists"
else
  log_fail "docs/CLAIM_PROVENANCE.md missing"
fi

# 6. Key files referenced in README exist
echo ""
echo "Checking key file references..."
for ref in CONTRIBUTING.md LICENSE docs/ARCHITECTURE.md docs/API_CONTRACT.md docs/MCP_TOOL_REFERENCE.md; do
  if [ -f "$REPO_ROOT/$ref" ]; then
    log_ok "$ref exists"
  else
    log_warn "$ref referenced in README but not found"
  fi
done

echo ""
echo "Results: $PASS pass, $FAIL fail, $WARN warn"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILED: $FAIL claim-doc drift(s) detected" >&2
  exit 1
fi

echo "All claim checks passed."
