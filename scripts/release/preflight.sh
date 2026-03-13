#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"

echo "== Release Preflight =="
echo "Repo: $ROOT"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "FAIL: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

required=(jq node python3 npm bash git)
for cmd in "${required[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "FAIL: missing dependency: $cmd" >&2
    exit 1
  fi
done

echo "Running hook tests..."
bash tests/hooks-smoke.sh
bash tests/health-check-regression.sh
bash tests/smoke-install.sh --ref HEAD --mode full

echo "Running syntax checks..."
bash -n hooks/*.sh tests/*.sh install.sh
python3 -m py_compile hooks/token-guard.py hooks/read-efficiency-guard.py
node --check mcp-coordinator/index.js

echo "Running coordinator tests..."
(
  cd mcp-coordinator
  npm test
)

echo "Running policy/docs audits..."
npm run docs:audit

echo "Running compatibility proof checks..."
node scripts/proof/verify-proof-artifacts.mjs
node scripts/proof/generate-compatibility-matrix.mjs --check

echo "Running sidecar security smoke..."
bash scripts/release/security-smoke.sh

echo "Running perf gate..."
node tests/perf-gate.mjs

echo "Running dependency audit..."
(
  cd mcp-coordinator
  npm audit --audit-level=high
)

echo "PASS: release preflight completed."
