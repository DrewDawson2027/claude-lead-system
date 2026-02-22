#!/usr/bin/env node
/**
 * End-to-end demo scenarios exercising the sidecar system.
 *
 * Usage: node bench/demo-scenarios.mjs --port PORT
 * Requires a running sidecar instance.
 */

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 9900;
const BASE = `http://127.0.0.1:${PORT}`;

async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
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

/* ── Scenario 1: Happy Path ──────────────────────────────────────── */
async function happyPath() {
  // Health check
  const health = await api('GET', '/health.json');
  assert(health.ok, 'Health endpoint should be OK');

  // Trigger snapshot rebuild
  const rebuild = await api('POST', '/rebuild', { source: 'demo' });

  // Get snapshot
  const snap = await api('GET', '/snapshot.json');
  assert(snap.ok, 'Snapshot should be accessible');

  // Get metrics
  const metrics = await api('GET', '/metrics.json');
  assert(metrics.ok, 'Metrics should be accessible');

  // Export diagnostics
  const diag = await api('POST', '/diagnostics/export', { label: 'demo-happy-path' });
  assert(diag.ok, 'Diagnostics export should succeed');

  return { health: health.data, has_snapshot: !!snap.data, diagnostics_file: diag.data?.file };
}

/* ── Scenario 2: Metrics History ─────────────────────────────────── */
async function metricsHistory() {
  // Fetch metrics history
  const history = await api('GET', '/metrics/history?limit=10');
  assert(history.ok, 'Metrics history should be accessible');

  // Fetch metrics diff
  const diff = await api('GET', '/metrics/diff');
  assert(diff.ok, 'Metrics diff should be accessible');

  return { history_count: history.data?.count ?? 0, has_diff: !!diff.data?.diff };
}

/* ── Scenario 3: Comparison Report ───────────────────────────────── */
async function comparisonReport() {
  const report = await api('POST', '/reports/comparison', { label: 'demo-report' });
  assert(report.ok, 'Report generation should succeed');
  assert(report.data?.markdown, 'Report should contain markdown');
  assert(report.data?.json, 'Report should contain JSON summary');

  const latest = await api('GET', '/reports/latest');
  assert(latest.ok, 'Latest report should be accessible');

  return { report_file: report.data?.file, has_markdown: !!report.data?.markdown, json_keys: Object.keys(report.data?.json || {}) };
}

/* ── Scenario 4: Dispatch Routing ────────────────────────────────── */
async function dispatchRouting() {
  // Route simulation
  const sim = await api('POST', '/route/simulate', { action: 'coord_list_tasks', payload: {} });
  assert(sim.ok, 'Route simulation should succeed');

  return { simulation: sim.data };
}

/* ── Scenario 5: System Diagnostics ──────────────────────────────── */
async function systemDiagnostics() {
  // Full diagnostics bundle
  const diag = await api('POST', '/diagnostics/export', { label: 'demo-full' });
  assert(diag.ok, 'Diagnostics export should succeed');

  // Schema version check
  const latest = await api('GET', '/diagnostics/latest');
  assert(latest.ok, 'Diagnostics latest should be accessible');

  // Maintenance sweep
  const sweep = await api('POST', '/maintenance/run', {});
  assert(sweep.ok, 'Maintenance sweep should succeed');

  return { diagnostics: diag.data, has_latest: !!latest.data };
}

/* ── Run all ─────────────────────────────────────────────────────── */
const results = [];
results.push(await scenario('happy_path', happyPath));
results.push(await scenario('metrics_history', metricsHistory));
results.push(await scenario('comparison_report', comparisonReport));
results.push(await scenario('dispatch_routing', dispatchRouting));
results.push(await scenario('system_diagnostics', systemDiagnostics));

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
