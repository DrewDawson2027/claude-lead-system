<div align="center">

# Claude Lead System

### Your Claude Code terminals can now talk to each other — for free.

[![CI](https://github.com/DrewDawson2027/claude-lead-system/actions/workflows/ci.yml/badge.svg)](https://github.com/DrewDawson2027/claude-lead-system/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#platform-support)
[![Stars](https://img.shields.io/github/stars/DrewDawson2027/claude-lead-system?style=social)](https://github.com/DrewDawson2027/claude-lead-system/stargazers)

**Multi-agent Claude Code orchestration. Zero API tokens. One command.**

[**Install in 10 seconds →**](#installation) · [**See how it works →**](#how-it-works) · [**Contributing →**](CONTRIBUTING.md)

</div>

---

> **Type `/lead` in any Claude Code session.**
> It instantly becomes a project lead that sees every other Claude terminal, knows what they're doing, and can message them, wake them, spawn new workers, detect file conflicts, and run multi-step pipelines — **using zero API tokens for coordination.**

---

## The Problem

You're running 3 Claude Code terminals in parallel. They're **completely blind to each other.**

- Terminal B overwrites the file Terminal A just edited.
- Terminal C duplicates work Terminal A already finished.
- You spend your own tokens babysitting all of them.

There's no native way to coordinate multiple Claude Code sessions. Until now.

## The Solution

`claude-lead-system` wires every terminal together through shell hooks and a lightweight filesystem protocol — **completely outside the context window**.

```
Terminal A (lead)          Terminal B (coding)       Terminal C (testing)
      │                          │                          │
      ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Shell Hooks  (0 API tokens)                     │
│  PostToolUse  → terminal-heartbeat.sh  → enriches session JSON     │
│  PreToolUse   → check-inbox.sh         → delivers messages          │
│  SessionStart → session-register.sh    → registers new sessions     │
│  SessionEnd   → session-end.sh         → marks sessions closed      │
└─────────────────────────────────────────────────────────────────────┘
      │                          │                          │
      ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ~/.claude/terminals/                           │
│  session-*.json   → live state: tool counts, files, recent ops     │
│  activity.jsonl   → universal append-only activity log             │
│  inbox/           → per-session message queues                      │
│  results/         → autonomous worker output files                  │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│               MCP Coordinator (optional — enhances)                 │
│  coord_spawn_worker     → autonomous workers via claude -p          │
│  coord_wake_session     → AppleScript / inbox injection             │
│  coord_detect_conflicts → file overlap detection                    │
│  coord_run_pipeline     → multi-step sequential task chains         │
└─────────────────────────────────────────────────────────────────────┘
```

**The hooks run outside the context window.** No tokens. No cost. No latency.

---

## Demo

> 🎬 **[Demo GIF / video coming soon]** — want to contribute one? See [CONTRIBUTING.md](CONTRIBUTING.md).

**Boot sequence** — type `/lead` and get a live dashboard of all running terminals:

```
## Sessions (3) — Platform: darwin

| Session  | TTY         | Project  | Status | Last Active | W/E/B/R  | Recent Files          |
|----------|-------------|----------|--------|-------------|----------|-----------------------|
| a1b2c3d4 | /dev/ttys001| my-app   | active | 12s ago     | 0/5/12/3 | auth.ts, db.ts        |
| b5c6d7e8 | /dev/ttys002| my-app   | active | 34s ago     | 3/2/8/1  | tests/auth.test.ts    |
| c9d0e1f2 | /dev/ttys003| my-app   | idle   | 4m ago      | 0/0/2/12 | —                     |
```

**Send a message** to a terminal mid-task:
```
tell b5c6d7e8 to pause — a1b2c3d4 is already editing auth.ts
```

**Spawn an autonomous worker**:
```
run "refactor the payment module" in ~/my-app
```

**Run a pipeline** (steps run sequentially, each gets prior output):
```
pipeline: audit dependencies, fix vulnerabilities, update tests in ~/my-app
```

---

## What `/lead` Can Do

| Command | What happens |
|---|---|
| *(boot)* | Live dashboard of all active sessions with enriched metadata |
| `tell [session] to [task]` | Sends a message to an active terminal |
| `wake [session] with [message]` | Wakes an idle terminal (AppleScript on macOS, inbox everywhere else) |
| `run [task] in [dir]` | Spawns an autonomous `claude -p` worker |
| `pipeline: step1, step2, step3 in [dir]` | Runs a multi-step sequential pipeline |
| `conflicts` | Cross-references `files_touched` arrays — detects who's editing what |
| `spawn terminal in [dir]` | Opens a new interactive Claude Code terminal |
| `health check` | Validates all hooks, deps, and settings |

---

## Why Not Just Use [Other Multi-Agent Framework]?

| | **Claude Lead System** | Other multi-agent frameworks |
|---|---|---|
| API token cost per coordination message | **$0** | Varies (often $0.01–$0.10+) |
| Works with Claude Code's existing UI | **Yes** | Usually no |
| Requires a central server/process | **No** | Usually yes |
| Works in Cursor, VS Code, iTerm2 | **Yes** | No |
| Cross-platform (macOS/Windows/Linux) | **Yes** | Varies |
| Install complexity | **One curl command** | pip install + config + API keys |
| Runs outside the context window | **Yes** | No |

The key insight: **shell hooks fire on every tool call for free.** No other coordination system leverages this.

---

## Installation

### One-line install (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash
```

That's it. Type `/lead` in any Claude Code session.

### Manual install

```bash
# 1. Clone
git clone https://github.com/DrewDawson2027/claude-lead-system.git
cd claude-lead-system

# 2. Copy hooks, commands, and MCP coordinator
cp -r hooks/ ~/.claude/hooks/
cp -r commands/ ~/.claude/commands/
cp -r mcp-coordinator/ ~/.claude/mcp-coordinator/
chmod +x ~/.claude/hooks/*.sh

# 3. Install MCP coordinator dependencies
cd ~/.claude/mcp-coordinator && npm install

# 4. Add hooks to your settings
# Copy settings/settings.local.json to ~/.claude/settings.local.json
# or merge the hooks block into your existing file

# 5. Verify everything is working
bash ~/.claude/hooks/health-check.sh
```

### Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- `jq` (`brew install jq` / `apt install jq` / `choco install jq`)
- Node.js ≥ 18 (for MCP coordinator)
- `bash` · `python3` (optional guards)

---

## Platform Support

| Platform | Terminal Spawning | Session Waking | Messaging |
|---|---|---|---|
| **macOS — iTerm2** | Split panes + tabs | AppleScript by TTY | Inbox hooks |
| **macOS — Terminal.app** | New windows | AppleScript by title | Inbox hooks |
| **Windows — Windows Terminal** | Split panes + tabs (`wt`) | Inbox fallback | Inbox hooks |
| **Windows — PowerShell / cmd** | New windows | Inbox fallback | Inbox hooks |
| **Linux — gnome-terminal / konsole / kitty** | New windows / tabs | Inbox fallback | Inbox hooks |
| **Cursor / VS Code** | Background `claude -p` workers | Inbox fallback | Inbox hooks |

Inbox messaging via hooks is **universal** — works on every platform regardless of terminal emulator.

---

## How It Works

### Hooks run outside the context window

Every Claude Code tool call fires shell hooks. These maintain a live state file per session — writing `tool_counts`, `files_touched`, and `recent_ops` to a small JSON blob on every invocation. **This costs zero tokens.** The lead reads a few KB of JSON instead of parsing MBs of transcripts.

### Enriched session files

```json
{
  "session": "a1b2c3d4",
  "status": "active",
  "project": "my-app",
  "branch": "main",
  "tty": "/dev/ttys003",
  "schema_version": 2,
  "tool_counts": { "Write": 12, "Edit": 8, "Bash": 23, "Read": 5 },
  "files_touched": ["src/auth.ts", "src/db.ts", "tests/auth.test.ts"],
  "recent_ops": [
    { "tool": "Edit", "file": "src/auth.ts", "ts": "2026-02-19T14:32:01Z" }
  ]
}
```

### Rate-limited heartbeat

The heartbeat has a 5-second cooldown per session. Between full beats only the activity log is appended (cheap). Stale detection runs at most once per 60 seconds.

### MCP is optional

The filesystem protocol works without the MCP coordinator. The coordinator adds `spawn_worker`, `wake_session`, `run_pipeline`, and `detect_conflicts` — but core messaging and awareness works the moment you install the hooks.

### Token guard

`token-guard.py` prevents runaway agent spawning: max 3 agents per session, max 1 of each type, 30-second parallel spawn window. All configurable.

---

## Components

| File | Role |
|---|---|
| `hooks/terminal-heartbeat.sh` | Rate-limited PostToolUse hook — enriches session JSON with tool counts, files, recent ops |
| `hooks/session-register.sh` | SessionStart hook — registers sessions with TTY, branch, cwd |
| `hooks/check-inbox.sh` | PreToolUse hook — surfaces messages from lead/other terminals |
| `hooks/session-end.sh` | SessionEnd hook — marks closed, preserves final metadata |
| `hooks/health-check.sh` | Manual validator — checks all hooks, deps, and settings |
| `hooks/token-guard.py` | PreToolUse guard — enforces agent spawn limits (max 3/session) |
| `hooks/read-efficiency-guard.py` | PostToolUse advisor — warns about sequential read patterns |
| `commands/lead.md` | The `/lead` slash command prompt |
| `mcp-coordinator/index.js` | MCP server — spawn workers, wake sessions, run pipelines |
| `settings/settings.local.json` | Reference settings file with all hooks wired |

---

## Key Design Decisions

**Zero API tokens for coordination.** Hooks are shell scripts. They run outside the Claude context window. Coordination is free.

**Enriched session files eliminate transcript parsing.** Reading 3KB of JSON per session is orders of magnitude cheaper than parsing a transcript to infer state.

**Rate-limited heartbeat.** 5-second cooldown prevents IO storms on busy sessions.

**Schema versioned.** `schema_version` in session files enables non-breaking migrations.

**MCP is optional.** The file-based layer works standalone. MCP adds power-user features on top.

**AppleScript + inbox fallback.** Wake sessions natively on macOS; fall back to inbox injection everywhere else.

---

## Star History

If this saved you tokens or helped you ship faster — a ⭐ goes a long way and helps others find it.

[![Star History Chart](https://api.star-history.com/svg?repos=DrewDawson2027/claude-lead-system&type=Date)](https://star-history.com/#DrewDawson2027/claude-lead-system&Date)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — especially for:

- **Demo GIF** — a screen recording of `/lead` booting and sending a message would go a long way
- Windows-native `coord_wake_session` (currently inbox-fallback only)
- `tmux` / `zellij` split pane support
- Additional hook tests

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**Found this useful? [⭐ Star it](https://github.com/DrewDawson2027/claude-lead-system/stargazers) · [🐛 Report a bug](https://github.com/DrewDawson2027/claude-lead-system/issues/new?template=bug_report.md) · [💡 Request a feature](https://github.com/DrewDawson2027/claude-lead-system/issues/new?template=feature_request.md)**

*Share this with anyone running multiple Claude Code sessions in parallel.*

</div>
