# Operator Runbook

## Startup

### Sidecar Server

```bash
cd claude-lead-system
node sidecar/server/index.js --port 9900
```

Environment variables:

- `LEAD_SIDECAR_REQUIRE_TOKEN=1` — require `Authorization: Bearer <token>` for all mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`); browser requests also require same-origin + `X-Sidecar-CSRF`

Browser security defaults:

- Sidecar browser API access is same-origin only (`http://127.0.0.1:<sidecar-port>`)
- Cross-port localhost origins (for example `http://127.0.0.1:3000`) are rejected
- `GET /ui/bootstrap.json` returns `csrf_token` + `token_required` and does not return `api_token`

### MCP Coordinator

The coordinator runs as an MCP server, typically started by Claude Code automatically via `~/.claude/mcp.json`.

### Bridge

Started automatically by the sidecar when native team operations are requested. Manual start:

```bash
POST http://127.0.0.1:9900/native/bridge/ensure
```

## Health Checking

### Quick Health

```bash
curl http://127.0.0.1:9900/health.json
```

### Full Diagnostics

```bash
curl -X POST http://127.0.0.1:9900/diagnostics/export -d '{"label":"manual"}'
```

### Bridge Health

```bash
node bench/bridge-validator.mjs --port 9900
```

### Metrics

```bash
curl http://127.0.0.1:9900/metrics.json
curl http://127.0.0.1:9900/metrics/history?limit=10
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

Runs automatically every 15 seconds. Handles:

- Stale inflight action recovery (60s timeout)
- Action queue sweeping (expire old entries)
- Priority aging (bump old tasks)
- Auto-rebalance trigger evaluation
- Metrics snapshot persistence (throttled to 60s)

Manual trigger:

```bash
curl -X POST http://127.0.0.1:9900/maintenance/run
```

## Common Failure Modes

### Sidecar won't start

- Check port conflict: `lsof -i :9900`
- Check lock file: `cat ~/.claude/lead-sidecar/runtime/sidecar.lock`
- Remove stale lock: `rm ~/.claude/lead-sidecar/runtime/sidecar.lock`

### Bridge stuck

- Check process: `cat ~/.claude/lead-sidecar/runtime/native/bridge.lock`
- Kill and restart: `kill -9 <pid>` → `POST /native/bridge/ensure`

### Actions piling up

- Check action queue: `curl http://127.0.0.1:9900/actions`
- Retry failed: `curl -X POST http://127.0.0.1:9900/actions/<id>/retry`
- Force maintenance: `curl -X POST http://127.0.0.1:9900/maintenance/run`

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
curl -X PUT http://127.0.0.1:9900/ui/preferences -d '{"hotkeys":{},"macros":[]}'
```
