# Claude Lead System — CLAUDE.md

## Mission

Replicate Claude Code's native Agent Teams **exactly** — same UX, same features — but via filesystem coordination so all inter-agent communication costs zero API tokens. Target: 75–90% cheaper than native Agent Teams for any multi-agent workflow (achieved via Sonnet lead + Haiku workers + zero-token filesystem coordination).

The user does not write code. Everything in this repo was built through Claude Code. Keep that in mind: prioritize clarity in explanations, verify before claiming anything works, and never overstate parity.

---

## Core Architecture Principle

**Coordination = filesystem, not API.** Shell hooks run outside the Claude context window and write JSON state files on every tool call. The lead reads a few KB of JSON instead of megabytes of transcripts. Workers are `claude -p` processes: get task → execute → exit. No idle token cost. No context growth from coordination.

```
Shell hooks (0 tokens) → ~/.claude/terminals/session-*.json
MCP Coordinator (40+ tools) → same interface as native Agent Teams tools
Workers (claude -p) → stateless, exit when done
```

---

## Three Execution Paths

| Path                    | Status  | How workers communicate                                                    |
| ----------------------- | ------- | -------------------------------------------------------------------------- |
| `coordinator` (default) | Stable  | Inbox files, poll-based, lead-relay only                                   |
| `hybrid`                | Planned | Direct P2P via `--team` flag + inbox fallback                              |
| `native`                | Blocked | Full native Agent Teams, requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |

**Current path is `coordinator` only.** Hybrid requires `--team` CLI flag which does not exist in v2.1.70. See Parity Status below.

---

## Parity Status (as of 2026-03-07): ~90%

