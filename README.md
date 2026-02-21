<div align="center">

# Claude Lead System

**Power tools for Claude Code Agent Teams. Conflict detection, activity logging, observability, and terminal orchestration — the features Agent Teams doesn't have.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/DrewDawson2027/claude-lead-system/actions/workflows/ci.yml/badge.svg)](https://github.com/DrewDawson2027/claude-lead-system/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](https://github.com/DrewDawson2027/claude-lead-system)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-orange)](https://claude.ai/code)

</div>

---

> **Type `/lead` in any Claude Code session.**
> It complements Claude Code's built-in Agent Teams with capabilities they lack: pre-edit file conflict detection, enriched session observability, native terminal tab spawning, sequential pipelines, and a universal activity log — **all running outside the context window at zero token cost.**

---

## Who Is This For

- **Solo devs running 2+ terminals** — see all sessions at a glance, avoid file conflicts, dispatch work without switching tabs
- **Team leads orchestrating multi-agent Claude Code** — `/lead` dashboard + workers + pipelines for complex builds
- **Power users who want pipelines** — sequential multi-step task chains with status tracking
- **Anyone evaluating multi-agent workflows** — the coordination layer Agent Teams doesn't provide

---

## Why This Exists

Claude Code's Agent Teams (`TeamCreate`, `SendMessage`, `TaskCreate`) handle messaging and task management well. But they can't:

- **Detect file conflicts before they happen** — no pre-edit cross-session awareness
- **Show what each session is actually doing** — tool counts, files touched, recent operations
- **Open native terminal tabs** — iTerm2 splits, gnome-terminal tabs, Windows Terminal panes
- **Run sequential multi-step pipelines** — ordered task chains with status tracking
- **Log activity across sessions** — append-only observability without token cost

`claude-lead-system` fills these gaps by wiring every terminal together through shell hooks and a lightweight filesystem protocol — **completely outside the context window**.

## Authorship and Provenance

- Author and maintainer: **Drew Dawson** (`@DrewDawson2027`)
- Canonical repository: `https://github.com/DrewDawson2027/claude-lead-system`
- Citation metadata: [CITATION.cff](CITATION.cff)
- Provenance verification guide: [docs/PROVENANCE.md](docs/PROVENANCE.md)
- Release checklist: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- Security model: [docs/SECURITY.md](docs/SECURITY.md)
- Release scripts: `scripts/release/preflight.sh`, `scripts/release/verify-release.sh`

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
| `wake [session] with [message]` | Wakes an idle terminal (sends Enter keystroke; message content delivered via inbox) |
| `run [task] in [dir]` | Spawns an autonomous `claude -p` worker |
| `pipeline: task1, task2, task3 in [dir]` | Runs a multi-step sequential pipeline |
| `conflicts` | Cross-references `files_touched` arrays across all sessions |
| `spawn terminal in [dir]` | Opens a new interactive Claude Code terminal |
| `kill worker [id]` | Terminates a running worker |
| `health check` | Validates all hooks, deps, and settings |

---

## 2-Minute Demo

```bash
# 1) Install
curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash

# 2) Open two Claude Code terminals in the same project
# 3) In terminal A, run /lead
# 4) In terminal A, send:
#    tell [session] to write tests for src/auth.ts
# 5) In terminal A, run:
#    conflicts
```

Expected:
- Session dashboard appears with live `W/E/B/R` counters
- Message is delivered through inbox hook
- Conflict checker reports overlap when both sessions touch same file

---

## Demo Assets

![Demo GIF](assets/demo/demo.gif)

![Before vs After](assets/demo/before-after.png)

- Demo recording guide: [assets/demo/README.md](assets/demo/README.md)
- Narration script: [assets/demo/DEMO_SCRIPT.md](assets/demo/DEMO_SCRIPT.md)
- Benchmark source: [bench/coord-benchmark.mjs](bench/coord-benchmark.mjs)
- Latest benchmark output: [bench/latest-results.json](bench/latest-results.json)

---

## Coordinator Benchmarks

All coordinator operations are local filesystem reads — zero API tokens, sub-millisecond latency.

| Operation | Avg | P50 | P95 |
|---|---:|---:|---:|
| Single session read | 0.016 ms | 0.015 ms | 0.022 ms |
| Boot scan (10 sessions) | 0.233 ms | 0.199 ms | 0.473 ms |
| Conflict detection | 0.187 ms | 0.176 ms | 0.253 ms |

Each session file is ~1.7 KB of JSON maintained by shell hooks outside the context window.

Measured by: `node bench/coord-benchmark.mjs` (50 iterations, 5 warmup). Source: [bench/latest-results.json](bench/latest-results.json).

---

## Before/After Outcomes

