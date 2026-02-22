import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-http-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'delta.json'), JSON.stringify({
    team_name: 'delta',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 'd1', role: 'researcher' }],
    policy: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }));
  return home;
}

function getJson(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) }); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function postJson(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw || '{}') }); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

test('sidecar server exposes health and teams endpoints', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const health = await getJson(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.headers.deprecation, 'true');
    assert.match(String(health.headers.link || ''), /\/v1\/health/);

    const healthV1 = await getJson(port, '/v1/health');
    assert.equal(healthV1.status, 200);
    assert.equal(healthV1.body.ok, true);
    assert.equal(healthV1.headers.deprecation, undefined);

    const teams = await getJson(port, '/teams');
    assert.equal(teams.status, 200);
    assert.equal(Array.isArray(teams.body.teams), true);
    assert.equal(teams.body.teams[0].team_name, 'delta');

    const teamsV1 = await getJson(port, '/v1/teams');
    assert.equal(teamsV1.status, 200);
    assert.deepEqual(
      teamsV1.body.teams.map((t) => t.team_name),
      teams.body.teams.map((t) => t.team_name),
    );

    const schemaLegacy = await getJson(port, '/schema/version');
    assert.equal(schemaLegacy.status, 200);
    assert.equal(typeof schemaLegacy.body.api_version, 'string');
    assert.equal(schemaLegacy.body.compat_aliases_enabled, true);
    assert.equal(typeof schemaLegacy.body.sunset_date, 'string');

    const schemaV1 = await getJson(port, '/v1/schema/version');
    assert.equal(schemaV1.status, 200);
    assert.equal(schemaV1.body.api_version, 'v1');
    assert.equal(schemaV1.headers.deprecation, undefined);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});

test('sidecar server exposes native status/probe endpoints and action queue metadata', async () => {
  const prevHome = process.env.HOME;
  const prevMock = process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
  const prevNativeEnable = process.env.LEAD_SIDECAR_NATIVE_ENABLE;
  const prevBridgeMock = process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_NATIVE_ENABLE = '1';
  process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = '1';
  process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const ns = await getJson(port, '/native/status');
    assert.equal(ns.status, 200);
    assert.equal(typeof ns.body.mode, 'string');
    assert.equal(ns.headers.deprecation, 'true');
    assert.match(String(ns.headers.link || ''), /\/v1\/native\/status/);

    const nsV1 = await getJson(port, '/v1/native/status');
    assert.equal(nsV1.status, 200);
    assert.equal(nsV1.headers.deprecation, undefined);

    const probe = await postJson(port, '/native/probe', {});
    assert.equal(probe.status, 200);
    assert.equal(probe.body.ok, true);

    const nativeTask = await postJson(port, '/native/actions/task', { team_name: 'delta', agent: 'd1', task: 'Summarize progress' });
    assert.equal(nativeTask.status, 200);
    assert.equal(nativeTask.body.adapter, 'native');
    assert.equal(Boolean(nativeTask.body.action_id), true);

    const bridgeValidate = await postJson(port, '/native/bridge/validate', { team_name: 'delta', simulate: true, timeout_ms: 3000 });
    assert.equal([200, 400].includes(bridgeValidate.status), true);
    assert.equal(typeof bridgeValidate.body.ok, 'boolean');
    assert.equal(Boolean(bridgeValidate.body.diagnostics), true);

    const bridgeValidation = await getJson(port, '/native/bridge/validation');
    assert.equal(bridgeValidation.status, 200);
    assert.equal(Boolean(bridgeValidation.body.validation), true);

    const rebalanceExplain = await getJson(port, '/teams/delta/rebalance-explain?limit=5');
    assert.equal(rebalanceExplain.status, 200);
    assert.equal(rebalanceExplain.body.ok, true);
    assert.equal(Array.isArray(rebalanceExplain.body.tasks), true);

    const actions = await getJson(port, '/actions');
    assert.equal(actions.status, 200);
    assert.equal(actions.body.actions.length >= 1, true);
    assert.equal(actions.headers.deprecation, 'true');
    assert.match(String(actions.headers.link || ''), /\/v1\/actions/);

    const actionsV1 = await getJson(port, '/v1/actions');
    assert.equal(actionsV1.status, 200);
    assert.equal(actionsV1.headers.deprecation, undefined);
    assert.equal(Array.isArray(actionsV1.body.actions), true);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK; else process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = prevMock;
    if (prevNativeEnable === undefined) delete process.env.LEAD_SIDECAR_NATIVE_ENABLE; else process.env.LEAD_SIDECAR_NATIVE_ENABLE = prevNativeEnable;
    if (prevBridgeMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK; else process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK = prevBridgeMock;
  }
});

