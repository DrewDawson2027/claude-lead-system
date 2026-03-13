# Agent Delegation Plan: Native Parity Push (93% → 98%)

Based on 71k-token reverse-engineering of Claude Code native Agent Teams internals.

**Your role:** Copy-paste each prompt into a fresh Claude Code session pointed at `~/claude-lead-system`. Each is self-contained — the agent gets all the context it needs. Run them in the order shown (some depend on earlier work).

---

## Overview: 6 Workstreams, 6 Agents

| #   | Workstream                               | Gap Closed    | Priority | Est. Complexity |
| --- | ---------------------------------------- | ------------- | -------- | --------------- |
| A   | Atomic TeamCreate                        | 85% → 95%     | HIGH     | Medium          |
| B   | Recipient Validation on SendMessage      | Bug fix       | HIGH     | Low             |
| C   | E2E Self-Claim Loop Verification         | 85% → 95%     | HIGH     | Medium          |
| D   | E2E Bidirectional Messaging Verification | 80% → 95%     | HIGH     | Medium          |
| E   | E2E Plan Approval Gate Verification      | 85% → 95%     | MEDIUM   | Medium          |
| F   | Architecture Doc from Research           | Documentation | LOW      | Low             |

**Dependencies:** A, B can run in parallel. C, D, E can run in parallel after A+B merge. F can run anytime.

---

## Workstream A: Atomic TeamCreate

**The gap:** Native Agent Teams creates the team and spawns all workers in a single `TeamCreate` call. Our system requires two separate calls: `coord_create_team` (creates config.json) then `coord_spawn_worker` (launches each worker). If a spawn fails mid-way, you get a half-built team with no cleanup.

**The fix:** Add a `workers` array parameter to `coord_create_team` that optionally spawns workers atomically — rollback on any failure.

### Prompt (paste into fresh Claude Code session):

````
cd ~/claude-lead-system

I need you to make `coord_create_team` support atomic team creation with workers in a single call.

## Context

Currently team creation is two steps:
1. `coord_create_team` — creates `~/.claude/teams/{name}/config.json`
2. `coord_spawn_worker` — launches each worker separately

Native Claude Code does this atomically in one `TeamCreate` call. If spawning fails mid-way, we get a half-built team.

## What to build

In `mcp-coordinator/lib/teams.js`, modify `handleCreateTeam` to accept an optional `workers` array parameter:

```json
{
  "team_name": "my-team",
  "workers": [
    { "name": "frontend", "task": "Build the login page", "model": "haiku" },
    { "name": "backend", "task": "Build the auth API", "model": "sonnet" }
  ]
}
````

When `workers` is provided:

1. Create the team config as normal
2. Loop through workers array, calling the existing `handleSpawnWorker` logic for each
3. If ANY worker spawn fails, clean up: kill already-spawned workers, delete team config, return error
4. Return a combined result showing team + all workers created

When `workers` is omitted, behavior is unchanged (backwards compatible).

## Files to modify

- `mcp-coordinator/lib/teams.js` — `handleCreateTeam` function
- The MCP tool registration (wherever coord_create_team's schema is defined) — add `workers` as optional array param

## Testing

- Add tests to `mcp-coordinator/test/` — test atomic creation, test rollback on failure, test backwards compatibility (no workers param)
- Run `cd mcp-coordinator && npx vitest run` to verify

Commit when done with message: "feat: atomic team creation with optional workers array"

```

---

## Workstream B: Recipient Validation on SendMessage

**The gap:** Native Claude Code has bug #25135 — `SendMessage` silently succeeds even when the recipient name is wrong. Our system should NOT replicate this bug. Instead, validate that the recipient exists before delivering.

### Prompt (paste into fresh Claude Code session):

