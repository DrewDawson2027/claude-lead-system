#!/usr/bin/env bash
# check-claim-drift.sh — Verify README claims match reality.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
README="$REPO_ROOT/README.md"
METHODOLOGY="$REPO_ROOT/docs/COMPARISON_METHODOLOGY.md"
PROVENANCE="$REPO_ROOT/docs/CLAIM_PROVENANCE.md"
POSTURE_SOURCE="$REPO_ROOT/docs/CLAIM_POSTURE_SOURCE.json"
POSTURE_DOC="$REPO_ROOT/docs/PARITY_ECONOMICS_POSTURE.md"
ENGINEERING="$REPO_ROOT/docs/ENGINEERING_STANDARDS.md"
PACKAGE_JSON="$REPO_ROOT/package.json"
BENCH_FILE="$REPO_ROOT/bench/latest-results.json"
POSTURE_SYNC_SCRIPT="$REPO_ROOT/scripts/claim-posture-sync.mjs"

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
for file in "$README" "$METHODOLOGY" "$PROVENANCE" "$POSTURE_SOURCE" "$POSTURE_DOC"; do
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

# 3) Canonical parity/economics posture must stay synchronized across docs
echo ""
echo "Checking canonical posture sync..."
if [ -f "$POSTURE_SYNC_SCRIPT" ]; then
  if node "$POSTURE_SYNC_SCRIPT" --check; then
    log_ok "Canonical parity/economics posture is synchronized across README, CLAUDE, MANIFEST, and release report"
  else
    log_fail "Canonical posture sync check failed (run: node scripts/claim-posture-sync.mjs)"
  fi
else
  log_fail "scripts/claim-posture-sync.mjs is required but missing"
fi

# 4) Sync targets should not reintroduce retired parity/economics claim language
echo ""
echo "Checking retired claim language in sync targets..."
posture_targets=()
while IFS= read -r target; do
  if [ -n "$target" ]; then
    posture_targets+=("$target")
  fi
done < <(node -e "const s=require(process.argv[1]); for (const p of s.posture_sync_targets||[]) console.log(p);" "$POSTURE_SOURCE")
if [ "${#posture_targets[@]}" -eq 0 ]; then
  log_fail "CLAIM_POSTURE_SOURCE.json posture_sync_targets is empty"
else
  retired_pattern='57%|75-90% cheaper|90%[[:space:]]*\(\$|cheaper than native Agent Teams|Everything Agent Teams can do, the Lead System can do too|[0-9]{1,3}%[[:space:]]*parity|for free\.'
  for rel in "${posture_targets[@]}"; do
    abs="$REPO_ROOT/$rel"
    if [ ! -f "$abs" ]; then
      log_fail "$rel missing from posture sync targets"
      continue
    fi
    if grep -Eqi "$retired_pattern" "$abs"; then
      log_fail "$rel contains retired parity/economics claim language"
    else
      log_ok "$rel avoids retired parity/economics claim language"
    fi
  done
fi

if grep -Eqi 'flat-rate Max plan|usage window|token-equivalent' "$README"; then
  log_ok "README uses conditional Max-plan/usage-window framing"
else
  log_warn "README does not currently mention conditional Max-plan/usage-window framing"
fi

# 5) Methodology must preserve semantic claim-safety rules
echo ""
echo "Checking methodology posture..."
if [ -f "$METHODOLOGY" ]; then
  if grep -Eq 'production_measured' "$METHODOLOGY" \
    && grep -Eq 'synthetic_measured' "$METHODOLOGY" \
    && grep -Eq 'modeled' "$METHODOLOGY"; then
    log_ok "Methodology defines canonical evidence tiers (production_measured/synthetic_measured/modeled)"
  else
    log_fail "Methodology must define canonical evidence tiers (production_measured/synthetic_measured/modeled)"
  fi

  if grep -Eq 'cheaper than native Agent Teams' "$METHODOLOGY" \
    && grep -Eq 'universal savings' "$METHODOLOGY"; then
    log_ok "Methodology explicitly encodes prohibited universal savings language"
  else
    log_fail "Methodology must explicitly encode prohibited universal savings language"
  fi
else
  log_fail "docs/COMPARISON_METHODOLOGY.md missing"
fi

# 6) Claim provenance must keep a verifiable table
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

  if grep -Eq 'CLAIM_POSTURE_SOURCE\.json' "$PROVENANCE" \
    && grep -Eq 'claim-posture-sync\.mjs' "$PROVENANCE"; then
    log_ok "Claim provenance documents canonical posture source + sync gate"
  else
    log_fail "Claim provenance must document CLAIM_POSTURE_SOURCE.json and claim-posture-sync.mjs"
  fi
else
  log_fail "docs/CLAIM_PROVENANCE.md missing"
fi

# 7) Benchmark snapshot is optional, but if present must be valid JSON
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

# 8) Certification process documentation should remain aligned
echo ""
echo "Checking certification methodology..."
if grep -q "npm run cert:a-plus:fresh" "$ENGINEERING" && grep -q "npm run cert:a-plus:fresh" "$PROVENANCE"; then
  log_ok "Fresh-checkout certification command documented in standards + provenance"
