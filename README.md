<div align="center">

# Claude Lead System

### One control room for all your Claude Code terminals.

Detect file conflicts before they collide. Spawn, redirect, and message workers. Run tracked multi-step pipelines. All from a single local coordinator — no API tokens spent on coordination.

<!-- ![demo](demo.gif) -->

[![Tests](https://img.shields.io/badge/tests-618%20passing-brightgreen)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![Coverage](https://img.shields.io/badge/coverage-87.8%25-green)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Why you'd use it:**

- You run 3+ Claude terminals and need one place to see what each is touching
- You've had two sessions clobber the same file — and want to prevent it
- You want to redirect, wake, or spawn workers without opening a new window

```bash
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system && bash install.sh
```

</div>

---

## Quick Start

```bash
# 1. Install
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system && bash install.sh

# 2. Launch
claudex

# 3. Enter coordinator mode
/lead
```

You'll see a live dashboard of every active Claude terminal — what it's working on, what files it's touching, and whether any two sessions are about to collide.

**Common MCP tools (usable from any Claude session):**

```bash
coord_spawn_worker    # Start a new Claude worker on a task
coord_watch_output    # Stream a worker's live output
coord_send_message    # Send instructions to a named worker
```

---

## What It Does

| Feature                          | What It Does                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------ |
| **Pre-edit conflict detection**  | Flags when two sessions are about to edit the same file — before the collision |
| **Conflict lifecycle tracking**  | Track, resolve, and recheck conflicts across sessions                          |
| **Worker spawn + kill + resume** | Start, stop, and re-enter workers from one control point                       |
| **P2P worker messaging**         | Workers send messages directly to named peers via inbox files                  |
| **Broadcast**                    | Send one message to all active workers simultaneously                          |
| **Operator dashboard**           | Live table: session, status, branch, files touched, last active                |
| **Plan approval protocol**       | Workers pause in plan mode; lead approves before execution                     |
| **Pipeline orchestration**       | Run lint → test → build tracked from one place                                 |
| **Budget gating**                | Cap tokens or turns per worker before spawning                                 |
| **Zero API-token coordination**  | Filesystem carries coordination — no token cost for inter-worker comms         |
| **Session resumption**           | Re-enter a prior Claude conversation, not a fresh start                        |
| **Context store**                | Shared key/value store accessible to all workers in a session                  |
| **Worktree isolation**           | Each worker can run in its own git branch — no conflicts                       |
| **Activity audit log**           | Append-only record of every coordination event                                 |
| **60+ MCP tools**                | Full tool surface for coordination, governance, and orchestration              |

---

## Lead vs. Native Agent Teams

| Capability                              | Native Agent Teams | Lead System |
| --------------------------------------- | ------------------ | ----------- |
| Pre-edit conflict detection             | —                  | ✅ verified |
| Operator dashboard (all sessions)       | —                  | ✅ verified |
| Zero API-token coordination path        | —                  | ✅ verified |
| Budget/spawn/approval governance        | —                  | ✅ verified |
| In-context teammate lifecycle           | ✅ verified        | partial     |
| First-party cross-platform UX           | ✅ verified        | partial     |
| Minimum-setup (no external coordinator) | ✅ verified        | —           |

Use Lead when you need conflict detection, observability, and governance across 4+ terminals.
Use Native Agent Teams for 1-2 collaborators where first-party UX matters most.

---

## By the Numbers

- **618** automated tests passing
- **87.8%** test coverage
- **60+** MCP coordination tools
- **22** lib modules
- **Zero** API tokens spent on coordination (filesystem path)

---

## The Story

> _"I'm a Philosophy, Politics & Economics student at USC. I've never written a line of code in my life. I built this entire system — 60+ tools, 716 tests, SLSA supply chain security — entirely through Claude Code."_

→ [Twitter thread](#) _(coming soon)_

---

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- Node.js ≥ 18
- `jq` (`brew install jq` / `apt install jq`)
- `bash`, `python3`

## More

- [Docs](docs/) — architecture, API contract, MCP tool reference
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)

**Author:** Drew Dawson — [@DrewDawson2027](https://github.com/DrewDawson2027)

MIT License
