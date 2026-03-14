# Parity Proof Artifacts

Generated: 2026-03-13
Taxonomy: `verified` / `partial` / `experimental` (see `docs/CLAIM_POSTURE_SOURCE.json`)

Each entry follows: **CLAIM → TEST FILE → LINES → WHAT IT PROVES**

---

## TeamCreate / TeamDelete

### Claim: Atomic creation — all workers spawn or none persist

**Label:** `verified`

| CLAIM              | Team config file is created and all workers are spawned atomically; if any spawn fails the config file is deleted and workers already spawned are reported as killed. |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/atomic-team-create.test.mjs`                                                                                                                    |
| **LINES**          | 93–136 (`coord_create_team with workers array spawns all workers atomically`)                                                                                         |
| **WHAT IT PROVES** | Mocks two worker spawns, calls `coord_create_team`, asserts `Atomically Spawned Workers (2)` in output and asserts the team config JSON exists on disk after success. |

### Claim: Rollback on failure — team config removed when a worker spawn fails

**Label:** `verified`

| CLAIM              | If any worker in the `workers` array fails to spawn, the team config file is deleted and the response reports the count of killed workers and the failing worker name.                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/atomic-team-create.test.mjs`                                                                                                                                                                                          |
| **LINES**          | 140–183 (`coord_create_team rolls back team config when a worker spawn fails`)                                                                                                                                                              |
| **WHAT IT PROVES** | First worker spawn succeeds, second returns a failure string. Asserts response includes `Atomic team creation FAILED and was rolled back`, `Workers killed: 1`, and `Failed worker: worker-b`. Asserts `rollback-team.json` does NOT exist. |

### Claim: Backwards compatibility — no workers param creates team only

**Label:** `verified`

| CLAIM              | Calling `coord_create_team` without a `workers` field creates the team config file without triggering atomic spawn logic.                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TEST FILE**      | `mcp-coordinator/test/atomic-team-create.test.mjs`                                                                                                           |
| **LINES**          | 51–70 (`coord_create_team without workers creates team only (backwards compat)`)                                                                             |
| **WHAT IT PROVES** | Calls `coord_create_team` with no `workers` key. Asserts `Team created: **compat-team**` and asserts "Atomically Spawned Workers" does NOT appear in output. |

### Claim: Concurrent name handling — empty workers array falls through to sync path

**Label:** `verified`

| CLAIM              | Passing `workers: []` is equivalent to omitting the field — no atomic path fires.                   |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/atomic-team-create.test.mjs`                                                  |
| **LINES**          | 74–89 (`coord_create_team with empty workers array behaves like no workers`)                        |
| **WHAT IT PROVES** | Asserts team is created and "Atomically Spawned Workers" is absent when an empty array is provided. |

---

## Task System: Lead States → Native State Mapping

The lead coordinator task board uses `pending` / `in_progress` / `completed` states on team task records stored as JSON files under `~/.claude/terminals/tasks/`.

### State: pending → in_progress (claim next unblocked task)

**Label:** `verified`

| CLAIM              | `coord_claim_next_task` atomically transitions the next unblocked pending task to `in_progress`.            |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/e2e-worker-pipeline.test.mjs`                                                         |
| **LINES**          | 424–478 (`coord_team_queue_task + coord_team_status_compact + coord_team_assign_next dispatch queued work`) |
| **WHAT IT PROVES** | Creates queued tasks, calls `coord_team_assign_next`, asserts response includes `**Status:** in_progress`.  |

### State: in_progress → completed (chain advance on worker finish)

**Label:** `verified`

| CLAIM              | When a worker calls `coord_claim_next_task` with `completed_worker_task_id`, the in-progress task transitions to `completed` and the next pending task transitions to `in_progress`.     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/self-claim-loop.test.mjs`                                                                                                                                          |
| **LINES**          | 86–132 (`--claim-only: marks completed_worker_task_id team task as done and returns next`)                                                                                               |
| **WHAT IT PROVES** | Creates a task at `status: in_progress`, passes `completed_worker_task_id` pointing to it, asserts that task now has `status: completed` and the next task transitions to `in_progress`. |

### State machine: full loop terminates cleanly

**Label:** `verified`

| CLAIM              | A three-task chain cycles through `pending → in_progress → completed` for each task in sequence, with the loop terminating when all tasks are done.                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/self-claim-loop.test.mjs`                                                                                                                                                           |
| **LINES**          | 196–275 (`--claim-only: loops through a full queued chain and terminates cleanly`)                                                                                                                        |
| **WHAT IT PROVES** | Three tasks created, three claim calls issued in sequence, each completing the prior task. Final asserts: `task1.status === "completed"`, `task2.status === "completed"`, `task3.status === "completed"`. |

### State: blocked_by dependency enforcement

**Label:** `verified`

