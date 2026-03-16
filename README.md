<div align="center">

# Claude Lead System

### One control room for all your Claude Code terminals.

<div align="center">
<img src="demo.gif" alt="Claude Lead System — live demo: real test suite, conflict detection, health check" width="800" />
</div>

Detect file conflicts before they collide. Spawn, redirect, and message workers. Run tracked multi-step pipelines. All from a single local coordinator — no API tokens spent on coordination.

[![Tests](https://img.shields.io/badge/tests-847%20passing-brightgreen)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![Coverage](https://img.shields.io/badge/coverage-85%25%20lines-green)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## The Problem

Two Claude terminals. Same file. Neither knows the other is there.

```
Terminal A: editing src/auth/login.ts
Terminal B: editing src/auth/login.ts  ← collision in 3... 2... 1...
```

One overwrites the other. You find out when the build breaks.

**With Lead:**

```
Lead: "check conflicts"
→ CONFLICT: login.ts — terminal-a (editing) ↔ terminal-b (editing)
→ Both sessions notified. Collision blocked.
```

---

## Quick Start

### Quick (npm)

```bash
npm install -g claude-lead-system && claudex
```

### Standard (git)

```bash
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system && bash install.sh
claudex
```

### Try without installing (Docker)

```bash
docker run -it ghcr.io/drewdawson2027/claude-lead-system
```

Then in any install method, enter coordinator mode:

```bash
/lead
```

You'll see a live dashboard of every active Claude terminal — what it's working on, what files it's touching, and whether any two sessions are about to collide.

**Why you'd use it:**

- You run 3+ Claude terminals and need one place to see what each is touching
- You've had two sessions clobber the same file — and want to prevent it
- You want to redirect, wake, or spawn workers without opening a new window

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
| **Live output streaming**        | Worker output streamed via SSE — <1ms teammate switching in TUI                |
| **Activity audit log**           | Append-only record of every coordination event                                 |
| **81 MCP tools**                 | Full tool surface for coordination, governance, and orchestration              |

---

## Lead vs. Native Agent Teams

| Capability                              | Native Agent Teams | Lead System |
| --------------------------------------- | ------------------ | ----------- |
| Pre-edit conflict detection             | —                  | ✅ verified |
| Operator dashboard (all sessions)       | —                  | ✅ verified |
| Zero API-token coordination path        | —                  | ✅ verified |
| Budget/spawn/approval governance        | —                  | ✅ verified |
| In-process worker output streaming      | —                  | ✅ verified |
| In-context teammate lifecycle           | ✅ verified        | ✅ verified |
| First-party cross-platform UX           | ✅ verified        | partial     |
| Minimum-setup (no external coordinator) | ✅ verified        | —           |

Use Lead when you need conflict detection, observability, and governance across 4+ terminals.
Use Native Agent Teams for 1-2 collaborators where first-party UX matters most.

---

## By the Numbers

- **847** automated tests (480 coordinator + 308 sidecar + 59 Python hooks)
- **85%** line coverage (coordinator + sidecar)
- **81** MCP coordination tools
- **24** lib modules
- **Zero** API tokens spent on coordination (filesystem path)
- **8/8** macOS platform proofs passing · **8/8** Linux platform proofs passing

---

## The Story

> _"I'm a Philosophy, Politics & Economics student at USC. I've never written a line of code in my life. I built this entire system — 81 tools, 847 tests, SLSA supply chain security — entirely through Claude Code."_

---

## Platform Support

| Platform | Status       | Notes                                                                                               |
| -------- | ------------ | --------------------------------------------------------------------------------------------------- |
| macOS    | Verified     | Full support. iTerm2 or tmux recommended for split-pane. 8/8 proofs passing.                        |
| Linux    | Verified     | 8/8 proofs passing. Requires bash + tmux. See [compatibility matrix](docs/COMPATIBILITY_MATRIX.md). |
| Windows  | Experimental | Advisory CI. Some features may not work.                                                            |

**Requirements:** Node.js 18+, bash (macOS/Linux), Python 3.10+ (for hooks)

---

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- Node.js ≥ 18
- `jq` (`brew install jq` / `apt install jq`)
- `bash`, `python3`

> Docker users: all dependencies are bundled in the image.

## More

- [Getting Started](docs/GETTING_STARTED.md) — step-by-step first use walkthrough
- [Docs](docs/) — architecture, API contract, MCP tool reference
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)

**Author:** Drew Dawson — [@DrewDawson2027](https://github.com/DrewDawson2027)

MIT License
