# Sidecar HTTP API Contract

Base URL: `http://127.0.0.1:<port>` (default 9900, configurable via `--port`)

Optional transports:
- Unix socket mode: `--unix-socket <path>` or `LEAD_SIDECAR_UNIX_SOCKET=<path>`
- TLS/mTLS mode: `--tls-cert`, `--tls-key`, optional `--tls-ca`, `--mtls`

## Authentication

- **API Token**: When `LEAD_SIDECAR_REQUIRE_TOKEN=1`, all mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`) must pass `Authorization: Bearer <token>`.
- **CSRF Token**: Browser-origin mutations (`POST`/`PUT`/`PATCH`/`DELETE`) require `X-Sidecar-CSRF`. Obtain from `GET /ui/bootstrap.json`.
- **Browser Origin Policy**: Browser requests must come from the exact sidecar UI origin (`http://127.0.0.1:<sidecar-port>`). Cross-port localhost origins are rejected.
- **Non-browser clients**: Requests without an `Origin` header are allowed (for CLI/scripts), subject to token auth when enabled.

## Health & System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health check |
| GET | `/schema/version` | Current schema version + validation |
| GET | `/schema/routes` | API route schema payload |
| GET | `/events` | SSE event stream |
| GET | `/ui/bootstrap.json` | CSRF token + auth mode metadata (`api_token` is not returned) |
| POST | `/maintenance/run` | Trigger maintenance sweep |
| POST | `/maintenance/rotate-api-token` | Rotate API token |
| GET | `/checkpoints` | List available checkpoints |
| POST | `/checkpoints/create` | Create checkpoint |
| POST | `/checkpoints/restore` | Restore checkpoint |
| GET | `/events/consistency` | Event consistency check |
| POST | `/events/rebuild-check` | Rebuild/compare from timeline |
| POST | `/repair/scan` | Scan for corruption |
| POST | `/repair/fix` | Repair corruption |
| GET | `/schema/migrations` | Migration list and status |
| GET | `/health/locks` | Lock contention health |
| GET | `/health/terminals` | Terminal health diagnostics |
| GET | `/health/hooks` | Hook health diagnostics |
| POST | `/health/hooks/selftest` | Execute hook self-test |
| GET | `/health/security-audit` | Security audit events |
| POST | `/diagnostics/export` | Export diagnostics bundle |
| GET | `/diagnostics/latest` | Latest diagnostics file |
| GET | `/health/request-audit` | Request audit events |
| GET | `/backups` | List pre-op backups |
| POST | `/backups/restore` | Restore a backup |
| POST | `/open-dashboard` | Open web dashboard in browser (target is `https://...` when sidecar TLS mode is enabled, otherwise `http://...`) |
| GET | `/health/security-audit/export` | Schema-versioned security audit export for SIEM |

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
| GET | `/teams/:team_name` | Team snapshot |
| GET | `/teams/:team_name/interrupts` | Interrupt queue for team |
| GET | `/teams/:team_name/approvals` | Approval inbox (filtered interrupts) |
| PATCH | `/teams/:team_name/interrupt-priorities` | Update interrupt priority weights |
| POST | `/teams/:team_name/rebalance` | Trigger team rebalance |
| GET | `/teams/:team_name/rebalance-explain` | Get rebalance explanation |
| POST | `/teams/:team_name/rebalance-explain` | Generate rebalance explanation |
| POST | `/teams/:team_name/actions/:action` | Execute team action via router |
| POST | `/teams/:team_name/batch-triage` | Batch triage ops |

## Tasks

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/teams/:team_name/tasks/:task_id/audit` | — | Task audit trail |
| POST | `/teams/:team_name/tasks/:task_id/reassign` | `{ new_assignee, feedback? }` | Reassign in-progress task |
| POST | `/teams/:team_name/tasks/:task_id/gate-check` | — | Check quality gates |

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
| POST | `/dispatch` | `{ team_name, action, payload, route_mode? }` | Dispatch action |

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
| GET | `/actions/:action_id` | Get action details |
| POST | `/actions/:action_id/retry` | Retry failed action |
| POST | `/actions/:action_id/fallback` | Execute fallback for failed action |

## UI Preferences

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ui/preferences` | Load server-side preferences |
| PUT | `/ui/preferences` | Save preferences |

## Static UI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web dashboard HTML |
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

All errors return `{ error_code, message, request_id? }` (plus optional `details`) with appropriate HTTP status codes (400, 401, 403, 404, 409, 413, 429, 500).
