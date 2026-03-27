# Claude Lead System — CLAUDE.md

## Mission

Build and maintain a local coordination layer around Claude Code. The strongest truthful public category is "local coordination layer for Claude Code," not agent framework parity or native-team replacement. Do not claim exact UX parity, exact feature parity, or any universal cost delta without fresh evidence for the specific workflow being discussed.

The user does not write code. Everything in this repo was built through Claude Code. Keep that in mind: prioritize clarity in explanations, verify before claiming anything works, and never overstate parity.

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

---

## Key Modules

| File                       | Purpose                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `mcp-coordinator/index.js` | Entry point. Exports `__test__` API for integration tests.                                                       |
| `lib/messaging.js`         | `resolveWorkerName()`, `handleSendMessage()`, `handleBroadcast()`, `handleSendProtocol()`, `queueNativeAction()` |
| `lib/sessions.js`          | `handleDiscoverPeers()` — scans `*.meta.json` in RESULTS_DIR, links via `current_task`                           |
| `lib/workers.js`           | Worker output queries, active worker summaries, result retrieval                                                 |
| `lib/platform/common.js`   | Cross-platform utilities: terminal detection, process management, tmux messaging                                 |
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
# Run all tests (284 coordinator + 310 sidecar + 223 hooks = 817 total, must stay green)
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

## E2E Verification Checklist

### Status Summary (as of 2026-03-17)

Spawning tools removed — E1 (agent resume) no longer applies. E2 and E3 remain verified.

| Scenario          | Status                                    |
| ----------------- | ----------------------------------------- |
| E2: P2P Messaging | ✅ verified (cross-process, 7/7 tests)    |
| E3: Plan Approval | ✅ verified (11/11 tests, full lifecycle) |

## Rules for Working in This Repo

- **Verify before claiming.** Past sessions have overstated parity. Check code directly.
- **Native uses `--teammate-mode`, not `--team`.** The lead system doesn't need either flag — it coordinates externally via MCP.
- **Test after every change.** `cd mcp-coordinator && npm test` must pass before committing.
- **`current_task` IS written** via `terminal-heartbeat.sh` lines 101/177. Peer discovery works.
- **Coordination is always filesystem.** Never suggest adding API calls for inter-agent communication.

---

## Project

- **What it is:** Local coordination layer for multi-terminal Claude Code workflows — conflict detection, cross-terminal messaging, and task governance via filesystem hooks and 48 MCP tools, zero token cost.
- **Stack:** Node.js (ESM), Python 3 (hooks layer), npm workspaces (`mcp-coordinator`, `sidecar`), ruff, shellcheck, pytest
- **Repo:** https://github.com/DrewDawson2027/claude-lead-system.git
- **npm package:** `claude-lead-system` v1.0.0

---

## Architecture

| Directory          | Contents                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `mcp-coordinator/` | MCP server — 48 tools for coordination, messaging, task management, conflict detection   |
| `sidecar/`         | Native bridge (TypeScript) — experimental path for sidecar-mode coordination             |
| `hooks/`           | Shell + Python hooks that fire on every Claude tool call (0 tokens, filesystem-only)     |
| `agents/`          | Agent definition markdown files (master-coder, master-architect, role-implementer, etc.) |
| `commands/`        | Slash command definitions (cycle, lead, etc.)                                            |
| `lead-tools/`      | Lead-specific tooling scripts                                                            |
| `modes/`           | Mode configuration files                                                                 |
| `scripts/`         | CI audit scripts, release tooling, proof scripts, coverage checks                        |
| `bench/`           | A/B harness, workflow benchmarks, demo scenarios                                         |
| `docs/`            | Architecture, API contract, runbooks, release checklists, compatibility matrix           |
| `assets/`          | SVGs, GIFs, social preview images                                                        |
| `tests/`           | Hook smoke tests, integration test scripts                                               |

---

## Environment Variables

| Variable                              | Default  | Purpose                                                         |
| ------------------------------------- | -------- | --------------------------------------------------------------- |
| `COORDINATOR_TEST_MODE`               | `0`      | Set to `1` to run tests without live tmux/terminal dependencies |
| `COORDINATOR_PLATFORM`                | auto     | Override platform detection (`linux`, `darwin`)                 |
| `COORDINATOR_CLAUDE_BIN`              | `claude` | Path to Claude binary                                           |
| `COORDINATOR_WORKER_BUDGET_TOKENS`    | `60000`  | Per-worker token budget cap                                     |
| `COORDINATOR_GLOBAL_BUDGET_TOKENS`    | `240000` | Global token budget across all workers                          |
| `COORDINATOR_GLOBAL_BUDGET_POLICY`    | —        | Budget enforcement policy                                       |
| `COORDINATOR_MAX_ACTIVE_WORKERS`      | `8`      | Max concurrent workers                                          |
| `COORDINATOR_MAX_MESSAGE_BYTES`       | `8192`   | Max bytes per inbox message                                     |
| `COORDINATOR_MAX_INBOX_LINES`         | `500`    | Max lines in inbox before truncation                            |
| `COORDINATOR_MAX_MESSAGES_PER_MINUTE` | `120`    | Rate limit for messaging                                        |
| `LEAD_AB_HARNESS_SUMMARY`             | —        | Path to A/B harness summary JSON (bench only)                   |
| `LEAD_AB_HARNESS_ROOT`                | —        | Root dir for A/B harness output (bench only)                    |

---

## Current Focus

Recent commits are README/presentation work: tier-1 design overhaul (hero placement, badges, story layout, Tokyo Night palette). Core coordinator code and test suite are stable at 817 tests passing.
