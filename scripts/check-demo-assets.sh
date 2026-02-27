#!/usr/bin/env bash
# check-demo-assets.sh — Verify demo assets referenced in README exist and are valid.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
README="$REPO_ROOT/README.md"

PASS=0
FAIL=0
WARN=0
STALE_DAYS=30

log_ok()   { echo "  OK:   $*"; PASS=$((PASS + 1)); }
log_fail() { echo "  FAIL: $*" >&2; FAIL=$((FAIL + 1)); }
log_warn() { echo "  WARN: $*"; WARN=$((WARN + 1)); }

echo "Checking demo assets referenced in README.md..."
echo ""

# Extract all assets/demo/ references from README
refs=$(grep -oE 'assets/demo/[A-Za-z0-9_./-]+' "$README" | sort -u || true)

if [ -z "$refs" ]; then
  echo "No assets/demo/ references found in README.md"
  exit 0
fi

for ref in $refs; do
  full="$REPO_ROOT/$ref"
  if [ -f "$full" ]; then
    # Check file is non-empty
    size=$(wc -c < "$full" | tr -d ' ')
    if [ "$size" -eq 0 ]; then
      log_fail "$ref (empty file)"
    else
      log_ok "$ref (${size} bytes)"
    fi
  elif [ -d "$full" ]; then
    log_ok "$ref/ (directory)"
  else
    log_fail "$ref (not found)"
  fi
done

echo ""
echo "Checking screenshot freshness..."

SCREENSHOTS_DIR="$REPO_ROOT/assets/demo/screenshots"
if [ -d "$SCREENSHOTS_DIR" ]; then
  now=$(date +%s)
  for img in "$SCREENSHOTS_DIR"/*.{png,jpg,gif} 2>/dev/null; do
    [ -f "$img" ] || continue
    name=$(basename "$img")
    if [[ "$OSTYPE" == "darwin"* ]]; then
      mtime=$(stat -f %m "$img")
    else
      mtime=$(stat -c %Y "$img")
    fi
    age_days=$(( (now - mtime) / 86400 ))
    if [ "$age_days" -gt "$STALE_DAYS" ]; then
      log_warn "$name is ${age_days} days old (>$STALE_DAYS days)"
    else
      log_ok "$name (${age_days} days old)"
    fi
  done
else
  log_warn "screenshots/ directory not found"
fi

echo ""
echo "Results: $PASS pass, $FAIL fail, $WARN warn"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILED: $FAIL missing/invalid asset(s)" >&2
  exit 1
fi

echo "All demo assets verified."
