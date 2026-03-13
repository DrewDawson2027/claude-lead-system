# Operator Cheat Sheet

## Start / Stop

```bash
# Start sidecar
npm --workspace sidecar start -- --port 9900

# Stop sidecar
pkill -f "server/index.js --port 9900"

# Start with auth
LEAD_SIDECAR_REQUIRE_TOKEN=1 npm --workspace sidecar start -- --port 9900
```

Browser-origin security notes:

- Only the sidecar UI origin (`http://127.0.0.1:<sidecar-port>`) may call the sidecar API from a browser.
- Cross-port localhost browser requests are blocked by design.
- Use `X-Sidecar-CSRF` for browser-origin mutation requests.
- If `LEAD_SIDECAR_REQUIRE_TOKEN=1`, include `Authorization: Bearer <token>` on all mutating requests.

## Key Endpoints

```bash
# Health
curl http://127.0.0.1:9900/v1/health

# Teams snapshot
curl http://127.0.0.1:9900/v1/teams

# Metrics
curl http://127.0.0.1:9900/v1/metrics.json

# Teams
curl http://127.0.0.1:9900/v1/teams

# Schema version
curl http://127.0.0.1:9900/v1/schema/version
```

## Debugging

```bash
# Export diagnostics
curl -X POST http://127.0.0.1:9900/v1/diagnostics/export -H 'Content-Type: application/json' -d '{"label":"debug"}'

# Events consistency check
curl http://127.0.0.1:9900/v1/events/consistency

# Force maintenance sweep
curl -X POST http://127.0.0.1:9900/v1/maintenance/run -H 'Content-Type: application/json' -d '{}'

# Check action queue
curl http://127.0.0.1:9900/v1/actions

# Retry first failed action (if any)
ACTION_ID=$(curl -sS http://127.0.0.1:9900/v1/actions | jq -r '.actions[]? | select(.status=="failed") | .action_id' | head -n 1)
[ -n "$ACTION_ID" ] && curl -X POST "http://127.0.0.1:9900/v1/actions/$ACTION_ID/retry" -H 'Content-Type: application/json' -d '{}' || echo "No failed actions to retry"

# Timeline replay
curl "http://127.0.0.1:9900/v1/timeline/replay"

# Snapshot diff
curl -X POST http://127.0.0.1:9900/v1/snapshots/diff -H 'Content-Type: application/json' -d '{}'

# Comparison report
curl -X POST http://127.0.0.1:9900/v1/reports/comparison -H 'Content-Type: application/json' -d '{"label":"check"}'
```

## Log Locations

```
~/.claude/lead-sidecar/logs/timeline.jsonl       # Main event log
~/.claude/lead-sidecar/logs/diagnostics/          # Diagnostic bundles
~/.claude/lead-sidecar/logs/bridge-validation.jsonl # Bridge proofs
~/.claude/lead-sidecar/state/latest.json          # Current snapshot
~/.claude/lead-sidecar/state/metrics-history/     # Metrics over time
~/.claude/lead-sidecar/state/snapshot-history/    # Snapshot archive
~/.claude/lead-sidecar/state/ui-prefs.json        # UI preferences
~/.claude/lead-sidecar/runtime/sidecar.lock       # PID lock (when present)
~/.claude/lead-sidecar/runtime/sidecar.port       # Port file (when present)
```

## Configuration Knobs

| Env Variable                 | Default | Description                                                                           |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `LEAD_SIDECAR_REQUIRE_TOKEN` | `0`     | Enable bearer-token auth for non-browser clients (browser UI uses same-origin + CSRF) |
| `COORD_PERF_MIN_SPEEDUP`     | `50`    | Perf gate speedup threshold                                                           |
| `BENCH_ITERATIONS`           | `100`   | Benchmark iteration count                                                             |

## Emergency Procedures

```bash
# Ensure bridge (stuck/down)
curl -X POST http://127.0.0.1:9900/v1/native/bridge/ensure -H 'Content-Type: application/json' -d '{}'

# Reset snapshot (corrupt)
rm -f ~/.claude/lead-sidecar/state/latest.json
curl -X POST http://127.0.0.1:9900/v1/maintenance/run -H 'Content-Type: application/json' -d '{}'

# Force GC (cleanup)
# Via MCP coordinator tool: coord_run_gc

# Clear action queue (stuck)
find ~/.claude/lead-sidecar/runtime/actions/inflight -type f -delete
find ~/.claude/lead-sidecar/runtime/actions/pending -type f -delete

# Clear bridge queue
find ~/.claude/lead-sidecar/runtime/native/bridge.request-queue -type f -delete
```

## Benchmarks

```bash
# Run benchmarks
node bench/coord-benchmark.mjs

# Run perf gate
node tests/perf-gate.mjs

# Bridge validation
node bench/bridge-validator.mjs

# Demo scenarios
bash bench/run-demos.sh
```