| Scenario | Before | After |
|---|---|---|
| Multi-session awareness | Manual tab hunting | `/lead` dashboard with active/stale sessions |
| File conflict detection | Merge-time surprise conflicts | Pre-edit conflict detection via `files_touched` |
| Task dispatch | Manual copy/paste across terminals | `tell`, `wake`, `spawn_worker` |
| Long-running execution | Idle/forgotten terminal tasks | `coord_spawn_worker` + `coord_get_result` tracking |
| Sequential workflows | Manual step orchestration | `coord_run_pipeline` statusable pipeline execution |

---

## Platform Support

| Platform | Terminal Spawning | Session Waking | Messaging |
|---|---|---|---|
| **macOS — iTerm2** | Split panes + tabs | AppleScript by TTY | Inbox hooks |
| **macOS — Terminal.app** | New windows | AppleScript by title | Inbox hooks |
| **Windows — Windows Terminal** | Split panes + tabs (`wt`) | AppActivate + SendKeys (Enter-only by default), inbox fallback | Inbox hooks |
| **Windows — PowerShell / cmd** | New windows | AppActivate + SendKeys (Enter-only by default), inbox fallback | Inbox hooks |
| **Linux — gnome-terminal / konsole / kitty** | New windows / tabs | Direct safe TTY write (Enter-only by default), inbox fallback | Inbox hooks |
| **Cursor / VS Code** | Background `claude -p` workers | Inbox fallback | Inbox hooks |

Inbox messaging via hooks is **universal** — it works on every platform regardless of terminal emulator.

---

## Reliability Matrix

| Capability | Test Coverage |
|---|---|
| Hook shell syntax | CI (`bash -n hooks/*.sh`) |
| Python hook validity | CI (`py_compile` + `ruff` in workflow) |
| Coordinator syntax | CI (`node --check`) |
| Coordinator validation rules | CI (`npm run test:unit`) |
| Worker lifecycle (spawn/result/kill) | CI (`npm run test:e2e`) |
| Pipeline lifecycle (run/status/completion) | CI (`npm run test:e2e`) |
| Platform launch-path logic | CI matrix (`ubuntu`, `macos`, `windows`) |
| Hook behavior (session + heartbeat) | CI smoke test (`tests/hooks-smoke.sh`) |

---

## Compatibility Guarantees

- Node.js: **18.x, 20.x**
- Python: **3.10+**
- OS: **macOS, Linux, Windows** (with inbox fallback where native terminal wake/injection is unavailable)
- Release gating + versioned matrix: [docs/RELEASE_HARDENING.md](docs/RELEASE_HARDENING.md)

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
# Option A (recommended): run install.sh (auto-expands __HOME__ in coordinator path)
# Option B (manual):
sed "s|__HOME__|$HOME|g" settings/settings.local.json > ~/.claude/settings.local.json
# or merge the hooks + mcpServers.coordinator blocks into your existing file

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
| `hooks/conflict-guard.sh` | PreToolUse advisory — warns before Edit/Write if another session touched the same file |
| `hooks/health-check.sh` | Manual validator — checks all hooks, deps, and settings |
| `hooks/token-guard.py` | PreToolUse guard — enforces agent spawn limits (max 5/session) |
| `hooks/read-efficiency-guard.py` | PostToolUse advisor — warns about sequential read patterns |
| `hooks/lib/portable.sh` | Shared cross-platform utilities (stat, date, TTY detection) |
| `commands/lead.md` | The `/lead` slash command prompt |
| `mcp-coordinator/index.js` | MCP server — spawn workers, wake sessions, run pipelines |
| `settings/settings.local.json` | Reference settings file with all hooks wired |

---

## Master Agent System

The lead system now includes a production-grade multi-agent orchestration layer: 4 master agents that consolidate 17 archived specialists, with mechanical token enforcement and lifecycle observability.

### Agents

| Agent | Modes | Ref Cards | Purpose |
|-------|-------|-----------|---------|
| `master-coder` | 5 (build, debug, refactor, scrape, school) | 14 | Multi-file builds, cross-system debugging |
| `master-researcher` | 4 (deep, academic, competitor, market) | 2 | Multi-source research synthesis |
| `master-architect` | 4 (system, api, database, frontend) | 2 | System design, architecture decisions |
| `master-workflow` | 4 (gsd, feature, git, autonomous) | 0 | GSD execution, Agent Teams orchestration |

### Token Governance

`token-guard.py` enforces a strict Tool Ladder via PreToolUse hooks:

| Level | Tool | Cost | When |
|-------|------|------|------|
| 1 | Grep | ~1-2k tokens | Know what you're looking for |
| 2 | Grep + Read | ~5-15k | Need context around matches |
| 3 | Single Explore | ~40-60k | Need architecture understanding |
| 4 | 2 Explores | ~80-120k | Truly separate areas (rare) |

Hard rules: configurable agent cap per session (default 5), no parallel same-type agents, blocks spawns when Grep/Read suffice.

### Real Token Metering

