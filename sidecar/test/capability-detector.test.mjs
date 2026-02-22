import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeCapabilityDetector } from '../native/capability-detector.js';

function setupPaths() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-cap-'));
  const root = join(home, '.claude', 'lead-sidecar');
  mkdirSync(join(root, 'runtime', 'native'), { recursive: true });
  return {
    home,
    root,
    nativeCapabilitiesFile: join(root, 'runtime', 'native', 'capabilities.json'),
    nativeBridgeStatusFile: join(root, 'runtime', 'native', 'bridge.status.json'),
    nativeBridgeHeartbeatFile: join(root, 'runtime', 'native', 'bridge.heartbeat.json'),
  };
}

test('capability detector caches probe output and reports available', async () => {
  const prev = process.env.LEAD_SIDECAR_NATIVE_ENABLE;
  const prevMock = process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
  process.env.LEAD_SIDECAR_NATIVE_ENABLE = '1';
  process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = '1';
  const paths = setupPaths();
  const detector = new NativeCapabilityDetector({
    paths,
    runner: { async run() { return { ok: true, tool_available: true, notes: 'mock' }; } },
    readSettings: () => ({ permissions: { allow: ['TeamCreate', 'TeamStatus', 'SendMessage', 'Task'] } }),
    bridgeHealthFn: () => ({ bridge_status: 'down' }),
  });
  try {
    const out = await detector.detect({ force: true, ttlMs: 0, team: { execution_path: 'hybrid' } });
    assert.equal(out.available, true);
    assert.equal(out.tools.TeamStatus, true);
    const cached = await detector.detect({ force: false, ttlMs: 999999, team: { execution_path: 'hybrid' } });
    assert.equal(cached.available, true);
  } finally {
    if (prev === undefined) delete process.env.LEAD_SIDECAR_NATIVE_ENABLE;
    else process.env.LEAD_SIDECAR_NATIVE_ENABLE = prev;
    if (prevMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
    else process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = prevMock;
  }
});
