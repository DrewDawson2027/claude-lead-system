# Benchmarks & Validation

## Benchmark Harness

```bash
node bench/coord-benchmark.mjs
```

Runs 9 scenarios measuring coordinator performance. Output is JSON compatible with `tests/perf-gate.mjs`.

### Environment Variables

| Variable           | Default   | Description                                       |
| ------------------ | --------- | ------------------------------------------------- |
| `BENCH_ITERATIONS` | 100       | Iterations per scenario                           |
| `BENCH_TEAM_SIZES` | 1,5,10,20 | Comma-separated team sizes for snapshot benchmark |

### Scenarios

| Scenario              | What it measures                             |
| --------------------- | -------------------------------------------- |
| `session_json_read`   | Single session JSON parse                    |
| `boot_scan`           | 10-session boot scan                         |
| `conflict_detection`  | Cross-session file conflict detection        |
| `dispatch_latency`    | Policy engine dispatch path selection        |
| `approval_throughput` | Task approval create/resolve cycles          |
| `recovery_speed`      | Stale inflight detection + recovery          |
| `rebalance_quality`   | Priority aging + queue ordering quality      |
| `snapshot_build_time` | Snapshot normalization at varying team sizes |
| `transcript_scan`     | JSONL transcript parsing                     |

## Performance Gate

```bash
node tests/perf-gate.mjs
```

Runs benchmarks N times (default 3) and checks thresholds:

| Metric                     | Threshold | Env Override                       |
| -------------------------- | --------- | ---------------------------------- |
| `speedup_ratio_avg`        | > 50      | `COORD_PERF_MIN_SPEEDUP`           |
| `session_json_read.p95_ms` | < 2.0ms   | `COORD_PERF_MAX_SESSION_P95_MS`    |
| `transcript_scan.p95_ms`   | < 30.0ms  | `COORD_PERF_MAX_TRANSCRIPT_P95_MS` |
| `rebalance_quality_score`  | > 0.7     | `COORD_PERF_MIN_REBALANCE_QUALITY` |
| `snapshot_build_p95_ms`    | < 50.0ms  | `COORD_PERF_MAX_SNAPSHOT_P95_MS`   |

## Bridge Validator

```bash
node bench/bridge-validator.mjs [--port 9900] [--stale-ms 30000]
```

See `docs/BRIDGE_RUNBOOK.md` for full documentation.

## Demo Scenarios

```bash
# Against running sidecar
node bench/demo-scenarios.mjs --port 9900

# Auto-start sidecar, run demos, stop
bash bench/run-demos.sh
```

Exercises 5 end-to-end scenarios against a live sidecar instance.
