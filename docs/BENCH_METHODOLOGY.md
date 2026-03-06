# Benchmark Methodology

How performance benchmarks are configured, measured, and enforced.

## What's Measured

The benchmark suite (`bench/coord-benchmark.mjs`) measures actual coordinator operations:

| Operation | What It Tests |
|-----------|---------------|
| Session read | Load and parse a session JSON file |
| Boot scan | Full directory scan for sessions, workers, pipelines |
| Conflict detection | Compare files_touched arrays across active sessions |

## How It's Measured

### Multi-run median aggregation

Each operation is run multiple times (default: 10 iterations). The **median** value is reported, not the mean.

**Why medians over means:**
- Medians are robust to outliers caused by CI runner variance (GC pauses, disk I/O spikes)
- A single slow run doesn't inflate the result
- More representative of typical user experience

### Performance gate

`tests/perf-gate.mjs` enforces SLO thresholds in CI:

```javascript
// Thresholds (fail CI if exceeded)
{ sessionRead: 5,    // ms
  bootScan: 50,      // ms
  conflictDetect: 10  // ms
}
```

If any operation's median exceeds its threshold, the CI job fails.

## Environment

### CI environment
- Runner: `ubuntu-latest` GitHub Actions runner
- CPU: 2-core AMD EPYC (shared)
- RAM: 7 GB
- Disk: SSD (Azure-backed)
- Node.js: 20.x

### Local benchmarking

```bash
# Run benchmark locally
node bench/coord-benchmark.mjs

# View results
cat bench/latest-results.json | jq .
```

### Hardware/software capture

Benchmark results include:
- Node.js version
- OS platform and architecture
- Timestamp
- Iteration count

## Reading Results

`bench/latest-results.json` format:

```json
{
  "timestamp": "2026-02-26T...",
  "node_version": "v20.x.x",
  "platform": "linux",
  "iterations": 10,
  "results": {
    "sessionRead": { "median_ms": 1.2, "p95_ms": 2.1, "runs": [...] },
    "bootScan": { "median_ms": 15.3, "p95_ms": 22.0, "runs": [...] },
    "conflictDetect": { "median_ms": 3.1, "p95_ms": 5.5, "runs": [...] }
  }
}
```

Fields:
- `median_ms`: Median execution time across all iterations
- `p95_ms`: 95th percentile
- `runs`: Array of individual run times (for debugging flaky results)

## CI Integration

The performance gate runs in `.github/workflows/ci.yml` as the `perf-gate` job:

```yaml
perf-gate:
  name: Coordinator Performance Gate
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: "20" }
    - run: cd mcp-coordinator && npm ci
    - run: node tests/perf-gate.mjs
```

## References

- `bench/coord-benchmark.mjs` — Benchmark harness
- `bench/latest-results.json` — Latest benchmark snapshot
- `tests/perf-gate.mjs` — CI performance gate
- `docs/TOKEN_MANAGEMENT_BENCHMARK_PUBLISHING.md` — Benchmark publishing workflow