`agent-metrics.py` parses subagent transcript JSONL on every `SubagentStop` event to extract actual `input_tokens`, `output_tokens`, and `cache_read_input_tokens` from each API call. Calculates real cost and logs to `agent-metrics.jsonl`.

### Lifecycle Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| `agent-lifecycle.sh` | SubagentStart/Stop | Spawn/stop tracking with duration |
| `agent-metrics.py` | SubagentStop | Real token metering via transcript parsing |
| `pre-compact-save.sh` | PreCompact | Saves session state before context compaction |
| `self-heal.py` | SessionStart | Auto-repairs missing/corrupt files |
| `mcp-readiness.py` | SessionStart | Validates MCP server availability |

### On-Demand Mode Loading

Mode files load via the Read tool at runtime — they appear as tool results, not system prompt, so they never break Claude Code's internal prompt cache prefix. Each agent reads only the mode it needs for the current task.

---

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Release Hardening](docs/RELEASE_HARDENING.md)

## Security Model

- Trust boundary: this system is designed for a single local user account and local machine workflows.
- Protected by default: coordinator state directories/files are owner-restricted (`0700`/`0600`), message payloads are size-capped, and inbox reads are bounded.
- Out of scope: hostile local root/admin users, compromised OS, and arbitrary shell commands executed by trusted operators.
- Fail-safe behavior: `hooks/token-guard.py` is fail-closed by default; use `TOKEN_GUARD_SKIP_RULES=rule1,rule2` to bypass specific rules only (logged to stderr).
- Wake safety: terminal wake sends Enter keystroke only; all message content is delivered through inbox. Keystroke injection was removed as an attack surface.

---

## Key Design Decisions

**Zero API tokens for coordination.** Hooks are shell scripts. They run outside the Claude context window. Coordination is free.

**Enriched session files eliminate transcript parsing.** Reading 3KB of JSON per session is orders of magnitude cheaper than parsing a transcript to infer state.

**Rate-limited heartbeat.** 5-second cooldown prevents IO storms on busy sessions.

**Schema versioned.** `schema_version` in session files enables non-breaking migrations.

**MCP is optional.** The file-based layer works standalone. MCP adds power-user features on top.

**Cross-platform wake strategy.** macOS uses AppleScript, Linux attempts direct safe TTY wake, Windows uses AppActivate best-effort, and all platforms keep inbox fallback. Wake always sends Enter only — message content goes through inbox.

**Pre-edit conflict detection.** The `conflict-guard.sh` hook checks all active sessions' `files_touched` arrays before every Edit/Write. This is something Agent Teams fundamentally cannot do — it has no concept of which files each session has modified.

**Stable filesystem primitives.** The core protocol uses universal filesystem operations: JSON files, JSONL append, directory-based inboxes, and `mkdir`-based locks. Even if Claude Code adds native conflict detection or task routing, the enriched session files, activity log, terminal spawning, and sequential pipelines remain independently valuable — they sit at a different layer.

---

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated
- `jq` (`brew install jq` / `apt install jq` / `choco install jq`)
- Node.js ≥ 18 (for MCP coordinator)
- `bash` (hooks)
- `python3` (optional guards)

---

## Works WITH Agent Teams

This system complements Claude Code's built-in Agent Teams. Use both together. See [Agent Teams Integration Patterns](docs/AGENT_TEAMS_INTEGRATION.md) for detailed examples.

| Capability | Agent Teams | Claude Lead System |
|---|---|---|
| Task management | `TaskCreate`, `TaskUpdate` | — |
| Agent messaging | `SendMessage` | `coord_wake_session` (inbox + Enter keystroke) |
| **Pre-edit conflict detection** | — | `conflict-guard.sh` warns before file overwrites |
| **Session observability** | Idle notifications only | Tool counts, files touched, recent ops, activity log |
| **Native terminal tabs** | `Task` tool (background only) | iTerm2 splits, gnome-terminal tabs, Windows Terminal panes |
| **Sequential pipelines** | Manual chaining | `coord_run_pipeline` with status tracking |
| **Worker lifecycle** | Background agents | PID tracking, kill, result retrieval |

---

## Quality Gates

- CI validates shell, Python, and JavaScript syntax
- CI runs coordinator argument-validation tests
- CI enforces performance SLO thresholds via `tests/perf-gate.mjs`
- CI runs hook smoke tests (`session-register` + `terminal-heartbeat`) in isolated HOME
- CI runs shell hook unit tests (34 tests) and Python hook unit tests (23 tests)
- CI enforces 80%+ line coverage via `c8` (currently ~90%)
- `health-check.sh` validates install health on your machine
- Release supply-chain workflow publishes SBOM, provenance attestation, and keyless cosign signatures

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — especially for:
- `tmux` / `zellij` split pane support
- Tests for hooks

---

## License

MIT — see [LICENSE](LICENSE).
