# MCP Coordinator Tool Reference

All tools are prefixed with `coord_`. Each returns markdown-formatted text via the MCP `text/plain` content type.

## Session Management

### `coord_list_sessions`
List all active Claude sessions with enriched metadata.
- **Input**: `{ cwd?: string }`
- **Output**: Table of sessions with status, project, branch, last active, tools used

### `coord_get_session`
Get detailed info for a single session.
- **Input**: `{ session_id: string }`
- **Output**: Full session details including files touched, recent ops

### `coord_wake_session`
Send a message to a session's inbox to wake it.
- **Input**: `{ session_id: string, message: string }`
- **Output**: Confirmation with inbox path

### `coord_check_inbox`
Check a session's inbox for pending messages.
- **Input**: `{ session_id: string }`
- **Output**: Inbox contents

### `coord_detect_conflicts`
Detect file conflicts across active sessions.
- **Input**: `{ cwd?: string }`
- **Output**: List of files touched by multiple sessions

## Worker Management

### `coord_spawn_terminal`
Open a new terminal window.
- **Input**: `{ directory: string }`
- **Output**: Terminal spawn result

### `coord_spawn_worker`
Spawn a single Claude worker in a new terminal.
- **Input**: `{ name: string, prompt: string, directory: string, model?: string, agent_type?: string, permission_mode?: string }`
- **Output**: Worker spawn confirmation with task ID

### `coord_spawn_workers`
Spawn multiple workers in parallel.
- **Input**: `{ workers: [{ name, prompt, directory, model?, agent_type? }] }`
- **Output**: Spawn results for each worker

### `coord_kill_worker`
Kill a running worker process.
- **Input**: `{ task_id: string }`
- **Output**: Kill confirmation

### `coord_resume_worker`
Resume a paused worker.
- **Input**: `{ task_id: string, message?: string }`
- **Output**: Resume confirmation

### `coord_upgrade_worker`
Upgrade a worker's model or prompt.
- **Input**: `{ task_id: string, model?: string, prompt?: string }`
- **Output**: Upgrade confirmation

### `coord_get_result`
Get the result file for a completed worker task.
- **Input**: `{ task_id: string }`
- **Output**: Result contents

## Task Management

### `coord_create_task`
Create a task on the shared board.
- **Input**: `{ task_id: string, subject: string, prompt?: string, assignee?: string, priority?: string, metadata?: object }`
- **Output**: Creation confirmation

### `coord_update_task`
Update an existing task.
- **Input**: `{ task_id: string, status?: string, assignee?: string, priority?: string, result?: string, metadata?: object }`
- **Output**: Update confirmation

### `coord_list_tasks`
List all tasks, optionally filtered.
- **Input**: `{ status?: string, assignee?: string }`
- **Output**: Task table

### `coord_get_task`
Get full details for a single task.
- **Input**: `{ task_id: string }`
- **Output**: Task details

### `coord_reassign_task`
Reassign an in-progress task to a different worker. Creates handoff snapshot.
- **Input**: `{ task_id: string, new_assignee: string, feedback?: string }`
- **Output**: Reassignment confirmation with handoff file path

### `coord_get_task_audit`
Get the full audit trail for a task.
- **Input**: `{ task_id: string }`
- **Output**: Chronological event history

### `coord_check_quality_gates`
Check whether a task's quality gates are satisfied.
- **Input**: `{ task_id: string }`
- **Output**: Gate status (pass/fail per gate)

## Team Operations

### `coord_create_team`
Create a new team with configuration.
- **Input**: `{ team_name: string, spec: object }`
- **Output**: Team creation confirmation

### `coord_get_team`
Get team snapshot.
- **Input**: `{ team_name: string }`
- **Output**: Team details with members, tasks, status

### `coord_list_teams`
List all teams.
- **Input**: `{}`
- **Output**: Team summary table

### `coord_team_dispatch`
Dispatch an action to a team's worker pool.
- **Input**: `{ team_name: string, action: string, subject?: string, prompt?: string, priority?: string }`
- **Output**: Dispatch result with chosen worker

### `coord_team_status_compact`
Get compact team status (one-liner per member).
- **Input**: `{ team_name: string }`
- **Output**: Compact status summary

### `coord_team_queue_task`
Add a task to a team's queue.
- **Input**: `{ team_name: string, subject: string, prompt?: string, priority?: string, role_hint?: string }`
- **Output**: Queue confirmation

### `coord_team_assign_next`
Assign the next queued task to the best available member.
- **Input**: `{ team_name: string, assignee?: string }`
- **Output**: Assignment result or "why no candidate" explanation

### `coord_team_rebalance`
Analyze and optionally apply work rebalancing.
- **Input**: `{ team_name: string, apply?: boolean }`
- **Output**: Rebalance analysis with recommendations

## Communication

### `coord_broadcast`
Send a message to all team members.
- **Input**: `{ team_name: string, message: string }`
- **Output**: Broadcast confirmation

### `coord_send_message`
Send a direct message to a specific worker.
- **Input**: `{ team_name: string, target: string, message: string }`
- **Output**: Message delivery confirmation

### `coord_send_directive`
Send a priority directive to a worker.
- **Input**: `{ team_name: string, target: string, directive: string }`
- **Output**: Directive delivery confirmation

## Plan Approval

### `coord_approve_plan`
Approve a worker's pending plan.
- **Input**: `{ task_id: string }`
- **Output**: Approval confirmation

### `coord_reject_plan`
Reject a worker's plan with feedback.
- **Input**: `{ task_id: string, feedback: string }`
- **Output**: Rejection confirmation

### `coord_shutdown_request`
Request a worker to shut down gracefully.
- **Input**: `{ task_id: string, reason?: string }`
- **Output**: Shutdown request confirmation

### `coord_shutdown_response`
Respond to a shutdown request.
- **Input**: `{ task_id: string, approve: boolean, reason?: string }`
- **Output**: Response confirmation

## Context Sharing

### `coord_write_context`
Write shared context data accessible to all workers.
- **Input**: `{ key: string, value: string }`
- **Output**: Write confirmation

### `coord_read_context`
Read shared context data.
- **Input**: `{ key: string }`
- **Output**: Context value

### `coord_export_context`
Export all shared context.
- **Input**: `{}`
- **Output**: All context key-value pairs

## Pipeline

### `coord_run_pipeline`
Run a multi-step worker pipeline.
- **Input**: `{ name: string, steps: [{ name, prompt, directory, model? }] }`
- **Output**: Pipeline execution result

### `coord_get_pipeline`
Get pipeline status.
- **Input**: `{ name: string }`
- **Output**: Pipeline status with step results

## System

### `coord_sidecar_status`
Get sidecar process status.
- **Input**: `{}`
- **Output**: Sidecar health, port, PID
