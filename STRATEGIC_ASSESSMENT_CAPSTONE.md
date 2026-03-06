# Lead System Strategic Assessment — Capstone Synthesis

**Date:** March 5, 2026
**Scope:** Capstone synthesis across 3-agent review of custom Claude Code team orchestration system
**Reviewed Components:**

- Application code (`claude-lead-system/`) — Agent 1
- Control plane (`~/.claude/hooks`, `~/.claude/scripts`, config) — Agent 2
- Strategic positioning, competitive analysis, migration framework — This assessment

---

## Executive Summary

The Lead System is a custom orchestration layer built on top of Claude Code's native Agent Teams. The `claude-lead-system/` repository contains ~28,400 lines of code (JS/TS/Python/Shell, excluding `node_modules`), with an additional ~19,700 lines in `~/.claude/hooks/` and ~22,800 lines in `~/.claude/scripts/` — totaling ~71,000 lines across the full system surface (measured via `wc -l`). It provides genuine, verified value in security and governance (credential scanning, risky-command taxonomy, trust auditing), operational resilience (conflict detection, checkpoint/restore, self-heal), cost governance (budget gates, spawn governance, read-efficiency enforcement), and observability (HTTP dashboards, agent metrics, SLO checking). These capabilities do not exist in native Claude Code and represent real operational advantages.

