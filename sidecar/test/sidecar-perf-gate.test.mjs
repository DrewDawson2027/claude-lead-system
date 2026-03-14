/**
 * Sidecar startup performance gate — CI-enforced SLO.
 *
 * Asserts that the sidecar server starts (i.e. is ready to accept HTTP requests)
 * within 750 ms. This makes the advisory SLO in docs/OPERATIONAL_SLOS.md
 * a hard CI gate instead of a documentation-only promise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const STARTUP_SLO_MS = 750;

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-perf-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  return home;
}

function pingHealth(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/health', method: 'GET' },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test(`sidecar server starts and responds within ${STARTUP_SLO_MS}ms (SLO gate)`, async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;

  const t0 = Date.now();
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const startupMs = Date.now() - t0;

  try {
    // Verify the server actually responds (not just that the import resolved)
    const status = await pingHealth(sidecar.port);
    assert.equal(status, 200, 'health endpoint should return 200 after startup');

    assert.ok(
      startupMs < STARTUP_SLO_MS,
      `Server startup took ${startupMs}ms — exceeds SLO of ${STARTUP_SLO_MS}ms`,
    );
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('sidecar server port is available and accepting connections at startup', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    // Hit /health 3 times to verify stable serving (not just a one-time fluke)
    for (let i = 0; i < 3; i++) {
      const status = await pingHealth(sidecar.port);
      assert.equal(status, 200, `health check ${i + 1} failed`);
    }
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});
