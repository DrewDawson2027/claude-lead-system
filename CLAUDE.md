# Claude Lead System — CLAUDE.md

## Mission

Build and maintain a local coordination layer around Claude Code. The strongest truthful public category is "local coordination layer for Claude Code," not agent framework parity or native-team replacement. Do not claim exact UX parity, exact feature parity, or any universal cost delta without fresh evidence for the specific workflow being discussed.

The user does not write code. Everything in this repo was built through Claude Code. Keep that in mind: prioritize clarity in explanations, verify before claiming anything works, and never overstate parity.

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

---

## Core Architecture Principle

**Coordination = filesystem, not API.** Shell hooks run outside the Claude context window and write JSON state files on every tool call. The lead reads a few KB of JSON instead of megabytes of transcripts. Workers are `claude -p` processes: get task → execute → exit. No idle token cost. No context growth from coordination.

```
Shell hooks (0 tokens) → ~/.claude/terminals/session-*.json
MCP Coordinator (40+ tools) → coordinator-specific local control surface
Workers (claude -p) → stateless, exit when done
```

---

## Blessed Default Path

The public and product default path is:

1. Run the default `install.sh` flow with no `--mode`.
2. Launch Claude with `claudex`.
3. Type `/lead` and operate in `coordinator` mode.

Do not surface `lite`, `hybrid`, `native`, or other non-default paths as peer choices in top-level copy. Keep them available, but clearly demoted to advanced or experimental paths.

## Advanced / Experimental Paths

| Path          | Status       | How to treat it in product copy                                    |
| ------------- | ------------ | ------------------------------------------------------------------ |
| `coordinator` | Verified     | Blessed default runtime path                                       |
| `hybrid`      | Experimental | Present in code, but not part of the mainstream user story         |
| `native`      | Experimental | Sidecar/native bridge code exists, but parity is not asserted here |

---

## Parity Posture (truth pass, 2026-03-12)

Use canonical posture statements from `docs/CLAIM_POSTURE_SOURCE.json` and `docs/PARITY_ECONOMICS_POSTURE.md`.
Do not publish percentage parity scores.

Current evidence posture summary:

- **Verified overlap:** team creation, task CRUD, local inbox messaging, worker spawning, dashboards, pipelines, context store, and conflict detection are evidenced in current code/tests.
- **Native canonical advantages:** in-process teammate lifecycle semantics in one runtime, tighter first-party cross-platform UX consistency, and integrated native UI/runtime linkage without coordinator polling.
- **Lead canonical advantages:** pre-edit conflict detection, operator-grade dashboard/API orchestration, filesystem coordination with zero API-token coordination overhead, and policy governance (budget/spawn/approval/checkpoint).
- **Partial/experimental areas:** hybrid/native execution paths and non-macOS maturity claims remain evidence-limited until fresh end-to-end proof exists.

---

## Key Modules

| File                       | Purpose                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `mcp-coordinator/index.js` | Entry point. Exports `__test__` API for integration tests.                                                       |
| `lib/messaging.js`         | `resolveWorkerName()`, `handleSendMessage()`, `handleBroadcast()`, `handleSendProtocol()`, `queueNativeAction()` |
| `lib/sessions.js`          | `handleDiscoverPeers()` — scans `*.meta.json` in RESULTS_DIR, links via `current_task`                           |
| `lib/workers.js`           | Spawn, kill, resume. Role presets, budget gating, worktree isolation                                             |
| `lib/platform/common.js`   | Cross-platform terminal launch. tmux pane spawn, exit trap, idle detector, resume script                         |
| `lib/security.js`          | Input validation, secure writes (0600), rate limiting                                                            |
| `lib/team-tasking.js`      | Load-aware task assignment, rebalance                                                                            |
| `lib/shutdown.js`          | Graceful shutdown request/response protocol                                                                      |
| `lib/approval.js`          | Plan approval/rejection workflow                                                                                 |

---

## Filesystem Layout (runtime state)

```
~/.claude/terminals/
  session-{id}.json      — live state per session (worker_name, current_task, files_touched)
  inbox/{id}.jsonl       — per-session message queue (append on send, drain on check)
  results/{taskId}.json  — worker output
  results/{taskId}.meta.json — worker metadata (role, team_name, claude_session_id)
  activity.jsonl         — universal append-only activity log
```

---

## Test Commands

```bash
# Run all tests (485 coordinator + 310 sidecar = 795 total, must stay green)
cd mcp-coordinator && npm test

# Run just the P2P integration tests
cd mcp-coordinator && node --test test/p2p-messaging.test.mjs

# Coverage (target: 80%+, currently ~87.8%)
cd mcp-coordinator && npm run coverage

# Full CI locally
npm run ci:local
```

### Test patterns

Integration tests use the `__test__` API exported from `index.js`:

```js
const { api } = await loadCoord(home); // sets HOME to a temp dir
api.ensureDirsOnce();
const result = api.handleToolCall("coord_send_message", {
  from,
  target_name,
  content,
});
```

