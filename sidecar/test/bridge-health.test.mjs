import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBridgeHealth } from '../native/bridge-health.js';
import { BridgeController } from '../native/bridge-controller.js';

function writeJSON(path, value) {
  writeFileSync(path, JSON.stringify(value));
}

function setupPaths() {
  const root = mkdtempSync(join(tmpdir(), 'bridge-health-'));
  const nativeRuntimeDir = join(root, 'runtime', 'native');
  const nativeBridgeRequestDir = join(nativeRuntimeDir, 'bridge.request-queue');
  const nativeBridgeResponseDir = join(nativeRuntimeDir, 'bridge.response-queue');
  mkdirSync(nativeBridgeRequestDir, { recursive: true });
  mkdirSync(nativeBridgeResponseDir, { recursive: true });
  return {
    root,
    paths: {
      terminalsDir: join(root, 'terminals'),
      nativeRuntimeDir,
      nativeBridgeRequestDir,
      nativeBridgeResponseDir,
      nativeBridgeStatusFile: join(nativeRuntimeDir, 'bridge.status.json'),
      nativeBridgeHeartbeatFile: join(nativeRuntimeDir, 'bridge.heartbeat.json'),
    },
  };
}

test('bridge health prioritizes freshness even when pid is missing', () => {
  const { root, paths } = setupPaths();
  try {
    writeJSON(paths.nativeBridgeHeartbeatFile, { ts: new Date().toISOString(), session_id: 's-fresh' });
    const out = getBridgeHealth(paths, 1000);
    assert.equal(out.bridge_status, 'healthy');
    assert.equal(out.pid, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bridge health transitions stale and degraded based on heartbeat age', () => {
  const { root, paths } = setupPaths();
  try {
    const staleMs = 1000;
    writeJSON(paths.nativeBridgeHeartbeatFile, {
      ts: new Date(Date.now() - (staleMs * 2)).toISOString(),
      session_id: 's-stale',
      pid: process.pid,
    });
    let out = getBridgeHealth(paths, staleMs);
    assert.equal(out.bridge_status, 'stale');

    writeJSON(paths.nativeBridgeHeartbeatFile, {
      ts: new Date(Date.now() - (staleMs * 4)).toISOString(),
      session_id: 's-degraded',
      pid: process.pid,
    });
    out = getBridgeHealth(paths, staleMs);
    assert.equal(out.bridge_status, 'degraded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bridge health reports degraded when process is alive but no freshness signal exists', () => {
  const { root, paths } = setupPaths();
  try {
    writeJSON(paths.nativeBridgeStatusFile, { pid: process.pid, worker_name: 'sidecar-native-bridge' });
    const out = getBridgeHealth(paths, 1000);
    assert.equal(out.process_alive, true);
    assert.equal(out.bridge_status, 'degraded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bridge health does not report healthy after a recent spawn failure without heartbeat/session', () => {
  const { root, paths } = setupPaths();
  try {
    writeJSON(paths.nativeBridgeStatusFile, {
      pid: null,
      session_id: null,
      note: 'bridge spawn failed',
      updated_at: new Date().toISOString(),
    });
    const out = getBridgeHealth(paths, 1000);
    assert.equal(out.bridge_status, 'down');
    assert.equal(out.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bridge controller heartbeat persists pid to heartbeat file', () => {
  const { root, paths } = setupPaths();
  try {
    writeJSON(paths.nativeBridgeStatusFile, { pid: 424242, session_id: 's-controller' });
    const controller = new BridgeController({ paths, coordinatorAdapter: null, store: null });
    const hb = controller.heartbeat('s-controller', { capabilities: ['Task'] });
    assert.equal(hb.pid, 424242);

    const persisted = JSON.parse(readFileSync(paths.nativeBridgeHeartbeatFile, 'utf-8'));
    assert.equal(persisted.pid, 424242);
    assert.equal(persisted.session_id, 's-controller');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
