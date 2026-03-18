# Workflow Examples

Three realistic workflows showing the Lead System in action.

---

## 1. Bugfix Workflow

**Scenario:** CI fails on `src/auth.ts`. Lead detects, spawns worker, verifies fix.

### Terminal Transcript

```
# Terminal A — Lead session
$ /lead

Dashboard:
| Session  | TTY     | Status | W/E/B/R   | Recent Files    |
|----------|---------|--------|-----------|-----------------|
| a1b2c3d4 | ttys003 | active | 15/8/5/3  | src/api.ts      |

> run "fix the failing test in tests/auth.test.ts — the login handler returns 401 instead of 200 for valid tokens" in ~/my-app

  ✓ Worker spawned: task_abc123 (ttys005)

# ... worker runs autonomously in a new terminal tab ...

> check worker task_abc123

  Worker output (task_abc123):
  Fixed: auth middleware was checking token expiry in seconds instead of milliseconds.
  Modified: src/auth.ts (line 42), tests/auth.test.ts (line 15)
  Tests: 14/14 passing

> conflicts

  No conflicts detected.
```

### Behind the Scenes

1. `/lead` reads `~/.claude/terminals/session-*.json` files (0 tokens)
2. `run ...` calls `coord_spawn_worker` → opens new terminal tab with `claude -p "fix..."`
3. Worker runs, writes result to `~/.claude/terminals/results/task_abc123.json`
4. `check worker` calls `coord_get_result` → reads the JSON file (0 tokens)
5. `conflicts` calls `coord_detect_conflicts` → compares `files_touched` arrays across sessions

### Cost Estimate

```
Lead session: ~50K tokens (short orchestration)    ≈ $0.75
Worker:       ~40K tokens (focused bugfix, exits)  ≈ $0.36
Coordination: 0 tokens                             = $0.00
TOTAL: ~$1.11
```

---

## 2. Test Pipeline Workflow

**Scenario:** Lead runs a 3-step pipeline: lint → test → build.

### Terminal Transcript

```
# Terminal A — Lead session
$ /lead

> pipeline: lint, test, build in ~/my-app

  Pipeline started: pipeline_xyz789
  Step 1/3: lint ... running
  Step 1/3: lint ... ✓ passed (12s)
  Step 2/3: test ... running
  Step 2/3: test ... ✓ passed (45s, 142 tests)
  Step 3/3: build ... running
  Step 3/3: build ... ✓ passed (8s)

  Pipeline complete: 3/3 steps passed (65s total)

> check pipeline pipeline_xyz789

  { "status": "completed",
    "steps": [
      { "name": "lint", "status": "done", "duration_ms": 12340, "exit_code": 0 },
      { "name": "test", "status": "done", "duration_ms": 45120, "exit_code": 0 },
      { "name": "build", "status": "done", "duration_ms": 8230, "exit_code": 0 }
    ] }
```

### Behind the Scenes

1. `pipeline:` calls `coord_run_pipeline` with 3 steps
2. Each step spawns a background shell process (not a full Claude agent)
3. Steps run sequentially — each waits for the previous to complete
4. Status tracked in `~/.claude/terminals/pipelines/pipeline_xyz789.json`
5. If any step fails, subsequent steps are skipped and status is `failed`

### Cost Estimate

```
Lead session: ~30K tokens (pipeline command + check)  ≈ $0.45
Pipeline steps: 0 tokens (shell commands, not Claude)  = $0.00
TOTAL: ~$0.45
```

---

## 3. Refactor Coordination Workflow

**Scenario:** Two workers refactor different files simultaneously. Conflict detection prevents overlap.

### Terminal Transcript

```
# Terminal A — Lead session
$ /lead

Dashboard:
| Session  | TTY     | Status | W/E/B/R   | Recent Files         |
|----------|---------|--------|-----------|----------------------|
| a1b2c3d4 | ttys003 | active | 20/12/8/5 | src/api.ts, db.ts    |

> run "refactor src/api.ts — extract validation logic into src/validators.ts" in ~/my-app

  ✓ Worker spawned: task_refactor_1 (ttys005)

> run "refactor src/routes.ts — add error middleware and typed responses" in ~/my-app

  ✓ Worker spawned: task_refactor_2 (ttys006)

# Both workers run in parallel...

> conflicts

  ⚠ Potential conflict:
    src/api.ts touched by sessions a1b2c3d4 AND task_refactor_1
    No overlap between task_refactor_1 and task_refactor_2 (different files)

> check worker task_refactor_1

  Worker output (task_refactor_1):
  Extracted 3 validation functions to src/validators.ts.
  Modified: src/api.ts, src/validators.ts (new)
  Tests: 28/28 passing

> check worker task_refactor_2

  Worker output (task_refactor_2):
  Added error middleware, typed response helpers.
  Modified: src/routes.ts, src/middleware/errors.ts (new)
  Tests: 35/35 passing
```

### Behind the Scenes

1. Two workers spawn in separate terminal tabs
2. Each worker's `terminal-heartbeat.sh` hook updates `files_touched` in its session JSON
3. `conflicts` reads all session JSONs and compares `files_touched` — detects overlap on `src/api.ts` between the lead session and worker 1
4. Workers operate on different files (`api.ts`/`validators.ts` vs `routes.ts`/`errors.ts`), so no inter-worker conflict
5. The `conflict-guard.sh` PreToolUse hook would have warned worker 2 if it tried to edit `src/api.ts`

### Cost Estimate

```
Lead session: ~60K tokens (coordination + checks)    ≈ $0.90
Worker 1:     ~80K tokens (extract + test)            ≈ $0.72
Worker 2:     ~70K tokens (middleware + test)          ≈ $0.63
Coordination: 0 tokens                                = $0.00
TOTAL: ~$2.25


```

---

## References

- `README.md` — 2-Minute Demo section
- `docs/COMPARISON_METHODOLOGY.md` — Cost calculation details
- `docs/ARCHITECTURE.md` — System architecture
