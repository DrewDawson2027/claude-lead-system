# Operator Cheat Sheet

## Start / Stop

```bash
# Start sidecar
node sidecar/server/index.js --port 9900

# Stop sidecar
kill $(cat ~/.claude/lead-sidecar/runtime/sidecar.lock)

# Start with auth
LEAD_SIDECAR_REQUIRE_TOKEN=1 node sidecar/server/index.js --port 9900
```

Browser-origin security notes:

- Only the sidecar UI origin (`http://127.0.0.1:<sidecar-port>`) may call the sidecar API from a browser.
- Cross-port localhost browser requests are blocked by design.
- Use `X-Sidecar-CSRF` for browser-origin mutation requests.
- If `LEAD_SIDECAR_REQUIRE_TOKEN=1`, include `Authorization: Bearer <token>` on all mutating requests.

## Key Endpoints

```bash
# Health
curl http://127.0.0.1:9900/health.json

# Full snapshot
curl http://127.0.0.1:9900/snapshot.json

# Metrics
curl http://127.0.0.1:9900/metrics.json

# Teams
curl http://127.0.0.1:9900/teams

# Schema version
curl http://127.0.0.1:9900/schema/version
```

## Debugging

```bash
# Export diagnostics
curl -X POST http://127.0.0.1:9900/diagnostics/export -H 'Content-Type: application/json' -d '{"label":"debug"}'

# Force rebuild
curl -X POST http://127.0.0.1:9900/rebuild -H 'Content-Type: application/json' -d '{}'

# Force maintenance sweep
curl -X POST http://127.0.0.1:9900/maintenance/run -H 'Content-Type: application/json' -d '{}'

# Check action queue
curl http://127.0.0.1:9900/actions

# Retry failed action
curl -X POST http://127.0.0.1:9900/actions/<ID>/retry -H 'Content-Type: application/json' -d '{}'

# Timeline replay (last hour)
curl "http://127.0.0.1:9900/timeline/replay?from=$(date -v-1H -u +%Y-%m-%dT%H:%M:%SZ)"

# Snapshot diff
curl -X POST http://127.0.0.1:9900/snapshots/diff -H 'Content-Type: application/json' -d '{}'

# Comparison report
curl -X POST http://127.0.0.1:9900/reports/comparison -H 'Content-Type: application/json' -d '{"label":"check"}'
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
~/.claude/lead-sidecar/runtime/sidecar.lock       # PID lock
~/.claude/lead-sidecar/runtime/sidecar.port       # Port file
```

## Configuration Knobs

| Env Variable                 | Default | Description                                                                           |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `LEAD_SIDECAR_REQUIRE_TOKEN` | `0`     | Enable bearer-token auth for non-browser clients (browser UI uses same-origin + CSRF) |
| `COORD_PERF_MIN_SPEEDUP`     | `50`    | Perf gate speedup threshold                                                           |
| `BENCH_ITERATIONS`           | `100`   | Benchmark iteration count                                                             |

## Emergency Procedures

```bash
# Kill bridge (stuck)
kill -9 $(cat ~/.claude/lead-sidecar/runtime/native/bridge.lock)

# Reset snapshot (corrupt)
rm ~/.claude/lead-sidecar/state/latest.json
curl -X POST http://127.0.0.1:9900/rebuild -H 'Content-Type: application/json' -d '{}'

# Force GC (cleanup)
# Via MCP coordinator tool: coord_run_gc

# Clear action queue (stuck)
rm ~/.claude/lead-sidecar/runtime/actions/inflight/*
rm ~/.claude/lead-sidecar/runtime/actions/pending/*

# Clear bridge queue
rm ~/.claude/lead-sidecar/runtime/native/bridge.request-queue/*
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
