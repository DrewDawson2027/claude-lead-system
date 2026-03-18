<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,100:161b22&height=220&section=header&text=Claude%20Lead%20System&fontSize=58&fontColor=e6edf3&animation=fadeIn&fontAlignY=40&desc=One%20control%20room%20for%20all%20your%20Claude%20Code%20terminals.&descAlignY=62&descSize=18&descColor=8b949e" />

<div align="center">

[![npm](https://img.shields.io/npm/v/claude-lead-system?style=flat-square&color=7aa2f7&labelColor=0d1117)](https://www.npmjs.com/package/claude-lead-system)
[![Tests](https://img.shields.io/badge/tests-594_passing-9ece6a?style=flat-square&labelColor=0d1117)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![Coverage](https://img.shields.io/badge/coverage-85%25-9ece6a?style=flat-square&labelColor=0d1117)](https://github.com/DrewDawson2027/claude-lead-system/actions)
[![License](https://img.shields.io/badge/license-MIT-bb9af7?style=flat-square&labelColor=0d1117)](https://opensource.org/licenses/MIT)

<br/>

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&size=16&duration=2500&pause=1000&color=7AA2F7&center=true&vCenter=true&width=500&lines=Conflict+detection+before+collision;Cross-terminal+messaging%2C+zero+tokens;Persistent+tasks+that+survive+restarts;Live+dashboard+for+all+terminals)](https://git.io/typing-svg)

</div>

---

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

## Install 📦

```bash
npm install -g claude-lead-system
```

Open Claude Code. Type `/lead`. Done — the coordinator wires itself into your Claude settings on first run.

```bash
claude
> /lead
```

> **Prefer git?** `git clone https://github.com/DrewDawson2027/claude-lead-system.git && bash install.sh`

---

## What It Does 🎯

If you've ever had two Claude sessions silently clobber each other's work and found out when the build exploded — this is for you.

**Conflict detection** — Flags when two terminals are about to edit the same file, before the collision. Both sessions get notified. You intervene. The build stays green.

**Cross-terminal messaging** — Tell any terminal what to do by name from the lead session. Zero API tokens — coordination runs on the filesystem, not through Claude's context window.

**Persistent task board** — Tasks survive terminal restarts. Close a session, reopen it, the board is exactly as you left it.

**Live dashboard** — Every active terminal, branch, files touched, last active. All of it the moment you type `/lead`.

**Plan approval protocol** — Workers pause before executing plans. Lead reviews and approves. You stay in control of what runs.

---

## Demo 🖥️

<div align="center">
  <img src="assets/demo-hero.svg" alt="Claude Lead System — conflict detection in action" width="700" />
</div>

---

## MCP Tools 🔧

Available from any Claude session after install:

```
coord_detect_conflicts    # flag files being edited by multiple terminals
coord_send_message        # send instructions to any terminal by name or ID
coord_boot_snapshot       # live dashboard of all active terminals
coord_create_task         # persistent task on the shared board
coord_broadcast           # message all active terminals at once
```

48 tools total — [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md)

---

## By the Numbers 📊

<div align="center">

| Metric              |                     |
| :------------------ | :------------------ |
| Tests               | **594 passing**     |
| Coverage            | **85%**             |
| MCP Tools           | **48**              |
| Coordination tokens | **0**               |
| Platforms           | **macOS ✓ Linux ✓** |

</div>

---

## The Story ✍️

I'm a Philosophy, Politics & Economics student at USC — no prior programming background. I built this entire system through Claude Code. 48 tools. 594 tests. A complete local coordination layer for multi-terminal Claude workflows. Every line written in natural language.

---

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- Node.js ≥ 18
- `jq` — `brew install jq` / `apt install jq`
- `bash`, `python3`

---

## Docs 📄

[Getting Started](docs/GETTING_STARTED.md) · [MCP Tool Reference](docs/MCP_TOOLS.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Security](docs/SECURITY.md) · [Contributing](CONTRIBUTING.md)

---

<div align="center">
  MIT License · Made by <a href="https://github.com/DrewDawson2027">@DrewDawson2027</a>
</div>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:161b22,100:0d1117&height=100&section=footer" />
