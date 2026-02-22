#!/usr/bin/env node
/**
 * Bridge Validation Script — proof output for live bridge health.
 *
 * Usage: node bench/bridge-validator.mjs [--port PORT] [--stale-ms MS]
 *
 * Checks:
 *   1. Bridge process alive (PID file + process signal)
 *   2. Heartbeat freshness (within stale threshold)
 *   3. Request queue depth (no backlog)
 *   4. Sidecar validation endpoint responsive
 *   5. getBridgeHealth() overall status
 *
 * Outputs JSON proof record to stdout, appends to bridge-validation.jsonl.
 */

import { readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBridgeHealth } from '../sidecar/native/bridge-health.js';
import { sidecarPaths } from '../sidecar/core/paths.js';

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const staleIdx = args.indexOf('--stale-ms');
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 9900;
const staleMs = staleIdx >= 0 ? Number(args[staleIdx + 1]) : 30000;

const paths = sidecarPaths();
const checks = [];

// Single getBridgeHealth call — reused across checks 1, 2, 5
let bridgeHealth;
try {
  bridgeHealth = getBridgeHealth(paths, staleMs);
} catch (err) {
  bridgeHealth = { ok: false, process_alive: false, error: err.message };
}

// Check 1: Bridge process alive
checks.push({
  name: 'bridge_process_alive',
  passed: bridgeHealth.process_alive === true,
  detail: bridgeHealth.process_alive ? `PID ${bridgeHealth.pid} alive` : `PID ${bridgeHealth.pid || 'none'} not responding`,
});

// Check 2: Heartbeat freshness
{
  const fresh = bridgeHealth.age_ms != null && bridgeHealth.age_ms <= staleMs;
  checks.push({
    name: 'heartbeat_fresh',
    passed: fresh,
    detail: bridgeHealth.age_ms != null
      ? `${(bridgeHealth.age_ms / 1000).toFixed(1)}s old (threshold: ${(staleMs / 1000).toFixed(0)}s)`
      : 'No heartbeat data',
  });
}

// Check 3: Request queue depth
try {
  const pending = readdirSync(paths.nativeBridgeRequestDir).length;
  checks.push({ name: 'queue_depth_ok', passed: pending <= 5, detail: `${pending} pending requests` });
} catch {
  checks.push({ name: 'queue_depth_ok', passed: true, detail: 'Queue directory not found (bridge not started)' });
}

// Check 4: Sidecar validation endpoint
try {
  const resp = await fetch(`http://127.0.0.1:${port}/native/bridge/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(5000),
  });
  const data = await resp.json();
  checks.push({ name: 'validation_endpoint', passed: resp.ok, detail: `HTTP ${resp.status} — ok=${data.ok}` });
} catch (err) {
  checks.push({ name: 'validation_endpoint', passed: false, detail: `Endpoint unreachable: ${err.message}` });
}

// Check 5: Overall bridge health status
checks.push({
  name: 'bridge_health_status',
  passed: bridgeHealth.ok === true,
  detail: `bridge_status=${bridgeHealth.bridge_status}, session=${bridgeHealth.session_id || 'none'}`,
});

const allPassed = checks.every(c => c.passed);
const proof = {
  all_passed: allPassed,
  checks,
  timestamp: new Date().toISOString(),
  port,
  stale_threshold_ms: staleMs,
};

// Append to audit log
try {
  appendFileSync(join(paths.logsDir, 'bridge-validation.jsonl'), JSON.stringify(proof) + '\n');
} catch {}

console.log(JSON.stringify(proof, null, 2));
process.exit(allPassed ? 0 : 1);
