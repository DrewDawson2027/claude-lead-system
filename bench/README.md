# Benchmarks & Validation

## Benchmark Suites

### 1. Coordinator Performance

```bash
node bench/coord-benchmark.mjs
```

Runs 9 scenarios measuring raw coordinator operation latency. Output is JSON compatible with `tests/perf-gate.mjs`.

#### Environment Variables

| Variable           | Default   | Description                                       |
| ------------------ | --------- | ------------------------------------------------- |
| `BENCH_ITERATIONS` | 100       | Iterations per scenario                           |
| `BENCH_TEAM_SIZES` | 1,5,10,20 | Comma-separated team sizes for snapshot benchmark |

#### Scenarios

| Scenario              | What it measures                             |
| --------------------- | -------------------------------------------- |
| `session_json_read`   | Single session JSON parse                    |
| `boot_scan`           | 10-session boot scan                         |
| `conflict_detection`  | Cross-session file conflict detection        |
| `dispatch_latency`    | Policy engine dispatch path selection        |
| `approval_throughput` | Task approval create/resolve cycles          |
| `recovery_speed`      | Stale inflight detection + recovery          |
| `rebalance_quality`   | Priority aging + queue ordering quality      |
| `snapshot_build_time` | Snapshot normalization at varying team sizes  |
| `transcript_scan`     | JSONL transcript parsing                     |

### 2. Measured A/B Harness (native vs lead paths)

```bash
node bench/ab-harness.mjs --config bench/ab-harness.config.example.json
```

Runs the same workload through:
- native Claude path
- lead coordinator path
- lead hybrid/native-overlay path (when enabled)

Captures measured outcomes:
- token usage from transcript JSONL and/or `agent-metrics.jsonl`
- latency
- completion rate
- human intervention count
- conflict incidents
- resume success
- throughput per usage window

Outputs:
- raw dataset JSONL
- reproducible run manifest
- run status (`running`, `completed`, `completed_partial`, `failed_partial`)
- markdown report with confidence bounds
- claim-safe summary (suppresses economics claims unless certification gates pass)
- machine-readable economics certification (`certified`, `not_certified`, `blocked_by_evidence_quality`)

Timeout behavior is hardened and deterministic per run:
- send `SIGTERM` at `timeout_seconds`
- wait bounded `timeout_grace_seconds`
- force `SIGKILL` if still running

Even partial/failed harness runs still emit diagnosable artifacts (`raw-dataset.jsonl`, `run-status.json`, per-trial logs/events).

Quick local validation:

```bash
node bench/ab-harness.mjs --config bench/ab-harness.mock.config.json
```

### 3. Scenario-model benchmark (legacy lane)

```bash
node bench/workflow-benchmark.mjs
```

This script remains available for scenario exploration, but it is not a source for savings claims.

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

Runs 5 live API smoke scenarios against a sidecar instance using canonical `/v1/*` routes:

- Health + schema discovery (`/v1/health`, `/v1/schema/*`)
- Metrics + timeline replay (`/v1/metrics/*`, `/v1/timeline/replay`)
- Diagnostics + report generation (`/v1/diagnostics/*`, `/v1/reports/*`)
- Maintenance + rebuild consistency checks (`/v1/maintenance/run`, `/v1/events/*`, `/v1/snapshots/diff`)
- Route simulation + queue visibility (`/v1/route/simulate`, `/v1/actions`)

`maintenance_and_consistency` is blocking: it fails unless both `/v1/events/consistency` and `/v1/events/rebuild-check` return `consistent: true`.

This harness verifies route reachability plus the listed scenario assertions; it is not a full protocol-certification suite.

`bench/run-demos.sh` starts sidecar via the supported workspace command: `npm --workspace sidecar start -- --port <PORT>`.

## Results Files

| File | Contents |
| ---- | -------- |
| `bench/latest-results.json` | Latest coordinator benchmark snapshot |
| `bench/workflow-results.json` | Latest workflow archetype results + verdicts |
| `reports/ab-harness/<run-id>/raw-dataset.jsonl` | Per-run measured raw dataset |
| `reports/ab-harness/<run-id>/run-status.json` | Run lifecycle + partial/failure diagnostics |
| `reports/ab-harness/<run-id>/summary.json` | Confidence-bounded run summary + claim-safety flags |
| `reports/ab-harness/<run-id>/report.md` | Markdown report with claim-safe summary |

## References

- `docs/BENCH_METHODOLOGY.md` — Full methodology documentation
- `docs/COMPARISON_METHODOLOGY.md` — Throughput comparison methodology
- `mcp-coordinator/lib/cost-comparison.js` — Runtime cost comparison tool
