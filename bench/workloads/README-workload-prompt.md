# Matched A/B Economics Workload Prompt

Use this exact workload for all enabled paths (`native`, `lead_coordinator`, and optional `lead_overlay`) in the same run.

## Objective

Implement and verify a small, deterministic code change set in the current repository that requires:

1. One source-file edit.
2. One test-file edit.
3. Running tests.
4. Producing a concise completion summary with changed files and test output.

## Constraints

- Stay inside the current workspace.
- Do not rewrite unrelated files.
- Keep behavior unchanged outside the target change.
- If blocked, stop and report the blocker in the final summary.

## Required Completion Evidence

A run is considered completed when output includes all of the following:

- A list of edited file paths.
- The exact test command executed.
- The test result status (pass/fail).
- A one-line rationale for the change.

## Human Intervention Marker Contract

If manual intervention was required during the run, print this marker once per intervention:

`[HUMAN_INTERVENTION]`

## Workflow Metrics File Contract (Optional but Preferred)

If the runner can emit structured metrics, write JSON to `$AB_WORKFLOW_METRICS_FILE` with integer fields:

- `completion_units`
- `human_intervention_count`
- `conflict_incidents`
- `resume_attempts`
- `resume_successes`

The A/B harness will convert these into measured event counts.