else
  log_fail "Missing fresh-checkout certification command in engineering standards or claim provenance docs"
fi
if grep -q 'Canonical public-cert branch: `main`' "$ENGINEERING" \
  && grep -q 'Canonical public-cert branch: `main`' "$PROVENANCE"; then
  log_ok "Canonical source-of-truth branch policy is documented consistently"
else
  log_fail "Canonical public-cert branch policy is missing from engineering standards or claim provenance docs"
fi
if grep -q 'reports/a-plus-cert.json' "$ENGINEERING" && grep -q 'reports/a-plus-cert.json' "$PROVENANCE"; then
  log_ok "Deterministic cert report artifact path is documented in standards + provenance"
else
  log_fail "Missing deterministic cert report artifact path in engineering standards or claim provenance docs"
fi
if grep -Eq '"docs:audit"\s*:\s*".*check-claim-drift\.sh' "$PACKAGE_JSON"; then
  log_ok "docs:audit command includes claim-drift gate"
else
  log_fail "docs:audit command does not include claim-drift gate"
fi
if grep -Eq 'installed.*\\.claude|blessed-path' "$ENGINEERING"; then
  log_ok "Installed/blessed-path scope for health-check is documented"
else
  log_warn "Installed/blessed-path health-check scope language missing from engineering standards"
fi

# 9) 1/5th-price claim must be backed by certified measured economics proof
echo ""
echo "Checking 1/5th-price claim proof gate..."
one_fifth_pattern='essentially same thing at ~?1/5th price|same thing at ~?1/5th price|same workload at ~?1/5th price'

claim_scan_files=(
  "$README"
  "$REPO_ROOT/CLAUDE.md"
  "$REPO_ROOT/MANIFEST.md"
  "$REPO_ROOT/reports/release-readiness-report-2026-03-09.md"
)
for rel in "${posture_targets[@]}"; do
  claim_scan_files+=("$REPO_ROOT/$rel")
done

claim_hits=()
while IFS= read -r hit; do
  if [ -n "$hit" ]; then
    claim_hits+=("$hit")
  fi
done < <(
  printf '%s\n' "${claim_scan_files[@]}" \
    | awk '!seen[$0]++' \
    | while IFS= read -r file; do
      [ -f "$file" ] || continue
      grep -Ein "$one_fifth_pattern" "$file" | sed "s#^#${file#"$REPO_ROOT/"}:#" || true
    done
)

if [ "${#claim_hits[@]}" -eq 0 ]; then
  log_ok "No explicit 1/5th-price claim language found in claim-governed docs"
else
  latest_summary="$(node -e "
const fs=require('fs');
const path=require('path');
const root=process.argv[1];
const reports=path.join(root,'reports','ab-harness');
if(!fs.existsSync(reports)){process.exit(0);}
const dirs=fs.readdirSync(reports,{withFileTypes:true}).filter(d=>d.isDirectory());
const rows=[];
for(const d of dirs){
  const p=path.join(reports,d.name,'summary.json');
  if(!fs.existsSync(p)) continue;
  try {
    const st=fs.statSync(p);
    rows.push({p,mtime:st.mtimeMs});
  } catch {}
}
rows.sort((a,b)=>b.mtime-a.mtime);
if(rows[0]) process.stdout.write(rows[0].p);
" "$REPO_ROOT")"

  if [ -z "$latest_summary" ] || [ ! -f "$latest_summary" ]; then
    log_fail "1/5th-price claim language present but no reports/ab-harness/*/summary.json proof artifact exists"
  else
    rel_summary="${latest_summary#"$REPO_ROOT/"}"
    proof_status="$(node -e "
const fs=require('fs');
const p=process.argv[1];
const doc=JSON.parse(fs.readFileSync(p,'utf8'));
const econ=doc.economics_certification||{};
const result=String(econ.overall_result||'');
const target=String(econ.target_claim||'');
const tier=String(econ.evidence_tier||doc.workload?.evidence_tier||'');
const runState=String(doc.run_status?.state||'');
const pass=result==='certified' && target==='essentially_same_workload_at_1_5th_price' && tier==='production_measured' && runState==='completed';
process.stdout.write(
  pass
    ? 'pass'
    : 'fail:' + (result || 'none') + ':' + (target || 'none') + ':' + (tier || 'none') + ':' + (runState || 'none')
);
" "$latest_summary")"

    if [ "$proof_status" = "pass" ]; then
      log_ok "1/5th-price claim language is backed by certified production-measured economics proof ($rel_summary)"
    else
      log_fail "1/5th-price claim language present without certified production-measured proof ($rel_summary, status=$proof_status)"
      for hit in "${claim_hits[@]}"; do
        echo "    claim-hit: $hit" >&2
      done
    fi
  fi
fi

echo ""
echo "Results: $PASS pass, $FAIL fail, $WARN warn"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILED: $FAIL claim-doc drift(s) detected" >&2
  exit 1
fi

echo "All claim checks passed."