```

cd ~/claude-lead-system

Fix a potential bug in `coord_send_message`: it should validate that the recipient session actually exists before delivering a message.

## Context

Native Claude Code has a known bug (#25135) where SendMessage silently succeeds even when the recipient name is wrong. We should NOT have this bug. When someone sends a message to a non-existent session, we should return a clear error.

## What to change

In `mcp-coordinator/lib/messaging.js`, find the `handleSendMessage` function. Before writing to the inbox file:

1. Check if the target session exists by looking for a session file in `~/.claude/terminals/` matching the `to` parameter
2. Also check if there's a worker meta file in `~/.claude/terminals/workers/` matching the `to` parameter
3. If neither exists, return an error: `"Recipient session '{to}' not found. Available sessions: {list}"`
4. If the session exists but is in "exited" status, still deliver but warn: `"Warning: session '{to}' has exited. Message written to inbox but may not be read."`

Important: the `handleBroadcast` function should skip non-existent sessions silently (broadcast is best-effort). Only `handleSendMessage` (direct messages) should validate.

Also check `handleSendProtocol` in the same file for the same issue.

## Testing

- Add test cases to the existing test files or create `mcp-coordinator/test/recipient-validation.test.mjs`
- Test: send to valid session → succeeds
- Test: send to non-existent session → returns error with available sessions list
- Test: send to exited session → succeeds with warning
- Test: broadcast skips non-existent sessions silently
- Run `cd mcp-coordinator && npx vitest run` to verify all tests pass

Commit when done with message: "fix: validate recipient exists before message delivery (#25135 parity)"

```

---

## Workstream C: E2E Self-Claim Loop Verification

**The gap:** The self-claim mechanism is fully wired (EXIT trap → `claim-next-task.mjs` → `handleClaimNextTask`) but has never been verified end-to-end in a live run. Need to confirm the full loop: worker completes task → EXIT trap fires → claims next pending task → executes it.

**How native works (from research):**
1. Teammate calls `TaskList` → reads all task JSON files
2. Finds first task where `status === "pending"` AND `owner === ""`
3. Calls `TaskUpdate` → atomically sets `in_progress` + `owner` using file lock
4. Executes task
5. Sets `completed`
6. Loops back until no claimable tasks remain

### Prompt (paste into fresh Claude Code session):

```

cd ~/claude-lead-system

I need you to verify and fix the self-claim loop so it works end-to-end.

## How it should work

When a worker finishes its task, its EXIT trap should:

1. Run `claim-next-task.mjs` (or equivalent)
2. Find the next pending task where `status === "pending"` and no one has claimed it
3. Set `claimed_by` to this worker's session ID and `status` to `in_progress`
4. Spawn a new worker (or re-use the current one) to execute the claimed task
5. Repeat until no claimable tasks remain

## What to verify

1. Read these files to understand the current implementation:
   - `mcp-coordinator/lib/tasks.js` — look for `handleClaimNextTask`
   - `mcp-coordinator/lib/platform/common.js` — look for EXIT trap logic
   - Any `claim-next-task.mjs` script in the project
   - `mcp-coordinator/lib/workers.js` — worker spawn logic

2. Trace the full path: worker process exits → what shell code runs → what JS function gets called → what happens to task state

3. Fix any broken links in the chain. Common issues:
   - EXIT trap script path might be wrong
   - `claim-next-task.mjs` might not actually spawn a new worker
   - File locking might not be working for concurrent claims
   - The task filter might not match the right fields (should check `status === "pending"` AND `claimed_by` is empty/null)

4. Write or update the E2E test at `mcp-coordinator/test/self-claim-loop.test.mjs`:
   - Create a team with 1 worker and 3 tasks
   - Complete task 1
   - Verify task 2 gets auto-claimed (claimed_by set, status → in_progress)
   - Complete task 2
   - Verify task 3 gets auto-claimed
   - Complete task 3
   - Verify no more claims happen (loop terminates cleanly)

5. Run `cd mcp-coordinator && npx vitest run self-claim` to verify

Commit when done with message: "test: verify self-claim loop E2E — close 85% → 95% gap"

```

---

## Workstream D: E2E Bidirectional Messaging Verification

**The gap:** Workers have `coord_send_message` available via MCP, but we've never verified that a worker can actually send a message to another worker (or back to the lead) and have it be received.

**How native works (from research):**
- `SendMessage` writes to `~/.claude/teams/{team}/inboxes/{recipient}.json`
- Inbox is append-only (native uses JSON array; ours uses JSONL — better)
- Message types: `message`, `broadcast`, `shutdown_request`, `shutdown_response`, `plan_approval_response`
- Workers poll their inbox on each tool call

### Prompt (paste into fresh Claude Code session):

