#!/usr/bin/env bash
# Run demo scenarios against an ephemeral sidecar instance.
# Usage: bash bench/run-demos.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${DEMO_PORT:-9901}"

echo "==> Starting sidecar on port $PORT..."
node "$SCRIPT_DIR/sidecar/server/index.js" --port "$PORT" &
SIDECAR_PID=$!

cleanup() {
  echo "==> Stopping sidecar (pid $SIDECAR_PID)..."
  kill "$SIDECAR_PID" 2>/dev/null || true
  wait "$SIDECAR_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for sidecar to be ready
READY=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/health.json" >/dev/null 2>&1; then
    echo "==> Sidecar ready after ${i}s"
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: Sidecar failed to start within 30s"
  exit 1
fi

echo "==> Running demo scenarios..."
node "$SCRIPT_DIR/bench/demo-scenarios.mjs" --port "$PORT"
EXIT_CODE=$?

echo "==> Demo exit code: $EXIT_CODE"
exit $EXIT_CODE