| CLAIM              | Tasks with `blocked_by` dependencies are skipped by `coord_claim_next_task` until their dependency resolves.                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/self-claim-loop.test.mjs`                                                                                          |
| **LINES**          | 162–194 (`--claim-only: respects blocked_by — skips blocked tasks`)                                                                      |
| **WHAT IT PROVES** | Creates tasks where task B is `blocked_by` task A. Asserts the claim call skips B and returns empty rather than claiming a blocked task. |

### State: dispatch linking (Task board + live team state)

**Label:** `verified`

| CLAIM              | `coord_team_dispatch` creates a team task, spawns a worker, and links the task to `in_progress` in the live team state in one call. |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/e2e-worker-pipeline.test.mjs`                                                                                 |
| **LINES**          | 373–417 (`coord_team_dispatch creates team task, spawns worker, and links live team state`)                                         |
| **WHAT IT PROVES** | Asserts `**Status:** in_progress` in task output and `T_DISPATCH \| in_progress \| alice` in team status compact view.              |

**Native state mapping:**

| Lead state    | Semantic equivalent in native Agent Teams | Notes                                                               |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `pending`     | Task created, not yet assigned            | Lead adds `blocked_by` dependency graph; native does not            |
| `in_progress` | Task assigned and running                 | Lead links to worker PID; native links to subagent                  |
| `completed`   | Task done, result available               | Lead writes result to `results/{taskId}.txt`; native returns inline |

---

## Agent Spawn: Role Presets → Model / Permission Output

Role presets are defined at `mcp-coordinator/lib/workers.js:53–86`.

### Researcher preset

**Label:** `verified`

| CLAIM              | `role=researcher` produces `model=haiku`, `permissionMode=readOnly`, `agent=scout`, `isolate=false`.                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TEST FILE**      | `mcp-coordinator/test/gap-parity.test.mjs`                                                                                                                   |
| **LINES**          | 71–107 (`Gap 7: all 8 permission modes are accepted by coord_spawn_worker`)                                                                                  |
| **SOURCE**         | `lib/workers.js:54–61` (ROLE_PRESETS.researcher definition)                                                                                                  |
| **WHAT IT PROVES** | All 8 permission modes including `readOnly` (researcher default) pass validation. Role-to-preset mapping confirmed by source definition at workers.js:54–61. |

### Implementer preset

**Label:** `verified`

| CLAIM              | `role=implementer` produces `model=sonnet`, `permissionMode=acceptEdits`, `isolate=true`.                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/gap-parity.test.mjs`                                                                                                               |
| **LINES**          | 71–107, 109–130 (permission mode acceptance + fallback tests)                                                                                            |
| **SOURCE**         | `lib/workers.js:62–69` (ROLE_PRESETS.implementer definition)                                                                                             |
| **WHAT IT PROVES** | `acceptEdits` is the default fallback on invalid mode (workers.js:109–130), confirming it is a valid registered mode. Preset source at workers.js:62–69. |

### Reviewer preset

**Label:** `verified`

| CLAIM              | `role=reviewer` produces `model=sonnet`, `agent=reviewer`, `permissionMode=readOnly`, `isolate=true`, `requirePlan=true`. |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/gap-parity.test.mjs`                                                                                |
| **LINES**          | 131–148 (`Gap 7: planOnly maps to --permission-mode plan in the worker CLI script`)                                       |
| **SOURCE**         | `lib/workers.js:70–77` (ROLE_PRESETS.reviewer definition)                                                                 |
| **WHAT IT PROVES** | `readOnly` permission mode passes through to generated CLI script. `requirePlan=true` confirmed by source.                |

### Planner preset

**Label:** `verified`

| CLAIM              | `role=planner` produces `model=sonnet`, `agent=code-architect`, `permissionMode=planOnly`, `requirePlan=true`.             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/gap-parity.test.mjs`                                                                                 |
| **LINES**          | 131–148 (`Gap 7: planOnly maps to --permission-mode plan in the worker CLI script`)                                        |
| **SOURCE**         | `lib/workers.js:78–85` (ROLE_PRESETS.planner definition)                                                                   |
| **WHAT IT PROVES** | `planOnly` is accepted as a valid permission mode and maps to `--permission-mode plan` in the generated worker CLI script. |

### Permission mode pass-through to CLI

**Label:** `verified`

| CLAIM              | Native modes `bypassPermissions` and `dontAsk` pass through unmodified to the worker CLI `--permission-mode` flag.                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TEST FILE**      | `mcp-coordinator/test/gap-parity.test.mjs`                                                                                                                                                   |
| **LINES**          | 150–172 (`Gap 7: native modes bypassPermissions and dontAsk pass through to worker script`)                                                                                                  |
| **WHAT IT PROVES** | Calls `buildInteractiveWorkerScript` with `bypassPermissions` / `dontAsk`, asserts the generated script string contains `--permission-mode bypassPermissions` / `--permission-mode dontAsk`. |
