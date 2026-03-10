# Sidecar HTTP API Contract

Base URL: `http://127.0.0.1:<port>` (default 9900, configurable via `--port`)

## Authentication

- **API Token**: Required when `LEAD_SIDECAR_REQUIRE_TOKEN=1`. Pass via `Authorization: Bearer <token>` or `?token=<token>`.
- **CSRF Token**: Required for POST/PUT/PATCH/DELETE. Pass via `X-CSRF-Token` header. Obtain from `GET /ui/bootstrap.json`.

## Health & System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` or `/health.json` | System health check |
| GET | `/schema/version` | Current schema version + validation |
| GET | `/ui/bootstrap.json` | CSRF token, auth config |
| POST | `/maintenance/run` | Trigger maintenance sweep |
| POST | `/diagnostics/export` | Export diagnostics bundle |
| GET | `/diagnostics/latest` | Latest diagnostics file |
| POST | `/open-dashboard` | Open web dashboard in browser |
| POST | `/rebuild` | Force snapshot rebuild |

## Metrics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metrics.json` | Current metrics snapshot |
| GET | `/metrics/history` | Historical metrics snapshots. `?limit=N` |
| GET | `/metrics/diff` | Diff between earliest and latest metric snapshot |

## Reports

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/reports/comparison` | `{ label?, baseline_file? }` | Generate comparison report |
| GET | `/reports/latest` | — | Latest report markdown |

## Snapshots & Timeline

| Method | Path | Body/Params | Description |
|--------|------|-------------|-------------|
| POST | `/snapshots/diff` | `{ before_ts?, after_ts? }` | Diff two snapshot history entries |
| GET | `/timeline/replay` | `?from=<ts>&to=<ts>&type=<filter>` | Replay filtered timeline events |

## Teams

| Method | Path | Description |
|--------|------|-------------|
| GET | `/teams` | List all teams |
| GET | `/teams/:name` | Team snapshot |
| GET | `/teams/:name/interrupts` | Interrupt queue for team |
| GET | `/teams/:name/approvals` | Approval inbox (filtered interrupts) |
| PATCH | `/teams/:name/interrupt-priorities` | Update interrupt priority weights |
| POST | `/teams/:name/rebalance` | Trigger team rebalance |
| GET | `/teams/:name/rebalance-explain` | Get rebalance explanation |
| POST | `/teams/:name/rebalance-explain` | Generate rebalance explanation |
| POST | `/teams/:name/actions/:action` | Execute team action via router |
| POST | `/teams/:name/batch-triage` | Batch triage ops |

## Tasks

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/teams/:name/tasks/:id/audit` | — | Task audit trail |
| POST | `/teams/:name/tasks/:id/reassign` | `{ new_assignee, reason?, progress_context? }` | Reassign in-progress task |
| POST | `/teams/:name/tasks/:id/gate-check` | — | Check quality gates |

## Task Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/task-templates` | List templates |
| POST | `/task-templates` | Create template |

## Route Simulation

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/route/simulate` | `{ action, payload }` | Simulate routing decision |

## Dispatch

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/dispatch` | `{ team_name, subject?, prompt?, directory?, priority?, role?, files?, blocked_by?, metadata?, force_path? }` | Dispatch action |

## Native Bridge

| Method | Path | Description |
|--------|------|-------------|
| GET | `/native/status` | Native adapter status |
| GET | `/native/bridge/status` | Bridge status |
| GET | `/native/bridge/validation` | Bridge validation result |
| POST | `/native/bridge/ensure` | Ensure bridge running |
| POST | `/native/bridge/validate` | Run bridge validation |
| POST | `/native/probe` | Probe native capabilities |
| POST | `/native/actions/:action` | Execute via native adapter |

## Actions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/actions` | List action queue |
| GET | `/actions/:id` | Get action details |
| POST | `/actions/:id/retry` | Retry failed action |
| POST | `/actions/:id/fallback` | Execute fallback for failed action |

## UI Preferences

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ui/preferences` | Load server-side preferences |
| PUT | `/ui/preferences` | Save preferences |

## Static UI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` or `/index.html` | Web dashboard HTML |
| GET | `/ui/app.js` | Web dashboard JavaScript |

## SSE Events

| Event | Payload | Description |
|-------|---------|-------------|
| `snapshot` | Full snapshot | Snapshot rebuilt |
| `team.updated` | `{ ts, teams }` | Team state changed |
| `timeline.event` | `{ ts, type, ... }` | Timeline event fired |
| `action.queued` | `{ action_id, action }` | Action enqueued |
| `action.started` | `{ action_id, action }` | Action started |
| `action.completed` | `{ action_id, result }` | Action completed |
| `action.failed` | `{ action_id, error }` | Action failed |
| `alert.raised` | `{ level, message }` | Alert raised |
| `metrics.updated` | `{ ts, metrics }` | Metrics updated |
| `native.bridge.status` | `{ ts, bridge_status }` | Bridge status changed |

## Error Format

All errors return `{ error: "message" }` with appropriate HTTP status codes (400, 401, 403, 404, 500).
