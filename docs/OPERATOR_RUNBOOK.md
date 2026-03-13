# Operator Runbook

## Startup

### Sidecar Server

```bash
cd claude-lead-system
npm --workspace sidecar start -- --port 9900
```

Environment variables:

- `LEAD_SIDECAR_REQUIRE_TOKEN=1` — require `Authorization: Bearer <token>` for all mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`); browser requests also require same-origin + `X-Sidecar-CSRF`

Browser security defaults:

- Sidecar browser API access is same-origin only (`http://127.0.0.1:<sidecar-port>`)
- Cross-port localhost origins (for example `http://127.0.0.1:3000`) are rejected
- `GET /v1/ui/bootstrap.json` returns `csrf_token` + `token_required` and does not return `api_token`

### MCP Coordinator

The coordinator runs as an MCP server, typically started by Claude Code automatically via `~/.claude/mcp.json`.

### Bridge

Started automatically by the sidecar when native team operations are requested.

Manual ensure attempt:

```bash
curl -X POST http://127.0.0.1:9900/v1/native/bridge/ensure -H 'Content-Type: application/json' -d '{}'
```

Interpret the response literally:

- `200` + `ok: true`: bridge session found or spawned.
- `400` + `error: bridge_spawn_failed`: sidecar could not spawn a bridge worker (for example local spawn policy blocked it).
- `400` + `error: bridge_not_running`: bridge autostart is disabled (`LEAD_SIDECAR_NATIVE_BRIDGE_AUTOSTART=0` or team `native_bridge_policy: "off"`).

## Health Checking

### Quick Health

```bash
curl http://127.0.0.1:9900/v1/health
```

### Full Diagnostics

```bash
curl -X POST http://127.0.0.1:9900/v1/diagnostics/export -H 'Content-Type: application/json' -d '{"label":"manual"}'
```

### Bridge Health

```bash
node bench/bridge-validator.mjs --port 9900
```

### Metrics

```bash
curl http://127.0.0.1:9900/v1/metrics.json
curl http://127.0.0.1:9900/v1/metrics/history?limit=10
```

### What to Monitor

| Signal              | Healthy   | Warning  | Critical           |
| ------------------- | --------- | -------- | ------------------ |
| Health endpoint     | 200 OK    | —        | Non-200 or timeout |
| Bridge status       | `healthy` | `stale`  | `degraded`/`down`  |
| Action success rate | >95%      | 80-95%   | <80%               |
| Latency p95         | <50ms     | 50-200ms | >200ms             |
| Stale workers       | 0         | 1-2      | 3+                 |
| Queue depth         | <5        | 5-10     | >10                |

## Maintenance Sweep

Runs automatically every 60 seconds by default (`LEAD_SIDECAR_MAINTENANCE_MS`, default `60000`). Handles:

- Stale inflight action recovery (5 minute timeout by default via `LEAD_SIDECAR_INFLIGHT_STALE_MS`, default `300000`)
- Action queue sweeping (expire old entries)
- Priority aging (bump old tasks)
- Auto-rebalance trigger evaluation
- Metrics snapshot persistence (throttled to 60s)

Manual trigger:

```bash
curl -X POST http://127.0.0.1:9900/v1/maintenance/run -H 'Content-Type: application/json' -d '{}'
```

## Common Failure Modes

### Sidecar won't start

- Check port conflict: `lsof -i :9900`
- Check for existing process: `pgrep -fal "server/index.js --port 9900"`
- Stop stale process: `pkill -f "server/index.js --port 9900"`

### Bridge stuck

- Check bridge status: `curl http://127.0.0.1:9900/v1/native/bridge/status`
- Attempt bridge ensure: `curl -X POST http://127.0.0.1:9900/v1/native/bridge/ensure -H 'Content-Type: application/json' -d '{}'`
- If response includes `error: bridge_spawn_failed`, treat it as a local spawn-policy failure; resolve the blocking policy, then retry `ensure`.

### Actions piling up

- Check action queue: `curl http://127.0.0.1:9900/v1/actions`
- Force maintenance: `curl -X POST http://127.0.0.1:9900/v1/maintenance/run -H 'Content-Type: application/json' -d '{}'`

### Coordinator unreachable

- MCP server may need restart via Claude Code
- Check `~/.claude/mcp.json` for coordinator config
- Verify coordinator process exists

## Log Locations

| Log               | Location                                              | Format     |
| ----------------- | ----------------------------------------------------- | ---------- |
| Timeline          | `~/.claude/lead-sidecar/logs/timeline.jsonl`          | JSONL      |
| Diagnostics       | `~/.claude/lead-sidecar/logs/diagnostics/`            | JSON files |
| Bridge validation | `~/.claude/lead-sidecar/logs/bridge-validation.jsonl` | JSONL      |
| Snapshot history  | `~/.claude/lead-sidecar/state/snapshot-history/`      | JSON files |
| Metrics history   | `~/.claude/lead-sidecar/state/metrics-history/`       | JSON files |

## Configuration Reference

### Team Policies

Set via team config files in `~/.claude/terminals/teams/<name>.json`:

```json
{
  "policy": {
    "execution_preference": "coordinator_first",
    "interrupt_weights": { "approval": 100, "bridge": 90, "stale": 80 },
    "auto_rebalance": {
      "enabled": false,
      "cooldown_ms": 60000,
      "triggers": {
        "stale_with_task": true,
        "queue_overflow": 3,
        "load_imbalance": 40
      }
    }
  }
}
```

### UI Preferences

Persisted to `~/.claude/lead-sidecar/state/ui-prefs.json`. Editable via web dashboard or:

```bash
curl -X PUT http://127.0.0.1:9900/v1/ui/preferences -H 'Content-Type: application/json' -d '{"hotkeys":{},"macros":[]}'
```
