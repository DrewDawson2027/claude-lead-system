# Measured A/B Parity + Economics Report (ab-20260312T004942Z)

Generated: 2026-03-12T00:49:45.890Z
Workload: mock-ab-workload
Trials: 4
Baseline path: native
Confidence level: 0.95

## Claim-safe summary

- Claims are restricted to measured A/B outcomes from this harness run.
- lead_coordinator: measured token difference vs native is inconclusive; no savings claim is supported.
- lead_overlay: measured token difference vs native is inconclusive; no savings claim is supported.

## Path metrics (mean with confidence interval)

| Path             | Completion rate       | Latency ms            | Tokens               | Human interventions | Conflict incidents | Throughput / usage window        | Resume success rate   |
| ---------------- | --------------------- | --------------------- | -------------------- | ------------------- | ------------------ | -------------------------------- | --------------------- |
| lead_coordinator | 1 [0.510109, 1] (4/4) | 261 [256, 266]        | 15000 [15000, 15000] | 1 [1, 1]            | 0 [0, 0]           | 14.666667 [14.666667, 14.666667] | 1 [0.510109, 1] (4/4) |
| lead_overlay     | 1 [0.510109, 1] (4/4) | 265.5 [261.5, 271.75] | 15400 [15400, 15400] | 1 [1, 1]            | 0 [0, 0]           | 14.285714 [14.285714, 14.285714] | 1 [0.510109, 1] (4/4) |
| native           | 1 [0.510109, 1] (4/4) | 275.5 [270, 281]      | 15900 [15900, 15900] | 1 [1, 1]            | 2 [2, 2]           | 13.836478 [13.836478, 13.836478] | 0 [0, 0.489891] (0/4) |

## Comparisons vs baseline (native)

| Path             | Tokens diff       | Latency diff          | Throughput diff               |
| ---------------- | ----------------- | --------------------- | ----------------------------- |
| lead_coordinator | -900 [-900, -900] | -14.5 [-21.75, -7.25] | 0.830189 [0.830189, 0.830189] |
| lead_overlay     | -500 [-500, -500] | -10 [-17.25, -1.75]   | 0.449236 [0.449236, 0.449236] |

## Artifacts

- Raw dataset: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-20260312T004942Z/raw-dataset.jsonl`
- Summary JSON: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-20260312T004942Z/summary.json`
- Run manifest: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-20260312T004942Z/run-manifest.json`

## Guardrail

- No savings claim should be published unless `savings_claim_allowed` is true for the compared path in this run output.
