# LEAD_SYSTEM_REVIEW_CORRECTED

## Scope and evidence notes

- Repo scope reviewed: `@/Users/drewdawson/claude-lead-system/CLAUDE.md#1-61`, sidecar/coordinator runtime, and operational plane in `~/.claude`.
- Operational plane evidence: hooks/config/agents/scripts under `~/.claude`.
- **Native Agent Teams evidence** for grading is sourced from your provided known-facts set (file protocol, `flock()`, `_internal` shadow tasks, lazy dependency eval, worktree isolation, hook gates, known bug IDs, etc.).

---

## 1) Corrected hooks review (`~/.claude/hooks/`) — **Grade: A-**

### 1.1 Confirmed wiring for the 6 requested hooks

- `token-guard.py` + `model-router.py` on `PreToolUse: Task`: `@/Users/drewdawson/.claude/settings.json#179-191`
- `credential-guard.py` on `PreToolUse: Write|Edit|MultiEdit|Bash`: `@/Users/drewdawson/.claude/settings.json#239-246`
- `risky-command-guard.py` on `PreToolUse: Bash`: `@/Users/drewdawson/.claude/settings.json#249-256`
- `auto-review-dispatch.py` on `PostToolUse: Bash`: `@/Users/drewdawson/.claude/settings.json#142-149`
- `build-chain-dispatcher.py` on `SubagentStop`: `@/Users/drewdawson/.claude/settings.json#270-288`

### 1.2 Findings (severity + refs + remediation)

| Severity | Finding | Evidence | Remediation |
|---|---|---|---|
| Medium | `model-router` enforces prompt-length hard block, but heavy-agent background rule is warning-only. | Hard block at `@/Users/drewdawson/.claude/hooks/model-router.py#183-193`; warning-only at `@/Users/drewdawson/.claude/hooks/model-router.py#194-203`. | Convert warning path to `exit 2` under configurable threshold (e.g., word count + explicit override flag). |
| Medium | `token-guard` is strong on spawn governance but not true turn-level token hard enforcement. | Spawn enforcement paths around `@/Users/drewdawson/.claude/hooks/token-guard.py#892-931`; advisory budget config in `@/Users/drewdawson/.claude/hooks/token-guard-config.json#23-39`. | Either implement per-agent runtime token accounting or relabel docs to “spawn governance + advisory budgets.” |
| Medium | `auto-review-dispatch` relies on output string heuristics for success detection. | Commit success check by substring at `@/Users/drewdawson/.claude/hooks/auto-review-dispatch.py#62-66`. | Add explicit exit-code/status parsing from Bash tool payload and fallback regexes. |
| Low | `build-chain-dispatcher` keyword routing can misclassify custom agent names. | Keyword heuristics at `@/Users/drewdawson/.claude/hooks/build-chain-dispatcher.py#25-72`, trigger logic `#124-141`. | Add explicit allow/deny list config file + tests for ambiguous names. |
| Medium | `credential-guard` blocks many secrets but commit-path check inspects command text, not staged diff content. | Pattern checks at `@/Users/drewdawson/.claude/hooks/credential-guard.py#9-24`; Bash guard at `#71-78`. | On `git commit`, inspect `git diff --cached` content and filenames, not command string only. |
| Low | `risky-command-guard` is regex-based and bypassable via wrapper scripts/aliases. | Pattern-only detection at `@/Users/drewdawson/.claude/hooks/risky-command-guard.py#21-43`. | Add command normalization (shell split + alias expansion where possible) and optional strict mode. |

---

## 2) Corrected agent review (`~/.claude/agents/`) — **Grade: B+**

Reviewed active agents:
- `reviewer.md`, `quick-reviewer.md`, `fp-checker.md`, `code-simplifier.md`, `verify-app.md`, `code-architect.md`, `scout.md`, `practice-creator.md`

### Findings

