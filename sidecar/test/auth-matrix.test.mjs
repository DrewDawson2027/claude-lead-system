import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-auth-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'auth-team.json'), JSON.stringify({
    team_name: 'auth-team', execution_path: 'hybrid', low_overhead_mode: 'simple',
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

function getToken(home) {
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  return JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
}

function getCsrf(port) {
  return requestJson(port, '/ui/bootstrap.json').then((r) => r.body.csrf_token);
}

// ─── Token OFF tests ─────────────────────────────────────────────────────────

test('token off: no auth required for any request', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    // GET works without any headers
    const health = await requestJson(sidecar.port, '/health');
    assert.equal(health.status, 200);

    // POST works without any auth
    const maint = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' });
    assert.equal(maint.status, 200);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token off: cross-origin browser request rejected (origin check always applies)', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/health', 'GET', null, { Origin: 'http://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error_code, 'ORIGIN_REJECTED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token off: same-origin browser request allowed', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/health', 'GET', null, { Origin: `http://127.0.0.1:${sidecar.port}` });
    assert.equal(res.status, 200);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

// ─── Token ON tests ──────────────────────────────────────────────────────────

test('token on: bearer auth allows mutating request', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const apiToken = getToken(home);
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Authorization: `Bearer ${apiToken}`,
    });
    assert.equal(res.status, 200);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: wrong bearer token rejected', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Authorization: 'Bearer wrong-token-value',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error_code, 'AUTH_REQUIRED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: no auth on mutating request returns 401', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error_code, 'AUTH_REQUIRED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: same-origin browser + CSRF without bearer is rejected', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const csrf = await getCsrf(sidecar.port);
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Origin: `http://127.0.0.1:${sidecar.port}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error_code, 'AUTH_REQUIRED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: same-origin browser WITHOUT CSRF rejected for mutation', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Origin: `http://127.0.0.1:${sidecar.port}`,
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error_code, 'AUTH_REQUIRED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: same-origin browser with wrong CSRF rejected', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Origin: `http://127.0.0.1:${sidecar.port}`,
      'X-Sidecar-CSRF': 'wrong-csrf-token',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error_code, 'AUTH_REQUIRED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: cross-origin browser rejected even with valid Authorization', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const apiToken = getToken(home);
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Origin: 'http://evil.example',
      Authorization: `Bearer ${apiToken}`,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error_code, 'ORIGIN_REJECTED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: bearer auth + same-origin + CSRF all present works', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const apiToken = getToken(home);
  const csrf = await getCsrf(sidecar.port);
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Origin: `http://127.0.0.1:${sidecar.port}`,
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(res.status, 200);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: bearer auth still requires CSRF for browser-origin mutation', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const apiToken = getToken(home);
  try {
    // Same-origin + auth header but NO csrf — must be rejected
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' }, {
      Origin: `http://127.0.0.1:${sidecar.port}`,
      Authorization: `Bearer ${apiToken}`,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error_code, 'CSRF_REQUIRED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: same-origin different port (127.0.0.1) rejected', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/health', 'GET', null, {
      Origin: 'http://127.0.0.1:3000',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error_code, 'ORIGIN_REJECTED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: forged same-origin browser mutation without bearer is always rejected (property)', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const csrf = await getCsrf(sidecar.port);
  try {
    for (let i = 0; i < 25; i += 1) {
      const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: `prop-${i}` }, {
        Origin: `http://127.0.0.1:${sidecar.port}`,
        'X-Sidecar-CSRF': csrf,
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.error_code, 'AUTH_REQUIRED');
    }
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: localhost different port rejected', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/health', 'GET', null, {
      Origin: 'http://localhost:3000',
    });
    assert.equal(res.status, 403);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('OPTIONS preflight returns 204 with CORS headers for same-origin', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'OPTIONS', null, {
      Origin: `http://127.0.0.1:${sidecar.port}`,
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], `http://127.0.0.1:${sidecar.port}`);
    assert.ok(res.headers['access-control-allow-methods']);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('token on: GET non-mutating with bad origin rejected', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/health', 'GET', null, {
      Origin: 'http://evil.example',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error_code, 'ORIGIN_REJECTED');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
  }
});

test('rate limit returns error_code and Retry-After header', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const prevWindow = process.env.LEAD_SIDECAR_RATE_WINDOW_MS;
  const home = setupHome();
  process.env.HOME = home;
  delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  process.env.LEAD_SIDECAR_RATE_LIMIT = '2';
  process.env.LEAD_SIDECAR_RATE_WINDOW_MS = '60000';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    // Exhaust rate limit
    await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' });
    await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' });
    const limited = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error_code, 'RATE_LIMITED');
    assert.ok(limited.headers['retry-after'], 'should have Retry-After header');
    const retryAfter = Number(limited.headers['retry-after']);
    assert.ok(retryAfter > 0 && retryAfter <= 60, `Retry-After should be reasonable, got ${retryAfter}`);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
    if (prevWindow === undefined) delete process.env.LEAD_SIDECAR_RATE_WINDOW_MS; else process.env.LEAD_SIDECAR_RATE_WINDOW_MS = prevWindow;
  }
});

test('successful mutating request includes rate limit headers', async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const home = setupHome();
  process.env.HOME = home;
  delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  process.env.LEAD_SIDECAR_RATE_LIMIT = '100';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'test' });
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-ratelimit-limit'], 'should have X-RateLimit-Limit header');
    assert.ok(res.headers['x-ratelimit-remaining'], 'should have X-RateLimit-Remaining header');
    assert.equal(res.headers['x-ratelimit-limit'], '100');
    const remaining = Number(res.headers['x-ratelimit-remaining']);
    assert.ok(remaining >= 0 && remaining < 100, `remaining should be <100, got ${remaining}`);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevToken === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevToken;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
  }
});
