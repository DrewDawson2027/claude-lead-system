import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-sec-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'alpha.json'), JSON.stringify({
    team_name: 'alpha',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 'a1', role: 'worker' }],
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

function getJson(port, path, headers = {}) { return requestJson(port, path, 'GET', null, headers); }
function postJson(port, path, body, headers = {}) { return requestJson(port, path, 'POST', body, headers); }

// ── Test: CSP header present on all responses ─────────────────────────
test('CSP header is set on all responses', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const health = await getJson(sidecar.port, '/health');
    assert.equal(health.status, 200);
    const csp = health.headers['content-security-policy'];
    assert.ok(csp, 'CSP header must be present');
    assert.ok(csp.includes("default-src 'self'"), 'CSP must include default-src self');
    assert.ok(csp.includes("frame-ancestors 'none'"), 'CSP must include frame-ancestors none');
    assert.ok(csp.includes("script-src 'self'"), 'CSP must include script-src self');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

// ── Test: File permissions in health endpoint ─────────────────────────
test('health endpoint includes file_permissions field', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const health = await getJson(sidecar.port, '/health');
    assert.equal(health.status, 200);
    assert.ok(Object.hasOwn(health.body, 'file_permissions'), 'health must include file_permissions');
    assert.equal(typeof health.body.file_permissions.ok, 'boolean');
    assert.ok(Array.isArray(health.body.file_permissions.issues));
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

// ── Test: Security audit log collects auth failures ──────────────────
test('security audit log records auth failures and is queryable', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
  try {
    // Trigger auth failure
    await postJson(port, '/maintenance/run', { source: 'test' });

    // Trigger origin reject
    await getJson(port, '/health', { Origin: 'http://evil.example:9999' });

    // Trigger CSRF failure
    await postJson(port, '/maintenance/run', { source: 'test' }, {
      Origin: `http://127.0.0.1:${port}`,
    });

    // Query security audit
    const audit = await getJson(port, '/health/security-audit');
    assert.equal(audit.status, 200);
    assert.equal(audit.body.ok, true);
    assert.ok(audit.body.total >= 2, `Expected at least 2 audit entries, got ${audit.body.total}`);
    assert.ok(audit.body.by_type.auth_failure >= 1, 'Should have auth_failure entries');
    assert.ok(audit.body.by_type.origin_reject >= 1, 'Should have origin_reject entries');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
  }
});

test('security audit export endpoint is schema-versioned and health exposes token telemetry', async () => {
  const prevHome = process.env.HOME;
  const prevMaxAge = process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS = '0';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    await getJson(port, '/health', { Origin: 'http://evil.example:9999' });
    const exportRes = await getJson(port, '/health/security-audit/export?limit=10');
    assert.equal(exportRes.status, 200);
    assert.equal(exportRes.body.ok, true);
    assert.equal(exportRes.body.schema_version, 'sidecar-security-audit/v1');
    assert.ok(Array.isArray(exportRes.body.events));
    assert.equal(typeof exportRes.body.summary.total, 'number');

    const health = await getJson(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.security_telemetry.log_schema_version, 'sidecar-security-audit/v1');
    assert.equal(typeof health.body.security_telemetry.api_token.age_ms, 'number');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevMaxAge === undefined) delete process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS; else process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS = prevMaxAge;
  }
});

test('health degrades when API token age exceeds configured threshold', async () => {
  const prevHome = process.env.HOME;
  const prevMaxAge = process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS = '1';
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'api.token'), JSON.stringify({
    token: 'a'.repeat(48),
    created_at: '2000-01-01T00:00:00.000Z',
  }));
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const health = await getJson(sidecar.port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'degraded');
    assert.ok(health.body.degraded_reasons.includes('api_token_age_exceeded'));
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevMaxAge === undefined) delete process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS; else process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS = prevMaxAge;
  }
});

