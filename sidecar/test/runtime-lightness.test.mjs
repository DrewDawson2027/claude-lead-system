import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HookStreamAdapter } from '../adapters/hook-stream-adapter.js';
import { startRuntimeLifecycle } from '../server/runtime/lifecycle.ts';

test('HookStreamAdapter uses a low-noise reconciliation poll when fs watchers are available', () => {
  const root = mkdtempSync(join(tmpdir(), 'hook-stream-lightness-'));
  const paths = {
    terminalsDir: join(root, 'terminals'),
    teamsDir: join(root, 'teams'),
    tasksDir: join(root, 'tasks'),
    resultsDir: join(root, 'results'),
  };
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });

  const adapter = new HookStreamAdapter(paths, () => {});
  adapter.start();
  try {
    assert.equal(adapter.watchers.length > 0, true);
    assert.equal(adapter.interval?._idleTimeout, 30_000);
  } finally {
    adapter.stop();
  }
});

test('runtime lifecycle defaults maintenance sweeps to 60 seconds', () => {
  class FakeHookStreamAdapter {
    constructor(paths, onChange) {
      this.paths = paths;
      this.onChange = onChange;
    }
    start() {}
    stop() {}
  }

  const lifecycle = startRuntimeLifecycle({
    HookStreamAdapter: FakeHookStreamAdapter,
    paths: {},
    store: { on() {} },
    rebuild: async () => {},
    maintenanceSweep: () => {},
    clients: new Set(),
    sseBroadcast: () => {},
  });

  try {
    assert.equal(lifecycle.maintenanceTimer?._idleTimeout, 60_000);
  } finally {
    lifecycle.stop();
  }
});
