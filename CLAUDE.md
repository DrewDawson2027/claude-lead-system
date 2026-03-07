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

## Parity Status (as of 2026-03-06): ~70%

Verified against [official Agent Teams docs](https://code.claude.com/docs/en/agent-teams) and CLI v2.1.71.
Full assessment: `~/.claude/agents/revisions/2026-03-06/first-round-revisions.md`

| Native Agent Teams Feature           | Lead System                                            | Parity  | Notes                                            |
| ------------------------------------ | ------------------------------------------------------ | ------- | ------------------------------------------------ |
| TeamCreate                           | coord_create_team + coord_spawn_worker                 | 85%     | Works, but separate calls vs native atomic       |
| Shared Task List + Dependencies      | tasks.js with blocked_by + file locking                | 90%     | Done — dependencies, locking, 3 states           |
| **Self-Claim (auto-pick next task)** | **Not implemented**                                    | **0%**  | **Workers exit after completion, no task loop**  |
| SendMessage Protocol (5 types)       | coord_send_message + broadcast + send_protocol         | 95%     | All 5 native types mapped                        |
| Push Message Delivery                | tmuxSendKeys() + inbox polling fallback                | 85%     | ~85% in tmux, ~50% non-tmux                      |
| **In-Process Display Mode**          | **Not possible — architectural limit**                 | **0%**  | **Requires Claude Code runtime internals**       |
| Split-Pane Display (tmux)            | spawnTmuxPaneWorker() + auto-tile                      | 95%     | Nearly identical to native split-pane            |
| Idle Notifications                   | Exit trap (instant) + idle detector (3-5s) + heartbeat | 93%     | Completion instant, mid-task 3-5s lag            |
| Agent Resume                         | --session-id at spawn + --resume on resume             | 90%     | Code exists, needs end-to-end verification       |
| Peer Discovery                       | coord_discover_peers + meta scan                       | 90%     | current_task written via heartbeat hook          |
| Bidirectional Communication          | Env vars + worker instruction block                    | 80%     | Workers have tools, not verified end-to-end      |
| Plan Approval Workflow               | coord_send_protocol + approval.js                      | 85%     | Protocol exists, e2e not verified                |
| Permission Modes (6 native)          | 8 modes but missing `auto`                             | 90%     | Has 5 original + 2 extras, missing `auto`        |
| Team Cleanup                         | coord_delete_team with clean_tasks                     | 85%     | No active-teammate check before deletion         |
| **Quality Gate Hooks**               | **teammate-lifecycle.sh — telemetry only**             | **40%** | **Logs events, no exit-code-2 feedback pattern** |
| Task Auto-Unblock                    | Dependencies tracked, passive check                    | 75%     | Checked on query, not actively triggered         |
| Token enforcement                    | token-guard.py (7 rules)                               | N/A     | Lead-exclusive feature                           |
| Conflict detection                   | conflict-guard.sh                                      | N/A     | Lead-exclusive feature                           |

### Critical open gaps (3 blockers to higher parity)

1. **Self-Claim (0%)** — Workers exit after task completion. No mechanism to auto-pick next unblocked task. Needs `coord_claim_next_task` tool + exit-trap integration.
2. **In-Process Display (0%)** — Architectural limit. Native runs teammates inside same terminal with keyboard cycling. Cannot be emulated from MCP. Tmux pane mode is the closest equivalent.
3. **Quality Gate Hooks (40%)** — `teammate-lifecycle.sh` only logs. Needs exit-code-2 pattern to prevent completion / send feedback.

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
5. Workers auto-claim next unblocked task after completing (self-claim) — NOT YET IMPLEMENTED
6. Quality gate hooks prevent task completion when checks fail — NOT YET IMPLEMENTED

Items 1, 2, 3, 4 are achievable now. Item 5 (self-claim) is in progress. Item 6 (quality gates) is implemented.
In-process display mode (Shift+Up/Down in same terminal) is an architectural impossibility — tmux panes are the equivalent.

---

## E2E Verification Checklist (GAP 5 — manual one-time runs required)

Code paths exist but have not been verified end-to-end. Run once before declaring GAP 5 closed.

### E1: Agent Resume (`buildResumeWorkerScript`)
1. Spawn a worker on a task, note the session ID from its meta file
2. Kill the worker mid-task (`coord_kill_worker`)
3. Call `coord_resume_worker` with that `session_id`
4. Verify the resumed worker picks up from prior conversation context (not a fresh run)

### E2: Bidirectional Worker-to-Peer Messaging
1. Spawn two workers on the same team: `alpha`, `beta`
2. In alpha's task prompt, include: "call coord_send_message to target_name=beta with content=ping"
3. Verify `~/.claude/terminals/inbox/{beta_session_id}.jsonl` contains the message
4. Verify beta's tmux pane shows the injected message

### E3: Plan Approval Flow
1. Spawn a worker with `permission_mode: plan`
2. Worker enters plan mode and calls `coord_send_protocol type=plan_approval_request`
3. Lead receives the request via its inbox
4. Call approval endpoint; verify worker resumes execution

---

## Rules for Working in This Repo

- **Verify before claiming.** Past sessions have overstated parity. Check code directly.
- **Native uses `--teammate-mode`, not `--team`.** The lead system doesn't need either flag — it coordinates externally via MCP.
- **Test after every change.** `cd mcp-coordinator && npm test` must pass before committing.
- **`current_task` IS written** via `terminal-heartbeat.sh` lines 101/177. Peer discovery works.
- **Coordination is always filesystem.** Never suggest adding API calls for inter-agent communication.
