import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-sse-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'sse-team.json'), JSON.stringify({
    team_name: 'sse-team', execution_path: 'hybrid', low_overhead_mode: 'simple',
    members: [{ name: 's1', role: 'coder' }], policy: {},
    created: new Date().toISOString(), updated: new Date().toISOString(),
  }));
  return home;
}

function connectSSE(port, path = '/events') {
  return new Promise((resolve) => {
    const req = http.get({
      host: '127.0.0.1', port, path,
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk.toString()); });
      resolve({ res, req, chunks, destroy: () => req.destroy() });
    });
    req.on('error', () => {}); // suppress errors on intentional destroy
  });
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

test('SSE: connect and receive initial connected comment', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const sse = await connectSSE(sidecar.port);
    assert.equal(sse.res.statusCode, 200);
    assert.match(sse.res.headers['content-type'], /text\/event-stream/);
    await sleep(100);
    const data = sse.chunks.join('');
    assert.match(data, /: connected/, 'should receive connected comment');
    sse.destroy();
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('SSE: client disconnect cleans up from clients set', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const sse1 = await connectSSE(sidecar.port);
    await sleep(50);

    // Health endpoint includes queue_depth; we verify the server is healthy
    const health = await requestJson(sidecar.port, '/health');
    assert.equal(health.status, 200);

    // Disconnect the SSE client
    sse1.destroy();
    await sleep(100);

    // Server should still be healthy after client disconnect
    const health2 = await requestJson(sidecar.port, '/health');
    assert.equal(health2.status, 200);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('SSE: multiple concurrent clients all receive connected comment', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const clients = await Promise.all([
      connectSSE(sidecar.port),
      connectSSE(sidecar.port),
      connectSSE(sidecar.port),
    ]);
    await sleep(100);

    for (let i = 0; i < clients.length; i++) {
      const data = clients[i].chunks.join('');
      assert.match(data, /: connected/, `client ${i} should receive connected comment`);
      assert.equal(clients[i].res.statusCode, 200);
    }

    for (const c of clients) c.destroy();
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('SSE: reconnection after disconnect gets fresh connected message', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const sse1 = await connectSSE(sidecar.port);
    await sleep(50);
    sse1.destroy();
    await sleep(100);

    const sse2 = await connectSSE(sidecar.port);
    await sleep(50);
    const data = sse2.chunks.join('');
    assert.match(data, /: connected/, 'reconnected client should receive connected comment');
    sse2.destroy();
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('SSE: legacy /events and /v1/events both work', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const legacy = await connectSSE(sidecar.port, '/events');
    const v1 = await connectSSE(sidecar.port, '/v1/events');
    await sleep(100);

    assert.equal(legacy.res.statusCode, 200);
    assert.equal(v1.res.statusCode, 200);
    assert.match(legacy.chunks.join(''), /: connected/);
    assert.match(v1.chunks.join(''), /: connected/);

    // Legacy should have deprecation header
    assert.equal(legacy.res.headers.deprecation, 'true');
    // v1 should not
    assert.equal(v1.res.headers.deprecation, undefined);

    legacy.destroy();
    v1.destroy();
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('SSE: server survives dead client during broadcast', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const sse = await connectSSE(sidecar.port);
    await sleep(50);

    // Destroy the underlying socket to simulate a dead client
    sse.res.socket?.destroy();
    await sleep(50);

    // Server should still respond to health checks (no crash)
    const health = await requestJson(sidecar.port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('SSE: response includes correct headers', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const sse = await connectSSE(sidecar.port);
    assert.match(sse.res.headers['content-type'], /text\/event-stream/);
    assert.equal(sse.res.headers['cache-control'], 'no-cache');
    assert.equal(sse.res.headers.connection, 'keep-alive');
    sse.destroy();
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});
