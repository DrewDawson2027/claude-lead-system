# Claude Lead System Release Readiness Report (2026-03-09, updated 2026-03-12)

## Executive summary

- Validation is broadly strong: coordinator tests, sidecar tests, hook tests, docs audits, perf gate, and smoke install all passed.
- I fixed concrete release-quality drift in audit tooling and claim/provenance docs so evidence checks now run cleanly.
- The current release gates are green: `npm run audit:api-contract`, `npm run docs:audit`, and `npm run ci:local` all passed on 2026-03-12.
- Exact native Agent Teams parity is **not** proven and not currently achievable in several architectural areas.
- “Cheaper-than-native” is **not provable** with current repo evidence; only model-based token-pressure estimates exist.

## Canonical claim posture

<!-- CLAIM_POSTURE:START -->

- Canonical taxonomy: `verified`, `partial`, `experimental`
- Parity posture (canonical): Do not claim exact UX parity or exact feature parity with native Agent Teams. Do not publish single-number parity percentages. Use only evidence-labeled capability claims using the canonical taxonomy. Hybrid/native execution paths remain experimental until current end-to-end evidence exists.
- Native advantages (canonical): In-process teammate lifecycle semantics in a single runtime. Tighter first-party cross-platform UX consistency. Integrated native UI and runtime linkage without external coordinator polling.
- Lead advantages (canonical): Pre-edit conflict detection and conflict lifecycle visibility across active sessions. Operator-grade dashboard and API orchestration for multi-terminal workflows. Filesystem coordination path with zero API-token coordination overhead. Policy and governance controls around worker execution (budget/spawn/approval/checkpoint).
- Economics posture (canonical): Do not claim universal savings or blanket cheaper-than-native outcomes. Filesystem coordination can claim zero API-token coordination overhead on that path. Throughput and economics claims beyond that path must stay evidence-scoped to the workflow under discussion.
- Economics verdicts (canonical): Filesystem coordination overhead claim = verified; Workflow-scoped token-pressure delta claim = partial; Universal cheaper-than-native or universal savings claim = experimental.
- Release blocker posture (canonical): Release blockers are failing release-quality gates, not unresolved parity/economics ambitions. Parity and economics gaps remain posture limits until promoted by fresh evidence.
- Canonical source: `docs/CLAIM_POSTURE_SOURCE.json`
- Canonical parity/economics document: `docs/PARITY_ECONOMICS_POSTURE.md`
<!-- CLAIM_POSTURE:END -->

## A+ gap register

### Release blockers

| current behavior                                                    | claimed behavior                                    | native target behavior     | proof artifact                                                                                   | severity | fix owner     | fix plan                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ | -------- | ------------- | --------------------------------------------------------------------- |
| No active release blockers. All required release gates are passing. | Local CI gate should be green for release preflight | n/a (release quality gate) | `npm run audit:api-contract`, `npm run docs:audit`, and `npm run ci:local` outputs on 2026-03-12 | Closed   | Release owner | Keep release gate checks in preflight; block ship on first regression |

Release-blocker posture: parity/economics ambitions are tracked as evidence limits, but release blockers are failing release-quality gates.

### Parity gaps

| current behavior                                                                                      | claimed behavior                                        | native target behavior                                           | proof artifact                                                               | severity | fix owner            | fix plan                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------ |
| In-process display is `tmux capture-pane` polling                                                     | README/docs explicitly avoid parity claim               | Native has in-process React state swap (`selectedTeammate`)      | `docs/ARCHITECTURE-COMPARISON.md` table and architecture sections            | Medium   | Core architecture    | Would require native in-process UI embedding semantics; not a short-term coordinator patch |
| Cross-platform runtime maturity is intentionally uneven (macOS strongest, Linux/Windows partial)      | Compatibility doc already scopes this down              | Native target is consistent first-party UX on all supported OSes | `docs/COMPATIBILITY_MATRIX.md` notes and matrix                              | Medium   | Platform maintainers | Expand runtime proofs per OS, then tighten matrix labels only when evidence is equivalent  |
| Team creation now atomic with rollback, but native still has tighter in-process lifecycle integration | Architecture doc now reflects overlap (not superiority) | Native’s single-runtime lifecycle linkage                        | `mcp-coordinator/test/atomic-team-create.test.mjs` + architecture doc update | Low      | Coordinator team     | Keep atomic flow; add more lifecycle parity tests if native behavior details are needed    |

### Economics-proof gaps

| current behavior                                                                                           | claimed behavior                                       | native target behavior                                                                    | proof artifact                                                             | severity | fix owner             | fix plan                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Cost comparison is token-equivalent modeling with scenario bands; no live native-vs-lead telemetry harness | Docs now correctly avoid exact savings claims          | Real workflow evidence of lower pressure/cost versus native                               | `docs/COMPARISON_METHODOLOGY.md`, `mcp-coordinator/lib/cost-comparison.js` | High     | Perf/econ owner       | Build A/B harness: same workload on native vs lead, collect token/latency/throughput traces, publish dataset + confidence bounds |
| Max-plan billing impact is not directly measurable from current local metrics                              | Docs correctly frame Max as usage-window/headroom only | If claiming “cheaper”, must show real billed deltas or equivalent constrained experiments | `docs/COMPARISON_METHODOLOGY.md` canonical interpretation                  | High     | Product/release owner | Keep claim downgraded until invoice-coupled or API-billed telemetry exists                                                       |

### Docs/claim drift

