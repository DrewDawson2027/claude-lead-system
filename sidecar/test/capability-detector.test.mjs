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
    assert.equal(out.route_mode, 'native-direct');
    assert.match(String(out.route_reason || ''), /probe passed/i);
    assert.equal(out.tools.TeamStatus, true);
    const cached = await detector.detect({ force: false, ttlMs: 999999, team: { execution_path: 'hybrid' } });
    assert.equal(cached.available, true);
    assert.equal(cached.route_mode, 'native-direct');
    assert.equal(cached.probe_source, 'cache');
    assert.equal(typeof cached.cache_age_ms, 'number');
  } finally {
    if (prev === undefined) delete process.env.LEAD_SIDECAR_NATIVE_ENABLE;
    else process.env.LEAD_SIDECAR_NATIVE_ENABLE = prev;
    if (prevMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
    else process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = prevMock;
  }
});

test('capability detector prefers native-direct over bridge when both are healthy', async () => {
  const prev = process.env.LEAD_SIDECAR_NATIVE_ENABLE;
  const prevMock = process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
  process.env.LEAD_SIDECAR_NATIVE_ENABLE = '1';
  process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = '1';
  const paths = setupPaths();
  const detector = new NativeCapabilityDetector({
    paths,
    runner: { async run() { return { ok: true, tool_available: true, notes: 'mock' }; } },
    readSettings: () => ({ permissions: { allow: ['TeamCreate', 'TeamStatus', 'SendMessage', 'Task'] } }),
    bridgeHealthFn: () => ({ bridge_status: 'healthy' }),
  });
  try {
    const out = await detector.detect({ force: true, ttlMs: 0, team: { execution_path: 'native' } });
    assert.equal(out.available, true);
    assert.equal(out.route_mode, 'native-direct');
    assert.equal(out.mode, 'native-direct');
  } finally {
    if (prev === undefined) delete process.env.LEAD_SIDECAR_NATIVE_ENABLE;
    else process.env.LEAD_SIDECAR_NATIVE_ENABLE = prev;
    if (prevMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
    else process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = prevMock;
  }
});

test('capability detector static disablement overrides cached availability', async () => {
  const prevEnable = process.env.LEAD_SIDECAR_NATIVE_ENABLE;
  const prevMock = process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
  delete process.env.LEAD_SIDECAR_NATIVE_ENABLE;
  process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = '1';
  const paths = setupPaths();
  let runCalls = 0;
  const detector = new NativeCapabilityDetector({
    paths,
    runner: {
      async run() {
        runCalls += 1;
        return { ok: true, tool_available: true, notes: 'mock' };
      },
    },
    readSettings: () => ({ permissions: { allow: ['TeamCreate', 'TeamStatus', 'SendMessage', 'Task'] } }),
    bridgeHealthFn: () => ({ bridge_status: 'down' }),
  });
  try {
    const first = await detector.detect({ force: true, ttlMs: 0, team: { execution_path: 'native' } });
    assert.equal(first.available, true);
    assert.equal(first.route_mode, 'native-direct');
    assert.equal(runCalls, 1);

    const disabled = await detector.detect({
      force: false,
      ttlMs: 999999,
      team: { execution_path: 'coordinator' },
    });
    assert.equal(runCalls, 1, 'cached result should be used');
    assert.equal(disabled.probe_source, 'cache');
    assert.equal(disabled.available, false, 'static disablement must override cached availability');
    assert.equal(disabled.route_mode, 'coordinator');
    assert.match(String(disabled.route_reason || ''), /disabled by policy/i);
    assert.equal(Array.isArray(disabled.fallback_history), true);
    assert.equal(disabled.fallback_history[0]?.route_mode, 'native-direct');
  } finally {
    if (prevEnable === undefined) delete process.env.LEAD_SIDECAR_NATIVE_ENABLE;
    else process.env.LEAD_SIDECAR_NATIVE_ENABLE = prevEnable;
    if (prevMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
    else process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = prevMock;
  }
});