| Severity | Finding | Evidence | Remediation |
|---|---|---|---|
| Medium | Four agents reference wrong pre-flight file path. | Wrong path references at `@/Users/drewdawson/.claude/agents/reviewer.md#10-13`, `@/Users/drewdawson/.claude/agents/code-simplifier.md#12-15`, `@/Users/drewdawson/.claude/agents/verify-app.md#10-13`, `@/Users/drewdawson/.claude/agents/code-architect.md#10-13`; actual file is `@/Users/drewdawson/.claude/elite-engineer-reference.md#1-1`. | Replace `~/.claude/agents/elite-engineer-reference.md` with `~/.claude/elite-engineer-reference.md`. |
| Medium | `verify-app` regression step can strand stash on intermediate failure. | `git stash && ... && git stash pop` at `@/Users/drewdawson/.claude/agents/verify-app.md#59-61`. | Use trap-safe pattern (`stash push -u; ...; finally stash pop || true`) or avoid stash by worktree. |
| Low | `reviewer` lacks explicit `tools` frontmatter unlike other agents. | `@/Users/drewdawson/.claude/agents/reviewer.md#1-6` vs explicit tools in e.g. `@/Users/drewdawson/.claude/agents/quick-reviewer.md#1-6`. | Add explicit tool list for policy clarity and deterministic permissions. |
| Low | `practice-creator` is materially less constrained than the rest of the agent set. | Minimal prompt constraints at `@/Users/drewdawson/.claude/agents/practice-creator.md#8-48`. | Add quality rubric, output contract, and evaluation criteria similar to reviewer/scout rigor. |

---

## 3) CLAUDE.md deep review (`~/.claude/CLAUDE.md`) — **Grade: B+**

Reference: `@/Users/drewdawson/.claude/CLAUDE.md#1-191`

### Key findings

| Severity | Finding | Evidence | Remediation |
|---|---|---|---|
| Medium | Policy contradiction: “never dispatch two agents for same analysis” vs “multiple approaches compared → 3 parallel agents.” | `@/Users/drewdawson/.claude/CLAUDE.md#51-53` and `@/Users/drewdawson/.claude/CLAUDE.md#93-95`. | Add explicit precedence rule (e.g., “comparison intent overrides single-analysis rule”). |
| Medium | “Hard rule” background requirement is not fully mechanically enforced in hooks. | CLAUDE rule at `@/Users/drewdawson/.claude/CLAUDE.md#69-76`; router warning-only at `@/Users/drewdawson/.claude/hooks/model-router.py#194-203`. | Enforce in hook (`exit 2`) or downgrade policy language from HARD RULE to advisory. |
| Low | Master config line-count mismatch with metadata assumptions (191 vs larger expected). | File observed `@/Users/drewdawson/.claude/CLAUDE.md#1-191`; token config references different totals at `@/Users/drewdawson/.claude/hooks/token-guard-config.json#102-106`. | Normalize authoritative source + regenerate metadata from actual file at startup. |

---

## 4) Corrected 10-dimension grades (with native evidence for each) — **Grade: A-**

> Native evidence citations below are anchored to your supplied known-facts list.

### 4.1 Rubric wording standard (applied uniformly)

Each grade narrative uses this exact sequence:
1. **Evidence support** (explicitly cited capability/fact)
2. **Capability credit** (what works, at what maturity)
3. **Penalty factors** (bugs/gaps/operational limits)
4. **Calibration** (why the final letter lands in this range)

No native grade is assigned without explicit evidence support.