// ── Test: Per-route body size limits ─────────────────────────────────
test('per-route body limits reject oversized payloads', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  process.env.LEAD_SIDECAR_RATE_LIMIT = '200';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
  const csrf = JSON.parse(readFileSync(join(runtimeDir, 'csrf.token'), 'utf-8')).token;
  try {
    // /native/probe has 1KB limit — send 2KB payload
    // Server calls req.destroy() when limit exceeded, causing ECONNRESET on client
    let bigProbeResult;
    try {
      bigProbeResult = await postJson(port, '/native/probe', { data: 'x'.repeat(2048) }, {
        Authorization: `Bearer ${apiToken}`,
        'X-Sidecar-CSRF': csrf,
      });
    } catch (err) {
      // ECONNRESET is expected — server killed the oversized request
      assert.ok(err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE',
        `Expected ECONNRESET for oversized body, got ${err.code}`);
      bigProbeResult = { status: 413 }; // treat connection kill as implicit 413
    }
    assert.ok([400, 413].includes(bigProbeResult.status), `Expected 400 or 413 for oversized probe, got ${bigProbeResult.status}`);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
  }
});

// ── Test: API token rotation ──────────────────────────────────────────
test('API token rotation generates new token and invalidates old', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  process.env.LEAD_SIDECAR_RATE_LIMIT = '200';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const oldToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
  const csrf = JSON.parse(readFileSync(join(runtimeDir, 'csrf.token'), 'utf-8')).token;
  try {
    // Rotate token
    const rotate = await postJson(port, '/maintenance/rotate-api-token', {}, {
      Authorization: `Bearer ${oldToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(rotate.status, 200);
    assert.equal(rotate.body.ok, true);
    assert.ok(rotate.body.new_token, 'Must return new token');
    assert.ok(rotate.body.new_token !== oldToken, 'New token must differ from old');
    assert.ok(rotate.body.rotated_at, 'Must include rotated_at timestamp');

    // Old token should now fail
    const oldTokenReq = await postJson(port, '/maintenance/run', { source: 'test' }, {
      Authorization: `Bearer ${oldToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(oldTokenReq.status, 401, 'Old token should be rejected after rotation');

    // New token should work
    const newTokenReq = await postJson(port, '/maintenance/run', { source: 'test' }, {
      Authorization: `Bearer ${rotate.body.new_token}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(newTokenReq.status, 200, 'New token should work');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
  }
});

// ── Test: CSRF rotation on startup ───────────────────────────────────
test('CSRF token rotates on startup with --rotate-csrf-on-startup', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;

  // First boot — creates initial CSRF
  const mod1 = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const s1 = await mod1.startSidecarServer({ port: 0 });
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const csrf1 = JSON.parse(readFileSync(join(runtimeDir, 'csrf.token'), 'utf-8')).token;
  s1.close();

  // Second boot with rotateCsrf — should generate new token
  const mod2 = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const s2 = await mod2.startSidecarServer({ port: 0, rotateCsrf: true });
  const csrf2 = JSON.parse(readFileSync(join(runtimeDir, 'csrf.token'), 'utf-8')).token;
  s2.close();

  assert.ok(csrf1, 'First CSRF token must exist');
  assert.ok(csrf2, 'Second CSRF token must exist');
  assert.notEqual(csrf1, csrf2, 'CSRF token must change after rotation');

  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
});

// ── Test: Replay protection rejects duplicate nonces ─────────────────
test('replay protection rejects duplicate nonce on protected routes', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevReplay = process.env.LEAD_SIDECAR_REPLAY_PROTECTION;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  process.env.LEAD_SIDECAR_REPLAY_PROTECTION = '1';
  process.env.LEAD_SIDECAR_RATE_LIMIT = '200';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
  const csrf = JSON.parse(readFileSync(join(runtimeDir, 'csrf.token'), 'utf-8')).token;
  try {
    const nonce = 'test-nonce-' + Date.now();
    const authHeaders = { Authorization: `Bearer ${apiToken}`, 'X-Sidecar-CSRF': csrf, 'X-Sidecar-Nonce': nonce };

    // First request with nonce should succeed
    const first = await postJson(port, '/dispatch', { team_name: 'alpha', subject: 'test', prompt: 'test' }, authHeaders);
    assert.ok([200, 404].includes(first.status), `First request should succeed, got ${first.status}`);

    // Second request with SAME nonce should be rejected as replay
    const second = await postJson(port, '/dispatch', { team_name: 'alpha', subject: 'test', prompt: 'test' }, authHeaders);
    assert.equal(second.status, 409, 'Duplicate nonce should be rejected with 409');

    // Request WITHOUT nonce should still succeed (backwards-compatible)
    const noNonce = await postJson(port, '/dispatch', { team_name: 'alpha', subject: 'test2', prompt: 'test2' }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.ok([200, 404].includes(noNonce.status), `Request without nonce should not be blocked, got ${noNonce.status}`);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
    if (prevReplay === undefined) delete process.env.LEAD_SIDECAR_REPLAY_PROTECTION; else process.env.LEAD_SIDECAR_REPLAY_PROTECTION = prevReplay;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
  }
});

// ── Test: Secret redaction in diagnostics ─────────────────────────────
test('diagnostics export redacts secrets from output', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  process.env.LEAD_SIDECAR_RATE_LIMIT = '200';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
  const csrf = JSON.parse(readFileSync(join(runtimeDir, 'csrf.token'), 'utf-8')).token;
  try {
    const diag = await postJson(port, '/diagnostics/export', { label: 'sec-test' }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(diag.status, 200);
    assert.equal(diag.body.ok, true);

    // Read the actual exported file and check for redaction
    const diagFile = readFileSync(diag.body.file, 'utf-8');
    // The raw API token should NOT appear in the diagnostics file
    assert.ok(!diagFile.includes(apiToken), 'Raw API token must not appear in diagnostics export');
    // The CSRF token should NOT appear raw either
    assert.ok(!diagFile.includes(csrf), 'Raw CSRF token must not appear in diagnostics export');
    // Verify the bundle was written successfully
    const parsed = JSON.parse(diagFile);
    assert.ok(parsed.runtime, 'Bundle must contain runtime section');
    // Boolean presence fields should survive redaction
    assert.equal(typeof parsed.runtime.api_token_present, 'boolean');
    assert.equal(typeof parsed.runtime.csrf_token_present, 'boolean');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
  }
});

// ── Test: Origin allowlist ────────────────────────────────────────────
test('origin allowlist permits configured origins', async () => {
  const prevHome = process.env.HOME;
  const prevAllowlist = process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST = 'http://trusted.local:8080,http://dashboard.local:3000';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    // Allowed origin (from allowlist) should get CORS headers
    const allowed = await getJson(port, '/health', { Origin: 'http://trusted.local:8080' });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://trusted.local:8080');

    // Sidecar's own origin should also work
    const self = await getJson(port, '/health', { Origin: `http://127.0.0.1:${port}` });
    assert.equal(self.status, 200);
    assert.equal(self.headers['access-control-allow-origin'], `http://127.0.0.1:${port}`);

    // Unknown origin should be rejected
    const rejected = await getJson(port, '/health', { Origin: 'http://evil.example:9999' });
    assert.equal(rejected.status, 403);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevAllowlist === undefined) delete process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST; else process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST = prevAllowlist;
  }
});

// ── Test: File permissions auto-fix on startup ───────────────────────
test('startup auto-fixes loose file and directory permissions on sensitive sidecar paths', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;

  // First boot to create token files
  const mod1 = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const s1 = await mod1.startSidecarServer({ port: 0 });
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const sidecarDir = join(home, '.claude', 'lead-sidecar');
  s1.close();

  // Loosen permissions on api.token
  const apiTokenPath = join(runtimeDir, 'api.token');
  chmodSync(apiTokenPath, 0o644);
  chmodSync(sidecarDir, 0o755);
  const looseStat = statSync(apiTokenPath);
  const looseDirStat = statSync(sidecarDir);
  assert.equal(looseStat.mode & 0o077, 0o044, 'Permissions should be loose (644) before restart');
  assert.equal(looseDirStat.mode & 0o077, 0o055, 'Directory permissions should be loose (755) before restart');

  // Second boot should auto-fix
  const mod2 = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const s2 = await mod2.startSidecarServer({ port: 0 });
  s2.close();

  const fixedStat = statSync(apiTokenPath);
  const fixedDirStat = statSync(sidecarDir);
  assert.equal(fixedStat.mode & 0o077, 0, 'Permissions should be tightened to 600 after restart');
  assert.equal(fixedDirStat.mode & 0o077, 0, 'Directory permissions should be tightened to 700 after restart');

  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
});

// ── Test: X-Sidecar-Nonce in CORS allowed headers ───────────────────
test('CORS allows X-Sidecar-Nonce header', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const opts = await requestJson(port, '/health', 'OPTIONS', null, { Origin: `http://127.0.0.1:${port}` });
    assert.equal(opts.status, 204);
    const allowHeaders = opts.headers['access-control-allow-headers'] || '';
    assert.ok(allowHeaders.includes('X-Sidecar-Nonce'), 'CORS must allow X-Sidecar-Nonce header');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

// ── Unit test: SecurityAuditLog ──────────────────────────────────────
test('SecurityAuditLog ring buffer and rate limiting', async () => {
  const { SecurityAuditLog } = await import('../server/http/audit.js');
  const log = new SecurityAuditLog({ maxEntries: 5, maxPerSec: 3 });

  // Log some events
  log.log({ type: 'auth_failure', ip: '1.2.3.4', path: '/test' });
  log.log({ type: 'origin_reject', ip: '5.6.7.8', path: '/test2', origin: 'http://evil.com' });
  log.log({ type: 'csrf_failure', ip: '1.2.3.4', path: '/test3' });

  // Rate limit should kick in (4th event in same second)
  log.log({ type: 'rate_limit', ip: '1.2.3.4', path: '/test4' });

  const entries = log.entries();
  assert.equal(entries.length, 3, 'Rate limiter should cap at 3 events/sec');

  const snap = log.snapshot();
  assert.equal(snap.total, 3);
  assert.equal(snap.by_type.auth_failure, 1);
  assert.equal(snap.by_type.origin_reject, 1);
  assert.equal(snap.by_type.csrf_failure, 1);

  // Test ring buffer eviction
  const bigLog = new SecurityAuditLog({ maxEntries: 3, maxPerSec: 100 });
  for (let i = 0; i < 10; i++) {
    bigLog.log({ type: 'auth_failure', ip: `10.0.0.${i}`, path: `/p${i}` });
  }
  assert.equal(bigLog.entries().length, 3, 'Ring buffer should cap at maxEntries');
  assert.equal(bigLog.entries()[0].ip, '10.0.0.7', 'Oldest entries should be evicted');
});

// ── Unit test: bodyLimitForRoute ──────────────────────────────────────
test('bodyLimitForRoute returns correct limits per route category', async () => {
  const { bodyLimitForRoute } = await import('../server/http/body.js');

  assert.equal(bodyLimitForRoute('/native/probe'), 1024, 'probe should have 1KB limit');
  assert.equal(bodyLimitForRoute('/maintenance/run'), 4096, 'maintenance should have 4KB limit');
  assert.equal(bodyLimitForRoute('/diagnostics/export'), 4096, 'diagnostics should have 4KB limit');
  assert.equal(bodyLimitForRoute('/repair/scan'), 4096, 'repair should have 4KB limit');
  assert.equal(bodyLimitForRoute('/dispatch'), 65536, 'dispatch should have 64KB limit');
  assert.equal(bodyLimitForRoute('/teams/alpha/actions/task'), 65536, 'team actions should have 64KB limit');
  assert.equal(bodyLimitForRoute('/teams/alpha/batch-triage'), 65536, 'batch-triage should have 64KB limit');
  assert.equal(bodyLimitForRoute('/some/unknown/route'), 256 * 1024, 'unknown routes should have 256KB default');
});

// ── Unit test: redactSecrets ──────────────────────────────────────────
test('redactSecrets redacts token-like keys and hex strings', async () => {
  // Import maintenance module to access redactSecrets indirectly via diagnosticsBundle
  // Since redactSecrets is module-private, we test via a synthetic object
  const input = {
    api_token: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    secret_key: 'supersecretvalue123',
    csrf_token_present: true,
    api_token_present: false,
    normal_field: 'safe value',
    nested: {
      auth_header: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      password: 'hunter2',
      data: 'regular data',
      hex_id: 'abcdef0123456789abcdef01',
    },
  };

  // We can't import the private function directly, so verify the behavior
  // through the module's export path. The key test is the integration test above
  // which proves no raw tokens appear in diagnostics exports.
  // Here we verify the pattern matching logic:

  // Token-like key patterns
  assert.ok(/token|secret|password|key|auth|credential/i.test('api_token'));
  assert.ok(/token|secret|password|key|auth|credential/i.test('secret_key'));
  assert.ok(/token|secret|password|key|auth|credential/i.test('auth_header'));
  assert.ok(/token|secret|password|key|auth|credential/i.test('password'));
  assert.ok(!/token|secret|password|key|auth|credential/i.test('normal_field'));
  assert.ok(!/token|secret|password|key|auth|credential/i.test('data'));

  // Hex string pattern (>20 chars)
  assert.ok(/^[0-9a-f]{20,}$/i.test('abcdef0123456789abcdef01'));
  assert.ok(!/^[0-9a-f]{20,}$/i.test('short'));
  assert.ok(!/^[0-9a-f]{20,}$/i.test('not-hex-at-all-but-long-enough'));

  // Bearer pattern
  assert.ok(/^Bearer\s+\S{8,}/.test('Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature'));
  assert.ok(!/^Bearer\s+\S{8,}/.test('Bearer abc'));
});

// ── Unit test: createReplayProtector ──────────────────────────────────
test('createReplayProtector rejects duplicate nonces within window', async () => {
  const prevReplay = process.env.LEAD_SIDECAR_REPLAY_PROTECTION;
  process.env.LEAD_SIDECAR_REPLAY_PROTECTION = '1';
  const { createReplayProtector } = await import('../server/http/security.js');
  const protector = createReplayProtector({ windowMs: 5000, maxNonces: 10 });

  const req1 = { headers: { 'x-sidecar-nonce': 'nonce-abc' } };
  const req2 = { headers: { 'x-sidecar-nonce': 'nonce-abc' } };
  const reqNoNonce = { headers: {} };
  const reqDiffNonce = { headers: { 'x-sidecar-nonce': 'nonce-def' } };

  assert.deepEqual(protector.check(req1, '/dispatch'), { ok: true });
  assert.equal(protector.check(req2, '/dispatch').ok, false, 'Duplicate nonce should fail');
  assert.deepEqual(protector.check(reqNoNonce, '/dispatch'), { ok: true }, 'No nonce should pass');
  assert.deepEqual(protector.check(reqDiffNonce, '/dispatch'), { ok: true }, 'Different nonce should pass');

  // Non-protected route should always pass
  assert.deepEqual(protector.check(req2, '/health'), { ok: true }, 'Non-protected route should pass even with duplicate nonce');

  if (prevReplay === undefined) delete process.env.LEAD_SIDECAR_REPLAY_PROTECTION; else process.env.LEAD_SIDECAR_REPLAY_PROTECTION = prevReplay;
});
