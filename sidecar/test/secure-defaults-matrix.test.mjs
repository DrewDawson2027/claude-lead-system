import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-sec-matrix-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'matrix.json'), JSON.stringify({
    team_name: 'matrix',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 'm1', role: 'worker' }],
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
        catch { resolve({ status: res.statusCode, headers: res.headers, body: {} }); }
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body || {}));
    req.end();
  });
}

test('secure defaults matrix: token on rejects unauthenticated no-origin mutation', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'matrix' });
    assert.equal(res.status, 401);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
  }
});

test('secure defaults matrix: allowlisted browser origin is accepted with CSRF', async () => {
  const prevHome = process.env.HOME;
  const prevAllow = process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST = 'http://trusted.local:8080';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const csrf = JSON.parse(readFileSync(join(home, '.claude', 'lead-sidecar', 'runtime', 'csrf.token'), 'utf-8')).token;
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'matrix' }, {
      Origin: 'http://trusted.local:8080',
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(res.status, 200);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevAllow === undefined) delete process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST; else process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST = prevAllow;
  }
});

test('secure defaults matrix: safe mode blocks mutation endpoints', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0, safeMode: true });
  const csrf = JSON.parse(readFileSync(join(home, '.claude', 'lead-sidecar', 'runtime', 'csrf.token'), 'utf-8')).token;
  try {
    const res = await requestJson(sidecar.port, '/maintenance/run', 'POST', { source: 'matrix' }, {
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.error_code, 'SAFE_MODE_ACTIVE');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});
