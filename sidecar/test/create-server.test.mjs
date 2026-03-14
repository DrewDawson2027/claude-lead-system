/**
 * create-server lifecycle tests — covers behaviors NOT exercised by server-http.test.mjs:
 *   - OPTIONS (CORS preflight) → 204
 *   - Unknown routes → 404
 *   - Safe mode blocks POST dispatch + non-POST mutations
 *   - Safe mode allows GET routes
 *   - Server port is a valid positive integer after start
 *   - sidecar.close() terminates the server cleanly
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-cs-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'gamma.json'), JSON.stringify({
    team_name: 'gamma',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 'g1', role: 'coder' }],
    policy: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }));
  return home;
}

function rawRequest(port, path, method, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: body !== null ? { 'Content-Type': 'application/json', ...headers } : headers,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw }));
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

test('server starts on an OS-assigned port and port is a positive integer', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    assert.equal(typeof sidecar.port, 'number');
    assert.ok(sidecar.port > 0 && sidecar.port < 65536, `port ${sidecar.port} not in valid range`);
    assert.ok(sidecar.server, 'server object should exist');
    assert.ok(sidecar.close, 'close() should exist');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('OPTIONS preflight returns 204 and allows same-origin', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const res = await rawRequest(port, '/health', 'OPTIONS', null, {
      Origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(res.status, 204);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('unknown route returns 404 with NOT_FOUND error code', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const res = await rawRequest(port, '/no-such-route-xyzzy', 'GET');
    assert.equal(res.status, 404);
    const body = JSON.parse(res.raw);
    assert.equal(body.error_code, 'NOT_FOUND');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('safe mode blocks POST /dispatch with 503 SAFE_MODE_ACTIVE', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0, safeMode: true });
  const { port } = sidecar;
  // Need auth to get past auth check — fetch bootstrap token first
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  // Wait a tick for runtime files to be written
  await new Promise((r) => setTimeout(r, 50));
  const { readFileSync } = await import('node:fs');
  let apiToken = '';
  try { apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token; } catch {}
  const bootstrapRes = await rawRequest(port, '/ui/bootstrap.json', 'GET', null, {
    Origin: `http://127.0.0.1:${port}`,
  });
  const csrf = JSON.parse(bootstrapRes.raw).csrf_token || '';
  try {
    // GET /health should still work in safe mode
    const health = await rawRequest(port, '/health', 'GET');
    assert.equal(health.status, 200);

    // POST /dispatch blocked
    const dispatch = await rawRequest(port, '/dispatch', 'POST', { team_name: 'gamma' }, {
      Authorization: `Bearer ${apiToken}`,
      Origin: `http://127.0.0.1:${port}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(dispatch.status, 503);
    const body = JSON.parse(dispatch.raw);
    assert.equal(body.error_code, 'SAFE_MODE_ACTIVE');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('safe mode blocks PATCH mutations but allows GET requests', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0, safeMode: true });
  const { port } = sidecar;
  await new Promise((r) => setTimeout(r, 50));
  const { readFileSync } = await import('node:fs');
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  let apiToken = '';
  try { apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token; } catch {}
  const bootstrapRes = await rawRequest(port, '/ui/bootstrap.json', 'GET', null, {
    Origin: `http://127.0.0.1:${port}`,
  });
  const csrf = JSON.parse(bootstrapRes.raw).csrf_token || '';
  try {
    // GET /teams works
    const teams = await rawRequest(port, '/teams', 'GET');
    assert.equal(teams.status, 200);

    // PATCH blocked
    const patch = await rawRequest(port, '/teams/gamma/interrupt-priorities', 'PATCH', { approval: 5 }, {
      Authorization: `Bearer ${apiToken}`,
      Origin: `http://127.0.0.1:${port}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(patch.status, 503);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('server close() stops accepting new connections', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  // Verify server is live
  const before = await rawRequest(port, '/health', 'GET');
  assert.equal(before.status, 200);
  sidecar.close();
  // After close, new connections should fail — Node drains gracefully so
  // the error may be ECONNREFUSED (refused immediately) or ECONNRESET /
  // 'socket hang up' (accepted then dropped). Either means the server is closed.
  await assert.rejects(
    () => rawRequest(port, '/health', 'GET'),
    (err) => ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'socket hang up'].some(
      (code) => err.code === code || err.message?.includes(code),
    ),
    'expected a connection error after close',
  );
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
});