test('sidecar secure mode enforces auth and CSRF, and Phase A maintenance/diagnostics endpoints work', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const prevWindow = process.env.LEAD_SIDECAR_RATE_WINDOW_MS;
  const prevInflight = process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  process.env.LEAD_SIDECAR_RATE_LIMIT = '6';
  process.env.LEAD_SIDECAR_RATE_WINDOW_MS = '60000';
  process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS = '1';

  const inflightDir = join(home, '.claude', 'lead-sidecar', 'runtime', 'actions', 'inflight');
  mkdirSync(inflightDir, { recursive: true });
  writeFileSync(join(inflightDir, 'A_recover.json'), JSON.stringify({
    action_id: 'A_recover',
    action: 'message',
    state: 'inflight',
    created_at: '2020-01-01T00:00:00.000Z',
    started_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    audit: [],
  }));

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
  try {
    const unauth = await postJson(port, '/maintenance/run', { source: 'test' });
    assert.equal(unauth.status, 401);

    const bootstrap = await getJson(port, '/ui/bootstrap.json');
    assert.equal(bootstrap.status, 200);
    const csrf = bootstrap.body.csrf_token;
    assert.equal(typeof csrf, 'string');

    const csrfFail = await postJson(port, '/maintenance/run', { source: 'test' }, {
      Origin: `http://127.0.0.1:${port}`,
      Authorization: `Bearer ${apiToken}`,
    });
    assert.equal(csrfFail.status, 200, 'auth header bypasses csrf by design');

    const noCsrfNoAuth = await postJson(port, '/maintenance/run', { source: 'test' }, { Origin: `http://127.0.0.1:${port}` });
    assert.equal(noCsrfNoAuth.status, 401);

    const badOrigin = await postJson(port, '/maintenance/run', { source: 'test' }, {
      Authorization: `Bearer ${apiToken}`,
      Origin: 'http://evil.example',
    });
    assert.equal(badOrigin.status, 403);

    const badKeys = await postJson(port, '/native/probe', { unexpected: true }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(badKeys.status, 400);

    let lastRate = null;
    for (let i = 0; i < 8; i += 1) {
      lastRate = await postJson(port, '/native/probe', {}, { Authorization: `Bearer ${apiToken}`, 'X-Sidecar-CSRF': csrf });
    }
    assert.equal(lastRate.status, 429);

    const maint = await postJson(port, '/maintenance/run', { source: 'test' }, { Authorization: `Bearer ${apiToken}`, 'X-Sidecar-CSRF': csrf });
    assert.equal(maint.status, 200);
    assert.equal(maint.body.ok, true);
    assert.equal(maint.body.maintenance.recovered_inflight >= 0, true);

    const actions = await getJson(port, '/actions');
    assert.equal(actions.status, 200);
    assert.equal(actions.body.actions.some((a) => a.action_id === 'A_recover' && a.state === 'failed'), true);

    const diag = await postJson(port, '/diagnostics/export', { label: 'test' }, { Authorization: `Bearer ${apiToken}`, 'X-Sidecar-CSRF': csrf });
    assert.equal(diag.status, 200);
    assert.equal(diag.body.ok, true);
    assert.equal(typeof diag.body.file, 'string');

    const latest = await getJson(port, '/diagnostics/latest');
    assert.equal(latest.status, 200);
    assert.equal(latest.body.ok, true);
    assert.equal(Boolean(latest.body.latest), true);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
    if (prevWindow === undefined) delete process.env.LEAD_SIDECAR_RATE_WINDOW_MS; else process.env.LEAD_SIDECAR_RATE_WINDOW_MS = prevWindow;
    if (prevInflight === undefined) delete process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS; else process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS = prevInflight;
  }
});
