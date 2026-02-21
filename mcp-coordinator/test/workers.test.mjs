import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function loadForTest(home) {
  const prev = { HOME: process.env.HOME, COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE, COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM, COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  process.env.COORDINATOR_CLAUDE_BIN = 'echo';
  const mod = await import(`../index.js?workers=${Date.now()}-${Math.random()}`);
  return {
    api: mod.__test__,
    restore: () => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } },
  };
}

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-workers-'));
  const terminals = join(home, '.claude', 'terminals');
  const inbox = join(terminals, 'inbox');
  const results = join(terminals, 'results');
  const sessionCache = join(home, '.claude', 'session-cache');
  mkdirSync(inbox, { recursive: true });
  mkdirSync(results, { recursive: true });
  mkdirSync(sessionCache, { recursive: true });
  return { home, terminals, inbox, results };
}

test('spawn_terminal requires valid directory', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_spawn_terminal', {
      directory: '/tmp/does-not-exist-' + Date.now(),
    });
    assert.match(result?.content?.[0]?.text || '', /not found/i);
  } finally {
    restore();
  }
});

test('spawn_terminal succeeds with valid directory', async () => {
  const { home } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_spawn_terminal', {
      directory: projectDir,
      layout: 'split',
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /Terminal spawned/);
    assert.match(text, /split/);
  } finally {
    restore();
  }
});

test('get_result returns not found for missing task', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_get_result', { task_id: 'W_MISSING' });
    assert.match(result?.content?.[0]?.text || '', /not found/);
  } finally {
    restore();
  }
});

test('kill_worker returns appropriate message for missing PID', async () => {
  const { home, results } = setupHome();
  writeFileSync(join(results, 'W_TEST.meta.json'), JSON.stringify({ task_id: 'W_TEST', status: 'running' }));

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_kill_worker', { task_id: 'W_TEST' });
    assert.match(result?.content?.[0]?.text || '', /no PID file/i);
  } finally {
    restore();
  }
});

test('kill_worker recognizes already completed tasks', async () => {
  const { home, results } = setupHome();
  writeFileSync(join(results, 'W_DONE.meta.json'), JSON.stringify({ task_id: 'W_DONE', status: 'completed' }));
  writeFileSync(join(results, 'W_DONE.meta.json.done'), JSON.stringify({ status: 'completed' }));

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_kill_worker', { task_id: 'W_DONE' });
    assert.match(result?.content?.[0]?.text || '', /already completed/i);
  } finally {
    restore();
  }
});
