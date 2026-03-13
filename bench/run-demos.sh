#!/usr/bin/env bash
# Run demo scenarios against an ephemeral sidecar instance.
# Usage: bash bench/run-demos.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${DEMO_PORT:-9901}"
if [ -n "${SIDECAR_LOG:-}" ]; then
  AUTO_CLEAN_LOG=0
else
  SIDECAR_LOG="$(mktemp "${TMPDIR:-/tmp}/lead-sidecar-demo.XXXXXX.log")"
  AUTO_CLEAN_LOG=1
fi

echo "==> Starting sidecar on port $PORT..."
cd "$SCRIPT_DIR"
npm --workspace sidecar start -- --port "$PORT" >"$SIDECAR_LOG" 2>&1 &
SIDECAR_PID=$!

cleanup() {
  echo "==> Stopping sidecar (pid $SIDECAR_PID)..."
  kill "$SIDECAR_PID" 2>/dev/null || true
  wait "$SIDECAR_PID" 2>/dev/null || true
  if [ "$AUTO_CLEAN_LOG" -eq 1 ]; then
    rm -f "$SIDECAR_LOG" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Wait for sidecar to be ready
READY=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then
    echo "==> Sidecar ready after ${i}s"
    READY=1
    break
  fi
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    echo "ERROR: Sidecar exited before readiness check passed"
    echo "==> Sidecar log:"
    sed -n '1,200p' "$SIDECAR_LOG" || true
    exit 1
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: Sidecar failed to start within 30s"
  echo "==> Sidecar log:"
  sed -n '1,200p' "$SIDECAR_LOG" || true
  exit 1
fi

echo "==> Running demo scenarios..."
node "$SCRIPT_DIR/bench/demo-scenarios.mjs" --port "$PORT"
EXIT_CODE=$?

echo "==> Demo exit code: $EXIT_CODE"
exit $EXIT_CODE
