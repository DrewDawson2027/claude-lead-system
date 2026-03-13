# Measured A/B Parity + Economics Report (ab-economics-proof-synthetic-20260312-final)

Generated: 2026-03-12T03:01:18.173Z
Workload: agent-teams-economics-ab-synthetic
Comparison target: claude_agent_teams_subagent_workflow
Evidence tier: synthetic_measured
Trials: 6
Baseline path: native
Confidence level: 0.95

## Run quality checks

- Balanced trial matrix: pass
- Token coverage ratio: 1
- Event coverage ratio: 1
- Claim readiness for savings: pass

## Claim-safe summary

- Claims are restricted to measured A/B outcomes from this harness run.
- Evidence tier for this run: synthetic_measured.
- lead_overlay: measured token difference vs native is inconclusive for savings claims (evidence tier is synthetic_measured; only production_measured runs can support savings claims).
- lead_coordinator: measured token difference vs native is inconclusive for savings claims (evidence tier is synthetic_measured; only production_measured runs can support savings claims).

## Path metrics (mean with confidence interval)

| Path             | Completion rate       | Latency ms                          | Tokens               | Human interventions | Conflict incidents | Throughput / usage window        | Resume success rate   |
| ---------------- | --------------------- | ----------------------------------- | -------------------- | ------------------- | ------------------ | -------------------------------- | --------------------- |
| lead_overlay     | 1 [0.609666, 1] (6/6) | 259.833333 [257.666667, 262.166667] | 15400 [15400, 15400] | 1 [1, 1]            | 0 [0, 0]           | 14.285714 [14.285714, 14.285714] | 1 [0.609666, 1] (6/6) |
| lead_coordinator | 1 [0.609666, 1] (6/6) | 254 [252.166667, 255.5]             | 15000 [15000, 15000] | 1 [1, 1]            | 0 [0, 0]           | 14.666667 [14.666667, 14.666667] | 1 [0.609666, 1] (6/6) |
| native           | 1 [0.609666, 1] (6/6) | 270.666667 [268.666667, 272.666667] | 15900 [15900, 15900] | 1 [1, 1]            | 2 [2, 2]           | 13.836478 [13.836478, 13.836478] | 0 [0, 0.390334] (0/6) |

## Comparisons vs baseline (native)

| Path             | Tokens diff       | Latency diff                     | Throughput diff               |
| ---------------- | ----------------- | -------------------------------- | ----------------------------- |
| lead_overlay     | -500 [-500, -500] | -10.833333 [-13.8375, -7.833333] | 0.449236 [0.449236, 0.449236] |
| lead_coordinator | -900 [-900, -900] | -16.666667 [-19.333333, -14]     | 0.830189 [0.830189, 0.830189] |

## Artifacts

- Raw dataset: `/Users/drewdawson/claude-lead-system/reports/ab-harness/ab-economics-proof-synthetic-20260312-final/raw-dataset.jsonl`
- Summary JSON: `/Users/drewdawson/claude-lead-system/reports/ab-harness/ab-economics-proof-synthetic-20260312-final/summary.json`
- Run manifest: `/Users/drewdawson/claude-lead-system/reports/ab-harness/ab-economics-proof-synthetic-20260312-final/run-manifest.json`

## Guardrail

- No savings claim should be published unless `savings_claim_allowed` is true for the compared path in this run output.
