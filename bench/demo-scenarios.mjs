#!/usr/bin/env node
/**
 * Demo scenarios against live supported sidecar endpoints.
 *
 * Usage: node bench/demo-scenarios.mjs --port PORT
 * Requires a running sidecar instance.
 */

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 9900;
const BASE = `http://127.0.0.1:${PORT}`;

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data, path };
}

async function scenario(name, fn) {
  const t0 = performance.now();
  try {
    const details = await fn();
    return { scenario: name, passed: true, duration_ms: +(performance.now() - t0).toFixed(1), details };
  } catch (err) {
    return { scenario: name, passed: false, duration_ms: +(performance.now() - t0).toFixed(1), error: err.message };
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

/* ── Scenario 1: API Health + Schema ─────────────────────────────── */
async function healthAndSchema() {
  const health = await api('GET', '/v1/health');
  assert(health.ok, `/v1/health should be OK (got ${health.status})`);

  const schemaVersion = await api('GET', '/v1/schema/version');
  assert(schemaVersion.ok, '/v1/schema/version should be OK');
  assert(schemaVersion.data?.api_version === 'v1', 'api_version should be v1');

  const routes = await api('GET', '/v1/schema/routes');
  assert(routes.ok, '/v1/schema/routes should be OK');
  assert(Array.isArray(routes.data?.routes), 'schema routes payload should include routes[]');

  return {
    health_status: health.data?.status,
    api_version: schemaVersion.data?.api_version,
    route_count: routes.data?.routes?.length ?? 0,
  };
}

/* ── Scenario 2: Metrics + Timeline ──────────────────────────────── */
async function metricsAndTimeline() {
  const metrics = await api('GET', '/v1/metrics.json');
  assert(metrics.ok, '/v1/metrics.json should be OK');

  const history = await api('GET', '/v1/metrics/history?limit=10');
  assert(history.ok, '/v1/metrics/history should be OK');

  const diff = await api('GET', '/v1/metrics/diff');
  assert(diff.ok, '/v1/metrics/diff should be OK');

  const timeline = await api('GET', '/v1/timeline/replay');
  assert(timeline.ok, '/v1/timeline/replay should be OK');

  return {
    history_count: history.data?.count ?? 0,
    has_diff: diff.data?.diff !== undefined,
    replay_events: Array.isArray(timeline.data?.events) ? timeline.data.events.length : 0,
  };
}

/* ── Scenario 3: Diagnostics + Reports ───────────────────────────── */
async function diagnosticsAndReports() {
  const diag = await api('POST', '/v1/diagnostics/export', { label: 'demo-diagnostics' });
  assert(diag.ok, '/v1/diagnostics/export should succeed');
  assert(typeof diag.data?.file === 'string', 'diagnostics export should return a file path');

  const latestDiag = await api('GET', '/v1/diagnostics/latest');
  assert(latestDiag.ok, '/v1/diagnostics/latest should be OK');

  const report = await api('POST', '/v1/reports/comparison', { label: 'demo-report' });
  assert(report.ok, '/v1/reports/comparison should succeed');
  assert(report.data?.markdown, 'Report should contain markdown');
  assert(report.data?.json, 'Report should contain JSON summary');

  const latest = await api('GET', '/v1/reports/latest');
  assert(latest.ok, '/v1/reports/latest should be accessible');

  return {
    diagnostics_file: diag.data?.file,
    has_latest_diagnostics: Boolean(latestDiag.data?.latest),
    report_file: report.data?.file,
    has_markdown: Boolean(report.data?.markdown),
    report_json_keys: Object.keys(report.data?.json || {}).length,
  };
}

/* ── Scenario 4: Maintenance + Consistency ───────────────────────── */
async function maintenanceAndConsistency() {
  const run = await api('POST', '/v1/maintenance/run', { source: 'demo' });
  assert(run.ok, '/v1/maintenance/run should succeed');
  const maintenanceOk = run.data?.ok === true;
  assert(maintenanceOk, '/v1/maintenance/run should return ok=true');

  const consistency = await api('GET', '/v1/events/consistency');
  assert(consistency.ok, '/v1/events/consistency should be OK');
  const consistencyMatch = consistency.data?.consistent === true;
  assert(
    consistencyMatch,
    '/v1/events/consistency should report consistent=true',
  );

  const rebuildCheck = await api('POST', '/v1/events/rebuild-check', {});
  assert(rebuildCheck.ok, '/v1/events/rebuild-check should be OK');
  const rebuildCheckMatch = rebuildCheck.data?.consistent === true;
  assert(
    rebuildCheckMatch,
    '/v1/events/rebuild-check should report consistent=true',
  );

  const snapshotDiff = await api('POST', '/v1/snapshots/diff', {});
  assert(snapshotDiff.ok, '/v1/snapshots/diff should be OK');

  return {
    maintenance_ok: maintenanceOk,
    consistency_match: consistencyMatch,
    rebuild_check_match: rebuildCheckMatch,
    snapshot_diff_present: snapshotDiff.data?.diff !== undefined,
  };
}

/* ── Scenario 5: Action Routing Simulation ───────────────────────── */
async function routingSimulation() {
  const simulation = await api('POST', '/v1/route/simulate', {
    team_name: 'demo-team',
    action: 'dispatch',
    payload: {
      team_name: 'demo-team',
      subject: 'demo',
      prompt: 'Validate route decision path only',
    },
  });
  assert(simulation.ok, '/v1/route/simulate should succeed');
  assert(simulation.data?.decision, 'route simulation should return decision');

  const actions = await api('GET', '/v1/actions');
  assert(actions.ok, '/v1/actions should be accessible');
  assert(Array.isArray(actions.data?.actions), '/v1/actions should return actions[]');

  return {
    decision_adapter: simulation.data?.decision?.adapter ?? null,
    decision_reason: simulation.data?.decision?.reason ?? null,
    action_queue_size: actions.data?.actions?.length ?? 0,
  };
}

/* ── Run all ─────────────────────────────────────────────────────── */
const results = [];
results.push(await scenario('health_and_schema', healthAndSchema));
results.push(await scenario('metrics_and_timeline', metricsAndTimeline));
results.push(await scenario('diagnostics_and_reports', diagnosticsAndReports));
results.push(await scenario('maintenance_and_consistency', maintenanceAndConsistency));
results.push(await scenario('routing_simulation', routingSimulation));

const allPassed = results.every(r => r.passed);
const output = {
  all_passed: allPassed,
  passed: results.filter(r => r.passed).length,
  total: results.length,
  scenarios: results,
  generated_at: new Date().toISOString(),
};

console.log(JSON.stringify(output, null, 2));
process.exit(allPassed ? 0 : 1);