```

cd ~/claude-lead-system

I need you to verify and fix bidirectional messaging between workers.

## What should work

1. Worker A sends a message to Worker B via `coord_send_message`
2. Worker B receives it on their next `coord_check_inbox` call
3. Worker B can send a message back to Worker A
4. Workers can send messages to the lead session
5. The lead can send messages to any worker

All 5 native message types should work: message, broadcast, shutdown_request, shutdown_response, plan_approval_response

## What to verify

1. Read these files:
   - `mcp-coordinator/lib/messaging.js` — `handleSendMessage`, `handleCheckInbox`, `handleBroadcast`, `handleSendProtocol`
   - `mcp-coordinator/lib/workers.js` — check what MCP tools workers get access to
   - `mcp-coordinator/lib/platform/common.js` — check how worker processes are built (do they get coord_send_message in their tool list?)

2. Key questions to answer:
   - When a worker is spawned, does its MCP config include coord_send_message and coord_check_inbox?
   - Does the worker's session ID match what other workers would use as the `to` parameter?
   - Do workers know each other's session IDs? (peer discovery via coord_discover_peers?)

3. Fix any issues found. The most likely problem: workers might not have the right session IDs for other workers.

4. Write or update the E2E test at `mcp-coordinator/test/e2e-bidirectional-comms.test.mjs`:
   - Create a team with 2 workers (worker-a, worker-b) and a lead
   - Lead sends message to worker-a → verify worker-a receives it
   - Worker-a sends message to worker-b → verify worker-b receives it
   - Worker-b sends message back to lead → verify lead receives it
   - Broadcast from lead → verify both workers receive it
   - Test all 5 message types

5. Run `cd mcp-coordinator && npx vitest run e2e-bidirectional` to verify

Commit when done with message: "test: verify bidirectional messaging E2E — close 80% → 95% gap"

```

---

## Workstream E: E2E Plan Approval Gate Verification

**The gap:** The plan approval protocol exists (`approval.js`, `handleApprovePlan`, `handleRejectPlan`) but hasn't been verified end-to-end. Critical: native Claude Code has a KNOWN BUG (#27265, #29548) where `ExitPlanMode` auto-approves itself before the lead can review. Our system should NOT have this bug — the lead must explicitly approve.

