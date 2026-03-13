# Measured A/B Parity + Economics Report (ab-smoke-pathfix)

Generated: 2026-03-12T00:50:15.841Z
Workload: mock-ab-workload
Trials: 4
Baseline path: native
Confidence level: 0.95

## Claim-safe summary

- Claims are restricted to measured A/B outcomes from this harness run.
- lead_coordinator: measured token difference vs native is inconclusive; no savings claim is supported.
- lead_overlay: measured token difference vs native is inconclusive; no savings claim is supported.

## Path metrics (mean with confidence interval)

| Path | Completion rate | Latency ms | Tokens | Human interventions | Conflict incidents | Throughput / usage window | Resume success rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lead_coordinator | 1 [0.510109, 1] (4/4) | 256.75 [253.5, 260] | 15000 [15000, 15000] | 1 [1, 1] | 0 [0, 0] | 14.666667 [14.666667, 14.666667] | 1 [0.510109, 1] (4/4) |
| lead_overlay | 1 [0.510109, 1] (4/4) | 262.25 [258.5, 266] | 15400 [15400, 15400] | 1 [1, 1] | 0 [0, 0] | 14.285714 [14.285714, 14.285714] | 1 [0.510109, 1] (4/4) |
| native | 1 [0.510109, 1] (4/4) | 273.5 [272.5, 274.5] | 15900 [15900, 15900] | 1 [1, 1] | 2 [2, 2] | 13.836478 [13.836478, 13.836478] | 0 [0, 0.489891] (0/4) |

## Comparisons vs baseline (native)

| Path | Tokens diff | Latency diff | Throughput diff |
| --- | --- | --- | --- |
| lead_coordinator | -900 [-900, -900] | -16.75 [-20.25, -13.25] | 0.830189 [0.830189, 0.830189] |
| lead_overlay | -500 [-500, -500] | -11.25 [-15.75, -7.25] | 0.449236 [0.449236, 0.449236] |

## Artifacts

- Raw dataset: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-smoke-pathfix/raw-dataset.jsonl`
- Summary JSON: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-smoke-pathfix/summary.json`
- Run manifest: `/Users/drewdawson/claude-lead-system/bench/reports/ab-harness/ab-smoke-pathfix/run-manifest.json`

## Guardrail

- No savings claim should be published unless `savings_claim_allowed` is true for the compared path in this run output.

