#!/usr/bin/env bash
# check-claim-drift.sh — Verify README claims match reality.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
README="$REPO_ROOT/README.md"
METHODOLOGY="$REPO_ROOT/docs/COMPARISON_METHODOLOGY.md"
PROVENANCE="$REPO_ROOT/docs/CLAIM_PROVENANCE.md"
ENGINEERING="$REPO_ROOT/docs/ENGINEERING_STANDARDS.md"
BENCH_FILE="$REPO_ROOT/bench/latest-results.json"

PASS=0
FAIL=0
WARN=0

log_ok()   { echo "  OK:   $*"; PASS=$((PASS + 1)); }
log_fail() { echo "  FAIL: $*" >&2; FAIL=$((FAIL + 1)); }
log_warn() { echo "  WARN: $*"; WARN=$((WARN + 1)); }

echo "Checking README claim drift..."
echo ""

# 1) Core files required for claim governance
echo "Checking core claim-governance files..."
for file in "$README" "$METHODOLOGY" "$PROVENANCE"; do
  rel="${file#"$REPO_ROOT/"}"
  if [ -f "$file" ]; then
    log_ok "$rel exists"
  else
    log_fail "$rel is required but missing"
  fi
done

# 2) All docs/*.md links in README resolve to existing files
echo "Checking doc links..."
doc_refs=$(grep -oE '\(docs/[A-Za-z0-9_./-]+\.md([#?][^)]*)?\)' "$README" | tr -d '()' | sed 's/[#?].*$//' | sort -u || true)
for ref in $doc_refs; do
  if [ -f "$REPO_ROOT/$ref" ]; then
    log_ok "$ref exists"
  else
    log_fail "$ref referenced in README but file missing"
  fi
done
if [ -z "$doc_refs" ]; then
  log_warn "No docs/*.md links found in README"
fi

# 3) README economics framing should not reintroduce unsupported claims
echo ""
echo "Checking economics framing..."
if grep -Eqi '57%|75-90%|90%[[:space:]]*\(\$|cheaper than native Agent Teams|for free\.' "$README"; then
  log_fail "README contains retired or unsupported savings-style claims"
else
  log_ok "README avoids retired savings-style claims"
fi

if grep -Eqi 'flat-rate Max plan|usage window|token-equivalent' "$README"; then
  log_ok "README uses conditional Max-plan/usage-window framing"
else
  log_warn "README does not currently mention conditional Max-plan/usage-window framing"
fi

# 4) Methodology must express current, truthful claim taxonomy (no stale heading assumptions)
echo ""
echo "Checking methodology posture..."
if [ -f "$METHODOLOGY" ]; then
  if grep -Eq 'What Is Measured \(Proven\)' "$METHODOLOGY"; then
    log_ok "Methodology includes measured-evidence section"
  else
    log_fail "Methodology is missing measured-evidence guidance"
  fi

  if grep -Eq 'What Is Modeled \(Not Measured Billing Proof\)' "$METHODOLOGY"; then
    log_ok "Methodology separates modeled results from billing proof"
  else
    log_fail "Methodology is missing modeled-vs-measured separation"
  fi

  if grep -Eq 'Verdict Taxonomy \(Canonical\)' "$METHODOLOGY"; then
    log_ok "Methodology defines canonical verdict labels"
  else
    log_fail "Methodology is missing canonical verdict taxonomy"
  fi

  if grep -Eq 'Any blanket "cheaper than native" statement' "$METHODOLOGY"; then
    log_ok "Methodology explicitly disallows blanket cheaper-than-native claims"
  else
    log_fail "Methodology is missing explicit cheaper-than-native prohibition"
  fi
else
  log_fail "docs/COMPARISON_METHODOLOGY.md missing"
fi

# 5) Claim provenance must keep a verifiable table
echo ""
echo "Checking claim provenance..."
if [ -f "$PROVENANCE" ]; then
  if grep -Eq '^##[[:space:]]+Verification Table' "$PROVENANCE"; then
    table_rows=$(awk '
      /^##[[:space:]]+Verification Table/ {in_table=1; next}
      /^##[[:space:]]+/ && in_table {in_table=0}
      in_table && /^\|/ {count++}
      END {print count+0}
    ' "$PROVENANCE")
    if [ "$table_rows" -ge 3 ]; then
      log_ok "Claim provenance has a populated verification table"
    else
      log_fail "Claim provenance verification table is missing claim rows"
    fi
  else
    log_fail "Claim provenance is missing a verification table section"
  fi
else
  log_fail "docs/CLAIM_PROVENANCE.md missing"
fi

# 6) Benchmark snapshot is optional, but if present must be valid JSON
echo ""
echo "Checking benchmark artifacts..."
if [ -f "$BENCH_FILE" ]; then
  if python3 -c "import json; json.load(open('$BENCH_FILE'))" 2>/dev/null; then
    log_ok "bench/latest-results.json is valid JSON"
  else
    log_fail "bench/latest-results.json is invalid JSON"
  fi
else
  log_warn "bench/latest-results.json not found (may not exist until first benchmark run)"
fi

# 7) Certification process documentation should remain aligned
echo ""
echo "Checking certification methodology..."
if grep -q "npm run cert:a-plus:fresh" "$ENGINEERING" && grep -q "npm run cert:a-plus:fresh" "$PROVENANCE"; then
  log_ok "Fresh-checkout certification command documented in standards + provenance"
else
  log_fail "Missing fresh-checkout certification command in engineering standards or claim provenance docs"
fi
if grep -Eq 'installed.*\\.claude|blessed-path' "$ENGINEERING"; then
  log_ok "Installed/blessed-path scope for health-check is documented"
else
  log_warn "Installed/blessed-path health-check scope language missing from engineering standards"
fi

echo ""
echo "Results: $PASS pass, $FAIL fail, $WARN warn"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILED: $FAIL claim-doc drift(s) detected" >&2
  exit 1
fi

echo "All claim checks passed."
