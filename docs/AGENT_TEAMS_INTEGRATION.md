# Agent Teams Integration Patterns

Claude Code's built-in Agent Teams (`TeamCreate`, `SendMessage`, `TaskCreate`) handles messaging and task management. `claude-lead-system` adds the coordination layer on top: conflict detection, session observability, terminal spawning, and pipelines.

This guide shows four concrete patterns for using them together.

---

## Pattern 1: Lead + Workers

Use `/lead` for the dashboard and `coord_spawn_worker` for autonomous background tasks.

```
Terminal A (lead):
  /lead
  → sees 3 active sessions
  → "run 'write comprehensive tests for src/auth.ts' in /Users/you/my-app"
  → coordinator spawns worker W_abc123
  → worker completes, result routes to lead inbox via check-inbox.sh

Terminal B (interactive):
  → working on feature, gets inbox message about worker completion
```

**When to use:** Long-running tasks that don't need interactive back-and-forth. Workers run `claude -p` headlessly and report results.

**How it complements Agent Teams:** Agent Teams' `Task` tool spawns background subagents within the same process. `coord_spawn_worker` spawns fully independent terminal processes with PID tracking, kill support, and result retrieval.

---

## Pattern 2: Conflict-Safe Teams

Use Agent Teams for task assignment and `conflict-guard.sh` for pre-edit safety.

```
Terminal A: TaskCreate → "Refactor auth module" → assigned to Terminal B
Terminal B: TaskCreate → "Add rate limiting" → assigned to Terminal C

Both terminals work independently. When Terminal C tries to Edit src/auth.ts:
  conflict-guard.sh fires:
  ⚠️ CONFLICT WARNING: session a1b2c3d4 (Terminal B) has touched src/auth.ts
  Terminal C sees the warning and coordinates before overwriting.
```

**When to use:** Any time multiple agents work in the same codebase. Agent Teams has no concept of which files each session has modified — `conflict-guard.sh` fills that gap.

**How it complements Agent Teams:** Agent Teams handles the task assignment (`TaskCreate`, `TaskUpdate`). The conflict guard provides the file-level awareness that prevents merge-time surprises.

---

## Pattern 3: Pipeline to Team Handoff

Use `coord_run_pipeline` for sequential build steps, then hand results to Agent Teams for distribution.

```
Terminal A (lead):
  "pipeline: lint, test, build in /Users/you/my-app"
  → coordinator runs lint → test → build sequentially
  → pipeline completes with all results

  "tell Terminal B: pipeline finished, deploy results are in results/P_deploy/"
  → or use SendMessage via Agent Teams to distribute
```

**When to use:** Ordered task chains where step N depends on step N-1. Agent Teams has no sequential pipeline primitive — it dispatches tasks independently.

**How it complements Agent Teams:** Pipelines handle sequential ordering. Agent Teams handles the fan-out of results to multiple agents afterward.

---

## Pattern 4: Observability Layer

Use the activity log and enriched session files for metrics that Agent Teams doesn't track.

```
~/.claude/terminals/activity.jsonl:
  {"session":"a1b2c3d4","tool":"Edit","file":"src/auth.ts","ts":"2026-02-19T14:32:01Z"}
  {"session":"a1b2c3d4","tool":"Bash","ts":"2026-02-19T14:32:15Z"}
  {"session":"e5f6g7h8","tool":"Write","file":"tests/auth.test.ts","ts":"2026-02-19T14:33:02Z"}

Session file (session-a1b2c3d4.json):
  tool_counts: { Write: 12, Edit: 8, Bash: 23, Read: 5 }
  files_touched: ["src/auth.ts", "src/db.ts"]
  recent_ops: [{ tool: "Edit", file: "src/auth.ts", ts: "..." }]
```

**When to use:** Understanding what happened across sessions. Agent Teams provides idle notifications but no tool-level activity tracking.

**What you get:** Per-session tool counts, files touched, recent operations, and a universal append-only activity log — all maintained by shell hooks at zero token cost.

---

## Quick Reference

| Need | Use |
|---|---|
| Task assignment | Agent Teams (`TaskCreate`) |
| Agent-to-agent messaging | Agent Teams (`SendMessage`) or `coord_wake_session` |
| Pre-edit conflict detection | `conflict-guard.sh` (automatic) |
| Session dashboard | `/lead` |
| Background autonomous work | `coord_spawn_worker` |
| Sequential task chains | `coord_run_pipeline` |
| Terminal spawning | `coord_spawn_terminal` |
| Activity metrics | `activity.jsonl` + session files |
