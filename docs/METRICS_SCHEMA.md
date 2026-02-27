# Metrics Schema

Documentation for the sidecar metrics endpoints.

## Endpoints

### `GET /v1/metrics.json`

Returns the current metrics snapshot.

```bash
curl -s http://127.0.0.1:7199/v1/metrics.json | jq .
```

**Response:**

```json
{
  "actions_dispatched": 42,
  "actions_completed": 38,
  "actions_failed": 2,
  "actions_retried": 1,
  "actions_fallback": 1,
  "bridge_requests_sent": 15,
  "bridge_responses_received": 14,
  "bridge_timeouts": 1,
  "rebuilds": 12,
  "maintenance_sweeps": 8,
  "checkpoints_created": 5,
  "sse_connections": 2,
  "generated_at": "2026-02-25T14:32:01Z"
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `actions_dispatched` | number | Total actions dispatched since startup |
| `actions_completed` | number | Actions that completed successfully |
| `actions_failed` | number | Actions that failed |
| `actions_retried` | number | Actions retried after failure |
| `actions_fallback` | number | Actions sent to fallback path |
| `bridge_requests_sent` | number | Native bridge requests sent |
| `bridge_responses_received` | number | Native bridge responses received |
| `bridge_timeouts` | number | Bridge requests that timed out |
| `rebuilds` | number | Snapshot rebuilds performed |
| `maintenance_sweeps` | number | Maintenance sweeps executed |
| `checkpoints_created` | number | Recovery checkpoints created |
| `sse_connections` | number | Active SSE connections |
| `generated_at` | ISO 8601 | When the snapshot was taken |

---

### `GET /v1/metrics/history`

Returns historical metrics snapshots persisted to disk.

```bash
curl -s "http://127.0.0.1:7199/v1/metrics/history?limit=10" | jq .
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 100 | Max snapshots to return |

**Response:**

```json
{
  "ok": true,
  "count": 10,
  "snapshots": [
    { "actions_dispatched": 10, "generated_at": "2026-02-25T14:00:00Z", ... },
    { "actions_dispatched": 42, "generated_at": "2026-02-25T14:32:01Z", ... }
  ]
}
```

**Collection method:** The `MetricsTracker` persists a snapshot to `{metricsHistoryDir}/metrics-{timestamp}.json` during each maintenance sweep (default: every 60 seconds).

**Retention:** Up to 100 snapshots are returned. Older files are retained on disk but not loaded by this endpoint.

---

### `GET /v1/metrics/diff`

Returns the diff between the oldest and newest metrics snapshots in history.

```bash
curl -s http://127.0.0.1:7199/v1/metrics/diff | jq .
```

**Response:**

```json
{
  "ok": true,
  "diff": {
    "actions_dispatched": { "before": 10, "after": 42, "delta": 32 },
    "actions_completed": { "before": 8, "after": 38, "delta": 30 },
    "actions_failed": { "before": 1, "after": 2, "delta": 1 },
    "rebuilds": { "before": 3, "after": 12, "delta": 9 }
  }
}
```

If fewer than 2 snapshots exist:

```json
{
  "ok": true,
  "diff": null,
  "reason": "need at least 2 snapshots"
}
```

**Fields in diff:** Each numeric field from the metrics snapshot is compared. Only fields with a non-zero delta are included.

---

## Collection Method

Metrics are collected in-memory by `MetricsTracker` and incremented on each relevant event:

1. **Action dispatch** — `actions_dispatched` incremented when `runTrackedAction` is called
2. **Action completion** — `actions_completed` or `actions_failed` incremented on result
3. **Bridge operations** — counters incremented by the native bridge adapter
4. **Rebuilds** — incremented each time `rebuild()` is called
5. **Maintenance** — incremented each sweep cycle

Snapshots are persisted to disk during maintenance sweeps, creating a time series of JSON files in the metrics history directory.

## References

- `sidecar/native/metrics.js` — `MetricsTracker` implementation
- `sidecar/server/routes/system.ts` — Route handlers
- `docs/OPERATIONAL_SLOS.md` — Performance targets
