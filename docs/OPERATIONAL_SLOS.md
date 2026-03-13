# Operational SLOs

Service Level Objectives for the claude-lead-system sidecar and coordinator. These are local-machine targets for self-hosted operation.

## SLO Table

| Metric                         | Target  | Measurement Method                              | Alerting                    |
| ------------------------------ | ------- | ----------------------------------------------- | --------------------------- |
| Sidecar startup time           | < 500ms | Time from `listen()` to first `GET /health` 200 | None (local)                |
| API response latency (p95)     | < 100ms | `GET /health`, `GET /teams` response time       | None (local)                |
| SSE connection setup           | < 200ms | Time to receive `: connected\n\n`               | None                        |
| Maintenance sweep              | < 2s    | `POST /maintenance/run` duration                | None                        |
| Snapshot rebuild               | < 500ms | `rebuild()` internal timing                     | None                        |
| Hook execution (shell)         | < 200ms | PostToolUse heartbeat round-trip                | Token-guard warns at >500ms |
| Hook execution (Python)        | < 500ms | `token-guard.py` / `read-efficiency-guard.py`   | Logged to stderr            |
| Recovery from crash            | < 5s    | Restart + rebuild from timeline                 | Manual (`sidecarctl`)       |
| Coordinator session read       | < 5ms   | `bench/coord-benchmark.mjs`                     | CI perf-gate fails          |
| Coordinator boot scan          | < 50ms  | `bench/coord-benchmark.mjs`                     | CI perf-gate fails          |
| Coordinator conflict detection | < 10ms  | `bench/coord-benchmark.mjs`                     | CI perf-gate fails          |

## CI-Enforced vs Advisory

| Type            | Metrics                                                 | Enforcement                                           |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| **CI-enforced** | Coordinator session read, boot scan, conflict detection | `tests/perf-gate.mjs` — CI fails if exceeded          |
| **Advisory**    | All sidecar SLOs                                        | Measured but not CI-gated (too environment-dependent) |

### Why sidecar SLOs are not CI-gated

- Sidecar performance depends on local hardware, disk speed, and OS
- CI runners have variable performance characteristics
- Coordinator benchmarks are isolated enough to be reliable in CI
- Sidecar SLOs are verified manually during release testing

## How to Measure

### Sidecar startup time

```bash
time curl -s http://127.0.0.1:7199/health
```

### API response latency

```bash
# Single request
time curl -s http://127.0.0.1:7199/v1/health > /dev/null

# Batch (10 requests)
for i in $(seq 1 10); do
  time curl -s http://127.0.0.1:7199/v1/teams > /dev/null
done
```

### Coordinator benchmarks

```bash
node bench/coord-benchmark.mjs
cat bench/latest-results.json | jq '.results'
```

### Hook execution time

```bash
# Token guard reports execution time in stderr
# Look for lines like: "[token-guard] execution: 45ms"
```

## Monitoring Endpoints

| Endpoint                  | What It Shows                                                  |
| ------------------------- | -------------------------------------------------------------- |
| `GET /v1/health`          | Server status, PID, team count, lock age, checkpoint freshness |
| `GET /v1/metrics.json`    | Current metrics snapshot                                       |
| `GET /v1/metrics/history` | Historical metrics (up to 100 snapshots)                       |
| `GET /v1/metrics/diff`    | Diff between oldest and newest metrics snapshot                |

## Degradation Indicators

| Signal                           | Meaning                          | Action                                 |
| -------------------------------- | -------------------------------- | -------------------------------------- |
| `lock_age_ms` > 30000            | Stale lock file (possible crash) | Run `POST /maintenance/run`            |
| `queue_depth` > 50               | Action queue backing up          | Check for slow workers                 |
| Health returns `safe_mode: true` | Sidecar in safe mode (read-only) | Investigate root cause, restart        |
| Hook stderr shows ">500ms"       | Hook execution slow              | Check disk I/O, reduce hook complexity |

## References

- `bench/coord-benchmark.mjs` — Coordinator benchmark suite
- `tests/perf-gate.mjs` — CI performance gate
- `docs/BENCH_METHODOLOGY.md` — Benchmark methodology
- `sidecar/server/create-server.ts` — Sidecar server implementation
