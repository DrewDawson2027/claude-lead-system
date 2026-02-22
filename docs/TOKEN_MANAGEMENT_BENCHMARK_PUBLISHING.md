# Token Management Benchmark Publishing

## Goal
Publish reproducible benchmark artifacts for operator trust and release validation.

## Benchmarks Covered
- Coordinator benchmark (`bench/coord-benchmark.mjs`)
- Hook/CLI smoke benchmarks (`claude-token-guard benchmark` and `ops today` / `session-recap` timing in regression output)

## CI Workflow
- Workflow: `.github/workflows/benchmark-publish.yml`
- Triggers:
  - manual (`workflow_dispatch`)
  - weekly schedule
  - release publication
- Outputs:
  - uploaded benchmark artifact JSON
  - updated `bench/latest-results.json` in repo on `main` (optional path in workflow)
  - job summary with p50/p95 highlights

## Reproducibility
- Record commit SHA, OS, Node/Python versions, and timestamp in output JSON.
- Keep benchmark fixtures stable; document when corpus changes affect results.