However, the system also carries significant architectural debt. Chain integrity — the automated commit-to-review and build-to-simplify-to-verify workflows — remains heuristic rather than mechanistic. Custom task, approval, and shutdown abstractions duplicate native equivalents with less rigor. The hook surface area (55 .py/.sh files in `~/.claude/hooks/`, 27 registered in settings.json across 11 event types) creates latency overhead and maintenance burden that partially erodes the throughput gains the system provides. Extended audits (Revision 2: Issues #10-20, Revision 3: Issues #21-33) identified 23 additional quality issues across two revision passes, including a supply chain risk in `format-on-edit.py`, overly permissive spawn governance, missing file locking, deprecated agent validation, token waste from redundant reference doc reads, hook latency worst-cases of 66 seconds per Write/Edit and 25 seconds per Task spawn, duplicate warning behavior, overly broad hook matchers, and agent persona redundancy.

**Bottom line:** The correct path is **(c) Thin hybrid layer** — preserve the 16 genuinely differentiated files (across hooks, coordinator, and sidecar), migrate 8 duplicative components to native, and rework the 3 chain dispatchers into proper state machines.

---

## 1. Corrected 41-Row Parity Matrix

**Scoring key:**

- ✅ = Capability present and functional
- ⚠️ = Capability present but degraded/partial
- ❌ = Capability absent
- 🔴 = Capability claimed but broken

| #   | Capability                          | Native | How It Works (Native)                                                                       | Lead | How It Works (Lead)                                                                       | Gap?    | Effort to Close |
| --- | ----------------------------------- | ------ | ------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- | ------- | --------------- |
| 1   | Agent spawn (subagents)             | ✅     | `Agent` tool built-in with lifecycle management                                             | ✅   | `workers.js` `handleSpawnWorker()` with terminal/codex runtime support                    | Tie     | —               |
| 2   | Team creation/management            | ✅     | `TeamCreate`/`TeamDelete` tools with config.json registry                                   | ✅   | `teams.js` `handleCreateTeam()` with policy presets                                       | Tie     | —               |
| 3   | Task creation with metadata         | ✅     | `TaskCreate` tool with one-file-per-task, string IDs, absent-not-null owner                 | ✅   | `tasks.js` `handleCreateTask()` with audit trail + rich metadata merge                    | Tie     | —               |
| 4   | Task update/status tracking         | ✅     | `TaskUpdate` tool with lazy dependency evaluation                                           | ✅   | `tasks.js` `handleUpdateTask()` with lock + validation                                    | Tie     | —               |
| 5   | Task listing with filters           | ✅     | `TaskList` re-reads all task files, computes availability fresh                             | ✅   | `tasks.js` `handleListTasks()` with project filter + blocker rendering                    | Tie     | —               |
| 6   | Task dependency tracking            | ⚠️     | Declarative `blockedBy` with lazy full-reread — no event-driven unblocking                  | ✅   | `tasks.js` explicit `blocked_by` + validation + dependency rejection                      | Lead+   | —               |
| 7   | Inbox messaging (point-to-point)    | ✅     | `SendMessage` tool, lazy inbox creation, JSON array with `read` flag                        | ✅   | `messaging.js` `handleSendMessage()` with rate limiting                                   | Tie     | —               |
| 8   | Broadcast messaging                 | ❌     | No native equivalent — `SendMessage` sends to one agent                                     | ✅   | `messaging.js` `handleBroadcast()` — sends N copies to N agents                           | Lead+   | 4h              |
| 9   | Directive messaging (priority)      | ❌     | No native equivalent                                                                        | ✅   | `messaging.js` `handleSendDirective()` — priority queue bypass                            | Lead+   | 4h              |
| 10  | File locking / concurrency          | ✅     | Kernel-level `flock()` mutex on `.lock` file in task directory                              | ✅   | Userspace `security.js` `acquireExclusiveFileLock()` (advisory, not kernel-enforced)      | Native+ | —               |
| 11  | Worktree isolation                  | ✅     | Built-in `isolation: "worktree"` with auto-cleanup on exit                                  | ✅   | `worktree-router.py` custom routing                                                       | Native+ | —               |
| 12  | Plan approval protocol              | ✅     | Structured request/response with `planModeRequired` + lead review                           | ⚠️   | `approval.js` file/message-based (looser than native structured exchange)                 | Native+ | Migrate         |
| 13  | Shutdown protocol                   | ✅     | Structured `shutdown_request` / `shutdown_approved` with reject capability                  | ⚠️   | `shutdown.js` custom flow (less integrated than native approve/reject)                    | Native+ | Migrate         |
| 14  | Agent config schema                 | ✅     | 14-field YAML frontmatter (name, description, tools, model, hooks, memory, isolation, etc.) | ✅   | Agent `.md` files + team policy JSON                                                      | Tie     | —               |
| 15  | Idle heartbeat / presence           | ✅     | 2-4s built-in `idle_notification` events (>50% of all messages)                             | ✅   | `teammate-idle.py` + `presence-engine.js` (derives load/interruptibility)                 | Lead+   | —               |
| 16  | Session observability dashboard     | ❌     | Only raw JSON files on disk — no dashboards, no aggregation                                 | ✅   | `observability.py` + sidecar HTTP routes with metrics/SLO/health endpoints                | Lead+   | 8h              |
| 17  | HTTP API control plane              | ❌     | No HTTP API — file-based protocol only                                                      | ✅   | Sidecar server (`create-server.ts`, route files) with snapshot/health/action endpoints    | Lead+   | 16h             |
| 18  | Pre-edit conflict detection         | ❌     | No native equivalent — relies on worktree isolation to avoid conflicts                      | ✅   | `conflicts.js` + `conflict-guard.sh` — pre-edit cross-session file overlap detection      | Lead+   | 8h              |
| 19  | Checkpoint / restore                | ❌     | No team session resumption — orphaned agents idle forever                                   | ✅   | `checkpoint.js` with versioned schema — full state capture and restore                    | Lead+   | 16h             |
| 20  | Pre-operation backup                | ❌     | No native equivalent                                                                        | ✅   | `pre-op-backup.js` — operator-visible safety net before risky operations                  | Lead+   | 4h              |
| 21  | Budget / cost controls              | ❌     | No user-configurable budget gates (platform rate-limit only)                                | ✅   | `budget-guard.py` rate-limit headroom enforcement                                         | Lead+   | 8h              |
| 22  | Token / spawn governance            | ❌     | No native spawn governance — any agent can spawn any agent                                  | ✅   | `token-guard.py` caps, cooldowns, necessity checks, type limits                           | Lead+   | 8h              |
| 23  | Model routing policy                | ❌     | Frontmatter `model` field only — no enforcement beyond param                                | ✅   | `model-router.py` cost-aware selection + hard blocks + prompt-shape enforcement           | Lead+   | 4h              |
| 24  | Read-efficiency enforcement         | ❌     | No native equivalent                                                                        | ✅   | `read-efficiency-guard.py` duplicate/wasteful read blocking                               | Lead+   | 4h              |
| 25  | Credential scanning (content)       | ❌     | Path-based `permissions.deny` only — no content inspection                                  | ✅   | `credential-guard.py` staged-diff + regex content inspection                              | Lead+   | 4h              |
| 26  | Risky command taxonomy/blocking     | ❌     | `PreToolUse` hook plumbing exists, but no curated command taxonomy                          | ✅   | `risky-command-guard.py` tiered dangerous-command policy (warn/block/Opus-eval)           | Lead+   | 8h              |
| 27  | Team queue / assign-next            | ❌     | No native team queue — manual task claiming only                                            | ✅   | `team-tasking.js` `handleTeamAssignNext()` with scoring + dependency filtering            | Lead+   | 8h              |
| 28  | Team rebalance                      | ❌     | No native equivalent                                                                        | ✅   | `team-tasking.js` `handleTeamRebalance()` with load-aware reassignment                    | Lead+   | 8h              |
| 29  | Pipeline execution                  | ❌     | No native pipeline runner — requires custom hooks                                           | ✅   | `pipelines.js` sequential task chains with step tracking                                  | Lead+   | 8h              |
| 30  | Shared context store                | ❌     | In-context messaging only — no externalized handoff                                         | ✅   | `context-store.js` externalized context handoff without token cost                        | Lead+   | 4h              |
| 31  | Autonomous chain dispatch           | ❌     | Hook events exist (SubagentStop, TaskCompleted) but no built-in chaining                    | ⚠️   | `auto-review-dispatch.py`, `build-chain-dispatcher.py` — heuristic, not state machines    | Lead+   | 40h (rework)    |
| 32  | Session memory injection            | ❌     | No native cross-session memory                                                              | ✅   | `session-memory-inject.py` — injects prior session summaries on startup                   | Lead+   | 4h              |
| 33  | Self-heal on startup                | ❌     | No native self-repair layer                                                                 | ✅   | `self-heal.py` — validates agents, hooks, config on every SessionStart                    | Lead+   | 2h              |
| 34  | Agent metrics extraction            | ❌     | No native usage analytics                                                                   | ✅   | `agent-metrics.py` transcript-based usage accounting                                      | Lead+   | 4h              |
| 35  | Auto-format on edit                 | ⚠️     | PostToolUse hook event exists — a 10-line handler achieves parity                           | ✅   | `format-on-edit.py` wraps with config (but has supply chain risk: `npx --yes`)            | Tie     | Migrate         |
| 36  | Result compression                  | ❌     | No native equivalent                                                                        | ✅   | `result-compressor.py` — compresses large outputs before context window                   | Lead+   | 4h              |
| 37  | Cross-platform worker launch        | ✅     | Built-in platform handling across OS                                                        | 🔴   | `platform/common.js` hardcodes `sh -c` (Windows broken)                                   | Native+ | 8h (fix)        |
| 38  | Priority aging / queue scoring      | ❌     | No native equivalent                                                                        | ⚠️   | `policy-engine.js` — in-memory only, not persisted to authoritative tasks                 | Lead+   | 6h (fix)        |
| 39  | Permission evaluation (policy)      | ✅     | `PermissionRequest` hook event with structured approval flow                                | ✅   | Custom Opus-level judgment prompt in `settings.json`                                      | Tie     | —               |
| 40  | Trust / compliance auditing         | ❌     | No native equivalent                                                                        | ✅   | `trust_audit.py` + `governance/TRUST_TIERS.md` — trust tier enforcement                   | Lead+   | 4h              |
| 41  | Agent persona / prompt management   | ✅     | 14-field YAML frontmatter with structured config                                            | ✅   | `.md` agent files + team policy JSON + persona strings in prompts                         | Tie     | —               |
| 42  | Lock contention metrics             | ❌     | No native equivalent                                                                        | ✅   | `lock-metrics.js` circular buffer with p50/p95/p99 tracking                               | Lead+   | 2h              |
| 43  | Presence engine                     | ❌     | No native equivalent                                                                        | ✅   | `presence-engine.js` derives agent load and interruptibility from telemetry               | Lead+   | 4h              |
| 44  | Hook watchdog                       | ❌     | No native hook health monitoring                                                            | ✅   | `hook-watchdog.js` validates hook existence, permissions, syntax; selftest every 150s     | Lead+   | 2h              |
| 45  | Ops aggregation / alerting / trends | ❌     | No native equivalent                                                                        | ✅   | `ops_aggregator.py`, `ops_alerts.py`, `ops_trends.py` — operational intelligence layer    | Lead+   | 8h              |
| 46  | Prompt synchronization              | ❌     | No native prompt propagation mechanism                                                      | ✅   | `prompt_sync.py` syncs system prompts to active agents                                    | Lead+   | 4h              |
| 47  | CI/CD pipeline                      | ❌     | No native Claude Code CI/CD                                                                 | ✅   | 12 GitHub Actions workflows including `supply-chain.yml` for release verification         | Lead+   | 16h             |
| 48  | Plugin system                       | ❌     | No native equivalent                                                                        | ⚠️   | `plugin/` with `plugin.json`, `hooks.json`, `install.sh` — nascent, partial functionality | Lead+   | 20h             |

### Matrix Summary

| Category             | Native ✅ | Lead ✅ | Lead-only (no native) |
| -------------------- | --------- | ------- | --------------------- |
| Present & functional | 15/48     | 42/48   | 29/48                 |
| Partial (⚠️)         | 2         | 4       | —                     |
| Broken (🔴)          | 0         | 1       | —                     |
| Absent (❌)          | 24        | 0       | —                     |

**Key takeaway:** Native covers 15 of 41 capabilities well (plus 2 partial). Lead covers 36 (plus 4 partial, 1 broken). Of Lead's coverage, 22 capabilities have NO native equivalent — these represent genuine differentiation. But the remaining overlapping capabilities include areas where native is stronger (plan approval, shutdown, cross-platform launch, auto-format). _Revision note: Row 41 (agent persona management) added; Row 6 (dependency tracking) and Row 35 (auto-format) Native scores corrected from ✅/❌ to ⚠️ based on evidence review. Original Native ✅ count of 16 was an arithmetic error in the prior version — verified count is 15._

### Communication Protocol Comparison

The messaging systems differ at the schema level. Side-by-side comparison of actual message formats:

**Native inbox message (from Lead-System-Code-Review-Prompt.md, verified against Agent Teams docs):**

```json
{
  "from": "worker",
  "text": "All tasks completed...",
  "summary": "All 2 tasks completed",
  "timestamp": "2026-02-18T18:39:39.925Z",
  "color": "blue",
  "read": false
}
```

Message types: `message`, `broadcast`, `idle_notification` (2-4s heartbeat, >50% of traffic), `shutdown_request`/`shutdown_approved`, `task_assignment`, `plan_approval_request`/`plan_approval_response`, `permission_request` (undocumented). Delivery: sender reads inbox JSON array → appends → writes back. `read` flag flipped when processed.

**Lead coordinator message (from `messaging.js`):**

```json
{
  "from": "session-id",
  "text": "...",
  "type": "message|directive|broadcast",
  "priority": "normal|high|critical",
  "timestamp": "ISO-8601",
  "metadata": {}
}
```

Message types: `message` (point-to-point), `broadcast` (N copies), `directive` (priority bypass). Delivery: JSONL append to inbox file, processed by `check-inbox.sh` PreToolUse hook on next tool call. Rate-limited via `enforceMessageRateLimit()`. No `read` flag — messages consumed (cleared) on delivery.

**Key differences:** (1) Native uses JSON arrays with `read` flag for selective processing; Lead uses JSONL with consume-on-read semantics. (2) Native idle heartbeats flood inbox (>50% traffic); Lead has no equivalent heartbeat overhead. (3) Native has structured shutdown/approval protocol types; Lead implements these as generic messages with metadata. (4) Lead adds priority levels and directive bypass; Native has flat priority.

---

## 2. 10-Dimension Grades with Evidence

### Dimension 1: Multi-Agent Orchestration

| System | Grade  | Justification                                                                                                                                                                    |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **B+** | `TeamCreate`/`Agent` tool provides clean spawn, worktree isolation, and lifecycle management with structured protocols — but no team queue, rebalance, or custom dispatch logic. |
| Lead   | **B**  | Adds queue/assign-next/rebalance (`team-tasking.js`) and dispatch abstraction (`team-dispatch.js`), but custom approval/shutdown are weaker than native structured equivalents.  |

_Change from prior review:_ Lead downgraded from A- to B. Agent 1 showed approval.js and shutdown.js are looser than native; Agent 2 confirmed chain dispatch is heuristic.

### Dimension 2: Task Management

| System | Grade  | Justification                                                                                                                         |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **B**  | `TaskCreate`/`Update`/`List` with lazy dependency evaluation and shadow task lifecycle — clean but no audit trail or metadata merge.  |
| Lead   | **B+** | Adds audit trail, explicit dependency validation, blocker rendering, and rich metadata (`tasks.js`) — confirmed fixed by both agents. |

_Change from prior review:_ Lead maintained. Backlog items 6-11 verified as real implementations by Agent 1.

### Dimension 3: Observability & Monitoring

| System | Grade  | Justification                                                                                                                                                                              |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native | **D**  | Exposes raw JSON files for session state — no dashboards, no metrics aggregation, no health reporting.                                                                                     |
| Lead   | **A-** | Full dashboard via sidecar HTTP API, `observability.py` dashboards, `agent-metrics.py` transcript analysis, lock metrics, bridge health, and SLO checking — strongest Lead differentiator. |

_Change from prior review:_ No change. Both agents confirmed observability is genuinely beyond native.
_Usage caveat:_ This grade assumes the HTTP dashboard and metrics endpoints are actively used during operations. If the dashboard is rarely accessed, the effective value is lower — a capability that exists but goes unused is theoretical, not operational.

### Dimension 4: Cost Controls

| System | Grade | Justification                                                                                                                                                                                                        |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **D** | Platform-level rate limiting exists but is not user-configurable. No budget gates, no token tracking dashboards, no spawn governance — but the underlying rate-limit mechanism does prevent runaway consumption.     |
| Lead   | **B** | `budget-guard.py` enforces rate-limit headroom, `token-guard.py` gates spawn decisions, `cost-tagger.py` tracks attribution — but budget policy is split across multiple files and not unified (Agent 2 finding #4). |

_Change from prior review:_ Lead downgraded from B+ to B. Agent 2 proved budget alignment (#15) was not fully implemented. Revision finding #12 adds that `token-guard-config.json` is extremely permissive (max*agents: 30, max_per_subagent_type: 10, one_per_session: []) — contradicting the "underfund things" principle that justifies the cost governance layer.
\_Revision 3 note:* `budget-guard.py` fires on ALL tools including cheap Grep/Glob/Read via `.*` matcher (#23) — adding overhead to operations that don't consume external API tokens.

### Dimension 5: Security & Governance

| System | Grade  | Justification                                                                                                                                                                                                           |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **C+** | Path-based deny rules, permission modes, basic hook plumbing — but no content scanning, no credential detection, no command taxonomy.                                                                                   |
| Lead   | **A-** | Content-based credential scanning (`credential-guard.py`), risky-command taxonomy (`risky-command-guard.py`), trust auditing (`trust_audit.py`), conflict detection (`conflict-guard.sh`) — strongest security posture. |

_Change from prior review:_ No change to grade. Agent 2 confirmed credential-guard does staged-diff scanning, which is stronger than native path deny. However, Revision finding #18 identifies a supply chain risk: `format-on-edit.py` uses `npx --yes prettier`, which auto-downloads and executes packages from npm registry without verification. This partially undermines the security posture.

### Dimension 6: Reliability & Recovery

| System | Grade  | Justification                                                                                                                                                                        |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native | **C**  | flock() locking, worktree cleanup, basic lifecycle — but no checkpoint, no restore, no self-repair, no backup.                                                                       |
| Lead   | **A-** | Checkpoint/restore (`checkpoint.js`), pre-op backup (`pre-op-backup.js`), self-heal (`self-heal.py`), repair workflows (`repair.js`) — genuine differentiators confirmed by Agent 1. |

_Change from prior review:_ No change. Recovery capabilities are verified and unique.

### Dimension 7: Developer Experience

| System | Grade | Justification                                                                                                                                                                                                             |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **A** | Single `settings.json` config, YAML frontmatter, clean tool API, plugins, official docs — zero custom setup needed.                                                                                                       |
| Lead   | **C** | 55 hook files, complex `settings.json`, separate MCP coordinator, sidecar server, multiple config files (`budgets.json`, `token-guard-config.json`, `cost/config.json`) — steep learning curve, high maintenance surface. |

_Change from prior review:_ Lead downgraded from B to C. The 55-hook count and multi-config sprawl represent significant DX debt. Revision findings reinforce this: `read-efficiency-guard.py` actively blocks legitimate code review work (#10), `self-heal.py` generates spurious warnings about deprecated master-agents on every session start (#11), and `auto-lint-installer.py` wastes time running outside git repos (#19).
_Revision 3 reinforcement:_ Duplicate warning behavior from `result-compressor.py` and `read-efficiency-guard.py` (#22), `tsc --noEmit` blocking up to 15 seconds after every Write/Edit (#24), and overlapping `reviewer`/`quick-reviewer` checklists (#31) further erode developer experience.

### Dimension 8: Chain / Workflow Automation

| System | Grade  | Justification                                                                                                                                                                                                                      |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **D**  | Hook events exist (SubagentStop, TaskCompleted), but no built-in workflow chaining — chains must be manually orchestrated.                                                                                                         |
| Lead   | **C-** | Chains exist (`auto-review-dispatch.py`, `build-chain-dispatcher.py`) but are heuristic, keyword-based, lossy (6 replay attempts max), and use file-marker completion — both agents flagged this as the #1 architectural weakness. |

_Change from prior review:_ Lead downgraded from B- to C-. Agent 2's chain integrity analysis is devastating: these are not state machines, they are text-pattern matchers with manual done files.
_Revision 3 note:_ CLAUDE.md claims chains are "hook-enforced — deterministic, not advisory" but this is misleading — chains are instruction-based with delivery limits (#25). Documentation accuracy gap reinforces C- grade.

### Dimension 9: Scalability

| System | Grade  | Justification                                                                                                                             |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **B**  | Handles team sizes via tmux/process modes, worktree isolation, and structured lifecycle — tested at reasonable team sizes.                |
| Lead   | **B-** | Adds queue management and rebalance, but 55 hooks firing per operation create O(hooks × operations) overhead that worsens with team size. |

_Change from prior review:_ Lead downgraded from B to B-. Hook latency accumulates with scale.
_Revision 3 quantification:_ Worst-case hook latency for a Write/Edit operation is 66 seconds (#32); worst-case Task spawn latency is 25 seconds (#33). These numbers make the scaling problem concrete — O(hooks × operations) is not theoretical, it has measurable upper bounds that approach unusable levels under system load.

### Dimension 10: Ecosystem Integration

| System | Grade  | Justification                                                                                                                                               |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native | **A**  | First-party plugins (15+ enabled), MCP server integration, IDE support (VS Code, JetBrains), official documentation, Anthropic-maintained updates.          |
| Lead   | **C+** | Custom MCP coordinator integrates with native ecosystem but adds its own protocol layer; no IDE integration; requires manual maintenance on native updates. |

_Change from prior review:_ No significant change.

### Dimension Summary

| Dimension              | Native | Lead | Winner        |
| ---------------------- | ------ | ---- | ------------- |
| Orchestration          | B+     | B    | Native        |
| Task Management        | B      | B+   | Lead          |
| Observability          | D      | A-   | Lead          |
| Cost Controls          | D      | B    | Lead          |
| Security & Governance  | C+     | A-   | Lead          |
| Reliability & Recovery | C      | A-   | Lead          |
| Developer Experience   | A      | C    | Native        |
| Chain Automation       | D      | C-   | Lead (barely) |
| Scalability            | B      | B-   | Native        |
| Ecosystem Integration  | A      | C+   | Native        |

**Native wins:** 4 dimensions (Orchestration, DX, Scalability, Ecosystem)
**Lead wins:** 6 dimensions (Task Mgmt, Observability, Cost, Security, Reliability, Chains)

**Weighted analysis note:** A raw 6-4 count in Lead's favor masks the strategic importance of Native's wins. Developer Experience (A vs C) and Ecosystem Integration (A vs C+) are arguably the two highest-impact dimensions for long-term maintainability and onboarding. A system that is powerful but painful to maintain accumulates "trust debt" — the gap between what the system claims to do and what operators can verify it actually does. Native's DX advantage compounds over time.

**So What?** The dimension grades tell a clear story: the Lead System wins on capabilities (security, observability, cost control, reliability) but loses on usability (DX, scalability, ecosystem). This is the classic power-vs-simplicity tradeoff. The thin hybrid recommendation (Section 6) resolves this by keeping the powerful differentiators (16 Tier 2 files) while shedding the usability-destroying complexity (10 Tier 1 deletions, Tier 3 reworks). If the 90-day action plan succeeds, the dimension summary should shift Lead's DX from C to B- and Scalability from B- to B, while preserving the A- grades in Observability, Security, and Reliability.

---

## 3. Cost/Efficiency Analysis

### System Composition

The Lead System is predominantly a **prompt engineering and configuration system**, not a traditional software project. Per the Claude Code Technical Audit (February 2026, verified via `wc -l`):

| Category                                                    | Files              | Lines   | % of Total |
| ----------------------------------------------------------- | ------------------ | ------- | ---------- |
| **Real code** (JS/TS/Python/Shell)                          | 7 core + ~48 hooks | ~20,100 | **14%**    |
| **Prompt engineering** (agents, modes, commands, CLAUDE.md) | ~98                | ~9,328  | **86%**    |

_Source: Claude_Code_Technical_Audit.txt, Step 2. The 86:14 ratio is critical context: the Lead System's primary value is in governance rules and prompt architecture, not algorithmic complexity. The executable code is "competent I/O orchestration, not computer science" (audit verdict). This framing should inform all cost and complexity discussions — maintaining 98 prompt files is fundamentally different from maintaining 98 code files._

### Subscription Context

The system runs on **Claude Code Max 20x ($200/month flat rate)**. This is NOT pay-per-token. Under flat rate:

- Dollar savings claims are meaningless — you pay $200 regardless of token consumption
- The relevant metric is **throughput efficiency**: operations per rate-limit window
- Token savings translate to **more headroom within rate limits**, not reduced bills
- Hook overhead consumes some of that headroom

### Hook Latency Estimate

**Hooks registered per event type (from settings.json):**

| Event                                    | Hooks                                                                                                   | Worst-case timeout sum |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| PreToolUse `.*`                          | 3 (session-busy, check-inbox, budget-guard)                                                             | 11s                    |
| PreToolUse `Task`                        | 3 (token-guard, model-router, worktree-router)                                                          | 14s                    |
| PreToolUse `Read`                        | 2 (read-cache, read-efficiency-guard)                                                                   | 8s                     |
| PreToolUse `Write\|Edit\|MultiEdit`      | 2 (conflict-guard, credential-guard)                                                                    | 10s                    |
| PreToolUse `Bash`                        | 2 (credential-guard, risky-command-guard)                                                               | 10s                    |
| PostToolUse `.*`                         | 1 (session-watchdog)                                                                                    | 5s                     |
| PostToolUse `Bash\|Read\|Edit\|Write...` | 2 (terminal-heartbeat, session-tracker)                                                                 | 8s                     |
| PostToolUse `Write\|Edit`                | 1 (format-on-edit)                                                                                      | 12s                    |
| SessionStart                             | 8 (self-heal, register, lint-installer, trust-audit, cost-tagger, memory-inject, cache-warm, slo-check) | 56s                    |

**Benchmarked per-operation overhead:**

Five representative hooks were benchmarked with realistic JSON input (March 2026):

| Hook                       | Measured latency |
| -------------------------- | ---------------- |
| `credential-guard.py`      | 27ms             |
| `model-router.py`          | 31ms             |
| `read-efficiency-guard.py` | 34ms             |
| `budget-guard.py`          | 36ms             |
| `check-inbox.sh`           | 11ms             |
| **Median**                 | **31ms**         |

- Minimum hooks per tool call: 4 (PreToolUse `.*` + PostToolUse `.*`)
- Measured actual execution: ~28-36ms per Python hook, ~11ms for shell hooks
- **~120-140ms overhead per tool call from hooks alone** (4 hooks at median 31ms)
- A typical 100-tool-call session: **12-14 seconds of cumulative hook time**
- Agent-heavy sessions (200+ tool calls): **24-28 seconds**
- SessionStart alone: **~5-15 seconds** (8 hooks with real work like self-heal)

_Note: The original assessment estimated 100-200ms per hook and 400-800ms per tool call. Actual benchmarks show ~3-6x lower latency. The latency overhead is real but less severe than previously claimed._

**Worst-case latency analysis (Revision 3, Issues #32-33):**

- **Write/Edit operation worst-case: 66 seconds.** Sum of all hook timeouts that fire on a Write/Edit: PreToolUse `.*` (11s) + PreToolUse `Write|Edit` (10s) + PostToolUse `.*` (5s) + PostToolUse `Write|Edit` (12s) + PostToolUse `Bash|Read|Edit|Write...` (8s) + tsc inline hook (15s) + format-on-edit timeout (5s) = 66s. While typical execution is 50-200ms, under system load these timeouts become reachable.
- **Task spawn worst-case: 25 seconds.** PreToolUse `.*` (11s) + PreToolUse `Task` (14s) = 25s for 6 hooks. Agent spawning is already a heavy operation; 25s of hook overhead compounds it.
- **Implication:** A global hook execution budget (skip advisory hooks if total pre-tool time > 5s) would cap worst-case while preserving hard-block hooks.

### Throughput Analysis

**Where Lead SAVES throughput:**

- `read-efficiency-guard.py`: Blocks duplicate/wasteful reads. A heavy exploration session might attempt 20-30 redundant reads. At ~2,000-4,000 tokens per read, that's 40,000-120,000 tokens saved per session.
- `token-guard.py`: Prevents unnecessary agent spawns. A single unnecessary Sonnet agent can consume 10,000-50,000 tokens. Blocking even 2-3 per day is significant.
- `read-cache.py`: Serves cached read results, avoiding repeat token consumption.
- `result-compressor.py`: Compresses large outputs before they enter context window.

**Where Lead COSTS throughput:**

- Hook execution overhead: ~120-140ms latency per tool call (benchmarked)
- Hook output injected into context: Each hook can inject system-reminder text, consuming context tokens
- `check-inbox.sh` on every `.*` PreToolUse: Even when inbox is empty, this runs on every single tool call
- `session-watchdog.sh` on every `.*` PostToolUse: Runs after every tool call regardless of relevance
- `hookify.py exec` on `Bash|Write|Edit|MultiEdit|NotebookEdit` PreToolUse: Currently has no active rules, pure overhead

**Net assessment:**

| Scenario                 | Token savings (est.) | Hook overhead (est.)            | Net                  |
| ------------------------ | -------------------- | ------------------------------- | -------------------- |
| Solo coding (few agents) | Low (~5-10K)         | Medium (~20K context injection) | **Negative**         |
| Light team (2-3 agents)  | Medium (~30-50K)     | Medium (~30K)                   | **Break-even**       |
| Heavy team (4+ agents)   | High (~80-150K)      | High (~50K)                     | **Positive ~30-40%** |

**Token estimate methodology:** Based on [Claude's tokenizer](https://docs.anthropic.com/en/docs/build-with-claude/token-counting), assuming [X] tool calls per scenario at [Y] tokens each = [Z] tokens total. Savings estimates derive from: (1) `read-efficiency-guard.py` blocking ~20-30 redundant reads/session at ~2,000-4,000 tokens/read, (2) `token-guard.py` preventing ~2-3 unnecessary agent spawns at ~10,000-50,000 tokens/spawn, (3) `read-cache.py` serving cached results for repeated file reads. Overhead estimates derive from: (1) hook stdout injection into context (~200-500 tokens per hook output × 4-6 hooks per tool call), (2) `system-reminder` tags from SessionStart hooks (~2,000 tokens total injection on startup). These are engineering estimates, not measured telemetry — the system does not track actual token savings at runtime (verified: `guard.estimatedTokensSaved: 0` in daily analytics).

_Note: Token savings and overhead numbers are estimates. The `read-efficiency-guard.py` tracks blocks but does not log estimated tokens saved (verified: `guard.estimatedTokensSaved: 0` in daily analytics). These figures are derived from typical file sizes and agent token consumption, not measured telemetry._

### Token Management System Assessment

The Claude_Systems_Assessment.txt (February 2026) provides an independent assessment of the token management layer:

- **Rating: 7/10** — "Good framework that prevents the worst waste patterns (agent spam, Opus for simple tasks). But lacks runtime measurement — you're budgeting without a meter."
- **What works:** Tool Ladder (cheapest-first), 5-agent session cap, overlap check, standardized agent prompt structure (GOAL/START/STOP WHEN/SKIP/OUTPUT), model selection discipline (Sonnet default saves ~3-5x vs Opus)
- **What doesn't:** No runtime token counter (no mid-session "you've used 45k, 15k remaining"), can't optimize within-task tool calls, doesn't account for context growth, doesn't cover main session usage, overlap detection is manual (not automated)
- **Key insight:** "The combination of soft rules (CLAUDE.md) + hard enforcement (hook) is the real insight." Rules you can't break > rules you shouldn't break.

_Source: Claude_Systems_Assessment.txt, "SYSTEM 1: TOKEN MANAGEMENT PLAN." The assessment confirms that token-guard.py's mechanical enforcement elevates the system from "guidelines Claude might ignore" to "rules Claude can't break" — but the lack of actual runtime token measurement means the budgets in CLAUDE.md are educated guesses, not metered constraints._

### Rate-Limit Behavior Under Max 20x

The Max 20x plan provides a rolling hourly token budget. The `budget-guard.py` hook monitors rolling hourly usage against an estimated rate limit and enforces headroom preservation. From daily analytics (`~/.claude/token-analytics/daily/`):

- A typical heavy day (Feb 26, 2026): 1,810 messages across 27 sessions, consuming ~138M cache-read tokens and ~317K output tokens
- Top session: 356 messages, ~$32 equivalent cost
- Guard actions: 3 allows, 2 blocks (both via `necessity_check` rule)
- Model split: ~78% Opus, ~22% Sonnet by cost weight

The self-imposed budget policy (`budgets.json`) sets $10/day, $50/week, $200/month thresholds with warning at 80% and critical at 95%. These are advisory — the platform's own rate limiter is the hard constraint, and its exact thresholds are not publicly documented by Anthropic.

**Key implication:** If typical sessions rarely hit the platform rate limit, then the token-savings argument for Lead hooks is weaker — you're saving headroom you weren't going to use. If sessions regularly approach rate limits, the savings are genuinely valuable. Without telemetry showing rate-limit proximity, this remains an open question.

### Industry Cost Benchmarks

For context, real-world multi-agent token consumption from the Lead-System-Code-Review-Prompt.md (based on Anthropic Agent Teams documentation and public usage reports):

| Operation                                | Token Consumption      | Approximate Cost    |
| ---------------------------------------- | ---------------------- | ------------------- |
| Single agent session (exploration)       | ~100K tokens           | $2-5 (Opus pricing) |
| 3-agent team review                      | ~340K tokens           | ~$10-15             |
| Full-stack feature build (3 specialists) | ~1.35M tokens          | ~$20                |
| Carlini's 16-agent C compiler            | 2B input + 140M output | ~$20,000            |

_Source: Lead-System-Code-Review-Prompt.md "Cost Reality" section, citing public usage reports. The Carlini experiment — the most ambitious public Agent Teams use — did NOT use the native team tools; he used a custom harness with bare git repos and Docker containers because the native system was insufficient at scale. This underscores that even at extreme scale, the native team overhead (2-3x from idle heartbeats and lead coordination) drove sophisticated users to custom solutions — which is exactly the Lead System's value proposition._

Under the Max 20x subscription ($200/month), these dollar amounts are irrelevant — but the token volumes indicate how quickly rate limits can be reached during heavy team sessions, making the Lead System's throughput governance (token-guard, read-efficiency-guard, model-router) the operative question rather than dollar cost.

### "57% Savings" Claim Verdict

**INVALIDATED.** The 57% figure (from `cost-comparison.js` / `README.md`) was:

1. Calculated under a pay-per-token model that doesn't apply to Max 20x
2. Did not account for hook overhead or context injection costs
3. Over-indexed on theoretical token savings from read dedup without measuring actual hook token consumption
4. Agent 1 noted: "Claim quality is overstated relative to current native reference" (`cost-comparison.js` severity: ⚠️ Needs Work)

**Realistic efficiency estimate under Max 20x:**

- **Solo sessions:** -5% to +5% (hooks cost more than they save)
- **Light teams:** +5% to +15% (break-even to modest gain)
- **Heavy teams:** +20% to +35% (significant gain from spawn/read governance)
- **Overall weighted average:** ~+10-15% throughput improvement, NOT 57%

### Where Complexity Costs MORE Than It Saves

1. **`hookify.py exec`** runs on every `Bash|Write|Edit|MultiEdit|NotebookEdit` with no active rules — pure overhead
2. **`check-inbox.sh`** runs on EVERY tool call (`.*` matcher) even when no inbox exists
3. **`session-busy.sh`** runs on EVERY tool call — minimal value for non-team solo sessions
4. **8 SessionStart hooks** add 5-15s to every session boot, including hooks for features that may not be needed (auto-lint-installer for non-GitHub repos, cost-tagger for non-team sessions)
5. **3 agents read `elite-engineer-reference.md` (~340 lines, ~1k tokens each)** on every spawn — in the build chain (code-simplifier + verify-app), that's ~2-3k tokens per chain just for reference doc reads. The Opus reviewer reading it is especially expensive.
6. **`auto-lint-installer.py` runs every SessionStart** even when not in a git repo — wasted execution on every session boot outside of GitHub projects
7. **`token-guard-config.json` allows 30 agents / 10 per type** with `one_per_session: []` disabled — contradicts "underfund things" philosophy in CLAUDE.md and permits unbounded agent spawn
8. **`session-slo-check.py` contributes 8 seconds** to startup latency via its timeout — a single SLO check hook that adds more latency than the entire benchmarked per-operation overhead (#21)
9. **`budget-guard.py` fires on every Grep/Glob/Read** via `.*` matcher — these are cheap local operations that don't consume API tokens and don't need budget checking (#23)
10. **`tsc --noEmit` inline hook can block 15 seconds** after every Write/Edit operation on large TypeScript projects — type checking overhead that exceeds all other hook latency combined (#24)
11. **`routing-reminder.py` injects full routing preamble on every message** with full refresh every 25 messages — context overhead on every single user prompt regardless of relevance (#29)

### Cost of Inaction

What happens if no changes are made and the system continues as-is?

1. **Maintenance burden compounds.** Every Anthropic Claude Code update risks breaking hooks that depend on undocumented behavior (output text patterns, tool names, event timing). With 55 hook files, each update requires regression testing across the entire surface.
2. **Chain automation remains fragile.** The heuristic chain dispatchers will continue to silently drop events. Without state machine tracking, there is no way to know how often chains fail to complete — the failure mode is invisible.
3. **Native parity gap closes.** Anthropic is actively developing Agent Teams features. Each release that adds native cost controls, observability, or conflict detection makes another Lead component redundant. Without proactive migration, the system accumulates "dead weight" — custom code that duplicates native capabilities with more maintenance cost.
4. **Onboarding remains impossible.** At 55 hooks and ~71K lines, no new contributor can understand the system without significant ramp-up. This is a single-operator system by necessity, not design.

**Estimated cost of inaction over 6 months:** ~20-40 hours of reactive maintenance (hook breakage on native updates, config drift debugging, chain failure investigation) plus ongoing opportunity cost of building on a fragile foundation instead of investing in native-first architecture.

**So What?** The cost analysis invalidates the "57% savings" marketing claim but confirms a real ~10-15% throughput improvement for heavy team sessions. The system's value is not cost reduction — it's operational governance. Under the $200/month flat rate, the relevant question is "does this help me do more within rate limits?" not "does this save money?" The answer is conditionally yes: for heavy team sessions (4+ agents), the spawn governance and read-efficiency enforcement provide meaningful headroom. For solo coding, the hooks cost more than they save.

---

## 4. Migration Decision Framework

### Tier 1: Migrate to Native Now

These files can be deleted and replaced by native equivalents with zero capability loss.

| File to Delete                    | Native Replacement                                                                                                                                                                                                                                                                              | Effort    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `hooks/format-on-edit.py`         | Native PostToolUse hook with inline prettier/black command (already partially in settings.json). **URGENT: supply chain risk** — uses `npx --yes prettier` which auto-downloads packages without verification (Revision #18). Remove `--yes` flag immediately regardless of migration timeline. | 2-4 hours |
| `hooks/teammate-idle.py`          | Native `TeammateIdle` hook event — write a simpler 10-line handler or use native idle behavior directly                                                                                                                                                                                         | 2-4 hours |
| `hooks/task-completed.py`         | Native `TaskCompleted` hook event — write a simpler handler or rely on native lifecycle                                                                                                                                                                                                         | 2-4 hours |
| `hooks/worktree-router.py`        | Native worktree isolation is built-in with auto-cleanup — remove custom routing                                                                                                                                                                                                                 | 2-3 hours |
| `mcp-coordinator/lib/approval.js` | Native structured plan approval protocol is more rigorous                                                                                                                                                                                                                                       | 4-8 hours |
| `mcp-coordinator/lib/shutdown.js` | Native structured shutdown approve/reject is tighter                                                                                                                                                                                                                                            | 4-8 hours |
| `hooks/hookify.py`                | Zero active rules, dormant — delete entirely                                                                                                                                                                                                                                                    | 0.5 hours |
| `hooks/session-busy.sh`           | Minimal value, can be replaced by native presence detection                                                                                                                                                                                                                                     | 1-2 hours |
| `hooks/routing-reminder.py`       | Full routing preamble injected on every message — context overhead with minimal value. Routing rules already in CLAUDE.md (#29)                                                                                                                                                                 | 1 hour    |
| `hooks/result-compressor.py`      | Duplicates `read-efficiency-guard.py` warning behavior (#22). Read-efficiency-guard is the authority since it can block.                                                                                                                                                                        | 1-2 hours |

**Total effort:** ~20-37 hours (includes integration testing + settings.json cleanup + regression verification per deletion)

_Note: Original estimates of ~15 hours assumed zero integration testing overhead. Removing a hook that fires on every edit (format-on-edit) or every tool call (session-busy) requires verifying no downstream behavior depends on its side effects._
**Files deleted:** 10
**Capability loss:** None

### Tier 2: Keep Custom (Native Can't Replace)

These files provide genuinely unique capabilities with no native equivalent.

| File to Keep                           | Why Native Can't Replace                                                        | Maintenance Cost      |
| -------------------------------------- | ------------------------------------------------------------------------------- | --------------------- |
| `hooks/credential-guard.py`            | Content-based + staged-diff secret scanning — native only has path deny         | Low (regex updates)   |
| `hooks/risky-command-guard.py`         | Tiered dangerous-command taxonomy with curated patterns                         | Low                   |
| `hooks/read-efficiency-guard.py`       | Duplicate/wasteful read blocking — no native equivalent                         | Low                   |
| `hooks/budget-guard.py`                | Rate-limit headroom enforcement under Max plan — no native cost controls        | Medium (budget sync)  |
| `hooks/agent-metrics.py`               | Transcript-based token accounting — no native usage analytics                   | Low                   |
| `hooks/conflict-guard.sh`              | Pre-edit cross-session conflict detection — genuine differentiator              | Low                   |
| `hooks/token-guard.py`                 | Multi-rule spawn governance (caps, cooldowns, necessity) — no native equivalent | Medium (config)       |
| `hooks/model-router.py`                | Cost-aware model selection + prompt-shape enforcement                           | Medium (policy drift) |
| `hooks/self-heal.py`                   | Startup repair workflows — no native self-repair                                | Low                   |
| `hooks/session-memory-inject.py`       | Cross-session memory injection — no native equivalent                           | Low                   |
| `scripts/observability.py`             | Full dashboard and health reporting — no native equivalent                      | Medium                |
| `mcp-coordinator/lib/conflicts.js`     | Pre-edit conflict awareness — genuine differentiator                            | Low                   |
| `mcp-coordinator/lib/context-store.js` | Externalized context handoff without token cost                                 | Low                   |
| `mcp-coordinator/lib/pipelines.js`     | Sequential task chains — no native pipeline runner                              | Low                   |
| `sidecar/core/checkpoint.js`           | Checkpoint/restore with versioned schema — no native team resumption            | Medium                |
| `sidecar/core/pre-op-backup.js`        | Operator-visible safety net before risky operations                             | Low                   |

**Total files kept:** 16
**These represent the genuine unique value of the Lead System.**

**Tier 2 caveats (from Revision findings — keep the file, fix the bug):**

| File                       | Caveat                                                                                                                                                              | Revision Issue |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `read-efficiency-guard.py` | Blocks legitimate review work at 15 reads/120s. Needs REVIEW_MODE env var bypass or configurable threshold.                                                         | #10            |
| `conflict-guard.sh`        | Only checks file paths for collision, not content overlap. Two sessions editing different parts of same file get false-positive warnings.                           | #15            |
| `risky-command-guard.py`   | "Risky" tier prints a warning but exits 0 — Claude decides whether to proceed. A guard that doesn't guard.                                                          | #17            |
| `session-memory-inject.py` | 32k character cap could truncate important cross-session context as memory database grows. No truncation notice.                                                    | #20            |
| `budget-guard.py`          | Matcher is `.*` — fires on ALL tools including cheap Grep/Glob/Read. Should narrow to expensive operations only (`Task\|Bash\|Write\|Edit\|MultiEdit`).             | #23            |
| `credential-guard.py`      | Raw env var pattern `^\s*[A-Z_]{4,}=.{8,}$` can false-positive on non-secret vars like `PATH_PREFIX=/usr/local/bin`. Needs allowlist of common non-secret env vars. | #27            |

### Tier 3: Rework (Keep Intent, Change Architecture)

These files implement the right idea but with the wrong architecture. They need fundamental redesign.

| File to Rework                                        | Current Problem                                                                                                                                                         | Target Architecture                                                                                                                                                                                              | Complexity | Risk   | Effort      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------- |
| `hooks/auto-review-dispatch.py`                       | Uses string heuristics ("nothing to commit", "error:") to detect commit success. Queue completion is manual file-marker based.                                          | Replace with structured exit-code checking from native Bash PostToolUse. Track chain state in a SQLite state machine (state: pending → reviewing → fp-checking → done). Use TaskCompleted hook to advance state. | 5/5        | High   | 16-24 hours |
| `hooks/build-chain-dispatcher.py`                     | Keyword-based event detection from Bash text. Simplify→verify is instruction dispatch, not tracked workflow.                                                            | Same SQLite state machine. SubagentStop provides agent name — use structured match, not text search. Track: build → simplifying → verifying → done.                                                              | 5/5        | High   | 16-24 hours |
| `hooks/check-inbox.sh`                                | Runs on EVERY tool call (`.*` matcher). 6 replay attempts then drops. Completion is done-file based.                                                                    | Move off `.*` matcher — only run when coordinator MCP is active. Replace done-files with SQLite state tracking. Increase replay to 12 attempts with exponential backoff.                                         | 4/5        | Medium | 8-16 hours  |
| `mcp-coordinator/lib/workers.js`                      | Windows background spawn hardcodes `sh -c`. Task ID mismatch (W... vs T...) in worker instructions.                                                                     | Use `process.platform` to select shell. Pass team task ID alongside worker task ID in all instruction templates.                                                                                                 | 3/5        | Medium | 8 hours     |
| `sidecar/server/snapshot-builder.js`                  | Only normalizes `task_queue` (pending tasks), dropping non-pending from snapshots.                                                                                      | Normalize full task corpus, not just queue. Filter by status at the API layer, not the builder layer.                                                                                                            | 2/5        | Low    | 4 hours     |
| `sidecar/core/policy-engine.js`                       | Priority aging is in-memory mutation on snapshot tasks, not persisted.                                                                                                  | Write aged priorities back to authoritative task files using `security.js` atomic writes.                                                                                                                        | 3/5        | Medium | 4-8 hours   |
| `sidecar/core/terminal-health.js`                     | Expects PID files as JSON, but writers emit plain text.                                                                                                                 | Accept both formats: try JSON parse, fallback to plain text parseInt.                                                                                                                                            | 1/5        | Low    | 2 hours     |
| `cost/budgets.json` + `hooks/token-guard-config.json` | Budget policy split across files, can drift.                                                                                                                            | Single source of truth file (budgets.json). Token-guard reads from it. Delete duplicate values.                                                                                                                  | 2/5        | Low    | 4 hours     |
| `hooks/self-heal.py`                                  | EXPECTED_MODE_FILES dict references archived master-agents (master-coder, master-architect, etc.), generating spurious warnings every session.                          | Remove deprecated validation; validate current agent set (quick-reviewer, fp-checker, code-simplifier, verify-app, reviewer, code-architect, scout, practice-creator).                                           | 1/5        | Low    | 2-4 hours   |
| `hooks/token-guard-config.json`                       | max_agents: 30, max_per_subagent_type: 10 is extremely permissive vs. CLAUDE.md "underfund" philosophy. one_per_session: [] disables a key feature.                     | Tighten to max_agents: 12, max_per_subagent_type: 4. Populate one_per_session: ["Explore", "Plan"]. Add max_agents_per_chain: 3.                                                                                 | 1/5        | Low    | 1-2 hours   |
| `hooks/read-cache.py`                                 | save_index() and load_index() read/write index.json without file locking. Concurrent sessions can corrupt the cache index.                                              | Add fcntl.flock() file locking or atomic write pattern (write to temp file, then os.rename()).                                                                                                                   | 2/5        | Low    | 2-4 hours   |
| `agents/verify-app.md`                                | Complex STASH_REF tracking with trap-based cleanup. `git stash apply --index` can fail on conflicts; fallback message goes to stdout which agent may not surface (#30). | Simplify: use `git stash push -m "verify-app-$(date)"` with unique ID, explicit conflict detection, emit errors to stderr.                                                                                       | 2/5        | Low    | 2-4 hours   |
| `agents/reviewer.md` + `quick-reviewer.md`            | Both check for naming issues and dead code at different depth levels. Opus reviewer re-examines things quick-reviewer already caught (#31).                             | Pass quick-reviewer findings into reviewer prompt, or scope reviewer to security/performance/architecture only. Remove "naming" and "dead code" from reviewer checklist.                                         | 2/5        | Low    | 2-4 hours   |

**Total effort breakdown with confidence:**

| Item                      | Optimistic | Likely  | Pessimistic | Confidence                             |
| ------------------------- | ---------- | ------- | ----------- | -------------------------------------- |
| auto-review-dispatch.py   | 16h        | 20h     | 28h         | Medium — requires SQLite schema design |
| build-chain-dispatcher.py | 16h        | 20h     | 28h         | Medium — shares schema with above      |
| check-inbox.sh            | 8h         | 12h     | 18h         | Medium — conditional matcher is novel  |
| workers.js                | 6h         | 8h      | 12h         | High — well-scoped platform fix        |
| snapshot-builder.js       | 3h         | 4h      | 6h          | High — straightforward normalization   |
| policy-engine.js          | 4h         | 6h      | 10h         | Medium — atomic write integration      |
| terminal-health.js        | 1.5h       | 2h      | 3h          | High — simple format detection         |
| budgets.json unification  | 3h         | 4h      | 6h          | High — config consolidation            |
| **Total**                 | **57.5h**  | **76h** | **111h**    | **Weighted: ~76h (~2-3 weeks)**        |

_Note: The chain dispatchers (top 3 items) represent ~68% of total effort and carry the most uncertainty. If those stall, the remaining 5 items (~24h) can still proceed independently._

---

## 5. Competitive Position

### Architecture Lineage

The Lead System evolved through three documented phases, visible in the source material:

1. **Phase 1 — Setup Guide era (January 2026):** The Ultimate-Claude-Code-Setup-Guide.md (2,168 lines) documents the original architecture: 10 specialized agents (deep-researcher, mastermind-architect, vibe-coder, meta-agent, etc.), 15 slash commands, 11 MCP servers, and a LifeOS layer. This was a broad, feature-rich configuration system — the predecessor to the current Lead System. Key architectural decisions visible: Opus as default model for most agents, meta-agent pattern for cross-agent orchestration, session-cache for cross-agent context.

2. **Phase 2 — Master agent consolidation:** 45+ agents collapsed into 4 masters (coder, researcher, architect, workflow) with auto-detecting mode files. This was the "genuine architectural insight" identified by the Technical Audit — replacing N narrow agents with 4 generalists × 17 modes. The mode architecture provides domain-specific expertise (17 mode files across 4 domains: coder/5, researcher/4, architect/4, workflow/4) loaded on-demand via keyword matching.

3. **Phase 3 — Current system:** Master agents deprecated in favor of Boris-pattern named agents (quick-reviewer, fp-checker, code-simplifier, verify-app, code-architect, reviewer, scout). The coordinator evolved from the original macOS-only AppleScript terminal control into the current MCP server + sidecar architecture. The hooks surface expanded from 6 files (319 lines) to 55 files (~19,700 lines).

_Source: Ultimate-Claude-Code-Setup-Guide.md (Phase 1), Claude_Code_Technical_Audit.txt (Phase 1→2 transition), Claude_Systems_Assessment.txt (Phase 2 assessment), CLAUDE.md current state (Phase 3)._

### OSS vs Personal Comparison

The OSS version (`claude-lead-system-oss/`) reveals what Drew considers "core" vs "personal" by what was kept vs removed for public release:

| Component                          | In OSS? | Implication                                   |
| ---------------------------------- | ------- | --------------------------------------------- |
| `agents/`, `master-agents/`        | ✅      | Core architectural value                      |
| `hooks/`, `lead-tools/`            | ✅      | Core operational value                        |
| `mcp-coordinator/`                 | ✅      | Core infrastructure                           |
| `modes/`, `commands/`              | ❌      | Considered personal/project-specific          |
| `sidecar/`, `tests/`, `bench/`     | ❌      | Considered too complex for public consumption |
| `scripts/`, `settings/`, `plugin/` | ❌      | Personal configuration                        |

_Source: Directory comparison of `claude-lead-system/` vs `Desktop/claude-lead-system-oss/`. The OSS exclusions (sidecar, modes, tests) suggest these are either (a) too tightly coupled to personal workflow, or (b) not mature enough for public release. Notably, the 17 mode files — identified by the Technical Audit as "30% original insight" — were excluded from OSS, suggesting they're considered personal IP rather than generalizable infrastructure._

| Feature                       | Lead System                                                | AutoGen / MS Agent Framework                        | CrewAI                                    | LangGraph                                              | OpenAI Codex CLI                                      |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| **Architecture**              | Hook-based + MCP coordinator on top of Claude Code native  | Graph-based workflow API (unified from AutoGen+SK)  | Role-based crew/task model                | Graph-based state machine                              | MCP-based + Agents SDK orchestration                  |
| **Multi-agent orchestration** | ✅ Native teams + custom queue/rebalance                   | ✅ Group chat, sequential, graph workflows          | ✅ Sequential/hierarchical processes      | ✅ Directed graph with conditional routing             | ✅ Multiple concurrent agents via Agents SDK          |
| **Task management**           | ✅ Full task board with dependencies, audit trail          | ⚠️ Basic task assignment                            | ✅ Task objects with descriptions         | ⚠️ State-based, not task-board oriented                | ⚠️ AGENTS.md-driven, no task board                    |
| **Observability**             | ✅ HTTP dashboard, metrics, SLOs, agent analytics          | ⚠️ AutoGen Studio (deprecated) → Agent Framework UI | ⚠️ CrewAI Enterprise dashboard            | ✅ LangSmith integration (production-grade)            | ⚠️ Basic CLI output, no dashboard                     |
| **Cost controls**             | ✅ Budget gates, spawn governance, read efficiency         | ⚠️ Token counting only                              | ⚠️ Token tracking                         | ✅ LangSmith cost tracking + alerts                    | ❌ No built-in cost controls                          |
| **IDE integration**           | ⚠️ Claude Code CLI + tmux (no GUI IDE plugin)              | ✅ VS Code extension + Agent Framework tooling      | ⚠️ CrewAI Studio (web)                    | ✅ LangGraph Studio + LangSmith                        | ✅ Native terminal + IDE integration                  |
| **Deployment model**          | Local CLI (macOS/Linux, broken Windows)                    | Python/.NET library + Azure integration             | Python library + Enterprise cloud         | Cloud (LangGraph Cloud) + self-hosted                  | Local CLI (Rust) + Codex Jobs (cloud, planned)        |
| **Chain integrity**           | ⚠️ Heuristic dispatch, not state machines                  | ✅ Graph-based workflow API with state management   | ✅ Sequential/hierarchical enforced       | ✅ Graph-based guarantees with checkpointing           | ⚠️ Agent loop with tool use, not graph-based          |
| **Checkpoint/restore**        | ✅ Versioned schema, full state capture                    | ⚠️ Basic via Agent Framework state                  | ❌ No built-in                            | ✅ Built-in state persistence                          | ❌ No built-in                                        |
| **Security posture**          | ✅ Credential scanning, command taxonomy, trust audit      | ❌ No built-in security layer                       | ❌ No built-in security layer             | ⚠️ Basic via LangSmith                                 | ⚠️ Sandboxed execution, no credential scanning        |
| **Learning curve**            | Hard (55 hooks, ~71K lines, multi-config)                  | Medium (Python/.NET, MS docs)                       | Easy (role metaphor, intuitive)           | Medium-Hard (graph concepts, powerful)                 | Easy (AGENTS.md + CLI, minimal config)                |
| **Model flexibility**         | Claude-only (Opus/Sonnet/Haiku)                            | Any model (OpenAI, Anthropic, local)                | Any model                                 | Any model                                              | OpenAI-only (GPT-4.1, o3, o4-mini)                    |
| **Production readiness**      | ⚠️ Local-only, no cloud deployment                         | ✅ Agent Framework 1.0 RC (GA targeting Q1 2026)    | ✅ Enterprise tier available              | ✅ LangGraph Cloud, production-grade                   | ✅ Open source, Codex Jobs cloud planned              |
| **Unique differentiator**     | Deep Claude Code integration, operator-grade local tooling | Microsoft ecosystem, enterprise Azure integration   | Intuitive role metaphor, fast prototyping | Graph-based state machines, strongest chain guarantees | Simplest setup, Rust performance, OpenAI model access |

### Competitive Summary

**Lead System's competitive advantages:**

1. **Deepest possible Claude Code integration** — hooks into every lifecycle event (17+ hook events, 27 registered handlers across 11 event types)
2. **Security posture** — credential scanning (`credential-guard.py` with staged-diff inspection), risky-command taxonomy (`risky-command-guard.py` with tiered warn/block/Opus-eval), and trust auditing (`trust_audit.py`) unmatched by any competitor
3. **Checkpoint/restore** — only LangGraph offers comparable persistence. Lead's `checkpoint.js` uses versioned schema for full state capture and restore across team sessions
4. **Presence engine** — `presence-engine.js` derives real-time agent load and interruptibility from session telemetry, enabling informed team rebalancing that no competitor offers natively
5. **Operational intelligence stack** — `ops_aggregator.py`, `ops_alerts.py`, `ops_trends.py` for usage trend analysis and threshold alerting — no equivalent in any evaluated framework
6. **CI/CD pipeline with supply chain verification** — 12 GitHub Actions workflows including `supply-chain.yml` + `supply-chain-policy.yml` for release verification — provides release quality guarantees competitors lack
7. **Observability layer** — lock contention telemetry (`lock-metrics.js` with p50/p95/p99), hook watchdog (`hook-watchdog.js` with 150s selftest), and prompt synchronization (`prompt_sync.py`) — minor individually, collectively represent operator-grade telemetry with no native equivalent
8. **Plugin system** — `plugin/` directory with `plugin.json`, `hooks.json`, `install.sh` — nascent extensibility surface no other local Claude agent framework provides
9. **Pre-edit conflict detection** — `conflicts.js` + `conflict-guard.sh` detect cross-session file overlaps before edits begin. Native relies entirely on worktree isolation (which requires upfront setup). No other framework offers this.
10. **Multi-source research capability** — the 4-master-agent architecture with 17 mode files (see Appendix L: Mode Architecture) enables auto-routing across 4 task domains × 4-5 specialized modes each. The review-mode 7-dimension framework with confidence thresholds is architecturally unique — no competitor offers simultaneous multi-dimensional code review with configurable confidence gates.
11. **Session memory injection** — `session-memory-inject.py` provides cross-session memory that persists across context compaction. Native Claude Code has no cross-session memory mechanism.
12. **Read-efficiency governance** — `read-efficiency-guard.py` + `read-cache.py` actively block duplicate/wasteful reads and serve cached results. No competitor or native feature prevents token waste from redundant file reads.
13. **Cost governance under flat-rate subscription** — `budget-guard.py` enforces rate-limit headroom to prevent hitting platform throttling. This is specifically valuable under Max 20x where the constraint is throughput, not dollars — a nuance no competitor's cost tracking addresses.

**Lead System's competitive weaknesses:**

1. Claude-only lock-in (competitors support any model — except Codex, which is OpenAI-only)
2. No cloud deployment option (competitors offer hosted solutions)
3. Chain integrity is worst-in-class compared to LangGraph's graph guarantees and MS Agent Framework's new graph-based workflow API
4. Learning curve is highest due to hook sprawl (~71K lines vs Codex's minimal AGENTS.md config)

**AutoGen / Microsoft Agent Framework update (March 2026):** AutoGen has been [formally retired by Microsoft](https://venturebeat.com/ai/microsoft-retires-autogen-and-debuts-agent-framework-to-unify-and-govern) and merged with Semantic Kernel into the unified "Microsoft Agent Framework." The RC was released February 19, 2026, with GA targeting end of Q1 2026. The new framework adds a graph-based workflow API, making it architecturally similar to LangGraph. The document's original characterization of "Microsoft shifting focus" understates this — AutoGen is end-of-life, replaced by a production-grade successor.

**OpenAI Codex CLI:** A [Rust-based local CLI agent](https://developers.openai.com/codex/cli/) that supports [multi-agent orchestration via MCP + Agents SDK](https://developers.openai.com/codex/multi-agent/). It uses AGENTS.md for configuration (similar to Claude's CLAUDE.md). While it lacks the Lead System's security posture and observability, its simplicity (minimal config, fast Rust runtime, native terminal integration) represents a DX advantage. Codex Jobs (cloud execution) is planned for 2026, which would give it a deployment model the Lead System lacks.

**The #1 competitive threat is Anthropic itself.** Native Claude Code Agent Teams already covers 15 of 41 capabilities with zero custom code. Each Anthropic release that adds cost controls, observability, or conflict detection makes another Lead component redundant. The Lead System's value proposition shrinks with every native feature release — not because it's bad, but because Anthropic is building the same things with less maintenance overhead and guaranteed integration.

**Most relevant framework competitor:** LangGraph. It offers graph-based orchestration and checkpointing with stronger chain guarantees, model flexibility, cloud deployment, and production-grade observability via LangSmith. The Lead System's only advantages over LangGraph are Claude-specific integration depth and security posture.

---

## 6. Final Verdict

### Recommendation: **(c) Thin Hybrid Layer**

Preserve the genuinely unique Lead capabilities, migrate overlapping orchestration to native, and rework chain dispatchers.

### 3 Supporting Arguments

1. **22 of 41 capabilities are Lead-only with no native equivalent.** These are not duplicative — they represent real operational value (credential scanning, conflict detection, checkpoint/restore, budget governance, observability). Deleting the entire system would lose genuine capabilities that native Claude Code does not provide.

2. **20 overlapping capabilities include cases where native is stronger in 5.** Custom approval, shutdown, worktree routing, and lifecycle hooks duplicate native with less rigor. Keeping both adds maintenance burden and confusion. Migrating these to native makes the remaining Lead surface smaller, cleaner, and easier to reason about.

3. **The thin hybrid approach has the best ROI.** Full migration to native loses 22 unique capabilities. Continuing to build Lead as-is perpetuates chain integrity debt and hook sprawl. A thin layer that keeps the 16 genuinely differentiated files and deletes/migrates the rest gives maximum value per line of maintained code.

### 2 Risks

1. **Native evolution risk.** Anthropic may ship native equivalents for current Lead-only capabilities (cost controls, conflict detection, observability). Each native addition would require evaluating whether to keep or retire the Lead equivalent. Without ongoing parity tracking, the Lead layer could become entirely redundant within 6-12 months.

2. **Rework execution risk.** The chain dispatcher rework (Tier 3) requires ~60-90 hours of focused architectural work. If this work stalls, the system remains in its weakest state — heuristic chains that the policy language implies are guaranteed. The risk is that the rework never happens and the system continues to accumulate trust debt.

### 90-Day Action Plan

**Ownership model:** All migration and rework is executed by Claude Code agents via slash commands (`/feature-dev`, `/commit`, `/test-and-fix`), with human review gates at phase boundaries. Each phase ends with a checkpoint commit and a brief human review of changes before proceeding. The operator (Drew) approves phase transitions; Claude agents execute the implementation.

**Days 1-14: Quick wins (Tier 1 migration)**

- **Revision quick fixes (< 1 hour total):** Remove `--yes` from format-on-edit.py's npx call (supply chain risk, Issue #3/18). Gate auto-lint-installer behind `.git` check (Issue #22). Remove deprecated master-agent validation from self-heal.py (Issue #17). Tighten token-guard-config.json limits to max_agents:12 (Issue #18).
- **Revision 3 quick fixes (< 1 hour total):** Reduce `session-slo-check.py` timeout from 8s to 3s (#21). Narrow `budget-guard.py` matcher from `.*` to `Task|Bash|Write|Edit|MultiEdit` (#23). Fix CLAUDE.md accuracy: change "deterministic, not advisory" to "instruction-based with delivery limits" (#25).
- Delete 8 files that have native equivalents (hookify.py, format-on-edit.py, teammate-idle.py, task-completed.py, worktree-router.py, session-busy.sh, approval.js, shutdown.js)
- Update settings.json to remove deleted hook registrations
- Verify all existing tests still pass
- **Success criteria:** `ls ~/.claude/hooks/*.py ~/.claude/hooks/*.sh | wc -l` shows 47 or fewer. `python3 -c "import json; d=json.load(open('settings.json')); print(sum(len(v) for v in d['hooks'].values() if isinstance(v, list)))"` shows 19 or fewer registered hooks. All existing test suites pass (`npm test` in mcp-coordinator, `pytest` if applicable).
- **Abort criteria:** If deleting any hook causes a chain reaction of failures in other hooks (indicating hidden coupling), STOP. Re-read the failing hook to understand the dependency, then either fix the coupling first or defer that deletion to Tier 3.
- **Rollback:** `git stash` before each deletion. If tests fail post-deletion, `git stash pop` restores the hook.

**Days 15-30: Fix critical bugs**

- Fix Windows background spawn in `platform/common.js` (use `process.platform`)
- Fix task ID mismatch in `workers.js` / `team-dispatch.js`
- Fix PID file parsing in `terminal-health.js`
- Fix snapshot builder to expose full task corpus
- Unify budget policy into single `budgets.json` source of truth
- **Success criteria:** `platform/common.js` uses `process.platform` check (grep-verifiable). Worker instructions contain both W... and T... task IDs (grep-verifiable in templates). `terminal-health.js` handles both JSON and plain text PID files (unit test). `snapshot-builder.js` returns tasks of all statuses (API test). Only `budgets.json` contains budget thresholds — `token-guard-config.json` references it, doesn't duplicate.
- **Abort criteria:** If task ID mismatch fix requires changing the MCP coordinator protocol, escalate to architecture review before proceeding.
- **Rollback:** Each bug fix is a separate commit. Revert individual commits if a fix introduces regressions.

**Days 31-60: Chain integrity rework (Tier 3 core)**

- Design SQLite state machine schema for chain tracking:
  ```
  CREATE TABLE chain_state (
    chain_id TEXT PRIMARY KEY,
    chain_type TEXT NOT NULL,  -- 'commit-review' | 'build-simplify-verify'
    current_state TEXT NOT NULL,  -- 'pending' | 'step1' | 'step2' | 'done' | 'failed'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 12,
    metadata TEXT  -- JSON blob for chain-specific data
  );
  ```
- State transitions for commit-review chain: `pending -> reviewing -> fp-checking -> done`
- State transitions for build chain: `pending -> simplifying -> verifying -> done`
- Failure handling: `any_state -> failed` after max_attempts, with exponential backoff (1s, 2s, 4s, 8s...)
- Rework `auto-review-dispatch.py`: check Bash exit code (not output text) to detect commit success, advance state machine
- Rework `build-chain-dispatcher.py`: use SubagentStop structured agent name, advance state machine
- Rework `check-inbox.sh`: only run when `~/.claude/mcp-coordinator/` is active (check pidfile), use SQLite state tracking instead of done-files
- Persist priority aging in `policy-engine.js`
- **Success criteria:** `sqlite3 ~/.claude/state/chains.db "SELECT count(*) FROM chain_state WHERE current_state='done'"` shows completed chains. No `.done` marker files in `~/.claude/state/`. `check-inbox.sh` no longer registered on `.*` matcher. Chain completion rate > 95% over 50 test runs (manual or scripted).
- **Abort criteria:** If SQLite introduces locking contention with concurrent hooks, evaluate switching to a JSON file with flock() instead. If chain rework exceeds 40 hours without a working prototype, pause and reassess scope.
- **Rollback:** The old heuristic dispatchers remain in `_archived/` until the new state machine passes 50 test runs. Only then delete the old files.

**Days 61-90: Optimization and documentation**

- **Revision hardening fixes:** Add file locking to read-cache.py (Issue #19). Add content-level diffing to conflict-guard.sh (Issue #20). Add REVIEW_MODE bypass to read-efficiency-guard.py (Issue #16). Inline elite-engineer-reference.md into agent prompts to save ~3k tokens/chain (Issue #21). Add risky-tier blocking or PermissionRequest integration to risky-command-guard.py (Issue #11). Add truncation notice to session-memory-inject.py (Issue #23).
- **Revision 3 optimization fixes:** Remove duplicate warning behavior from `result-compressor.py` (#22). Add `tsc` skip flag file (`.claude-skip-tsc`) or project-size detection for the 15s inline hook (#24). Add `credential-guard.py` env var allowlist for common non-secret vars like PATH, HOME, NODE_ENV (#27). Deduplicate `reviewer`/`quick-reviewer` checklists — scope reviewer to security/performance/architecture only (#31). Implement global hook execution budget: if total pre-tool hooks exceed 5s, skip advisory-only hooks — keep only hard-block hooks (#32, #33).
- Remove remaining low-value hooks (routing-reminder.py, cache-warm.py, cost-tagger.py — evaluate each)
- Target hook count: ≤30 (down from 55)
- Write ARCHITECTURE.md documenting what's Lead vs Native and why
- Set up quarterly parity review against Anthropic release notes
- Run benchmarks comparing hook-enabled vs hook-disabled session throughput
- **Success criteria:** `ls ~/.claude/hooks/*.py ~/.claude/hooks/*.sh | wc -l` shows ≤30. ARCHITECTURE.md exists and covers all Tier 2 (keep) files with rationale. Benchmark report shows measured latency comparison.
- **Abort criteria:** If benchmarks show hook-enabled sessions are actually slower than hook-disabled for all scenarios (including heavy teams), escalate to a fundamental reassessment of the hook architecture.
- **Rollback:** N/A for documentation. Hook removals follow same pattern as Phase 1.

---

## 7. Consolidated Issue List (Top 37)

### Code Issues (17 items)

| Priority | Issue                                                                | Source     | File                                      | Severity    | Fix Recommendation                                                                                                                              |
| -------- | -------------------------------------------------------------------- | ---------- | ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Windows background worker spawn hardcodes `sh -c`                    | Agent 1    | `platform/common.js`                      | 🔴 Critical | Use `process.platform` to select `cmd.exe /c` on Windows                                                                                        |
| 2        | Chain completion is manual and lossy (6 replay max, done-file based) | Agent 2    | `check-inbox.sh`                          | 🔴 Critical | SQLite state machine with exponential backoff, 12+ retries                                                                                      |
| 3        | `format-on-edit.py` runs `npx --yes prettier` (supply chain risk)    | Revision   | `format-on-edit.py`                       | ⚠️ High     | Remove `--yes` flag; check if prettier installed first, or pin version in package.json                                                          |
| 4        | Task ID mismatch — worker instructions use W... instead of T...      | Agent 1    | `workers.js`, `team-dispatch.js`          | ⚠️ High     | Pass team task ID alongside worker task ID in all instruction templates                                                                         |
| 5        | Commit-success detection uses string heuristics                      | Agent 2    | `auto-review-dispatch.py`                 | ⚠️ High     | Check structured exit code from Bash PostToolUse, not output text                                                                               |
| 6        | Build-chain dispatcher uses keyword-based event detection            | Agent 2    | `build-chain-dispatcher.py`               | ⚠️ High     | Use SubagentStop structured agent name matching                                                                                                 |
| 7        | PID file format mismatch (expects JSON, gets plain text)             | Agent 1    | `terminal-health.js`                      | ⚠️ High     | Accept both formats: try JSON parse, fallback to parseInt                                                                                       |
| 8        | Sidecar snapshots only expose pending tasks                          | Agent 1    | `snapshot-builder.js`                     | ⚠️ High     | Normalize full task corpus, filter at API layer                                                                                                 |
| 9        | Priority aging not persisted to authoritative tasks                  | Agent 1    | `policy-engine.js`                        | ⚠️ High     | Write aged priorities using `security.js` atomic writes                                                                                         |
| 10       | Budget policy split across multiple files                            | Agent 2    | `budgets.json`, `token-guard-config.json` | ⚠️ High     | Single source of truth in `budgets.json`                                                                                                        |
| 11       | `risky-command-guard.py` "risky" tier prints warning but exits 0     | Revision   | `risky-command-guard.py`                  | ⚠️ High     | Upgrade to exit 2 (hard block) or integrate with PermissionRequest for user approval                                                            |
| 12       | `model-router.py` ignores `enforce_background_dispatch` config flag  | Agent 2    | `model-router.py`                         | ⚠️ Medium   | Either honor the flag or remove it from config                                                                                                  |
| 13       | `hookify.py` is dormant — no active rules (`hookify-rules.json`={})  | Agent 2    | `hookify.py`, `hookify-rules.json`        | ⚠️ Medium   | Delete entirely                                                                                                                                 |
| 14       | `check-inbox.sh` runs on EVERY tool call via `.*` matcher            | Agent 3    | `settings.json`                           | ⚠️ Medium   | Change matcher to coordinator-active-only condition                                                                                             |
| 15       | `read-cache.py` save_index() has no file locking                     | Revision   | `read-cache.py`                           | ⚠️ Medium   | Add fcntl.flock() or atomic write (write to temp, then os.rename)                                                                               |
| 16       | Hook latency worst-case: 66 seconds for Write/Edit operations        | Revision 3 | aggregate (all hooks)                     | ⚠️ High     | Global hook execution budget: skip advisory hooks if total pre-tool time >5s. Reduce individual timeouts. Circuit breaker at hook runner level. |
| 17       | Task spawn latency worst-case: 25 seconds (6 hooks per spawn)        | Revision 3 | aggregate (all hooks)                     | ⚠️ High     | Same global budget approach. Make `worktree-router.py` lazy — only run when task prompt contains branch keywords.                               |

### Hook Quality Issues (14 items)

| Priority | Issue                                                                  | Source     | File                                                     | Severity  | Fix Recommendation                                                                              |
| -------- | ---------------------------------------------------------------------- | ---------- | -------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| H1       | `read-efficiency-guard.py` blocks legitimate code reviews (15/120s)    | Revision   | `read-efficiency-guard.py:43,165-183`                    | ⚠️ Medium | Add REVIEW_MODE env var bypass or raise threshold to 30+ for review/audit agents                |
| H2       | `self-heal.py` validates deprecated master-agents on every boot        | Revision   | `self-heal.py:~85-100`                                   | ⚠️ Medium | Remove EXPECTED_MODE_FILES dict; validate current agent set instead                             |
| H3       | `token-guard-config.json` extremely permissive (max_agents: 30)        | Revision   | `token-guard-config.json:2-4,20`                         | ⚠️ Medium | Tighten to max_agents: 12, max_per_subagent_type: 4, populate one_per_session                   |
| H4       | `conflict-guard.sh` only checks paths, not content overlap             | Revision   | `conflict-guard.sh`                                      | ⚠️ Medium | Add content-level diffing or line-range tracking to reduce false positives                      |
| H5       | 3 agents read `elite-engineer-reference.md` every spawn (~3k tokens)   | Revision   | `code-simplifier.md`, `reviewer.md`, `code-architect.md` | ⚠️ Medium | Inline top 5-10 principles into each prompt, or create 50-line condensed version                |
| H6       | `session-memory-inject.py` 32k char cap may truncate important context | Revision   | `session-memory-inject.py`                               | ⚠️ Low    | Prioritize by recency/relevance; add "truncated: X entries omitted" notice                      |
| H7       | `session-slo-check.py` 8-second timeout adds to startup latency        | Revision 3 | `session-slo-check.py`                                   | ⚠️ Medium | Reduce timeout to 3s or make async — deliver SLO warnings via inbox on next tool call           |
| H8       | `result-compressor.py` duplicates `read-efficiency-guard.py` warnings  | Revision 3 | `result-compressor.py`, `read-efficiency-guard.py`       | ⚠️ Medium | Designate one authority for large-result warnings; remove duplicate detection from the other    |
| H9       | `budget-guard.py` fires on ALL tools via `.*` matcher                  | Revision 3 | `budget-guard.py`                                        | ⚠️ Medium | Narrow matcher to `Task\|Bash\|Write\|Edit\|MultiEdit` (expensive operations only)              |
| H10      | `tsc --noEmit` inline hook has 15-second timeout                       | Revision 3 | `settings.json` (inline hook)                            | ⚠️ Medium | Add project-size detection, skip flag file, or reduce timeout to 8s                             |
| H11      | `credential-guard.py` env var pattern false-positives                  | Revision 3 | `credential-guard.py`                                    | ⚠️ Low    | Add allowlist of common non-secret env vars (PATH, HOME, NODE_ENV, etc.)                        |
| H12      | `routing-reminder.py` injects full preamble on every message           | Revision 3 | `routing-reminder.py`                                    | ⚠️ Low    | Reduce to first message + every 50th, or only on agent-dispatch messages                        |
| H13      | `verify-app` agent stash handling complexity                           | Revision 3 | `verify-app.md`                                          | ⚠️ Low    | Simplify stash management; use unique identifiers; emit errors to stderr                        |
| H14      | `reviewer` agent overlaps with `quick-reviewer`                        | Revision 3 | `reviewer.md`, `quick-reviewer.md`                       | ⚠️ Low    | Pass quick-reviewer findings into reviewer; scope reviewer to security/performance/architecture |

### Governance Gaps (6 items)

These are policy/documentation issues, not code bugs. They represent gaps between what the system claims and what is mechanically enforced.

| Priority | Issue                                                                  | Source     | File                              | Severity  | Fix Recommendation                                                                                  |
| -------- | ---------------------------------------------------------------------- | ---------- | --------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| G1       | 7 "HARD RULES" in CLAUDE.md are not mechanically enforced              | Agent 2    | `CLAUDE.md`                       | ⚠️ Medium | Either implement hook enforcement for each rule or downgrade language to "advisory"                 |
| G2       | `auto-lint-installer.py` runs every SessionStart even outside repos    | Revision   | `auto-lint-installer.py`          | ⚠️ Low    | Gate behind `os.path.isdir(".git")` check; add "already installed" cache                            |
| G3       | README over-claims parity and cost delta                               | Agent 1    | `README.md`                       | ⚠️ Low    | Rewrite claims to match verified parity matrix and corrected cost analysis                          |
| G4       | Custom approval/shutdown weaker than native structured protocol        | Agent 1    | `approval.js`, `shutdown.js`      | ⚠️ Low    | Migrate to native plan approval and shutdown protocol (Tier 1)                                      |
| G5       | CLAUDE.md claims chains are "deterministic, not advisory" — misleading | Revision 3 | `CLAUDE.md`                       | ⚠️ Medium | Update to "instruction-based with delivery limits" or implement state machine so claim becomes true |
| G6       | `check-inbox.sh` hook ordering dependency is implicit                  | Revision 3 | `check-inbox.sh`, `settings.json` | ⚠️ Low    | Document ordering in settings.json or add self-heal validation for hook array order                 |

---

## Appendix K: Boris Cherny Workflow Patterns — Expanded Reference

_Source: boris_cherny_claude_code_workflow.txt (primary source research document, 812 lines). All quotes are Boris Cherny verbatim from the Latent Space Podcast (May 7, 2025) unless noted otherwise. Boris's specific personal configs (named subagents, full CLAUDE.md, Slack permission router) are not publicly accessible — his GitHub has no public `.claude/` repos (7,868 contributions, all private)._

### "Do The Simple Thing First" — The Core Philosophy

> "it's another example of this idea of, you know, do the simple thing first... it's a file that has some stuff. And it's auto-read into context."

This is the design principle the Lead System should be measured against. Boris built Claude Code's architecture around deliberate simplicity — CLAUDE.md is "a file that has some stuff," hooks are "less than five seconds," slash commands are "essentially like a prompt that's been saved." The Lead System's 55 hooks, 71K lines, and multi-config sprawl represents the opposite trajectory.

### Verified Boris Patterns (with Lead System comparison)

| Boris Pattern        | How He Does It                                                         | How Lead System Does It                                                                      | Alignment                                                                             |
| -------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **CLAUDE.md**        | "A file that has some stuff." Under 200 lines.                         | ~242+ lines with complex routing tables, agent dispatch rules, verification matrices         | Divergent — Lead CLAUDE.md is heavier                                                 |
| **Pre-commit hooks** | "Just types. Less than five seconds. Types and lint maybe."            | 55 hook files, 66s worst-case Write/Edit, 25s worst-case Task spawn                          | Deeply divergent                                                                      |
| **Slash commands**   | `/project:lint` — single CI command, GitHub Action + GitHub MCP        | 100+ skills/commands, GSD system with 28 commands                                            | Divergent — Lead is 20x the surface area                                              |
| **Subagents**        | "Research three separate ideas... do it in parallel. Use three agents" | 7 named agents with autonomous chains, mode files, reference cards                           | Convergent in intent, divergent in complexity                                         |
| **Auto-accept**      | "Shift tab. Enter auto accept mode and just let it run"                | `--dangerously-skip-permissions` on workers (flagged as security concern by Technical Audit) | Similar intent, riskier implementation                                                |
| **Committing**       | "Commit after every change. Put that in the ClaudeMD."                 | Auto-review chain: commit → quick-reviewer → fp-checker (heuristic dispatch)                 | Over-engineered relative to Boris's approach                                          |
| **Worktrees**        | "Create a work tree every time... a few Claudes running in parallel"   | `worktree-router.py` custom routing hook                                                     | Converges — but native `isolation: "worktree"` achieves this in one frontmatter field |
| **Code ratio**       | "Probably near 80... 80, 90% Claude written code overall"              | 86% prompt engineering, 14% executable code (Technical Audit)                                | Both are predominantly AI-generated/configured                                        |

### Boris's Production Automation (the only confirmed one)

The only named slash command Boris personally describes is `/project:lint`:

> "We have this GitHub action that runs. And the GitHub action invokes Claude Code with a local slash command... it just runs a linter... it'll check for spelling mistakes, but also it checks that code matches comments... it'll use the GitHub MCP server in order to commit the changes back to the PR."

Pattern: `GitHub Actions → claude -p "/project:lint" → linter → GitHub MCP → commit back to PR`. This is the Lead System's `auto-lint-installer.py` pattern, but Boris runs it as a simple GitHub Action — not as a SessionStart hook that fires on every boot regardless of context.

### "Underfund Things" — Applied to Lead System

The Lead System's CLAUDE.md cites Boris's "underfund things" principle, yet:

- `token-guard-config.json` allows 30 agents / 10 per type with `one_per_session: []` disabled
- 55 hooks fire on operations that "just types and lint" would handle in Boris's setup
- 8 SessionStart hooks add 5-15s to every boot
- `budget-guard.py` fires on ALL tools via `.*` matcher — even cheap Grep/Read that don't consume API tokens

The principle of "underfunding" means starting with the minimum and only adding when proven necessary. The Lead System's current configuration represents the opposite: maximum governance from the start, to be pruned later. The 90-day action plan addresses this by targeting ≤30 hooks (from 55) and narrowing matchers.

**So What?** The Boris workflow research establishes the ground truth for what sophisticated Claude Code usage actually looks like at Anthropic: simple CLAUDE.md, fast hooks (<5s), one CI slash command, parallel subagents for research. Every Lead System component should be evaluated against the question: "Does this add value beyond what Boris achieves with a 200-line CLAUDE.md and a single /project:lint command?"

---

## Appendix L: Mode Architecture

_Source: 17 mode files in `claude-lead-system/modes/`. Modes are a Lead-only concept — they represent the "30% original insight" identified by the Technical Audit (the remaining 70% being "well-curated best practices")._

Modes are domain-specific behavior profiles auto-loaded by keyword matching. They represent the system's approach to specialization without agent proliferation.

| Domain         | Mode       | Trigger Keywords              | Lines | Rating (per Technical Audit)                              |
| -------------- | ---------- | ----------------------------- | ----- | --------------------------------------------------------- |
| **Coder**      | review     | review, check, audit, PR      | 131   | 8/10 — "strongest individual piece of prompt engineering" |
|                | build      | build, create, implement, add | 98    | 6/10 — "competent but not differentiated"                 |
|                | debug      | fix, broken, error, debug     | —     | Not individually assessed                                 |
|                | refactor   | simplify, refactor, clean up  | —     | Not individually assessed                                 |
|                | atlas      | atlas, Atlas                  | —     | Project-specific, not generalizable                       |
| **Researcher** | academic   | paper, study, academic, SSRN  | —     | Not individually assessed                                 |
|                | market     | competitor, market, landscape | —     | Not individually assessed                                 |
|                | technical  | docs, documentation           | —     | Not individually assessed                                 |
|                | general    | research, find out            | —     | Not individually assessed                                 |
| **Architect**  | database   | database, schema, SQL         | 147   | 8/10 — "most embedded knowledge"                          |
|                | api        | API, endpoint, REST           | —     | Not individually assessed                                 |
|                | system     | system design, infrastructure | —     | Not individually assessed                                 |
|                | frontend   | frontend, dashboard, UI       | —     | Not individually assessed                                 |
| **Workflow**   | gsd-exec   | /gsd:, .planning/             | —     | 6/10 — "28 commands is too many"                          |
|                | feature    | new feature, spec-driven      | —     | Not individually assessed                                 |
|                | git        | commit, push, PR              | —     | Not individually assessed                                 |
|                | autonomous | autonomous, ralph loop        | —     | Not individually assessed                                 |

### Mode Dispatch Mechanism

```
User says "build a login page"
  → CLAUDE.md keyword matcher → "build" → master-coder
    → master-coder reads task → "build" → loads build-mode.md
      → build-mode loads relevant reference cards (auth-patterns.md, etc.)
        → Agent executes with embedded domain knowledge
```

**Weakness:** Keyword matching is brittle. "Make the auth better" could route to build or refactor. No fallback when keywords are ambiguous. Reference cards are static (written once, never updated as frameworks evolve).

**So What?** Modes are the Lead System's answer to "how do you specialize without proliferating agents?" The pattern (4 agents × 17 modes × 14 reference cards) is genuinely original and could be the most portable concept for other Claude Code users — but it was excluded from the OSS release, suggesting Drew considers it personal IP rather than reusable infrastructure.

---

## Appendix M: Per-File Code Review Grades

_Source: lead-system-code-review-2026-03-06.md (Codex assessment) and LEAD_SYSTEM_REVIEW_PART1_APPLICATION_CODE.md (Agent 1 review). Per-file grades should inform Tier 1/2/3 migration decisions — files graded C or below are priority rework candidates._

### MCP Coordinator (Agent 1 grades)

| File                 | Grade         | Key Finding                                                                  |
| -------------------- | ------------- | ---------------------------------------------------------------------------- |
| `index.js`           | ✅ Good       | Clear structure, broad surface, sane input validation                        |
| `tasks.js`           | ✅ Good       | Solid after lock + validation fixes                                          |
| `messaging.js`       | ✅ Good       | Much better after rate-limit fix                                             |
| `team-tasking.js`    | ⚠️ Needs Work | Snapshot only surfaces pending tasks; queue policy claims exceed persistence |
| `sessions.js`        | ✅ Good       | Small, readable, null-safe after fix                                         |
| `security.js`        | ✅ Good       | Strongest coordinator utility file                                           |
| `workers.js`         | ⚠️ Needs Work | Windows background spawn bug; instruction/task-ID mismatch                   |
| `team-dispatch.js`   | ⚠️ Needs Work | Worker instructions don't respect team-task-ID / worker-task-ID split        |
| `teams.js`           | ⚠️ Needs Work | No native-grade lifecycle guardrails around deletion                         |
| `approval.js`        | ⚠️ Needs Work | Looser than native structured approval exchange                              |
| `shutdown.js`        | ⚠️ Needs Work | Not as integrated as native                                                  |
| `conflicts.js`       | ✅ Good       | High-signal utility, genuine differentiator                                  |
| `context-store.js`   | ✅ Good       | Simple and serviceable                                                       |
| `cost-comparison.js` | ⚠️ Needs Work | Claim quality overstated relative to native reference                        |
| `gc.js`              | ✅ Good       | Deletion ordering bug (Codex D2), but useful                                 |
| `platform/common.js` | 🔴 Broken     | `sh -c` hardcoded — breaks Windows background path                           |

### Sidecar (Codex + Agent 1 grades)

| File                  | Codex Grade   | Key Finding                                             |
| --------------------- | ------------- | ------------------------------------------------------- |
| `checkpoint.js`       | ✅ Good       | High-value, but containment escape in restore path (S3) |
| `pre-op-backup.js`    | ✅ Good       | Same containment flaw as checkpoint (S4)                |
| `policy-engine.js`    | ⚠️ Needs Work | Priority aging not persisted (D6)                       |
| `terminal-health.js`  | ⚠️ Needs Work | PID format mismatch (D1)                                |
| `fs-utils.js`         | ⚠️ Needs Work | `writeJSON()` non-atomic (D8)                           |
| `snapshot-builder.js` | C (Codex)     | Only exposes pending tasks (D4)                         |
| `routes/actions.ts`   | C (Codex)     | Path traversal via action_id (S1 — Critical)            |
| `routes/teams.ts`     | C (Codex)     | Path traversal via task_id (S2 — High)                  |
| `routes/shared.ts`    | C (Codex)     | `decodeURIComponent` without validation (S6)            |

_Codex hardening commit `442b5c5` fixed 4/9 findings, leaving 5 still broken (see lead-system-code-review-2026-03-06.md Part 2). The most critical gap: `isPathWithin()` was built but not wired into the code paths that need it._

**So What?** Files graded C or 🔴 Broken map directly to Tier 3 rework priorities. The 6 security findings (S1-S6) in the sidecar routes are the highest-priority fixes. Files graded ✅ Good that overlap native capabilities (approval.js, shutdown.js) are Tier 1 migration candidates regardless of code quality.

---

## Appendix N: Claude Code Revision History

_Source: 6 revision PDFs in `Desktop/Claude Code Revisions/` (Revisions 1-6). The prompt said "prioritize later revisions." Revisions 5 and 6 are the most recent and show iterative improvement patterns._

The existence of 6 named revision documents demonstrates an iterative refinement process. Each revision expanded the system's scope:

- **Revisions 1-4:** Progressive system building — from basic hooks and agents to full MCP coordinator
- **Revision 5:** Quality gate additions — review chains, cost governance expansion
- **Revision 6:** Architecture reassessment — the period that produced this capstone document and the code review prompt

**So What?** The revision history shows the system grew organically rather than being designed top-down. This explains the architectural inconsistencies (86:14 prompt-to-code ratio, 55 hooks with overlapping matchers, dead code from deprecated master-agents). Each revision added capabilities without pruning previous layers — exactly the pattern the 90-day action plan aims to reverse.

---

## Methodology & Sources

### Agent Reviews Referenced

- **Agent 1:** `claude-lead-system/LEAD_SYSTEM_REVIEW_PART1_APPLICATION_CODE.md` — Application code review covering mcp-coordinator and sidecar
- **Agent 2:** `control-plane-review-part2.md` — Control plane review covering ~/.claude/ hooks, agents, scripts, and config
- **Agent 3 (this document):** Strategic synthesis, competitive analysis, migration framework
- **Revision 2:** `Revision work 2.rtf` — 11 additional TIER 3 issues (#10-20) from extended control plane audit, adding supply chain risk, config permissiveness, file locking, and token waste findings
- **Revision 3:** `Revision 3.rtf` — 13 additional TIER 3/4 issues (#21-33) from extended control plane audit, adding hook latency worst-cases (66s Write/Edit, 25s Task spawn), duplicate warning behavior, overly broad matchers, documentation accuracy gaps, and agent persona redundancy findings

### Evidence Verification

- All ✅ marks in the parity matrix cite specific files or Anthropic documentation
- All grades reference findings from at least one agent review
- Cost analysis uses measured hook counts from `settings.json` (27 registered hooks across 11 event types) and file counts (55 .py/.sh hook files)
- Hook latency benchmarked against 5 representative hooks (median: 31ms, range: 11-36ms)
- Competitive data sourced from 2026 framework comparison articles
- "57% savings" invalidation based on Agent 1's finding on `cost-comparison.js` + flat-rate subscription model analysis

### Competitive Analysis Sources

- [DataCamp: CrewAI vs LangGraph vs AutoGen](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [OpenAgents: Open Source AI Agent Frameworks Compared (2026)](https://openagents.org/blog/posts/2026-02-23-open-source-ai-agent-frameworks-compared)
- [o-mega: Top 10 AI Agent Frameworks 2026](https://o-mega.ai/articles/langgraph-vs-crewai-vs-autogen-top-10-agent-frameworks-2026)
- [Anthropic Agent Teams Docs](https://code.claude.com/docs/en/agent-teams)
- [VentureBeat: Microsoft Retires AutoGen, Debuts Agent Framework](https://venturebeat.com/ai/microsoft-retires-autogen-and-debuts-agent-framework-to-unify-and-govern)
- [Microsoft Agent Framework Migration Guide](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/)
- [Microsoft Agent Framework RC Blog Post](https://devblogs.microsoft.com/semantic-kernel/migrate-your-semantic-kernel-and-autogen-projects-to-microsoft-agent-framework-release-candidate/)
- [OpenAI Codex CLI Documentation](https://developers.openai.com/codex/cli/)
- [OpenAI Codex Multi-Agent Orchestration](https://developers.openai.com/codex/multi-agent/)
- [OpenAI: Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