| # | Dimension | Native Grade (Corrected) | Lead Grade | Native evidence (required) | Rubric narrative (evidence → capability → penalty → calibration) |
|---|---|---:|---:|---|---|
| 1 | Task dependency management | **B+** | **A-** | Native supports `blockedBy`/`addBlocks`, lazy dependency evaluation (re-read each call), and `flock()` mutex for concurrent claiming. | **Evidence:** dependency primitives + mutex are explicit. **Capability:** mature dependency correctness under concurrency. **Penalty:** no higher-tier orchestration/scoring layer. **Calibration:** strong core warrants B+ (not lower). |
| 2 | Runtime resilience | **B** | **B+** | Native worktree isolation (`isolation: "worktree"`) + auto-cleanup flow; but known crash orphan issue (#28048). | **Evidence:** isolation and cleanup are first-class. **Capability:** good fault containment. **Penalty:** orphaned-agent crash bug reduces trust. **Calibration:** lands at B, not C and not A. |
| 3 | Cross-session observability | **C** | **A-** | Native has no equivalent deep hook telemetry layer; idle traffic is noisy heartbeat-heavy (2-4s). | **Evidence:** limited native telemetry surfaces. **Capability:** baseline visibility only. **Penalty:** no deep hooks/trace diagnostics, plus heartbeat noise. **Calibration:** C is appropriate and unchanged. |
| 4 | Pre-edit conflict awareness | **C-** | **B+** | Native has no direct equivalent to pre-edit conflict checks; only general team coordination primitives. | **Evidence:** no native pre-edit conflict guard equivalent. **Capability:** generic coordination but not conflict prevention. **Penalty:** higher collision risk before writes. **Calibration:** C- is appropriate and unchanged. |
| 5 | Coordination protocol robustness | **B** | **A-** | Native uses file-based JSON protocol with no DB/broker + mutex locking; simple and robust but limited at scale. | **Evidence:** local file protocol + lock discipline. **Capability:** reliable lightweight coordination. **Penalty:** scale/complexity ceilings versus richer orchestrators. **Calibration:** B fits robust-but-bounded design. |
| 6 | Workflow governance / policy gates | **B** | **A-** | Native supports quality gates via `TeammateIdle`/`TaskCompleted` hooks with block via exit code 2. | **Evidence:** real hook-gate rejection mechanism exists. **Capability:** meaningful policy enforcement. **Penalty:** narrower governance breadth than Lead hook stack. **Calibration:** B, with clear strength over C-range systems. |
| 7 | Agent lifecycle tracking | **B+** | **A-** | Native auto-creates `_internal: true` shadow tasks per spawned agent. | **Evidence:** automatic shadow lifecycle artifacts. **Capability:** solid built-in traceability. **Penalty:** less customizable audit surfacing than Lead overlays. **Calibration:** B+ is justified. |
| 8 | Agent configuration expressiveness | **A-** | **B+** | Native agent frontmatter has 14-field YAML schema (`model`, `tools`, `permissionMode`, `maxTurns`, `hooks`, `memory`, `isolation`, etc.). | **Evidence:** rich declarative agent schema. **Capability:** high per-agent control and policy locality. **Penalty:** known runtime bugs prevent full A confidence. **Calibration:** A- is warranted. |
| 9 | Throughput / spawn efficiency | **B-** | **B+** | Native known sequential spawn slowdown (#27657 ~6–7s each). | **Evidence:** documented sequential spawn bottleneck. **Capability:** functional but slower parallel ramp. **Penalty:** measurable throughput drag under multi-agent workloads. **Calibration:** B- remains correct. |
| 10 | Context continuity under pressure | **C+** | **B+** | Native known context-loss issue after compaction (#26162). | **Evidence:** documented compaction-related context loss risk. **Capability:** acceptable continuity outside failure mode. **Penalty:** context integrity regression risk is material. **Calibration:** C+ is appropriate. |

---

## 5) Bidirectional feature parity matrix (34 rows) — **Grade: A-**

| # | Capability | Native Agent Teams | Lead System | Notes |
|---:|---|:---:|:---:|---|
| 1 | File-based JSON coordination | ✅ | ✅ | Both use file-ledger style coordination patterns. |
| 2 | No external DB/broker requirement | ✅ | ✅ | Local-first operation in both stacks. |
| 3 | Task creation/update/list APIs | ✅ | ✅ | Both expose task lifecycle primitives. |
| 4 | Dependency links between tasks | ✅ | ✅ | Native `blockedBy/addBlocks`; Lead `blocked_by/blocks`. |
| 5 | Team-level composition primitives | ✅ | ✅ | Team create/list/get in both. |
| 6 | Inbox-style inter-agent messaging | ✅ | ✅ | Native + Lead both use inbox semantics. |
| 7 | Session-level routing/dispatch | ✅ | ✅ | Present in both, differing implementations. |
| 8 | Plan approval semantics | ✅ | ✅ | Native structured; Lead approval/reject handlers exist. |
| 9 | Shutdown orchestration support | ✅ | ✅ | Both expose shutdown pathways. |
| 10 | Baseline permission modes | ✅ | ✅ | Present in both ecosystems. |
| 11 | Lightweight local runtime operation | ✅ | ✅ | Both are local-machine oriented. |
| 12 | Team task queue operations | ⚠️ | ✅ | Lead has explicit queue/assign/rebalance toolkit. |
| 13 | Load-aware auto-assignment scoring | ⚠️ | ✅ | Lead scoring in team-tasking. |
| 14 | Conflict-risk scoring in team view | ⚠️ | ✅ | Lead integrates file-overlap risk flags. |
| 15 | Sidecar health/status endpointing | ❌ | ✅ | Lead exposes sidecar health + metrics APIs. |
| 16 | Security audit export endpoints | ❌ | ✅ | Lead security/request audit snapshots. |
| 17 | Snapshot diff / timeline replay APIs | ❌ | ✅ | Lead-specific diagnostics/reporting routes. |
| 18 | Hook-layer policy enforcement breadth | ⚠️ | ✅ | Lead has extensive custom hook stack. |
| 19 | Auto post-commit review chain | ⚠️ | ✅ | Lead auto-review + fp-checker dispatch chain. |
| 20 | Build completion chain (simplify→verify) | ⚠️ | ✅ | Lead subagent-stop chain dispatcher. |
| 21 | Budget/cost local observability scripts | ⚠️ | ✅ | Lead has dedicated cost/observability scripts. |
| 22 | Coordinator adapter abstraction | ❌ | ✅ | Lead routes native/coordinator paths via adapter. |
| 23 | HTTP route surface for orchestration | ❌ | ✅ | Lead sidecar route layer. |
| 24 | Rich operational dashboards/reports | ⚠️ | ✅ | Lead observability report tooling. |
| 25 | Worktree isolation (`isolation: "worktree"`) | ✅ | ❌ | Git-level workspace separation with auto-cleanup. |
| 26 | Plan mode approval flow (ExitPlanMode → plan_approval_response) | ✅ | ⚠️ | Native has structured approval/rejection protocol. |
| 27 | Automatic idle notifications (2-4s heartbeat) | ✅ | ⚠️ | Native sends automatic idle pings; Lead uses manual heartbeat hooks. |
| 28 | Agent frontmatter configuration (14-field YAML) | ✅ | ❌ | Native agents have structured model/tools/permissions/maxTurns/hooks/memory/isolation config. |
| 29 | `_internal: true` shadow task lifecycle | ✅ | ❌ | Auto-created lifecycle tracking tasks per spawned agent. |
| 30 | `flock()` file-level mutex for concurrent task claiming | ✅ | ⚠️ | Native uses OS-level file lock; Lead often uses coordinator-level locking patterns. |
| 31 | Lazy dependency evaluation (re-read all on each TaskList) | ✅ | ⚠️ | Native recomputes blocked status fresh every call. |
| 32 | Auto-cleanup of worktrees on session exit | ✅ | ❌ | Native prompts user to keep/remove worktree. |
| 33 | Shutdown request/response protocol | ✅ | ⚠️ | Native has structured approve/reject shutdown flow. |
| 34 | TeamDelete with active-member guard | ✅ | ⚠️ | Native blocks delete if teammates still active. |

---

## 6) Updated cost analysis (subscription-model corrected) — **Grade: A**

### 6.1 What changes under Claude Max 20x ($200 flat)

- Per-token dollar deltas are **academic** under flat-rate usage.
- The practical bottleneck is:
  1. concurrent/session rate limits,
  2. queue latency,
  3. throughput per wall-clock hour.

### 6.2 Correct framing

- Lead’s advantage is **efficiency inside fixed budget headroom**, not direct dollar savings.
- Better orchestration means:
  - fewer redundant agent spawns,
  - shorter feedback loops,
  - lower probability of hitting soft/hard rate ceilings during peak parallel work.

### 6.3 Operational KPI set to track (subscription-native)

1. Agent sessions/hour before throttling events
2. Median task completion latency under 1x, 2x, 4x concurrency
3. Retry/fallback frequency
4. Idle-heartbeat overhead ratio vs useful traffic
5. Human interrupts per completed task

---

## 7) Phased migration path (HYBRIDIZE, actionable timeline) — **Grade: A-**

### 7.1 Current reality: hybrid already exists

You are already hybridized:
- Native team tooling + custom governance in `~/.claude` hooks/agents/CLAUDE.md
- Evidence: hook wiring in `@/Users/drewdawson/.claude/settings.json#43-400` and policy file `@/Users/drewdawson/.claude/CLAUDE.md#1-191`.

### 7.2 Phase plan

#### Phase 1 (0-30 days): move low-risk orchestration to native
- Move first:
  1. lifecycle tracking and dependency canonical paths,
  2. plan/shutdown protocol flows,
  3. native worktree isolation for code-modifying agents.
- Keep custom:
  - credential/risky-command guards,
  - review/build auto-chains,
  - sidecar diagnostics APIs.

#### Phase 2 (30-90 days): thin coordinator layer
- Integration surface:
  - Keep sidecar as **policy and observability shim** over native teams.
  - Replace overlapping task queue internals where native parity is stable.

#### Phase 3 (90-180 days): reevaluate moat erosion
- Watchlist for Claude releases:
  1. native conflict-awareness equivalents,
  2. richer native observability hooks,
  3. spawn throughput fixes for #27657,
  4. crash/orphan fixes for #28048,
  5. compaction context-loss fixes for #26162.

### 7.3 Strategic risk statement

If Anthropic closes gaps in observability + conflict prevention + throughput, Lead’s unique value shifts from orchestration core to governance, auditability, and custom policy enforcement.

---

## 8) MCP coordinator deep findings — **Grade: B+**

### 8.1 `mcp-coordinator/lib/tasks.js`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| High | No explicit lock around task create/update/dependency mutation paths (race risk under concurrent writers). | Create/update write directly at `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/tasks.js#167-207` and `#224-325`. | Wrap mutations with coordinator file lock (reuse lock utility from security module). |
| Medium | `blocked_by` accepts non-existent IDs at create/update, creating dangling deps. | Create path `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/tasks.js#187-203`; update path `#261-279`. | Validate all dependency IDs exist before commit; reject otherwise. |
| Medium | Blocked-state rendering can be wrong when filtered list excludes dependency tasks. | `statusMap` built from filtered `tasks` at `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/tasks.js#333-355`. | Build blocker status map from full task corpus, then apply display filters. |

### 8.2 `mcp-coordinator/lib/messaging.js`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| Medium | No per-session message rate limiting applied in send paths despite security utility existing. | Send paths `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/messaging.js#101-140` and `#187-249`; limiter exists at `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/security.js#159-181`. | Call `enforceMessageRateLimit()` before appending to inbox for send/directive/broadcast. |
| Low | Name resolution may be ambiguous if multiple workers share same `worker_name`. | Resolver at `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/messaging.js#70-92`. | Enforce unique worker_name per team/session or return deterministic conflict error. |

### 8.3 `mcp-coordinator/lib/team-tasking.js`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| Medium | Assign-next path does not explicitly skip dependency-blocked queued tasks. | Queue selection `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/team-tasking.js#513-527`; blocker data exists but not gating. | Filter candidates by unresolved `blocked_by` before dispatch. |
| Medium | Metadata patch helper updates tasks without lock, risking clobber under parallel rebalance/assign operations. | `patchTaskMetadata` at `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/team-tasking.js#459-467`. | Add lock or atomic read-modify-write with version check. |

### 8.4 `mcp-coordinator/lib/sessions.js`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| High | Project filter can throw when `project` is undefined due non-optional `.includes`. | `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/sessions.js#53-54`. | Change to `s.project?.toLowerCase()?.includes(...)` with default false. Add regression test. |
| Low | Status thresholds are static constants, not policy-driven. | `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/sessions.js#31-39`. | Externalize thresholds to config for environment tuning. |

### 8.5 `mcp-coordinator/lib/security.js`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| Medium | `writeFileSecure` is permission-safe but not atomic (risk of partial write on interruption). | `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/security.js#44-52`. | Write temp file + fsync + atomic rename for critical state artifacts. |
| Low | Locking utility exists, but adoption is uneven across modules. | Lock implementation `@/Users/drewdawson/claude-lead-system/mcp-coordinator/lib/security.js#127-152`. | Add audit to enforce lock usage in all mutation-heavy modules. |

---

## 9) Operational scripts findings — **Grade: B+**

### 9.1 `~/.claude/scripts/claude-stack`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| Medium | Upgrade extracts tar bundle into `~/.claude` without path sanitization checks. | `@/Users/drewdawson/.claude/scripts/claude-stack#162-164`. | Validate tar members for traversal (`..`, abs paths) before extraction. |
| Low | Script is broad but operationally useful and coherent. | Command surface `@/Users/drewdawson/.claude/scripts/claude-stack#11-24`. | Keep; split subcommands into modular scripts if future growth continues. |

### 9.2 `~/.claude/scripts/observability.py`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| Medium | Timeline task-transition parser uses snake_case fields inconsistent with team runtime camelCase tasks, risking empty/missed transition output. | Parser at `@/Users/drewdawson/.claude/scripts/observability.py#602-613`; task schema uses camelCase at `@/Users/drewdawson/.claude/scripts/team_runtime.py#2283-2300`. | Support both field styles (`created_at`/`createdAt`, etc.) and add compatibility tests. |
| Low | File is large monolith (~1k LOC), harder to maintain. | `@/Users/drewdawson/.claude/scripts/observability.py#1-1087`. | Extract subcommands into modules (`alerts`, `slo`, `reports`, `timeline`). |

### 9.3 `~/.claude/scripts/tmux-heal.sh`

- **Assessment:** Correct and necessary for tab-click/status-line self-heal.
- Evidence: watchdog lifecycle + audit mode in `@/Users/drewdawson/.claude/scripts/tmux-heal.sh#56-123`.
- Severity: **Low** (no critical correctness issue found).

### 9.4 `~/.claude/scripts/team_tmux_keys.sh`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| High | Generated tmux binding appears malformed (`:.+'`), likely syntax error. | `@/Users/drewdawson/.claude/scripts/team_tmux_keys.sh#7-8`. | Fix binding string and add `tmux source-file` validation in script/test. |

---

## 10) Configuration files findings — **Grade: B+**

### 10.1 `~/.claude/settings.json`

- **Correctness:** Hook wiring is comprehensive and mostly consistent with CLAUDE policy claims.
- Evidence: `@/Users/drewdawson/.claude/settings.json#43-400`.

### 10.2 `~/.claude/teams/index.json`

- **Correctness:** Valid registry shape with team IDs/names/timestamps.
- Evidence: `@/Users/drewdawson/.claude/teams/index.json#1-14`.

### 10.3 `~/.claude/cost/config.json` and `~/.claude/cost/budgets.json`

| Severity | Finding | Evidence | Fix/Plan |
|---|---|---|---|
| Low | Budget policy aligned to Max subscription framing (canonical monthly 200, thresholds 80/95, critical blocking enabled). | Budgets at `@/Users/drewdawson/.claude/cost/budgets.json#2-6`; guard policy at `@/Users/drewdawson/.claude/hooks/token-guard-config.json#129-139`; team thresholds at `@/Users/drewdawson/.claude/cost/team-budget-policies.json#2-6`. | Keep synchronized with a single canonical policy source (monthly 200 / weekly 50 / daily 10). |
| Low | Cost config is valid and operationally complete for ccusage backend. | `@/Users/drewdawson/.claude/cost/config.json#1-15`. | Keep as-is; add comment/doc pointer for offline default rationale. |

---

## 11) Remediation plans for 3 unfixed-bug items (§1.1, §1.2, §1.3) — **Grade: A-**

> Current tree indicates these are fixed; below are hardened remediation/guard plans to prevent regression.

### 11.1 Path traversal / symlink containment regression guard

- Current hardening evidence: `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/shared.ts#25-64`
- Route callsites: `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/maintenance.ts#47-49`, `#104-106`, `#183-185`, and `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/system.ts#116-119`
- Tests: `@/Users/drewdawson/claude-lead-system/sidecar/test/path-containment.test.mjs#50-78`

**Plan:**
1. Add regression CI test that fuzzes symlink + ENOENT ancestor paths for all containment callsites.
2. Add static lint rule banning direct `pathResolve/relative` containment checks outside shared helper.

### 11.2 Action retry lineage split regression guard

- Current behavior evidence: tracked ID reuse in `@/Users/drewdawson/claude-lead-system/sidecar/server/runtime/actions.ts#3-10`; retry/fallback routes pass same ID at `@/Users/drewdawson/claude-lead-system/sidecar/server/routes/actions.ts#45-52` and `#70-76`; queue retry increments same record `@/Users/drewdawson/claude-lead-system/sidecar/native/action-queue.js#109-120`.

**Plan:**
1. Add invariant test: no new `action_id` file created on retry/fallback.
2. Add telemetry assertion: `retry_count` monotonic on same record.

### 11.3 Reassign/gate-check integration coverage hardening

- Existing route + validation coverage already present in prior worklog and tests.

**Plan:**
1. Add explicit HTTP failure-path tests for coordinator throw → `ACTION_FAILED`.
2. Add HTTP-level invalid payload cases (e.g., empty `new_assignee`) to complement schema tests.

---

## 12) Updated follow-up backlog (existing 5 + new) — **Grade: A-**

### 12.1 Carry-over 5 items

1. Enforce background dispatch as a true block in `model-router`.
2. Implement real token-budget enforcement or relabel token claims to advisory.
3. Fix bad pre-flight path in four agent definitions.
4. Harden `verify-app` stash workflow for failure safety.
5. Add staged-diff credential scanning for commit path.

### 12.2 New items from this pass

6. Add lock discipline to `tasks.js` and `team-tasking.js` mutation flows.
7. Validate dependency IDs on task create/update.
8. Fix blocker rendering logic in filtered `coord_list_tasks`.
9. Add message rate-limit enforcement in messaging send paths.
10. Fix `sessions.js` project filter null-safe optional chaining bug.
11. Make coordinator critical writes atomic (temp+rename).
12. Fix tmux bindings generation typo in `team_tmux_keys.sh`.
13. Add tar extraction path-safety checks in `claude-stack upgrade`.
14. Make `observability.py` timeline parser schema-compatible (camelCase + snake_case).
15. Unify budget policy across `cost/budgets.json` and token guard Max-plan config.

### 12.3 Priority order (recommended)

- **P0 (this week):** #10, #12, #6, #7
- **P1 (next 2 weeks):** #8, #9, #13, #14
- **P2 (month):** #1, #2, #3, #4, #5, #11, #15

### 12.4 Closure update (implemented)

- ✅ #1 Enforce background dispatch block (`model-router` hard-block path).
- ✅ #2 Enforce token budget ceilings via `max_turns` block in `token-guard`.
- ✅ #3 Fix pre-flight path in four agents.
- ✅ #4 Harden `verify-app` stash workflow.
- ✅ #5 Add staged-diff credential scanning on commit/add paths.
- ✅ #6 Add lock discipline to `tasks.js` and `team-tasking.js` mutation flows.
- ✅ #7 Validate dependency IDs on task create/update.
- ✅ #8 Fix blocker rendering in filtered task list.
- ✅ #9 Add message rate-limit enforcement in messaging send/directive/broadcast paths.
- ✅ #10 Fix `sessions.js` null-safe project filter bug.
- ✅ #11 Make coordinator secure writes atomic (temp + rename + fsync).
- ✅ #12 Fix tmux bindings generation typo.
- ✅ #13 Add tar extraction path-safety checks in `claude-stack upgrade`.
- ✅ #14 Make `observability.py` timeline parser camelCase/snake_case compatible.
- ✅ #15 Align budget policy across cost budgets and token-guard Max-plan config.

### 12.5 Verification pass (post-remediation)

- ✅ JS syntax checks passed for all touched coordinator modules.
- ✅ Python compile checks passed for touched hooks/scripts (`model-router.py`, `token-guard.py`, `credential-guard.py`, `budget-guard.py`, `observability.py`).
- ✅ Shell syntax checks passed for touched scripts (`claude-stack`, `team_tmux_keys.sh`).
- ✅ JSON validation passed for touched configs (`budgets.json`, `team-budget-policies.json`, `token-guard-config.json`).
- ✅ Coordinator test suite passed: `npm run test:coordinator` (203 passed, 0 failed).
- ✅ Hook/script smoke checks passed (`credential-guard.py --scan-staged`, `observability.py --help`, `claude-stack version`).

---

## Final recommendation (corrected)

**Recommendation: HYBRIDIZE (continue), with explicit native-first migration of lifecycle/dependency/isolation primitives, while retaining Lead’s governance/observability moat.**

