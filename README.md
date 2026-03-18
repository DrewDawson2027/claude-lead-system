<div align="center">

<img src="assets/demo-hero.svg" alt="Claude Lead System — conflict detection, cross-terminal coordination" width="800" />

<br />

# Claude Lead System

**One control room for all your Claude Code terminals.**

[![npm](https://img.shields.io/npm/v/claude-lead-system?style=flat-square&color=8b5cf6)](https://www.npmjs.com/package/claude-lead-system)
[![Tests](https://img.shields.io/badge/tests-594_passing-22c55e?style=flat-square)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![Coverage](https://img.shields.io/badge/coverage-85%25-22c55e?style=flat-square)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)](https://opensource.org/licenses/MIT)

</div>

<br />

Two Claude terminals. Same file. Neither knows.

```
Terminal A → editing src/auth/login.ts
Terminal B → editing src/auth/login.ts  ← about to collide
```

One overwrites the other. You find out when the build breaks.

```
> /lead
→ ⚠ CONFLICT: login.ts — frontend ↔ backend
→ Both terminals notified. Collision blocked. 0 tokens used.
```

---

## Install

```bash
npm install -g claude-lead-system
```

Open Claude Code. Type `/lead`. Done — the coordinator wires into your Claude settings automatically on first run.

```bash
claude
> /lead
```

> Prefer git? `git clone https://github.com/DrewDawson2027/claude-lead-system.git && bash install.sh`

---

## What it does

**Conflict detection** — Flags when two terminals are about to edit the same file, before the collision. Both sessions notified automatically.

**Cross-terminal messaging** — Send instructions to any terminal by name from the lead session. No API tokens spent on coordination — the filesystem carries the message.

**Persistent task board** — Create tasks that survive session restarts. Assign, track, and complete across any terminal at any time.

**Live dashboard** — Every terminal's session, branch, current task, and active files in one view the moment you type `/lead`.

---

## MCP tools

Available from any Claude session after install:

```
coord_detect_conflicts    # flag when two terminals are editing the same file
coord_send_message        # send instructions to any terminal by name or ID
coord_boot_snapshot       # live dashboard — all active terminals at a glance
coord_create_task         # create a persistent task on the shared board
coord_broadcast           # send one message to all active terminals
```

48 tools total. Full reference → [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md)

---

## By the numbers

```
594 tests  ·  85% coverage  ·  48 MCP tools  ·  0 coordination tokens
macOS verified (8/8)  ·  Linux verified (8/8)
```

---

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- Node.js ≥ 18
- `jq` — `brew install jq` / `apt install jq`
- `bash`, `python3`

---

## The story

I'm a Philosophy, Politics & Economics student at USC — no prior programming background. I built this entire system through Claude Code. 48 tools. 594 tests. A complete local coordination layer for multi-terminal Claude workflows. All of it written in natural language.

---

## Docs

[Getting Started](docs/GETTING_STARTED.md) · [MCP Tool Reference](docs/MCP_TOOLS.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Security](docs/SECURITY.md) · [Contributing](CONTRIBUTING.md)

---

<div align="center">

MIT License · Made by [@DrewDawson2027](https://github.com/DrewDawson2027)

</div>
