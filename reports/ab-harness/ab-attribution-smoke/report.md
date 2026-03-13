# Measured A/B Parity + Economics Report (ab-attribution-smoke)

Generated: 2026-03-13T01:05:02.231Z
Workload: mock-ab-workload
Comparison target: unspecified
Evidence tier: synthetic_measured
Trials: 1
Baseline path: native
Confidence level: 0.95

## Run quality checks

- Balanced trial matrix: pass
- Token coverage ratio: 0
- Event coverage ratio: 1
- Attribution integrity: fail
- Claim readiness for savings: fail
- Claim readiness issues:
  - token telemetry coverage below 95%
  - attribution incomplete for token_metric in 3/3 run(s)
  - attribution incomplete for activity in 3/3 run(s)
  - attribution incomplete for conflicts in 1/3 run(s)
  - attribution incomplete for transcript in 3/3 run(s)

## Claim-safe summary

- Claims are restricted to measured A/B outcomes from this harness run.
- Evidence tier for this run: synthetic_measured.
- Savings claims are disabled because claim-readiness quality gates did not pass.
- lead_coordinator: measured token difference vs native is inconclusive for savings claims (evidence tier is synthetic_measured; only production_measured runs can support savings claims).
- lead_overlay: measured token difference vs native is inconclusive for savings claims (evidence tier is synthetic_measured; only production_measured runs can support savings claims).

## Path metrics (mean with confidence interval)

| Path | Completion rate | Latency ms | Tokens | Human interventions | Conflict incidents | Throughput / usage window | Resume success rate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lead_coordinator | 1 [0.206549, 1] (1/1) | 454 [454, 454] | n/a | 1 [1, 1] | 0 [0, 0] | n/a | 1 [0.206549, 1] (1/1) |
| lead_overlay | 1 [0.206549, 1] (1/1) | 270 [270, 270] | n/a | 1 [1, 1] | 0 [0, 0] | n/a | 1 [0.206549, 1] (1/1) |
| native | 1 [0.206549, 1] (1/1) | 277 [277, 277] | n/a | 1 [1, 1] | n/a | n/a | 0 [0, 0.793451] (0/1) |

## Comparisons vs baseline (native)

| Path | Tokens diff | Latency diff | Throughput diff |
| --- | --- | --- | --- |
| lead_coordinator | n/a | 177 [177, 177] | n/a |
| lead_overlay | n/a | -7 [-7, -7] | n/a |

## Artifacts

- Raw dataset: `/Users/drewdawson/claude-lead-system/reports/ab-harness/ab-attribution-smoke/raw-dataset.jsonl`
- Summary JSON: `/Users/drewdawson/claude-lead-system/reports/ab-harness/ab-attribution-smoke/summary.json`
- Run manifest: `/Users/drewdawson/claude-lead-system/reports/ab-harness/ab-attribution-smoke/run-manifest.json`

## Guardrail

- No savings claim should be published unless `savings_claim_allowed` is true for the compared path in this run output.

