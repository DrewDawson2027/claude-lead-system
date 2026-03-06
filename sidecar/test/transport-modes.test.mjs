import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-transport-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'socket.json'), JSON.stringify({
    team_name: 'socket',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 's1', role: 'worker' }],
    policy: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }));
  return home;
}

test('unix socket mode serves health endpoint', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const socketPath = join(tmpdir(), `cls-${process.pid}-${Date.now()}.sock`);
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ unixSocket: socketPath });
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ socketPath, path: '/health', method: 'GET' }, (r) => {
        let raw = '';
        r.on('data', (c) => { raw += c; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(raw || '{}') }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('tls mode returns https dashboard target', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const home = setupHome();
  process.env.HOME = home;
  delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  process.env.LEAD_SIDECAR_NO_BROWSER = '1'; // prevent Safari from opening during tests
  const tlsDir = mkdtempSync(join(tmpdir(), 'sidecar-tls-'));
  const tlsKey = join(tlsDir, 'server.key');
  const tlsCert = join(tlsDir, 'server.crt');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
    '-keyout', tlsKey,
    '-out', tlsCert,
    '-subj', '/CN=127.0.0.1',
    '-days', '1',
  ]);
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0, tlsKeyFile: tlsKey, tlsCertFile: tlsCert });
  try {
    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1',
        port: sidecar.port,
        path: '/open-dashboard',
        method: 'POST',
        rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json' },
      }, (r) => {
        let raw = '';
        r.on('data', (c) => { raw += c; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(raw || '{}') }));
      });
      req.on('error', reject);
      req.write('{}');
      req.end();
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.target, 'string');
    assert.ok(res.body.target.startsWith(`https://127.0.0.1:${sidecar.port}/`));
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
  }
});
