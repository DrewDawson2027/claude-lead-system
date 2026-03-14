# Native Hook Integration Proof

Generated: 2026-03-13
Taxonomy: `verified` / `partial` / `experimental` (see `docs/CLAIM_POSTURE_SOURCE.json`)

This document proves the code path from native Agent Teams lifecycle events through the hook layer into the coordinator's observability store.

---

## Event Flow: TeammateIdle and TaskCompleted

### Registration (settings.json → hooks)

Native Claude Code fires `TeammateIdle` and `TaskCompleted` events when a teammate goes idle or completes a task. These are wired as hooks in the installed `settings.json`:

```json
"TeammateIdle": [
  { "matcher": "*", "hooks": [{ "command": "~/.claude/hooks/teammate-lifecycle.sh TeammateIdle" }] }
],
"TaskCompleted": [
  { "matcher": "*", "hooks": [{ "command": "~/.claude/hooks/teammate-lifecycle.sh TaskCompleted" }] }
]
```

**Verified by:** `tests/health-check-regression.sh:66–70` (asserts both entries exist in the installed settings.json) and `tests/health-check-regression.sh:82–83` (regression check that both hooks survive a reinstall).

---

### Step 1: Native event → hook input (stdin)

Claude Code calls the hook with the event name as `$1` and the event payload as stdin JSON:

```json
{
  "session_id": "team1234abcd",
  "task_id": "T42",
  "teammate_session_id": "mate9999",
  "reason": "idle"
}
```

**Hook entry point:** `hooks/teammate-lifecycle.sh:1` — receives `EVENT_NAME=$1`, reads stdin into `INPUT`.

---

### Step 2: Hook → activity.jsonl

The hook extracts `session_id` (first 8 chars), `teammate_session_id`, `task_id`, and `reason`, then appends a structured JSON record to `~/.claude/terminals/activity.jsonl` using a file lock for append safety (`portable_flock_append`):

```json
{
  "ts": "2026-03-13T00:00:00Z",
  "session": "team1234",
  "tool": "TeammateIdle",
  "teammate": "mate9999",
  "task_id": "T42",
  "project": "unknown",
  "detail": { "reason": "idle", "status": "", "summary": "" }
}
```

**Code path:** `hooks/teammate-lifecycle.sh:22–45` (EVENT_JSON construction + flock append).

**Test coverage:** `tests/test-hooks.sh:383–387`

- Pipes a `TeammateIdle` payload to the hook
- Asserts `~/.claude/terminals/activity.jsonl` is created
- Asserts the last record's `tool` field equals `"TeammateIdle"`

**Label:** `verified`

---

### Step 3: Hook → session file enrichment

After writing the activity log, the hook updates the session state file at `~/.claude/terminals/session-{8-char-id}.json`:

```json
{
  "teammate_events": 1,
  "last_teammate_event": {
    "t": "2026-03-13T00:00:00Z",
    "event": "TeammateIdle",
    "task_id": "T42",
    "teammate": "mate9999"
  }
}
```

**Code path:** `hooks/teammate-lifecycle.sh:47–68` (jq in-place update of session file, best-effort, never blocks parent tool flow).

**Test coverage:** `tests/test-hooks.sh:388–390`

- Pre-seeds `session-team1234.json` with `{"session":"team1234","status":"active","cwd":"/tmp"}`
- After hook fires: asserts `teammate_events == 1`

**Label:** `verified`

---

### Step 4: TaskCompleted → quality gate (conditional)

For `TaskCompleted` events only, the hook checks `$CLAUDE_LEAD_QUALITY_GATE` for an optional executable quality-gate script. If set and executable, it runs. This path is additive — the activity log write and session enrichment happen regardless.

**Code path:** `hooks/teammate-lifecycle.sh:70–end` (quality gate block gated on `[[ "$EVENT_NAME" == "TaskCompleted" ]]`).

**Label:** `experimental` — quality gate script path is present but no default gate script ships with the coordinator; behavior is operator-configured.

---

### Step 5: Coordinator reads activity.jsonl

The coordinator's `coord_get_session` / `coord_list_sessions` reads session JSON files written in Steps 2–3. The benchmark harness reads `activity.jsonl` directly to measure telemetry delta:

**Code path:** `bench/ab-harness.mjs:1711–1749` — captures `activity.jsonl` size before and after a benchmark run, diffs the delta to count events emitted during the run.

**Label:** `partial` — telemetry reading is verified in the benchmark harness; a dedicated MCP tool for streaming activity.jsonl does not yet exist (the coordinator reads session files, not the raw activity log, for its MCP responses).

---

## Full Code Path Summary

```
Claude Code native event (TeammateIdle / TaskCompleted)
  │
  ▼ settings.json hook registration
hooks/teammate-lifecycle.sh $EVENT_NAME   ← stdin: JSON payload
  │
  ├─► portable_flock_append → ~/.claude/terminals/activity.jsonl
  │     schema: { ts, session, tool, teammate, task_id, project, detail }
  │
  ├─► jq in-place update → ~/.claude/terminals/session-{id}.json
  │     fields: teammate_events++, last_teammate_event
  │
  └─► [TaskCompleted only] optional quality gate script (experimental)

Coordinator reads:
  coord_get_session  → session-{id}.json  (includes teammate_events)
  coord_list_sessions → all session-*.json files
  bench/ab-harness   → activity.jsonl delta (benchmark telemetry)
```

---

## Test File Index

| Test file                                         | What it covers                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tests/test-hooks.sh:376–390`                     | End-to-end hook execution: TeammateIdle payload in → activity.jsonl written + session enriched |
| `tests/health-check-regression.sh:66–70`          | Hook registration present in installed settings.json                                           |
| `tests/health-check-regression.sh:82–83, 119–120` | Hook registration survives reinstall                                                           |
| `mcp-coordinator/test/sessions.test.mjs:31–122`   | Coordinator reads session files and returns teammate_events / files_touched / tool_counts      |
| `bench/ab-harness.mjs:1711–1749`                  | activity.jsonl delta read in benchmark telemetry collection                                    |
