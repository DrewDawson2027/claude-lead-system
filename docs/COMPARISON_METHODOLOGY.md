# Throughput Comparison Methodology (Evidence-Grade A/B)

Economics claims must be tied to measured A/B artifacts. Modeled outputs are explicitly non-claim.

## Evidence Classes

- `production_measured`: live native vs Lead runs on the same workload; eligible for conditional savings claims.
- `synthetic_measured`: measured harness execution on synthetic/mock workflow adapters; validates instrumentation only, not production savings claims.
- `modeled`: scenario or assumption outputs; never eligible for savings claims.

## Matched Runner Contract

A/B commands are path-specific and workload-matched:

- Native path runner: `bench/workloads/run-native-subagent-workflow.sh`
- Lead coordinator runner: `bench/workloads/run-lead-coordinator-workflow.sh`
- Lead overlay runner: `bench/workloads/run-lead-overlay-workflow.sh` (optional)

Canonical config: `bench/ab-harness.config.example.json`

Key workload controls in config:

- `workload.comparison_target`
- `workload.evidence_tier`
- `workload.prompt_file`

## Canonical Run Command

```bash
node bench/ab-harness.mjs --config bench/ab-harness.config.example.json
```

Required per-run artifacts:

- `reports/ab-harness/<run-id>/raw-dataset.jsonl`
- `reports/ab-harness/<run-id>/run-manifest.json`
- `reports/ab-harness/<run-id>/run-status.json`
- `reports/ab-harness/<run-id>/summary.json`
- `reports/ab-harness/<run-id>/report.md`
- `reports/ab-harness/<run-id>/claim-safe-summary.md`

## Metric Definitions (Measured)

Metrics and their artifact fields:

- Token usage: `raw-dataset.jsonl[*].tokens.total_tokens_used`
- Latency: `raw-dataset.jsonl[*].latency_ms`
- Completion rate: `summary.per_path.<path>.completion_rate`
- Human intervention count: `raw-dataset.jsonl[*].human_intervention_count`
- Resume attempts/success: `raw-dataset.jsonl[*].resume.*` and `summary.per_path.<path>.resume`
- Conflict incidents: `raw-dataset.jsonl[*].conflict_incidents`
- Throughput per usage window: `raw-dataset.jsonl[*].throughput.per_usage_window`

## Attribution Integrity Contract

Every counted telemetry record must carry and match all three attribution fields for the active trial row:

- `run_id`
- `trial`
- `path_id`

This rule is enforced for:

- token lanes (`agent-metrics.jsonl`, transcript JSONL usage records)
- activity records
- conflict records
- resume records (`*.meta.json`)
- harness event records

Records tagged to another run are ignored.

Records missing attribution tags are treated as attribution gaps. Any metric dependent on a lane with attribution gaps is marked unavailable, and the run fails claim readiness.

## Claim Gate

A savings claim is allowed only when all conditions pass in `summary.json`:

1. `workload.evidence_tier == production_measured`
2. `data_quality.claim_ready_for_savings == true`
3. `claim_safe_summary.policy[*].savings_claim_allowed == true`
4. `data_quality.attribution_integrity_pass == true`

If any condition fails, the run is claim-ineligible and must be reported as inconclusive for savings.

## One-Fifth Objective Certification

The economics proof lane emits machine-readable certification in:

- `summary.json -> economics_certification.overall_result`
- `summary.json -> economics_certification.per_path.<path>.result`

Allowed values:

- `certified`
- `not_certified`
- `blocked_by_evidence_quality`

The one-fifth objective is certifiable only when every required gate passes for compared paths:

1. `same_workload_comparison_valid`
2. `completion_quality_non_inferior`
3. `intervention_failure_cost_not_materially_worse`
4. `token_cost_reduction_supports_target_threshold`

Target threshold is enforced conservatively from confidence bounds:

- `tokens_total_ratio_to_baseline.ci_high <= 0.2`

If evidence quality is incomplete (attribution gaps, partial trial matrix, missing lane bounds), result must be `blocked_by_evidence_quality`, never `certified`.

## Current Evidence Snapshot (March 12, 2026)

Run ID:

- `ab-economics-proof-synthetic-20260312-final`

Artifact root:

- `reports/ab-harness/ab-economics-proof-synthetic-20260312-final/`

Measured outputs from `summary.json`:

- Lead coordinator token delta vs native: `-900` (`summary.comparisons_vs_baseline.lead_coordinator.tokens_total_minus_baseline.mean_diff`)
- Lead overlay token delta vs native: `-500` (`summary.comparisons_vs_baseline.lead_overlay.tokens_total_minus_baseline.mean_diff`)
- Claim gate result: savings disallowed for both compared paths due `synthetic_measured` evidence tier (`claim_safe_summary.policy[*].reason`)

Interpretation status:

- These are measured harness results.
- They are synthetic evidence.
- They are not valid for production "cheaper than native" claims.

## Modeled Lane (Non-Claim)

`bench/workflow-benchmark.mjs` remains available for exploratory scenario analysis only.

Modeled outputs are not valid evidence for:

- provider billing outcomes,
- blanket savings claims,
- universal cheaper-than-native statements.

## Forbidden Economics Language

Never publish without a claim-qualified measured run:

- "cheaper than native Agent Teams"
- "75-90% cheaper"
- "universal savings"

Allowed only with matching measured artifacts and claim gate pass:

- "For run `<run-id>`, path `<x>` showed lower measured token usage than native under this workload."
