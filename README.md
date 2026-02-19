# Claude Lead System

Cross-platform orchestration layer for Claude Code terminals. Zero-token coordination via hooks, an MCP server, and enriched session metadata.

## What This Does

Type `/lead` in any Claude Code session to turn it into a project lead that can:
- See all running Claude Code terminals and what they're doing
- Send messages to active terminals
- Wake up idle terminals
- Spawn new worker terminals (autonomous or interactive)
- Detect file conflicts between terminals
- Run multi-step pipelines
- Health-check the entire system

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Terminal A      │     │  Terminal B      │     │  Terminal C      │
│  (lead session)  │     │  (coding)        │     │  (testing)       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Shell Hooks (0 API tokens)                     │
│  PostToolUse: terminal-heartbeat.sh → enriches session JSON      │
│  PreToolUse:  check-inbox.sh → delivers messages                 │
│  SessionStart: session-register.sh → registers new sessions      │
│  SessionEnd:  session-end.sh → marks sessions closed             │
└──────────────────────────────────────────────────────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                   ~/.claude/terminals/                            │
│  session-*.json  → enriched session state (tool counts, files,   │
│                    recent ops, TTY, plan file)                    │
│  activity.jsonl  → universal activity log                        │
│  inbox/          → per-session message queues                    │
│  results/        → worker output files                           │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│              MCP Coordinator (optional, enhances)                 │
│  coord_spawn_worker   → autonomous workers (claude -p)           │
│  coord_wake_session   → AppleScript/inbox injection              │
│  coord_detect_conflicts → file overlap detection                 │
│  coord_run_pipeline   → multi-step sequential tasks              │
└──────────────────────────────────────────────────────────────────┘
```

## Cross-Platform Support

| Platform | Terminal Spawning | Session Waking | Messaging |
|----------|------------------|----------------|-----------|
| **macOS - iTerm2** | Split panes + tabs | AppleScript by TTY | Inbox hooks |
| **macOS - Terminal.app** | New windows | AppleScript by title | Inbox hooks |
| **Windows - Windows Terminal** | Split panes + tabs (`wt`) | Inbox fallback | Inbox hooks |
| **Windows - PowerShell/cmd** | New windows | Inbox fallback | Inbox hooks |
| **Linux - gnome-terminal/konsole/kitty** | New windows/tabs | Inbox fallback | Inbox hooks |
| **Cursor / VS Code** | Background workers | Inbox fallback | Inbox hooks |

Inbox messaging (via hooks) works universally on every platform.

## Installation

1. Copy files to your `~/.claude/` directory:

```bash
cp -r hooks/ ~/.claude/hooks/
cp -r commands/ ~/.claude/commands/
cp -r mcp-coordinator/ ~/.claude/mcp-coordinator/
chmod +x ~/.claude/hooks/*.sh
```

2. Install MCP coordinator dependencies:

```bash
cd ~/.claude/mcp-coordinator && npm install
```

3. Add hooks to your `~/.claude/settings.local.json` (see `settings/settings.local.json` for reference).

4. Run the health check:

```bash
bash ~/.claude/hooks/health-check.sh
```

5. Type `/lead` in any Claude Code session.

## Key Design Decisions

- **Zero API tokens for coordination.** Hooks are shell scripts that run outside the Claude context window. They cost nothing.
- **Enriched session files eliminate transcript parsing.** The heartbeat writes tool_counts, files_touched, and recent_ops to the session JSON on every tool call. The lead reads a few KB of JSON instead of parsing MB of transcripts.
- **Rate-limited heartbeat.** Max 1 full session update per 5 seconds. Stale-check runs max 1x per 60 seconds. Activity log writes on every call (it's just an append).
- **Schema versioned.** Session files include `schema_version` for future migration.
- **MCP is optional.** The file-based system (session JSONs, inbox files, activity log) works without the MCP coordinator. The coordinator adds convenience (spawn workers, wake sessions) but isn't required.

## Components

| File | Purpose |
|------|---------|
| `hooks/terminal-heartbeat.sh` | Enriches session JSON with tool counts, files touched, recent ops. Rate-limited. |
| `hooks/session-register.sh` | Registers new sessions on SessionStart |
| `hooks/check-inbox.sh` | Delivers messages before each tool call |
| `hooks/session-end.sh` | Marks sessions closed, preserves metadata |
| `hooks/health-check.sh` | Validates all hooks, deps, and settings |
| `hooks/token-guard.py` | Enforces agent spawn limits (max 5/session) |
| `hooks/read-efficiency-guard.py` | Warns about sequential reads |
| `commands/lead.md` | The `/lead` skill prompt |
| `mcp-coordinator/index.js` | MCP server for spawning workers, waking sessions, pipelines |

## License

MIT
