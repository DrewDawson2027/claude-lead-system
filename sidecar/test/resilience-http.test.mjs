import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJSON, readJSONL } from '../core/fs-utils.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'resilience-http-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'resilience.json'), JSON.stringify({
    team_name: 'resilience',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 'r1', role: 'tester' }],
    policy: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }));
  return home;
}

function requestJson(port, path, method, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: body === null ? headers : { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw || '{}') }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: raw }); }
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body || {}));
    req.end();
  });
}

function getJson(port, path, headers = {}) {
  return requestJson(port, path, 'GET', null, headers);
}

function postJson(port, path, body, headers = {}) {
  return requestJson(port, path, 'POST', body, headers);
}

function saveEnv(...keys) {
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  return saved;
}

function restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Item 3: Shutdown consistency — no orphan lock/port files
// ═══════════════════════════════════════════════════════════════════════════════

test('shutdown cleanup removes lock and port files', async () => {
  const env = saveEnv('HOME');
  const home = setupHome();
  process.env.HOME = home;

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const lockFile = join(runtimeDir, 'sidecar.lock');
  const portFile = join(runtimeDir, 'sidecar.port');

  try {
    // Verify files exist after startup
    assert.ok(existsSync(lockFile), 'Lock file should exist after start');
    assert.ok(existsSync(portFile), 'Port file should exist after start');

    // Verify health works
    const health = await getJson(sidecar.port, '/health');
    assert.equal(health.status, 200);

    // Shutdown
    sidecar.close();

    // Wait briefly for cleanup
    await new Promise(r => setTimeout(r, 200));

    // Verify files cleaned up
    assert.equal(existsSync(lockFile), false, 'Lock file should be removed after shutdown');
    assert.equal(existsSync(portFile), false, 'Port file should be removed after shutdown');
  } finally {
    try { sidecar.close(); } catch {}
    restoreEnv(env);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 4: Restart continuity — state survives across boots
// ═══════════════════════════════════════════════════════════════════════════════

test('state survives sidecar restart', async () => {
  const env = saveEnv('HOME');
  const home = setupHome();
  process.env.HOME = home;

  // Boot #1: create state
  const mod1 = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar1 = await mod1.startSidecarServer({ port: 0 });
  try {
    // Set some team state
    const health1 = await getJson(sidecar1.port, '/health');
    assert.equal(health1.status, 200);
    assert.ok(health1.body.teams >= 1, 'Should have at least 1 team');

    // Create a checkpoint
    const cpResult = await postJson(sidecar1.port, '/checkpoints/create', { label: 'boot-1' }, {
      Authorization: `Bearer ${sidecar1.apiToken}`,
    });
    assert.equal(cpResult.status, 200);
    assert.equal(cpResult.body.ok, true);
  } finally {
    sidecar1.close();
    await new Promise(r => setTimeout(r, 200));
  }

  // Boot #2: verify state persisted
  const mod2 = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar2 = await mod2.startSidecarServer({ port: 0 });
  try {
    const health2 = await getJson(sidecar2.port, '/health');
    assert.equal(health2.status, 200);
    assert.ok(health2.body.teams >= 1, 'Teams should persist across restart');

    // Checkpoints from boot #1 should be listable
    const cpList = await getJson(sidecar2.port, '/checkpoints');
    assert.equal(cpList.status, 200);
    assert.ok(cpList.body.checkpoints.length >= 1, 'Checkpoints should survive restart');
    assert.ok(cpList.body.checkpoints.some(cp => cp.label === 'boot-1'), 'boot-1 checkpoint should exist');

    // Timeline log should have events from both boots
    const logFile = join(home, '.claude', 'lead-sidecar', 'logs', 'timeline.jsonl');
    if (existsSync(logFile)) {
      const events = readJSONL(logFile);
      assert.ok(events.length >= 2, 'Timeline should have events from both boots');
    }
  } finally {
    sidecar2.close();
    restoreEnv(env);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 5: Concurrent mutation tests under load
// ═══════════════════════════════════════════════════════════════════════════════

test('concurrent mutations produce no 500 errors', async () => {
  const env = saveEnv('HOME', 'LEAD_SIDECAR_RATE_LIMIT', 'LEAD_SIDECAR_RATE_WINDOW_MS');
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_RATE_LIMIT = '200'; // high limit for load test
  process.env.LEAD_SIDECAR_RATE_WINDOW_MS = '60000';

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port, apiToken } = sidecar;
  const authHeaders = { Authorization: `Bearer ${apiToken}` };

  try {
    // Fire 10 concurrent POST /maintenance/run
    const maintenancePromises = Array.from({ length: 10 }, (_, i) =>
      postJson(port, '/maintenance/run', { source: `concurrent-${i}` }, authHeaders)
    );

    // Fire 5 concurrent checkpoint creates
    const checkpointPromises = Array.from({ length: 5 }, (_, i) =>
      postJson(port, '/checkpoints/create', { label: `load-${i}` }, authHeaders)
    );

    const results = await Promise.all([...maintenancePromises, ...checkpointPromises]);

    // No 500 errors
    const serverErrors = results.filter(r => r.status >= 500);
    assert.equal(serverErrors.length, 0, `No 500 errors expected, got ${serverErrors.length}`);

    // All responses should be valid JSON with ok field
    for (const r of results) {
      assert.equal(typeof r.body, 'object', 'Response body should be JSON object');
    }

    // State file should be valid JSON after concurrent writes
    const snapshotFile = join(home, '.claude', 'lead-sidecar', 'state', 'latest.json');
    if (existsSync(snapshotFile)) {
      const snap = readJSON(snapshotFile);
      assert.ok(snap, 'Snapshot file should be valid JSON after concurrent mutations');
    }
  } finally {
    sidecar.close();
    restoreEnv(env);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 8: Health endpoint enrichment verification
// ═══════════════════════════════════════════════════════════════════════════════

test('health endpoint includes queue_depth, lock_age_ms, checkpoint_freshness', async () => {
  const env = saveEnv('HOME');
  const home = setupHome();
  process.env.HOME = home;

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port, apiToken } = sidecar;

  try {
    // First check health without checkpoints
    const health1 = await getJson(port, '/health');
    assert.equal(health1.status, 200);

    // queue_depth should have counts
    assert.ok(health1.body.queue_depth, 'queue_depth should be present');
    assert.equal(typeof health1.body.queue_depth.pending, 'number');
    assert.equal(typeof health1.body.queue_depth.inflight, 'number');
    assert.equal(typeof health1.body.queue_depth.done, 'number');
    assert.equal(typeof health1.body.queue_depth.failed, 'number');

    // lock_age_ms should be a number >= 0 (sidecar just started, lock was written)
    assert.equal(typeof health1.body.lock_age_ms, 'number');
    assert.ok(health1.body.lock_age_ms >= 0, 'lock_age_ms should be >= 0');

    // Boot may create a periodic checkpoint, so checkpoint_freshness may already be present
    // Either way, after creating our own checkpoint it should definitely be there
    const cpResult = await postJson(port, '/checkpoints/create', { label: 'health-test' }, {
      Authorization: `Bearer ${apiToken}`,
    });
    assert.equal(cpResult.status, 200);

    // Check health after checkpoint creation
    const health2 = await getJson(port, '/health');
    assert.equal(health2.status, 200);
    assert.ok(health2.body.checkpoint_freshness, 'checkpoint_freshness should be present after checkpoint');
    assert.equal(typeof health2.body.checkpoint_freshness.newest_age_ms, 'number');
    assert.ok(health2.body.checkpoint_freshness.newest_age_ms >= 0);
    // The newest should be our 'health-test' (just created) or 'periodic' if boot was more recent
    assert.equal(typeof health2.body.checkpoint_freshness.newest_label, 'string');
  } finally {
    sidecar.close();
    restoreEnv(env);
  }
});

test('health endpoint queue_depth reflects queued actions', async () => {
  const env = saveEnv('HOME', 'LEAD_SIDECAR_NATIVE_ENABLE', 'LEAD_SIDECAR_NATIVE_RUNNER_MOCK', 'LEAD_SIDECAR_NATIVE_BRIDGE_MOCK', 'LEAD_SIDECAR_RATE_LIMIT');
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_NATIVE_ENABLE = '1';
  process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = '1';
  process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK = '1';
  process.env.LEAD_SIDECAR_RATE_LIMIT = '200';

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port, apiToken } = sidecar;

  try {
    // Get baseline queue depth
    const before = await getJson(port, '/health');
    const basePending = before.body.queue_depth?.pending || 0;

    // Queue an action
    await postJson(port, '/native/actions/task', {
      team_name: 'resilience',
      agent: 'r1',
      task: 'Queue depth test',
    }, { Authorization: `Bearer ${apiToken}` });

    // Check queue depth increased
    const after = await getJson(port, '/health');
    // The action may have already completed (mock runner), so check done or pending increased
    const totalAfter = (after.body.queue_depth?.pending || 0) +
                       (after.body.queue_depth?.done || 0) +
                       (after.body.queue_depth?.failed || 0) +
                       (after.body.queue_depth?.inflight || 0);
    const totalBefore = (before.body.queue_depth?.pending || 0) +
                        (before.body.queue_depth?.done || 0) +
                        (before.body.queue_depth?.failed || 0) +
                        (before.body.queue_depth?.inflight || 0);
    assert.ok(totalAfter > totalBefore, 'Total actions should increase after queuing');
  } finally {
    sidecar.close();
    restoreEnv(env);
  }
});
