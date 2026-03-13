# Benchmark Methodology

How benchmark lanes are configured, measured, and interpreted without over-claiming.

## Method Boundary

This repo has two economics-related benchmark lanes:

1. **Measured A/B harness (`bench/ab-harness.mjs`)**: canonical claim-bearing lane for native vs lead comparisons.
2. **Workflow scenario model (`bench/workflow-benchmark.mjs`)**: legacy assumption-testing lane; not claim-bearing for savings.

## Benchmark Suites

### 1. Coordinator Performance (`bench/coord-benchmark.mjs`)

Measures raw coordinator operation latency across defined scenarios.

### 2. Measured A/B Harness (`bench/ab-harness.mjs`)

Runs the same workload across enabled paths (`native`, `lead_coordinator`, optional `lead_overlay`) and captures:

- token usage deltas from transcript JSONL / `agent-metrics.jsonl`
- latency
- completion rate
- human intervention count
- conflict incidents
- resume success
- throughput per usage window

Required outputs:

- `reports/ab-harness/<run-id>/raw-dataset.jsonl`
- `reports/ab-harness/<run-id>/run-manifest.json`
- `reports/ab-harness/<run-id>/summary.json`
- `reports/ab-harness/<run-id>/report.md`
- `reports/ab-harness/<run-id>/claim-safe-summary.md`

### 3. Workflow Scenario Model (`bench/workflow-benchmark.mjs`)

Used only for stress-testing assumptions. Outputs from this lane are not evidence for savings claims.

## Data Classification Contract

Use these evidence labels:

- `verified`
- `partial`
- `experimental`

Canonical source: `docs/CLAIM_POSTURE_SOURCE.json`

## Current Economics Claim Status

| Claim | Label | Notes |
| --- | --- | --- |
| A/B harness is the canonical economics evidence lane | `verified` | Runner + artifacts + claim-safe policy are implemented |
| Runtime cost comparison is sourced only from harness artifacts | `verified` | `mcp-coordinator/lib/cost-comparison.js` reads measured summaries |
| Savings claim can be published without `savings_claim_allowed=true` | `experimental` | Explicitly disallowed by harness policy guard |
| Scenario model output can prove cheaper-than-native economics | `experimental` | Explicitly disallowed; scenario lane is non-claim |

## Running Locally

```bash
# Coordinator benchmark
node bench/coord-benchmark.mjs

# Measured A/B harness (canonical lane)
node bench/ab-harness.mjs --config bench/ab-harness.config.example.json

# Deterministic local harness validation
node bench/ab-harness.mjs --config bench/ab-harness.mock.config.json

# Legacy scenario-model lane (non-claim)
node bench/workflow-benchmark.mjs > bench/workflow-results.json
```

## What This Lane Cannot Prove

1. Exact invoice savings without provider billing telemetry.
2. Universal or blanket cheaper-than-native outcomes.
3. Exact native-parity economics across all workflows.

## Strongest Truthful Position

- Measured A/B artifacts are required for economics claims.
- Savings claims are allowed only when harness claim-safe policy allows them.
- Scenario-model output is assumption analysis, not billing proof.

## References

- `bench/ab-harness.mjs`
- `bench/coord-benchmark.mjs`
- `bench/workflow-benchmark.mjs`
- `docs/COMPARISON_METHODOLOGY.md`
