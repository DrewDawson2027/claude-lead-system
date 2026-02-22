# Next-Level Build Program (Phased Execution)

This document preserves the implementation framework so work can continue across sessions without redesign churn.

## Principles

1. Ship real capabilities with tests, not paper parity claims.
2. Separate code features from runtime proofs and operational evidence.
3. Preserve existing strengths: cost governance, safety, observability, recovery.
4. Treat platform boundaries as boundaries (native in-process UI embedding, literal zero-install).

## Phase A: Security + Reliability Hardening

1. CSRF/CORS hardening and POST auth enforcement polish.
2. Request rate limiting.
3. Payload allowlists and size limits.
4. Queue sweeper + retention/GC.
5. Bridge stuck-request detection and alerting.
6. Crash recovery / replay safety checks (stale inflight recovery).
7. Diagnostics bundle export.
8. Tests for secure mode and failure modes.

Exit criteria:
- Sidecar secure mode remains usable (web + TUI).
- Hardening paths are covered by sidecar tests.
- No coordinator regressions.

## Phase B: UX Dominance Completion

1. Dedicated approval inbox with inline approve/reject.
2. Interrupt queue prioritization.
3. Route simulation / preview UI.
4. Focus modes (Approval / Dispatch / Recovery).
5. Batch triage actions.
6. Layout persistence + filters + custom hotkeys.
7. Web/TUI parity polish.

## Phase C: Tasking + Handoff + Policy Depth

1. In-progress controlled reassignment workflow.
2. Handoff protocol + audit trail.
3. Task templates + outcome quality gates.
4. Queue policies + priority aging.
5. Auto-rebalance triggers.
6. “Why no candidate?” explainability.

## Phase D: Proof / Benchmarks / Comparative Edge

1. Benchmark harness (dispatch, approval, recovery, rebalance quality, token cost).
2. Metrics history panel.
3. Exportable comparison report.
4. Demo scenarios.
5. Live bridge validation script + runbook proof output.

## Phase E: Ops / DX / Long Tail

1. Schema versioning + migrations.
2. Snapshot diff + event replay.
3. Runbooks + API contract docs.
4. Chaos/scalability testing.
5. Operator training + known limitations docs.

## Notes

1. “Fully complete” requires live runtime proofs and benchmark evidence, not just code.
2. Work should be marked complete phase-by-phase with test outputs recorded.
