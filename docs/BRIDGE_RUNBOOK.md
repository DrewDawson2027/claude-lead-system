# Bridge Validation Runbook

## When to Run

- Before/after deploying sidecar changes
- When bridge status shows `stale` or `degraded` in the dashboard
- During incident investigation
- As part of weekly ops sweep

## Running the Validator

```bash
# Default (port 9900, 30s stale threshold)
node bench/bridge-validator.mjs

# Custom port
node bench/bridge-validator.mjs --port 9901

# Tighter stale threshold
node bench/bridge-validator.mjs --stale-ms 15000
```

## Interpreting Results

### Check 1: `bridge_process_alive`

- **What**: Verifies the bridge process PID exists and responds to signals
- **Pass**: Process is running
- **Fail**: PID file missing, stale, or process not responding
- **Recovery**: Restart the bridge via `/team-recover` or `kill -9 <pid>` + restart

### Check 2: `heartbeat_fresh`

- **What**: Checks if the bridge heartbeat is within the stale threshold
- **Pass**: Last heartbeat < `--stale-ms` ago
- **Fail**: Heartbeat too old or missing
- **Recovery**: Check if bridge is stuck (CPU spike, blocking I/O). Restart if needed.

### Check 3: `queue_depth_ok`

- **What**: Checks pending request queue depth (threshold: 5)
- **Pass**: Queue has <= 5 pending requests
- **Fail**: Backlog detected — bridge can't keep up
- **Recovery**: Check bridge logs for errors. Increase processing capacity or restart.

### Check 4: `validation_endpoint`

- **What**: HTTP POST to `/native/bridge/validate` on the sidecar
- **Pass**: Endpoint returns 200 OK
- **Fail**: Sidecar unreachable or endpoint error
- **Recovery**: Verify sidecar is running. Check port binding. Review sidecar logs.

### Check 5: `bridge_health_status`

- **What**: Aggregate health via `getBridgeHealth()` — combines all signals
- **Pass**: `bridge_status === 'healthy'`
- **Fail**: Status is `stale`, `degraded`, or `down`
- **Recovery**: Address the specific failing sub-check above.

## Proof Output

Results are appended to `~/.claude/lead-sidecar/logs/bridge-validation.jsonl` for audit trail.

Each record:

```json
{
  "all_passed": true,
  "checks": [...],
  "timestamp": "2026-02-22T...",
  "port": 9900,
  "stale_threshold_ms": 30000
}
```

## Integration with Sidecar

The sidecar's `maintenanceSweep()` runs every 15 seconds and automatically:

- Detects stuck bridge requests
- Sweeps stale bridge queues
- Emits `native.bridge.status` SSE events

The bridge validator provides deeper point-in-time verification beyond what the sweep covers.

## Emergency Procedures

1. **Bridge completely down**: `node sidecar/server/index.js --port 9900` (sidecar restarts bridge)
2. **Bridge stuck**: `kill -9 $(cat ~/.claude/lead-sidecar/runtime/native/bridge.lock)` then restart
3. **Queue backlog**: `rm ~/.claude/lead-sidecar/runtime/native/bridge.request-queue/*` then restart
