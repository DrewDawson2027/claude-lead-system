# MCP Coordinator Tool Reference

Canonical source of truth: `mcp-coordinator/index.js` (`ALL_TOOLS`).

All tools are prefixed with `coord_`. Total registered tools: **48**.

## Snapshot and Sessions

### `coord_boot_snapshot`

Return a pre-formatted boot dashboard with sessions, conflicts, and recommended actions.

### `coord_session_health`

Check session enrichment health and sparse-data readiness for `/lead` boot.

### `coord_list_sessions`

List sessions with enriched metadata (`tool_counts`, files touched, status, and activity).

### `coord_get_session`

Get detailed metadata for one session.

### `coord_check_inbox`

Read pending inbox messages for a session.

### `coord_detect_conflicts`

Detect file overlaps across sessions.

### `coord_wake_session`

Send an inbox message and wake a target session.

### `coord_sidecar_status`

Return sidecar runtime/install status and latest snapshot metadata.

## Worker Output and Status

### `coord_get_result`

Read current or final worker output for a task.

### `coord_watch_output`

Stream recent worker output (all workers or focused worker/task).

### `coord_worker_report`

Write/read worker progress reports for lead visibility.

## Task Board

### `coord_create_task`

Create a task with optional assignee, dependencies, files, and metadata.

### `coord_update_task`

Update task state, assignee, metadata, and dependency links.

### `coord_list_tasks`

List tasks with optional filters (`status`, `assignee`, `team_name`).

### `coord_get_task`

Get full details for a single task.

### `coord_reassign_task`

Reassign an in-progress task and record handoff context.

### `coord_get_task_audit`

Return the full audit trail for a task.

### `coord_check_quality_gates`

Check acceptance/quality gate status for a task.

## Teams

### `coord_create_team`

Create or update a team with policy, members, and execution settings.

### `coord_get_team`

Get one team's current snapshot.

### `coord_list_teams`

List all teams.

### `coord_delete_team`

Delete a team (optionally deleting associated tasks).

### `coord_update_team_policy`

Patch team policy and interrupt weighting.

### `coord_team_status_compact`

Return concise operational team status.

### `coord_team_queue_task`

Queue a team task without immediate dispatch.

### `coord_claim_next_task`

Mark a completed worker task and claim the next unblocked queued task.

### `coord_team_assign_next`

Select the best teammate and dispatch the next queued task.

### `coord_team_rebalance`

Re-score/reassign queued work; supports dry-run and optional dispatch-next.

### `coord_discover_peers`

Return teammates with session IDs, roles, and presence metadata.

### `coord_drain_native_queue`

Flush native-bridge actions from queue into coordinator delivery path.

## Messaging and Control

### `coord_broadcast`

Send a message to all active sessions.

### `coord_send_directive`

Send a directive and auto-wake target session when possible.

### `coord_send_message`

Send a direct message to session ID or worker name.

### `coord_send_protocol`

Send structured protocol messages (`shutdown_*`, `plan_approval_response`).

### `coord_approve_plan`

Approve a worker plan.

### `coord_reject_plan`

Reject a worker plan with required feedback.

### `coord_shutdown_request`

Request graceful worker shutdown (with optional force-timeout).

### `coord_shutdown_response`

Respond to a shutdown request (approve/reject).

## Shared Context

### `coord_write_context`

Write shared context entries (replace or append).

### `coord_read_context`

Read shared context (single key or full context).

### `coord_export_context`

Export lead conversation context for worker bootstrapping.

## Agent Registry

### `coord_list_agents`

List agent files across local/project/user scopes.

### `coord_get_agent`

Resolve and read a single agent with scope precedence.

### `coord_create_agent`

Create an agent file with validated frontmatter.

### `coord_update_agent`

Update or rename an existing agent.

### `coord_delete_agent`

Delete an agent from one scope or all scopes.

### `coord_sync_agent_manifest`

Regenerate the `MANIFEST.md` agents table from discovered agents.

## Economics

### `coord_cost_comparison`

Report measured A/B economics evidence with claim-safe output gating.
