#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"

echo "== Sidecar Security Smoke =="

# Focused release smoke for top-priority hardening paths:
# - token-required mode cannot be bypassed with forged same-origin + CSRF
# - secure-mode integration still rejects sibling-prefix path bypass attempts
# - TLS dashboard URL contract remains correct
PATTERN='token on: same-origin browser \+ CSRF without bearer is rejected|token on: bearer auth \+ same-origin \+ CSRF all present works|token on: forged same-origin browser mutation without bearer is always rejected|sidecar secure mode enforces auth and CSRF|tls mode returns https dashboard target'
npm --workspace sidecar test -- --test-name-pattern "$PATTERN"

echo "PASS: sidecar security smoke checks passed."
