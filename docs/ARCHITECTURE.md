# Architecture

## Goal
Coordinate multiple Claude Code sessions with near-zero overhead by externalizing state into filesystem primitives.

## Layers
1. Hook Layer (`~/.claude/hooks`)
- Produces normalized session metadata (`session-*.json`)
- Captures activity stream (`activity.jsonl`)
- Delivers inbox messages (`inbox/<session>.jsonl`)

2. State Layer (`~/.claude/terminals`)
- Serves as append-only/event-log + current-state cache
- Enables cross-session coordination without transcript parsing

3. Coordinator MCP Layer (`~/.claude/mcp-coordinator/index.js`)
- Exposes orchestration tools:
  - session visibility
  - message passing
  - conflict detection
  - worker spawn/kill
  - sequential pipelines

4. Lead Command Layer (`/lead`)
- Human-facing orchestration interface driven by MCP tools + session files

## Data Contracts
### Session file (`session-<id>.json`)
Core fields:
- `session`, `status`, `project`, `branch`, `cwd`, `last_active`
- `tool_counts`, `files_touched`, `recent_ops`
- Optional `tty`, `plan_file`, `has_messages`

### Activity log (`activity.jsonl`)
Append-only events with:
- `ts`, `session`, `tool`, `file`, `path`, `project`

### Inbox (`inbox/<id>.jsonl`)
Message queue events:
- `ts`, `from`, `priority`, `content`

## Runtime Flows
### Session start
`SessionStart -> session-register.sh -> session file created`

### Tool execution
`PostToolUse -> terminal-heartbeat.sh -> activity append (+ rate-limited state update)`

### Message delivery
`coord_send_message -> inbox file append -> PreToolUse check-inbox.sh drains and prints`

### Worker lifecycle
`coord_spawn_worker -> prompt/result/meta/pid files -> terminal run -> done marker`

### Pipeline lifecycle
`coord_run_pipeline -> step prompt/result files + pipeline log/meta/done`

## Design Tradeoffs
Pros:
- Token-efficient coordination
- Low complexity and transparent debugging
- Works in terminal-first workflows

Cons:
- File-based concurrency and eventual consistency
- Terminal automation varies by platform
- Not multi-tenant/hosted-control-plane by default

## Scaling Guidance
- Keep session files small and bounded (`files_touched`, `recent_ops` limits)
- Keep activity append-only and periodically compacted
- Add lock discipline around shared mutable files when extending features
