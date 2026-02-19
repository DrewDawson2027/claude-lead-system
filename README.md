<div align="center">

# Claude Lead System

**Multi-agent Claude Code orchestration. Zero API tokens. One command.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](https://github.com/DrewDawson2027/claude-lead-system)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-orange)](https://claude.ai/code)

</div>

---

> **Type `/lead` in any Claude Code session.**
> It instantly becomes a project lead that sees every other Claude terminal, knows what they're doing, and can message them, wake them, spawn new workers, detect file conflicts, and run multi-step pipelines — **using zero API tokens for coordination.**

---

## Why This Exists

When you run multiple Claude Code terminals in parallel, they're blind to each other. They step on the same files. They duplicate work. You spend your own tokens babysitting them.

`claude-lead-system` fixes this by wiring every terminal together through shell hooks and a lightweight filesystem protocol — **completely outside the context window**.

```
Terminal A (lead)          Terminal B (coding)       Terminal C (testing)
      │                          │                          │
      ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Shell Hooks (0 API tokens)                      │
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

---

## What `/lead` Can Do

| Command | What happens |
|---|---|
| *(boot)* | Scans all sessions, shows live dashboard |
| `tell [session] to [task]` | Sends a message to an active terminal |
| `wake [session] with [message]` | Wakes an idle terminal (AppleScript on macOS, inbox fallback everywhere else) |
| `run [task] in [dir]` | Spawns an autonomous `claude -p` worker |
| `pipeline: task1, task2, task3 in [dir]` | Runs a multi-step sequential pipeline |
| `conflicts` | Cross-references `files_touched` arrays across all sessions |
| `spawn terminal in [dir]` | Opens a new interactive Claude Code terminal |
| `kill worker [id]` | Terminates a running worker |
| `health check` | Validates all hooks, deps, and settings |

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

Inbox messaging via hooks is **universal** — it works on every platform regardless of terminal emulator.

---

## Installation

### One-line install (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash
```

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

# 6. Done — type /lead in any Claude Code session
```

---

## How It Works

### Hooks run outside the context window

Every Claude Code tool call fires shell hooks. These hooks maintain a live state file per session — writing `tool_counts`, `files_touched`, and `recent_ops` to a small JSON blob on every tool invocation. **This costs zero tokens.** The lead reads a few KB of JSON instead of parsing MB of transcripts.

### Enriched session files

```json
{
  "session": "a1b2c3d4",
  "status": "active",
  "project": "my-app",
  "branch": "main",
  "cwd": "/Users/you/my-app",
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

The heartbeat has a 5-second cooldown per session. Between full beats, only the activity log is appended (cheap). Stale detection runs max once per 60 seconds.

### MCP is optional

The filesystem protocol (session JSONs, inbox files, activity log) works without the MCP coordinator. The coordinator adds `spawn_worker`, `wake_session`, `run_pipeline`, and `detect_conflicts` — but the core messaging and awareness layer works the moment you install the hooks.

---

## Components

| File | Role |
|---|---|
| `hooks/terminal-heartbeat.sh` | Rate-limited PostToolUse hook — enriches session JSON |
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

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- `jq` (`brew install jq` / `apt install jq` / `choco install jq`)
- Node.js ≥ 18 (for MCP coordinator)
- `bash` (hooks)
- `python3` (optional guards)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — especially for:
- Windows-native `coord_wake_session` (currently inbox-fallback only)
- `tmux` / `zellij` split pane support
- Tests for hooks

---

## License

MIT — see [LICENSE](LICENSE).
