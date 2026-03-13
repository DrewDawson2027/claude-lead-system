/**
 * Tests for atomic team creation (coord_create_team with workers array).
 * Covers: successful atomic creation, rollback on failure, backwards compatibility.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-atomic-'));
  mkdirSync(join(home, '.claude', 'terminals', 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'terminals', 'tasks'), { recursive: true });
  mkdirSync(join(home, '.claude', 'terminals', 'results'), { recursive: true });
  return home;
}

function contentText(result) {
  return result?.content?.[0]?.text || '';
}

async function loadCoord(home) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';

  const mod = await import(`../index.js?atomic=${Date.now()}-${Math.random()}`);

  const restore = () => {
    if (prev.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = prev.HOME;
    if (prev.COORDINATOR_TEST_MODE === undefined) delete process.env.COORDINATOR_TEST_MODE;
    else process.env.COORDINATOR_TEST_MODE = prev.COORDINATOR_TEST_MODE;
    if (prev.COORDINATOR_PLATFORM === undefined) delete process.env.COORDINATOR_PLATFORM;
    else process.env.COORDINATOR_PLATFORM = prev.COORDINATOR_PLATFORM;
    // Reset spawn mock after each test
    mod.__test__._setSpawnWorkerFn(null);
  };

  return { api: mod.__test__, restore };
}

// ── Test 1: backwards compatibility — no workers param ────────────────────────

test('coord_create_team without workers creates team only (backwards compat)', async () => {
  const home = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    const result = await api.handleToolCall('coord_create_team', {
      team_name: 'compat-team',
      project: 'test-project',
    });
    const txt = contentText(result);
    assert.match(txt, /Team created: \*\*compat-team\*\*/);
    assert.ok(
      existsSync(join(home, '.claude', 'terminals', 'teams', 'compat-team.json')),
      'team config file should exist',
    );
    assert.ok(!txt.includes('Atomically Spawned Workers'), 'should not show workers section');
  } finally {
    restore();
  }
});

// ── Test 2: empty workers array falls through to sync path ────────────────────

test('coord_create_team with empty workers array behaves like no workers', async () => {
  const home = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    const result = await api.handleToolCall('coord_create_team', {
      team_name: 'empty-workers-team',
      workers: [],
    });
    const txt = contentText(result);
    assert.match(txt, /Team created: \*\*empty-workers-team\*\*/);
    assert.ok(!txt.includes('Atomically Spawned Workers'), 'should not show workers section');
  } finally {
    restore();
  }
});

// ── Test 3: atomic creation — workers spawned, team config persists ───────────

test('coord_create_team with workers array spawns all workers atomically', async () => {
  const home = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const spawnCalls = [];
    api._setSpawnWorkerFn((args) => {
      spawnCalls.push(args);
      return {
        content: [{
          type: 'text',
          text: `Worker spawned: **${args.worker_name}** task_id=t${spawnCalls.length}abc`,
        }],
      };
    });

    const result = await api.handleToolCall('coord_create_team', {
      team_name: 'atomic-team',
      project: 'atomic-project',
      workers: [
        { name: 'frontend', task: 'Build the login page', model: 'haiku' },
        { name: 'backend', task: 'Build the auth API', model: 'sonnet' },
      ],
    });

    const txt = contentText(result);
    assert.match(txt, /Team created: \*\*atomic-team\*\*/);
    assert.match(txt, /Atomically Spawned Workers \(2\)/);
    assert.match(txt, /Worker 1: frontend/);
    assert.match(txt, /Worker 2: backend/);
    assert.equal(spawnCalls.length, 2, 'spawn called once per worker');
    assert.equal(spawnCalls[0].worker_name, 'frontend');
    assert.equal(spawnCalls[1].worker_name, 'backend');
    assert.equal(spawnCalls[0].team_name, 'atomic-team', 'team_name injected into every spawn');
    // Team config must exist after success
    assert.ok(
      existsSync(join(home, '.claude', 'terminals', 'teams', 'atomic-team.json')),
      'team config should remain after successful atomic creation',
    );
  } finally {
    restore();
  }
});

// ── Test 4: rollback — team config removed when a worker spawn fails ──────────

test('coord_create_team rolls back team config when a worker spawn fails', async () => {
  const home = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    let spawnCount = 0;
    api._setSpawnWorkerFn((args) => {
      spawnCount++;
      if (spawnCount === 1) {
        return {
          content: [{
            type: 'text',
            text: `Worker spawned: **${args.worker_name}** task_id=t1rollback`,
          }],
        };
      }
      // Second worker fails
      return {
        content: [{ type: 'text', text: 'Failed to spawn worker: tmux session not found' }],
      };
    });

    const result = await api.handleToolCall('coord_create_team', {
      team_name: 'rollback-team',
      workers: [
        { name: 'worker-a', task: 'Do A', model: 'haiku' },
        { name: 'worker-b', task: 'Do B', model: 'haiku' },
      ],
    });

    const txt = contentText(result);
    assert.match(txt, /Atomic team creation FAILED and was rolled back/);
    assert.match(txt, /Workers killed: 1/);
    assert.match(txt, /Failed worker: worker-b/);
    // Team config must be removed on rollback
    assert.ok(
      !existsSync(join(home, '.claude', 'terminals', 'teams', 'rollback-team.json')),
      'team config should be deleted on rollback',
    );
  } finally {
    restore();
  }
});
