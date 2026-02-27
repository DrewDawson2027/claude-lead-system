import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-ver-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'alpha.json'), JSON.stringify({
    team_name: 'alpha', execution_path: 'hybrid', low_overhead_mode: 'simple',
    members: [{ name: 'a1', role: 'coder' }], policy: {},
    created: new Date().toISOString(), updated: new Date().toISOString(),
  }));
  return home;
}

function requestJson(port, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
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
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

test('GET routes: legacy gets deprecation headers, v1 does not', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const routes = ['/health', '/teams', '/actions', '/schema/version', '/metrics.json', '/checkpoints'];
    for (const route of routes) {
      const legacy = await requestJson(sidecar.port, route);
      assert.equal(legacy.status, 200, `${route} legacy should be 200`);
      assert.equal(legacy.headers.deprecation, 'true', `${route} legacy should have Deprecation header`);
      assert.ok(legacy.headers.sunset, `${route} legacy should have Sunset header`);
      assert.match(String(legacy.headers.link || ''), /\/v1\//, `${route} legacy should have Link header with /v1/`);

      const v1 = await requestJson(sidecar.port, `/v1${route}`);
      assert.equal(v1.status, 200, `${route} v1 should be 200`);
      assert.equal(v1.headers.deprecation, undefined, `${route} v1 should NOT have Deprecation header`);
    }
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('POST routes: legacy and v1 produce same response shape', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const legacyMaint = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' });
    const v1Maint = await requestJson(sidecar.port, '/v1/maintenance/run', 'POST', { source: 'test' });
    assert.equal(legacyMaint.status, 200);
    assert.equal(v1Maint.status, 200);
    assert.equal(legacyMaint.body.ok, true);
    assert.equal(v1Maint.body.ok, true);
    assert.equal(legacyMaint.headers.deprecation, 'true');
    assert.equal(v1Maint.headers.deprecation, undefined);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('normalizeApiPath: bare /v1 resolves to /', async () => {
  const mod = await import(`../server/http/versioning.js?t=${Date.now()}`);
  const result = mod.normalizeApiPath('/v1');
  assert.equal(result.routePath, '/');
  assert.equal(result.isVersioned, true);
  assert.equal(result.isLegacyAlias, false);
});

test('normalizeApiPath: double prefix /v1/v1/health resolves correctly', async () => {
  const mod = await import(`../server/http/versioning.js?t=${Date.now()}`);
  const result = mod.normalizeApiPath('/v1/v1/health');
  assert.equal(result.routePath, '/v1/health');
  assert.equal(result.isVersioned, true);
});

test('normalizeApiPath: trailing slash /v1/health/ preserved', async () => {
  const mod = await import(`../server/http/versioning.js?t=${Date.now()}`);
  const result = mod.normalizeApiPath('/v1/health/');
  assert.equal(result.routePath, '/health/');
  assert.equal(result.isVersioned, true);
});

test('legacyDeprecationHeaders: returns empty for versioned routes', async () => {
  const mod = await import(`../server/http/versioning.js?t=${Date.now()}`);
  const meta = mod.normalizeApiPath('/v1/health');
  const headers = mod.legacyDeprecationHeaders(meta);
  assert.deepEqual(headers, {});
});

test('legacyDeprecationHeaders: returns deprecation for legacy routes', async () => {
  const mod = await import(`../server/http/versioning.js?t=${Date.now()}`);
  const meta = mod.normalizeApiPath('/health');
  const headers = mod.legacyDeprecationHeaders(meta);
  assert.equal(headers.Deprecation, 'true');
  assert.ok(headers.Sunset);
  assert.match(headers.Link, /\/v1\/health/);
});

test('legacyDeprecationHeaders: respects LEAD_SIDECAR_LEGACY_SUNSET_MS env', async () => {
  const prevSunset = process.env.LEAD_SIDECAR_LEGACY_SUNSET_MS;
  process.env.LEAD_SIDECAR_LEGACY_SUNSET_MS = String(1000 * 60 * 60 * 24); // 1 day
  try {
    const mod = await import(`../server/http/versioning.js?t=${Date.now()}-sunset`);
    const meta = mod.normalizeApiPath('/health');
    const now = new Date();
    const headers = mod.legacyDeprecationHeaders(meta, now);
    const sunsetDate = new Date(headers.Sunset);
    const diffMs = sunsetDate.getTime() - now.getTime();
    assert.ok(diffMs > 0 && diffMs <= 1000 * 60 * 60 * 24 + 5000, `Sunset should be ~1 day from now, got ${diffMs}ms`);
  } finally {
    if (prevSunset === undefined) delete process.env.LEAD_SIDECAR_LEGACY_SUNSET_MS;
    else process.env.LEAD_SIDECAR_LEGACY_SUNSET_MS = prevSunset;
  }
});

test('v1 and legacy routes return X-Request-Id header', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const legacy = await requestJson(sidecar.port, '/health');
    assert.ok(legacy.headers['x-request-id'], 'legacy response should have X-Request-Id');
    assert.match(legacy.headers['x-request-id'], /^[0-9a-f-]{36}$/);

    const v1 = await requestJson(sidecar.port, '/v1/health');
    assert.ok(v1.headers['x-request-id'], 'v1 response should have X-Request-Id');
    assert.match(v1.headers['x-request-id'], /^[0-9a-f-]{36}$/);

    assert.notEqual(legacy.headers['x-request-id'], v1.headers['x-request-id'], 'request IDs should be unique');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('schema/routes endpoint available via legacy and v1 paths', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const legacy = await requestJson(sidecar.port, '/schema/routes');
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.ok, true);
    assert.ok(Array.isArray(legacy.body.routes));
    assert.ok(legacy.body.routes.length > 30, 'should have 30+ routes');

    const v1 = await requestJson(sidecar.port, '/v1/schema/routes');
    assert.equal(v1.status, 200);
    assert.equal(v1.body.ok, true);
    assert.deepEqual(legacy.body.routes.length, v1.body.routes.length);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('404 responses use standardized error schema', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const notFound = await requestJson(sidecar.port, '/nonexistent-route');
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.error_code, 'NOT_FOUND');
    assert.ok(notFound.body.message);
    assert.ok(notFound.body.request_id, '404 should include request_id');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});