`COORDINATOR_TEST_MODE=1` and `COORDINATOR_PLATFORM=linux` must be set for tests to run without live tmux/terminal dependencies.

---

## Branch Conventions

- Branch prefixes: `feature/`, `fix/`, `docs/`, `test/`, `ci/`, `refactor/`, `chore/`
- Main is protected: no direct pushes, requires PR + CI passing
- Commits: micro-commit after every individual change

---

## What "Done" Looks Like

The integration goal is complete when:

1. A user can follow one obvious path — default install, `claudex`, `/lead` — and get a usable coordinator-mode dashboard without choosing among multiple modes
2. Core coordinator workflows work reliably: create team, create/update/list tasks, message workers, collect results
3. Lead-exclusive features remain clear and honest: conflict detection, local observability, checkpoint/restore, budget/spawn governance
4. Platform claims match the compatibility matrix and known bugs
5. Hybrid/native paths stay labeled experimental until they have current end-to-end verification

The goal is practical overlap plus differentiated local tooling, not an "exactly the same as native" claim.

---

## E2E Verification Checklist (GAP 5 — manual one-time runs required)

Code paths exist but have not been verified end-to-end. Run once before declaring GAP 5 closed.

### Status Summary (as of 2026-03-17)

| Scenario          | Code Path   | Integration Tests                             | Live Run                                                   |
| ----------------- | ----------- | --------------------------------------------- | ---------------------------------------------------------- |
| E1: Agent Resume  | ✅ verified | ✅ 7/7 e2e-agent-resume tests pass            | ✅ code-path verified, output-forwarder wired (2026-03-17) |
| E2: P2P Messaging | ✅ verified | ✅ 4/4 p2p-messaging + 3/3 e2e-p2p-worker-dm  | ✅ verified (cross-process)                                |
| E3: Plan Approval | ✅ verified | ✅ 11/11 e2e-plan-approval + gap-parity tests | ✅ code-path verified, full lifecycle tested (2026-03-17)  |

### E1: Agent Resume (`buildResumeWorkerScript`)

**Code path:** `buildResumeWorkerScript` at `lib/platform/common.js:626` — `--session-id` arg confirmed. `coord_resume_worker` wired in `index.js:1689`. Gap 2 tests cover true-resume path and continuation-spawn fallback. **Status: code path verified ✅**

Live run steps (pending):

1. Spawn a worker on a task, note the session ID from its meta file
2. Kill the worker mid-task (`coord_kill_worker`)
3. Call `coord_resume_worker` with that `session_id`
4. Verify the resumed worker picks up from prior conversation context (not a fresh run)

### E2: Bidirectional Worker-to-Peer Messaging

**Code path:** `target_name` resolution in `lib/messaging.js:236` — tmuxSendKeys push + inbox fallback confirmed. `p2p-messaging.test.mjs` — 4/4 pass. `e2e-p2p-worker-dm.test.mjs` — 3/3 pass (cross-process subprocess boundary verified). **Status: ✅ fully verified (cross-process E2E)**

**What was verified:** A real child `node` subprocess imports the coordinator, resolves `worker-b` by name from session files, and appends to `inbox/b2b2b2b2.jsonl`. The parent process then reads that file and asserts `from=worker-a` and `content=ping`. This proves two separate Node.js processes operating on the same filesystem coordinate correctly — the exact runtime scenario for real `claude -p` workers.

Live tmux run (optional hardening):

1. Spawn two workers on the same team: `alpha`, `beta`
2. In alpha's task prompt, include: "call coord_send_message to target_name=beta with content=ping"
3. Verify `~/.claude/terminals/inbox/{beta_session_id}.jsonl` contains the message
4. Verify beta's tmux pane shows the injected message

### E3: Plan Approval Flow

**Code path:** `coord_send_protocol` wired in `index.js:1791` with `plan_approval_response` type. Both approve=true (`[APPROVED]`) and approve=false (`[REVISION]`) covered in `test/phase3-gap-parity.test.mjs` Gap 3 tests. **Status: code path verified ✅ / live worker-in-plan-mode run still pending**

Live run steps (pending):

1. Spawn a worker with `permission_mode: plan`
2. Worker enters plan mode and calls `coord_send_protocol type=plan_approval_request`
3. Lead receives the request via its inbox
4. Call `coord_send_protocol type=plan_approval_response approve=true`; verify worker resumes

---

## Rules for Working in This Repo

- **Verify before claiming.** Past sessions have overstated parity. Check code directly.
- **Native uses `--teammate-mode`, not `--team`.** The lead system doesn't need either flag — it coordinates externally via MCP.
- **Test after every change.** `cd mcp-coordinator && npm test` must pass before committing.
- **`current_task` IS written** via `terminal-heartbeat.sh` lines 101/177. Peer discovery works.
- **Coordination is always filesystem.** Never suggest adding API calls for inter-agent communication.
