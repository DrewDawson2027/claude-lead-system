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

## Parity Status (as of 2026-03-06): ~60–65%

| Native Agent Teams Feature                                  | Lead System                                  | Gap                                |
| ----------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| Worker spawn + kill                                         | coord_spawn_worker                           | Done                               |
| Task create/assign/list                                     | coord_create/list/update_task                | Done                               |
| Cross-session messaging                                     | coord_send_message (resolves name → session) | Done                               |
| Broadcast to all workers                                    | coord_broadcast                              | Done                               |
| Shutdown protocol                                           | coord_send_protocol + shutdown.js            | Done                               |
| Plan approval workflow                                      | coord_send_protocol + approval.js            | Done                               |
| Peer discovery                                              | coord_discover_peers                         | Done                               |
| Real-time tmux delivery                                     | tmuxSendKeys() in messaging.js               | Done                               |
| Token enforcement                                           | token-guard.py (7 rules)                     | Lead-exclusive                     |
| Conflict detection                                          | conflict-guard.sh                            | Lead-exclusive                     |
| **P2P direct messaging**                                    | **Scaffolded only — ~5%**                    | **`--team` flag missing from CLI** |
| Native `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` integration | Bridge exists                                | Blocked on API stabilization       |

### Critical open gap: `current_task` field

`coord_discover_peers` resolves worker session IDs by matching `session.current_task === meta.task_id`. If `current_task` is not written to the session JSON during spawn/heartbeat, peer discovery shows `—` for all session IDs. Verify this field is written in `workers.js` heartbeat before shipping peer discovery as complete.

---

## Key Modules

| File                       | Purpose                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `mcp-coordinator/index.js` | Entry point. Exports `__test__` API for integration tests.                                                       |
| `lib/messaging.js`         | `resolveWorkerName()`, `handleSendMessage()`, `handleBroadcast()`, `handleSendProtocol()`, `queueNativeAction()` |
| `lib/sessions.js`          | `handleDiscoverPeers()` — scans `*.meta.json` in RESULTS_DIR, links via `current_task`                           |
| `lib/workers.js`           | Spawn, kill, resume. Role presets, budget gating, worktree isolation                                             |
| `lib/platform/common.js`   | Cross-platform terminal launch. **`--team` flag is a TODO here**                                                 |
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
2. Workers can message each other by name without lead relay (P2P) — blocked on `--team` CLI flag
3. Token cost for a 2-worker task is 75–80% less than the equivalent native Agent Teams run
4. `coord_discover_peers` returns live session IDs for all active workers (requires `current_task` in heartbeat)
5. Native Agent Teams env var integration works end-to-end in hybrid mode

Until `--team` ships in the CLI, items 2 and 5 are externally blocked. Items 1, 3, and 4 are achievable now.

---

## Rules for Working in This Repo

- **Verify before claiming.** Past sessions have overstated parity. Check code directly.
- **Never overstate the `--team` flag.** It does not exist in CLI v2.1.70. Hybrid mode is aspirational.
- **Test after every change.** `cd mcp-coordinator && npm test` must pass before committing.
- **Check `current_task` before touching peer discovery.** Grep `workers.js` for `current_task` to confirm it's written during spawn/heartbeat.
- **Coordination is always filesystem.** Never suggest adding API calls for inter-agent communication.