**How native SHOULD work (but doesn't due to bug):**
1. Worker spawned with `mode: "plan"` (read-only)
2. Worker drafts plan, calls `ExitPlanMode`
3. Worker sends `plan_approval_request` to lead, then WAITS
4. Lead reviews plan, sends `plan_approval_response` (approve/reject)
5. On approve: worker exits plan mode and begins implementation
6. On reject: worker revises plan

### Prompt (paste into fresh Claude Code session):

```

cd ~/claude-lead-system

I need you to verify the plan approval gate works correctly end-to-end. This is a critical differentiator — native Claude Code has a bug where plans auto-approve. We must NOT have this bug.

## How it should work

1. Lead spawns a worker with `mode: "plan"` — worker can only read, not write
2. Worker creates a plan and signals it's ready for review (writes plan to results dir)
3. Lead calls `coord_approve_plan` or `coord_reject_plan` with the task_id
4. On approve: approval file is written, worker's inbox gets notified
5. On reject: rejection file is written with feedback, worker's inbox gets notified
6. Worker must NOT be able to auto-approve itself

## What to verify

1. Read these files:
   - `mcp-coordinator/lib/approval.js` — `handleApprovePlan`, `handleRejectPlan`
   - `mcp-coordinator/lib/workers.js` — how does `mode: "plan"` affect worker permissions?
   - `mcp-coordinator/lib/messaging.js` — `handleSendProtocol` for plan_approval_request/response

2. Key questions:
   - When mode is "plan", does the worker actually get restricted permissions? (should only have Read, Glob, Grep — no Write, Edit, Bash)
   - Is there anything that could auto-approve the plan without lead intervention?
   - Does the approval status file get written correctly?
   - Does the worker's inbox get the approval/rejection notification?

3. Fix any issues. Especially:
   - If plan mode doesn't actually restrict permissions, fix it
   - If there's any auto-approve path, remove it
   - If the approval notification doesn't reach the worker's inbox, fix the delivery

4. Write or update the E2E test at `mcp-coordinator/test/e2e-plan-approval.test.mjs`:
   - Spawn worker in plan mode
   - Worker writes plan to results dir
   - Lead approves → verify approval file exists, worker inbox has notification
   - Test rejection flow too → verify rejection file has feedback
   - Verify no auto-approve path exists (plan sits in "pending" until explicit lead action)

5. Run `cd mcp-coordinator && npx vitest run e2e-plan-approval` to verify

Commit when done with message: "test: verify plan approval gate E2E — close 85% → 95% gap"

```

---

## Workstream F: Architecture Documentation

**The purpose:** Create a single reference doc that maps native internals to our implementation. Useful for onboarding future agents and for Drew's PM portfolio.

### Prompt (paste into fresh Claude Code session):

```

cd ~/claude-lead-system

Create an architecture comparison document at `docs/ARCHITECTURE-COMPARISON.md` that maps Claude Code's native Agent Teams internals to our lead system implementation.

## Structure

### 1. Architecture Overview

Show both architectures side by side:

**Native:**

- Lead process (React/Ink, Node.js) with selectedTeammate React state
- Teammate processes spawned via child_process.spawn()
- Communication: disk-based JSON files at ~/.claude/teams/{name}/
- Display: in-process (buffered in React state) OR split-pane (separate tmux panes)

**Lead System:**

- Lead process (Claude Code with MCP coordinator)
- Worker processes (claude -p, stateless)
- Communication: JSONL inbox files + tmux push delivery
- Display: in-process (tmux capture-pane) OR split-pane (tmux auto-tile)

### 2. Feature Comparison Table

For each feature, show:
| Feature | Native | Lead System | Advantage |

Key features to compare:

- Team creation (atomic vs two-step — we're adding atomic)
- Task management (same schema — id, assigned_to, claimed_by)
- Self-claim loop (same pattern — poll pending tasks on completion)
- Messaging (native: JSON array O(N), ours: JSONL O(1) — we win)
- Plan approval (native: broken auto-approve bug, ours: real gate — we win)
- Recipient validation (native: silent failure bug, ours: validated — we win)
- Idle detection (native: unknown, ours: 3-5s via heartbeat)
- Resume (native: buggy context dropping, ours: --session-id + --resume)
- Token cost (native: coordination in context window, ours: 0 tokens — we win)
- Display modes (native: React state swap, ours: tmux capture-pane)

### 3. Known Native Bugs We've Fixed

- #27265 / #29548: Plan auto-approve (we enforce real gate)
- #25135: SendMessage silent failure (we validate recipients)
- #15837 / #10856: Resume drops context (we use session persistence)
- Inbox O(N): JSON array full read/write per message (we use JSONL append)

### 4. Spawn Command Reference

Native spawn command (from bug #24989):

```
claude --agent-id qa@myteam --agent-name qa --team-name myteam \
  --agent-color purple --parent-session-id <uuid> \
  --agent-type general-purpose --dangerously-skip-permissions \
  --model claude-opus-4-6
```

Our spawn command (from workers.js):
[Read workers.js and document the actual spawn command used]

Read these files to fill in our implementation details:

- `mcp-coordinator/lib/teams.js`
- `mcp-coordinator/lib/tasks.js`
- `mcp-coordinator/lib/messaging.js`
- `mcp-coordinator/lib/workers.js`
- `mcp-coordinator/lib/approval.js`
- `mcp-coordinator/lib/platform/common.js`

Keep it factual — no marketing language. This is a technical reference.

Commit when done with message: "docs: architecture comparison — native vs lead system"

```

---

## Execution Order

```

Phase 1 (parallel):
├── Agent 1 → Workstream A (Atomic TeamCreate)
├── Agent 2 → Workstream B (Recipient Validation)
└── Agent 3 → Workstream F (Architecture Doc)

Phase 2 (parallel, after A+B merge):
├── Agent 4 → Workstream C (Self-Claim E2E)
├── Agent 5 → Workstream D (Bidirectional Messaging E2E)
└── Agent 6 → Workstream E (Plan Approval E2E)

````

**Before each agent:** Make sure you're on a clean branch:
```bash
cd ~/claude-lead-system
git checkout main && git pull
git checkout -b workstream-X-description
````

**After each agent:** Review the diff, run tests, merge:

```bash
cd ~/claude-lead-system && npx vitest run
# If tests pass:
git checkout main && git merge workstream-X-description
```

---

## Success Criteria

When all 6 workstreams are done:

- Parity table in CLAUDE.md shows no feature below 95%
- All E2E tests pass: `npx vitest run`
- Architecture doc exists and is accurate
- 3 native bugs are explicitly NOT replicated (validated recipients, real plan gate, JSONL inbox)