| current behavior                                                                     | claimed behavior                                    | native target behavior | proof artifact                                                                             | severity        | fix owner         | fix plan                                                                                 |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ | --------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Coverage audit script hard-failed when README omitted explicit numeric coverage line | README no longer carries that numeric claim         | n/a                    | `scripts/check-coverage-claim.mjs` updated and `npm run audit:coverage-claim` pass         | Medium (closed) | Codex (this pass) | Fixed: audit now validates gate/measured coverage and supports README “not-claimed” mode |
| API contract sync script regex only parsed single-quoted schema entries              | Sidecar schema uses double-quoted entries           | n/a                    | `scripts/policy/check-api-contract-sync.mjs` updated and `npm run audit:api-contract` pass | Medium (closed) | Codex (this pass) | Fixed: regex now supports single or double quotes                                        |
| Claim provenance had stale/overstated coverage and stale smoke-install mode command  | Provenance should reflect real gates and commands   | n/a                    | `docs/CLAIM_PROVENANCE.md` updates + docs audit pass                                       | Medium (closed) | Codex (this pass) | Fixed: updated coverage claim, shell lint command, and smoke-install command             |
| Architecture comparison still said atomic team create was “in progress”              | Code/tests already implement atomic create+rollback | n/a                    | `docs/ARCHITECTURE-COMPARISON.md` update + parity tests pass                               | Low (closed)    | Codex (this pass) | Fixed: capability row now reflects implemented behavior                                  |

### Install/blessed-path gaps

| current behavior                                                | claimed behavior                                                | native target behavior                         | proof artifact                                            | severity | fix owner            | fix plan                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------- |
| Blessed full-mode smoke install passes in isolated HOME locally | README says `install.sh -> claudex -> /lead` is mainstream path | n/a                                            | `bash tests/smoke-install.sh --ref HEAD --mode full` pass | Low      | Release owner        | Keep smoke-install in preflight and include artifact logs in release evidence   |
| Local run does not prove all OS install/runtime parity          | Docs already avoid claiming identical cross-platform maturity   | Native first-party install/runtime consistency | Compatibility matrix + local-only smoke evidence          | Medium   | Platform maintainers | Keep CI matrix + add periodic manual evidence packs for Linux/Windows workflows |

## Fixes made

- Added missing `/agents` endpoint contract entries with schema-parity auth/body/description fields:
  - [docs/API_CONTRACT.md](/Users/drewdawson/claude-lead-system/docs/API_CONTRACT.md):71
- Updated resume E2E fixture to include default model so policy-gated resume tests are valid:
  - [mcp-coordinator/test/e2e-agent-resume.test.mjs](/Users/drewdawson/claude-lead-system/mcp-coordinator/test/e2e-agent-resume.test.mjs):80
- Updated coverage claim audit to support README without explicit numeric coverage line while still enforcing coverage gate and measured value checks:
  - [scripts/check-coverage-claim.mjs](/Users/drewdawson/claude-lead-system/scripts/check-coverage-claim.mjs):22
- Fixed API contract drift checker parsing to handle current schema quote style:
  - [scripts/policy/check-api-contract-sync.mjs](/Users/drewdawson/claude-lead-system/scripts/policy/check-api-contract-sync.mjs):13
- Corrected stale claim provenance entries (coverage statement, shell lint command, smoke-install mode):
  - [docs/CLAIM_PROVENANCE.md](/Users/drewdawson/claude-lead-system/docs/CLAIM_PROVENANCE.md):10
- Corrected architecture comparison team-creation capability row and updated timestamp:
  - [docs/ARCHITECTURE-COMPARISON.md](/Users/drewdawson/claude-lead-system/docs/ARCHITECTURE-COMPARISON.md):4
  - [docs/ARCHITECTURE-COMPARISON.md](/Users/drewdawson/claude-lead-system/docs/ARCHITECTURE-COMPARISON.md):73

## Tests run and results

- `npm run audit:api-contract`
  - Result: **pass** (`api-contract sync check passed (73 schema routes checked)`)
- `npm run docs:audit`
  - Result: **pass** (36 pass, 0 fail, 0 warn)
- `npm run ci:local`
  - Result: **pass**
  - `mcp-coordinator test:coverage`: **363 passed, 0 failed**, line coverage **86.75%** (gate 80%)
  - `sidecar test`: **224 passed, 0 failed**
  - `verify:hooks`: shell hooks **43 passed, 0 failed**; `pytest` **124 passed**

## Remaining risks

- Economics claims remain model-derived, not experimentally proven against native real workflows.
- Exact parity remains structurally limited by architecture differences (in-process native UI/lifecycle integration).

## Exact parity verdict

- **Verdict: Not achieved, not proven.**
- What is proven: specific functional parity slices (atomic create+rollback, recipient validation, self-claim loop behavior, bidirectional comms, plan approval gate) through passing E2E/unit tests.
- What is not equivalent: native in-process teammate UI/lifecycle semantics and cross-platform maturity parity.

## Cheaper-than-native verdict

- **Filesystem coordination overhead claim:** `verified` (coordination traffic on the filesystem path uses 0 API/model tokens).
- **Workflow-scoped token-pressure delta claim:** `partial` (allowed only when tied to named measured artifacts and explicit workflow boundaries).
- **Universal cheaper-than-native claim:** `experimental` (not claimable without production-measured, workflow-matched evidence across scenarios).

## Claims now provable vs still unprovable

- Provable now:
  - 80%+ coordinator coverage gate is met (measured 86.75% on this validation run).
  - Atomic team create with rollback behavior works.
  - Recipient validation prevents silent-send failure cases.
  - Bidirectional worker/lead messaging paths function across tested protocol types.
  - Plan approval requires explicit lead action (no auto-approve in tested flows).
  - Perf gate and smoke install (full mode) pass.
- Still unprovable:
  - Exact native Agent Teams parity across architecture/UX/lifecycle semantics.
  - Universal cheaper-than-native claims without production-measured A/B telemetry.
