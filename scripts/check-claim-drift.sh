#!/usr/bin/env bash
# Claim drift detector — verifies API contract and coverage claims are in sync.
# Exits 1 if any claim has drifted from the implementation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Checking API contract sync..."
node "$SCRIPT_DIR/scripts/policy/check-api-contract-sync.mjs"

echo "==> Checking coverage claim..."
node "$SCRIPT_DIR/scripts/check-coverage-claim.mjs"

echo "claim-drift: OK"
