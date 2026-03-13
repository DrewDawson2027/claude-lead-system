# Measured A/B Parity + Economics Report (ab-20260312T004918Z)

Generated: 2026-03-12T00:49:21.902Z
Workload: mock-ab-workload
Trials: 4
Baseline path: native
Confidence level: 0.95

## Claim-safe summary

- Claims are restricted to measured A/B outcomes from this harness run.
- lead_coordinator: measured token difference vs native is inconclusive; no savings claim is supported.
- lead_overlay: measured token difference vs native is inconclusive; no savings claim is supported.

## Path metrics (mean with confidence interval)

| Path             | Completion rate       | Latency ms             | Tokens   | Human interventions | Conflict incidents | Throughput / usage window | Resume success rate   |
| ---------------- | --------------------- | ---------------------- | -------- | ------------------- | ------------------ | ------------------------- | --------------------- |
| lead_coordinator | 1 [0.510109, 1] (4/4) | 260.25 [253, 269.75]   | 0 [0, 0] | 1 [1, 1]            | 0 [0, 0]           | n/a                       | 1 [0.510109, 1] (4/4) |
| lead_overlay     | 1 [0.510109, 1] (4/4) | 265.25 [259.5, 270.25] | 0 [0, 0] | 1 [1, 1]            | 0 [0, 0]           | n/a                       | 1 [0.510109, 1] (4/4) |
| native           | 1 [0.510109, 1] (4/4) | 273.5 [270, 278]       | 0 [0, 0] | 1 [1, 1]            | 1 [1, 1]           | n/a                       | 0 [0, 0.489891] (0/4) |

## Comparisons vs baseline (native)

| Path             | Tokens diff | Latency diff          | Throughput diff |
| ---------------- | ----------- | --------------------- | --------------- |
| lead_coordinator | 0 [0, 0]    | -13.25 [-21.75, -3.5] | n/a             |
| lead_overlay     | 0 [0, 0]    | -8.25 [-15, -2.24375] | n/a             |

## Artifacts

- Raw dataset: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-20260312T004918Z/raw-dataset.jsonl`
- Summary JSON: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-20260312T004918Z/summary.json`
- Run manifest: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-20260312T004918Z/run-manifest.json`

## Guardrail

- No savings claim should be published unless `savings_claim_allowed` is true for the compared path in this run output.
