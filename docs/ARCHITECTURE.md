# Architecture

## Goal

Complement Claude Code Agent Teams with capabilities they lack — pre-edit conflict detection, enriched session observability, native terminal spawning, sequential pipelines, persistent state management, and recovery tooling — by externalizing state into filesystem primitives at zero token cost.

## Layers

### 1. Hook Layer (`~/.claude/hooks`)

- Produces normalized session metadata (`session-*.json`)
- Captures activity stream (`activity.jsonl`)
- Delivers inbox messages (`inbox/<session>.jsonl`)
- Pre-edit conflict detection (`conflict-guard.sh`)
- Ingests native teammate lifecycle events (`teammate-lifecycle.sh` via `TeammateIdle`/`TaskCompleted`)
- Token governance (`token-guard.py`, `agent-metrics.py`, `agent-lifecycle.sh`)
- Cross-platform utilities (`lib/portable.sh`)

### 2. State Layer (`~/.claude/terminals`)

- Append-only event log + current-state cache
- Enables cross-session coordination without transcript parsing
- Schema-versioned session files (v2)

### 3. Coordinator MCP Layer (`~/.claude/mcp-coordinator/index.js`)

- Exposes orchestration tools:
  - Session visibility and conflict detection
  - Message passing and inbox management
  - Worker spawn/kill with PID tracking
  - Sequential pipelines with status tracking
  - Role presets (model/tool/permission/isolation defaults)
  - Budget-aware plan gating (`budget_policy`, `budget_tokens`)
- Modular: 10 modules under `lib/` (security, helpers, constants, sessions, messaging, conflicts, workers, pipelines, gc, platform/)

### 4. Sidecar Control Plane (`sidecar/`)

- **HTTP bootstrap** (`server/index.js`) — thin entrypoint that launches the sidecar server
- **HTTP server assembly** (`server/create-server.ts`) — dependency wiring, request preflight/auth gating, and route dispatch
- **Route-family modules** (`server/routes/*.ts`) — `system`, `teams`, `actions`, `native`, `ui`, `maintenance`
- **Runtime modules** (`server/runtime/*.ts`) — bootstrapping, rebuild, maintenance, tracked actions, batch triage, lifecycle wiring
- **HTTP API versioning** — canonical `/v1/*` routes with temporary unversioned aliases that emit deprecation headers
- **Persistent state** (`core/state-store.js`) — EventEmitter-based in-memory state with disk persistence and JSONL timeline logging
- **Schema versioning** (`core/schema.js`) — v1→v2→v3 migration chain with dry-run support
- **Action queue** (`core/action-queue.js`) — filesystem-based queue with pending/inflight/done/failed states and per-action audit trail
- **Recovery toolkit:**
  - Checkpoints (`core/checkpoint.js`) — periodic state snapshots with create/restore/rotate lifecycle
  - Corruption repair (`core/repair.js`) — JSON/JSONL repair with backup-before-fix, corruption scanning
  - Event replay (`core/event-replay.js`) — reconstruct derived state from timeline, consistency checking against live snapshot
  - Pre-op backups (`core/pre-op-backup.js`) — state snapshots before destructive operations
- **Health monitoring:**
  - Terminal health (`core/terminal-health.js`) — zombie, stale, and dead shell detection with recovery suggestions
  - Hook watchdog (`core/hook-watchdog.js`) — syntax validation, permission checks, selftest runner
  - Lock metrics (`core/lock-metrics.js`) — contention tracking with circular buffers and percentiles
- **Safe mode** (`--safe-mode`) — read-only startup for inspection and repair without side effects
- **Native bridge** (`native/`) — AppleScript-based terminal automation (macOS)
- **Maintenance sweep** — runs every 15s: stale action recovery, priority aging, auto-rebalance, periodic checkpoints (5min), terminal health alerts, hook validation (every 150s)
- **TypeScript migration (incremental)** — sidecar server/router/routes/runtime modules are TS with `tsx` execution and `tsc --noEmit` CI typecheck; legacy JS modules remain during migration

### 5. Lead Command Layer (`/lead`)

- Human-facing orchestration interface driven by MCP tools + session files + sidecar state

## Data Contracts

### Session file (`session-<id>.json`)

Core fields:

- `session`, `status`, `project`, `branch`, `cwd`, `last_active`
- `tool_counts`, `files_touched`, `recent_ops`
- Optional `tty`, `plan_file`, `has_messages`

### Sidecar snapshot (`state/latest.json`)

- `generated_at`, `schema_version`, `teams`, `teammates`, `tasks`
- `timeline`, `adapters`, `policy_alerts`, `alerts`, `metrics`, `ui`
- `native`, `actions: { recent: [] }`

### Checkpoint (`state/checkpoints/cp-<ts>-<label>.json`)

- `schema_version`, `snapshot`, `teams: [{ file, data }]`, `tasks: [{ file, data }]`
- `label`, `created_at`

### Action queue (`runtime/actions/<state>/<id>.json`)

- `id`, `type`, `priority`, `payload`, `created_at`, `started_at`, `completed_at`
- States: `pending` → `inflight` → `done` | `failed`

### Activity log (`activity.jsonl`)

Append-only events: `ts`, `session`, `tool`, `file`, `path`, `project`

### Timeline (`logs/timeline.jsonl`)

Sidecar events: `ts`, `type`, `source`, `team_name`, metadata

### Inbox (`inbox/<id>.jsonl`)

Message queue: `ts`, `from`, `priority`, `content`

## Runtime Flows

### Session lifecycle

`SessionStart → session-register.sh → session file created`
`PostToolUse → terminal-heartbeat.sh → activity append (+ rate-limited state update)`
`SessionEnd → session-end.sh → session marked closed`

### Message delivery

`coord_send_message → inbox file append → PreToolUse check-inbox.sh drains and prints`

### Worker lifecycle

`coord_spawn_worker → prompt/result/meta/pid files → terminal run → done marker → inbox notification`

### Maintenance sweep (every 15s)

`Recover stale inflight actions → age task priorities → auto-rebalance teams → persist metrics`
`Every 5min: create periodic checkpoint → rotate old checkpoints`
`Every 150s: validate hooks → alert on failures`
`Every sweep: check terminal health → alert on zombies/dead shells`

### Recovery

`scanForCorruption(paths) → repairJSON/repairJSONL → backup originals → write repaired`
`createCheckpoint → (corruption) → restoreCheckpoint → state restored`
`rebuildFromTimeline → consistencyCheck(derived, actual) → diff report`

## Design Tradeoffs

Pros:

- Token-efficient coordination (zero API tokens for hooks + state)
- Low complexity and transparent debugging (filesystem primitives)
- Works in terminal-first workflows
- Recoverable — checkpoints, backups, and repair at every layer

Cons:

- File-based concurrency and eventual consistency
- Terminal automation varies by platform
- Not multi-tenant/hosted-control-plane by default

## Known Limitations

- Cannot replace Anthropic's internal in-process teammate UI from outside their runtime
- Cannot provide literal zero-install/no-launcher operation outside Anthropic's platform boundary
- Sidecar TS migration is incremental; some sidecar internals remain JavaScript for now

## Scaling Guidance

- Keep session files small and bounded (`files_touched`, `recent_ops` limits)
- Keep activity append-only and periodically compacted
- Add lock discipline around shared mutable files when extending features
- Use checkpoint rotation to bound disk usage (default: keep 20)
- Monitor lock contention via `/health/locks` endpoint
