# Parity, Economics, And Claim Posture (Canonical)

Generated from `docs/CLAIM_POSTURE_SOURCE.json` by `scripts/claim-posture-sync.mjs`. Do not hand-edit this file.

Version: `2026-03-13`

## Claim Taxonomy

| Label          | Definition                                                                     |
| -------------- | ------------------------------------------------------------------------------ |
| `verified`     | Code path plus current test or local operating evidence.                       |
| `partial`      | Code path exists with explicit scope limits or measured-but-narrow evidence.   |
| `experimental` | Present in code/config but not ready for parity or economics marketing claims. |

## Parity Posture

- Do not claim exact UX parity or exact feature parity with native Agent Teams.
- Do not publish single-number parity percentages.
- Use only evidence-labeled capability claims using the canonical taxonomy.
- Hybrid/native execution paths remain experimental until current end-to-end evidence exists.

## Native Advantages (Canonical)

- In-process teammate lifecycle semantics in a single runtime.
- Tighter first-party cross-platform UX consistency. In-process display (native keypress UX) is `partial` — `coord_watch_output` provides functional output monitoring via MCP tool call, not identical UX to native Shift+Down keypress.
- Integrated native UI and runtime linkage without external coordinator polling.

## Lead Advantages (Canonical)

- Pre-edit conflict detection and conflict lifecycle visibility across active sessions.
- Operator-grade dashboard and API orchestration for multi-terminal workflows.
- Filesystem coordination path with zero API-token coordination overhead.
- Policy and governance controls around worker execution (budget/spawn/approval/checkpoint).

## Economics Posture

- Do not claim universal savings or blanket cheaper-than-native outcomes.
- Filesystem coordination can claim zero API-token coordination overhead on that path.
- Throughput and economics claims beyond that path must stay evidence-scoped to the workflow under discussion.

## Economics Verdicts (Canonical)

| Claim                                                    | Label          | Scope                                                                                                  |
| -------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| Filesystem coordination overhead claim                   | `verified`     | Claim allowed for coordination traffic on the filesystem path only; excludes worker/model token usage. |
| Workflow-scoped token-pressure delta claim               | `partial`      | Claim allowed only when tied to named measured artifacts and explicit workflow boundaries.             |
| Universal cheaper-than-native or universal savings claim | `experimental` | Not claimable without production-measured, workflow-matched evidence across scenarios.                 |

## Release Blocker Posture

- Release blockers are failing release-quality gates, not unresolved parity/economics ambitions.
- Parity and economics gaps remain posture limits until promoted by fresh evidence.

## Posture Sync Targets

- `README.md`
- `CLAUDE.md`
- `MANIFEST.md`
- `reports/release-readiness-report-2026-03-09.md`

## Required Shared Block

The following block must appear verbatim in every sync target:

```md
<!-- CLAIM_POSTURE:START -->

- Canonical taxonomy: `verified`, `partial`, `experimental`
- Parity posture (canonical): Do not claim exact UX parity or exact feature parity with native Agent Teams. Do not publish single-number parity percentages. Use only evidence-labeled capability claims using the canonical taxonomy. Hybrid/native execution paths remain experimental until current end-to-end evidence exists.
- Native advantages (canonical): In-process teammate lifecycle semantics in a single runtime. Tighter first-party cross-platform UX consistency. In-process display is `partial` — `coord_watch_output` provides functional output monitoring via MCP tool call, not identical UX to native keypress. Integrated native UI and runtime linkage without external coordinator polling.
- Lead advantages (canonical): Pre-edit conflict detection and conflict lifecycle visibility across active sessions. Operator-grade dashboard and API orchestration for multi-terminal workflows. Filesystem coordination path with zero API-token coordination overhead. Policy and governance controls around worker execution (budget/spawn/approval/checkpoint).
- Economics posture (canonical): Do not claim universal savings or blanket cheaper-than-native outcomes. Filesystem coordination can claim zero API-token coordination overhead on that path. Throughput and economics claims beyond that path must stay evidence-scoped to the workflow under discussion.
- Economics verdicts (canonical): Filesystem coordination overhead claim = verified; Workflow-scoped token-pressure delta claim = partial; Universal cheaper-than-native or universal savings claim = experimental.
- Release blocker posture (canonical): Release blockers are failing release-quality gates, not unresolved parity/economics ambitions. Parity and economics gaps remain posture limits until promoted by fresh evidence.
- Canonical source: `docs/CLAIM_POSTURE_SOURCE.json`
- Canonical parity/economics document: `docs/PARITY_ECONOMICS_POSTURE.md`
<!-- CLAIM_POSTURE:END -->
```

## Forbidden Assertion Patterns

- Exact native parity mission statement: `Replicate Claude Code's native Agent Teams exactly`
- Same UX and feature language: `same UX, same features`
- Universal savings percentage target: `75[\u2013-]90% cheaper`
- Unqualified universal cheaper claim: `cheaper than native Agent Teams`
- Total parity assertion: `Everything Agent Teams can do, the Lead System can do too`
- Single-number parity percentage claim: `\b\d{1,3}%\s*parity\b`