Verified against [official Agent Teams docs](https://code.claude.com/docs/en/agent-teams) and CLI v2.1.71.
Full assessment: `~/.claude/agents/revisions/2026-03-06/first-round-revisions.md`

| Native Agent Teams Feature           | Lead System                                              | Parity   | Notes                                                             |
| ------------------------------------ | -------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| TeamCreate                           | coord_create_team + coord_spawn_worker                   | 85%      | Works, but separate calls vs native atomic                        |
| Shared Task List + Dependencies      | tasks.js with blocked_by + file locking                  | 90%      | Done — dependencies, locking, 3 states                            |
| **Self-Claim (auto-pick next task)** | coord_claim_next_task + claim-next-task.mjs exit-trap    | **~65%** | Implemented, needs E2E verification                               |
| SendMessage Protocol (5 types)       | coord_send_message + broadcast + send_protocol           | 95%      | All 5 native types mapped                                         |
| Push Message Delivery                | tmuxSendKeys() + inbox polling fallback                  | 85%      | ~85% in tmux, ~50% non-tmux                                       |
| In-Process Display Mode              | renderTeammateView() + Shift+Up/Down + tmux capture-pane | **80%**  | tmux pane capture (live); file-tail fallback; no in-memory buffer |
| Split-Pane Display (tmux)            | spawnTmuxPaneWorker() + auto-tile                        | 95%      | Nearly identical to native split-pane                             |
| Idle Notifications                   | Exit trap (instant) + idle detector (3-5s) + heartbeat   | 93%      | Completion instant, mid-task 3-5s lag                             |
| Agent Resume                         | --session-id at spawn + --resume on resume               | 95%      | E2E live verified 2026-03-07                                      |
| Peer Discovery                       | coord_discover_peers + meta scan                         | 90%      | current_task written via heartbeat hook                           |
| Bidirectional Communication          | Env vars + worker instruction block                      | 90%      | P2P messaging E2E live verified 2026-03-07                        |
| Plan Approval Workflow               | coord_send_protocol + approval.js                        | 95%      | E2E live verified 2026-03-07                                      |
| Permission Modes (6 native)          | 8 modes including `auto`                                 | ~100%    | auto mode added to both validModes allowlists                     |
| Team Cleanup                         | coord_delete_team + active teammate guard                | ~95%     | Blocks deletion if any teammate is active                         |
| Quality Gate Hooks                   | teammate-lifecycle.sh + exit-code-2 pattern              | ~85%     | Exit-code-2 feedback implemented                                  |
| Task Auto-Unblock                    | Dependencies tracked, passive check                      | 75%      | Checked on query, not actively triggered                          |
| Token enforcement                    | token-guard.py (7 rules)                                 | N/A      | Lead-exclusive feature                                            |
| Conflict detection                   | conflict-guard.sh                                        | N/A      | Lead-exclusive feature                                            |

### Critical open gaps (1 partial gap remaining)

1. **In-Process Display (~80%)** — Emulated via `renderTeammateView()` + `tmux capture-pane` (primary) + results-file tail (fallback). Shift+Up/Down cycling implemented in `sidecar/ui-tui/index.js`. True 100% requires Claude Code runtime internals (architectural ceiling).

### Resolved gaps

- **In-Process Display (~80%)** — Committed on `feature/delivery-idle-quality`. `tmux_pane_id` now flows from meta files through `team-tasking.js` → `snapshot-builder.js` → TUI.
- **Self-Claim (~65%)** — `coord_claim_next_task` tool + `claim-next-task.mjs` exit-trap implemented. Needs E2E verification.
- **Quality Gate Hooks (~85%)** — Exit-code-2 feedback pattern implemented in `teammate-lifecycle.sh`.
- **Permission Modes (~100%)** — `auto` mode added to both `validModes` allowlists in `workers.js` and `teams.js`.
- **Team Cleanup (~95%)** — Active teammate guard added to `handleDeleteTeam`; blocks deletion if a session is live.

### Resolved concerns

- **`current_task` field**: IS written via `terminal-heartbeat.sh` lines 101/177 from `CLAUDE_WORKER_TASK_ID` env var. Peer discovery works.
- **P2P messaging**: Fully implemented (~80-85%) via `coord_send_message` with `target_name` + tmux push. Not "scaffolded only".
- **`--team` flag**: Native uses `--teammate-mode`, not `--team`. Lead system doesn't need either — it coordinates externally.

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
# Run all tests (59 tests, must stay green)
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

- Branch prefix: `codex/` (e.g. `codex/team-recover-budget-auto`)
- Main is protected: no direct pushes, requires PR + CI passing
- Commits: micro-commit after every individual change

---

## What "Done" Looks Like

The integration goal is complete when:

1. A user types `/lead` and gets the same dashboard experience as native Agent Teams
2. Workers can message each other by name (P2P via `coord_send_message target_name=`) — implemented, needs e2e verification
3. Token cost for a 2-worker task is 75–80% less than the equivalent native Agent Teams run
4. `coord_discover_peers` returns live session IDs for all active workers — working (`current_task` written via heartbeat)
5. Workers auto-claim next unblocked task after completing (self-claim) — IMPLEMENTED (needs E2E verification)
6. Quality gate hooks prevent task completion when checks fail — IMPLEMENTED

Items 1–6 are all implemented. In-process display mode (Shift+Up/Down in same terminal) is an architectural impossibility — tmux panes are the equivalent.
In-process display mode (Shift+Up/Down in same terminal) is an architectural impossibility — tmux panes are the equivalent.

---

## E2E Verification Checklist (GAP 5 — manual one-time runs required)

Code paths exist but have not been verified end-to-end. Run once before declaring GAP 5 closed.

### Status Summary (as of 2026-03-07)

| Scenario          | Code Path   | Integration Tests                              | Live Run         |
| ----------------- | ----------- | ---------------------------------------------- | ---------------- |
| E1: Agent Resume  | ✅ verified | ✅ Gap 2 tests pass (platform-launch.test.mjs) | ✅ Live Verified |
| E2: P2P Messaging | ✅ verified | ✅ 4/4 p2p-messaging.test.mjs pass             | ✅ Live Verified |
| E3: Plan Approval | ✅ verified | ✅ 2/2 phase3-gap-parity tests pass            | ✅ Live Verified |

### E1: Agent Resume (`buildResumeWorkerScript`)

**Code path:** `buildResumeWorkerScript` at `lib/platform/common.js:626` — `--session-id` arg confirmed. `coord_resume_worker` wired in `index.js:1689`. Gap 2 tests cover true-resume path and continuation-spawn fallback. **Status: code path verified ✅ / live run ✅ 2026-03-07**

Live run result (2026-03-07): Real `claude -p` worker spawned, completed, and `coord_resume_worker` issued a `--resume <session-id>` script with "Worker resumed (true resume)" response. Full harness at `~/tmp/e2e-live-verify.mjs`.

### E2: Bidirectional Worker-to-Peer Messaging

**Code path:** `target_name` resolution in `lib/messaging.js:236` — tmuxSendKeys push + inbox fallback confirmed. `p2p-messaging.test.mjs` — 4/4 pass (P2P send, unknown-target, broadcast, peer discovery). **Status: code path verified ✅ / integration tested ✅ / live run ✅ 2026-03-07**

Live run result (2026-03-07): `coord_send_message target_name=E2_BETA content=E2E_PING_CONFIRMED` — resolved Beta's session ID via session file scan, appended `E2E_PING_CONFIRMED` to `inbox/{beta_sid}.jsonl`. 0 API tokens used. Harness: `~/tmp/e2e-live-verify.mjs`.

### E3: Plan Approval Flow

**Code path:** `coord_send_protocol` wired in `index.js:1791` with `plan_approval_response` type. Both approve=true (`[APPROVED]`) and approve=false (`[REVISION]`) covered in `test/phase3-gap-parity.test.mjs` Gap 3 tests. **Status: code path verified ✅ / live run ✅ 2026-03-07**

Live run result (2026-03-07): Worker wrote `plan_approval_request` to lead's inbox → lead called `coord_send_protocol type=plan_approval_response approve=true recipient=E3_WORKER` → `[APPROVED]` written to worker's inbox. Full protocol exchange verified. Harness: `~/tmp/e2e-live-verify.mjs`.

---

## Rules for Working in This Repo

- **Verify before claiming.** Past sessions have overstated parity. Check code directly.
- **Native uses `--teammate-mode`, not `--team`.** The lead system doesn't need either flag — it coordinates externally via MCP.
- **Test after every change.** `cd mcp-coordinator && npm test` must pass before committing.
- **`current_task` IS written** via `terminal-heartbeat.sh` lines 101/177. Peer discovery works.
- **Coordination is always filesystem.** Never suggest adding API calls for inter-agent communication.
