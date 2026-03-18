<div align="center">

# Claude Lead System

### One control room for all your Claude Code terminals.

<div align="center">
<img src="demo.gif" alt="Claude Lead System — live demo: real test suite, conflict detection, health check" width="800" />
</div>

Detect file conflicts before they collide. Message and coordinate across terminals. Persistent tasks, shared context, team management. All from a single local coordinator — no API tokens spent on coordination.

[![npm](https://img.shields.io/npm/v/claude-lead-system)](https://www.npmjs.com/package/claude-lead-system)
[![Tests](https://img.shields.io/badge/tests-614%20passing-brightgreen)](https://github.com/DrewDawson2027/claude-lead-system/actions)
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
- You want to redirect, wake, or message other terminals from one control room

**Common MCP tools (usable from any Claude session):**

```bash
coord_send_message    # Send instructions to any Claude terminal
coord_detect_conflicts # Check if two terminals are editing the same files
coord_boot_snapshot   # Live dashboard of all active terminals
coord_create_task     # Persistent task that survives sessions
```

---

## What It Does

| Feature                         | What It Does                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| **Pre-edit conflict detection** | Flags when two sessions are about to edit the same file — before the collision             |
| **Conflict lifecycle tracking** | Track, resolve, and recheck conflicts across sessions                                      |
| **Cross-terminal messaging**    | Send instructions to any Claude terminal by name or session ID                             |
| **P2P messaging**               | Terminals send messages directly to named peers via inbox files                            |
| **Broadcast**                   | Send one message to all active terminals simultaneously                                    |
| **Operator dashboard**          | Live table: session, status, branch, files touched, last active                            |
| **Plan approval protocol**      | Workers pause in plan mode; lead approves before execution                                 |
| **Persistent task board**       | Tasks survive sessions — track work across terminal restarts                               |
| **Team management**             | Create teams, assign tasks, track completion across terminals                              |
| **Zero API-token coordination** | Filesystem carries coordination — no token cost for inter-worker comms                     |
| **Agent templates**             | Define reusable agent configs with role presets                                            |
| **Context store**               | Shared key/value store accessible to all workers in a session                              |
| **Worktree isolation**          | Each worker can run in its own git branch — no conflicts                                   |
| **Worker output monitoring**    | Poll the latest N lines of any running worker's output on demand; use tmux for a live pane |
| **Activity audit log**          | Append-only record of every coordination event                                             |
| **35+ MCP tools**               | Full tool surface for coordination, governance, and orchestration                          |

---

## Lead vs. Native Agent Teams

| Capability                            | Native Agent Teams  | Lead System    |
| ------------------------------------- | ------------------- | -------------- |
| Pre-edit conflict detection           | —                   | ✅             |
| Persistent task board across sessions | —                   | ✅             |
| Shared context store                  | —                   | ✅             |
| Zero API-token coordination path      | —                   | ✅             |
| Cross-terminal messaging              | —                   | ✅             |
| Operator dashboard (all sessions)     | —                   | ✅             |
| Multiple simultaneous teams           | — (one per session) | ✅             |
| In-process teammate spawning          | ✅                  | —              |
| First-party cross-platform UX         | ✅                  | macOS verified |

**Use together:** Lead fills the gaps Agent Teams can't — persistent state, conflict detection, cross-session messaging. Use Agent Teams for in-process teammates, Lead for everything around them.

---

## By the Numbers

- **614** automated tests (304 coordinator + 310 sidecar)
- **85%** line coverage (coordinator + sidecar)
- **35+** MCP coordination tools
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
