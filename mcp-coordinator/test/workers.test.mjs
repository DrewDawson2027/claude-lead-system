import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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

test('spawn_worker compacts duplicated context sections and records compaction stats', async () => {
  const { home, terminals, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const sessionCacheDir = join(home, '.claude', 'session-cache');
  const contextDir = join(terminals, 'context');
  mkdirSync(contextDir, { recursive: true });

  const sharedSummary = 'Implement auth and tests for API parity.';
  writeFileSync(join(sessionCacheDir, 'coder-context.md'), sharedSummary);
  writeFileSync(
    join(contextDir, 'lead-context-lead1234.json'),
    JSON.stringify({ summary: sharedSummary }, null, 2),
  );

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const spawn = api.handleToolCall('coord_spawn_worker', {
      task_id: 'W_CTX_COMPRESS',
      directory: projectDir,
      prompt: 'Implement the endpoint.',
      notify_session_id: 'lead1234',
      context_summary: sharedSummary,
      mode: 'pipe',
      team_name: 'alpha',
    });
    assert.match(spawn?.content?.[0]?.text || '', /Worker spawned/);

    const promptText = readFileSync(
      join(results, 'W_CTX_COMPRESS.prompt'),
      'utf8',
    );
    const occurrences = promptText.split(sharedSummary).length - 1;
    assert.equal(occurrences, 1, 'duplicated context should be collapsed to one section');

    const meta = readJson(join(results, 'W_CTX_COMPRESS.meta.json'));
    assert.equal(
      Number(meta?.prompt_compaction?.context?.duplicate_sections_dropped || 0) >= 1,
      true,
    );
  } finally {
    restore();
  }
});

test('send_message suppresses immediate duplicate payloads', async () => {
  const { home, terminals, inbox } = setupHome();
  writeFileSync(
    join(terminals, 'session-sess1234.json'),
    JSON.stringify({
      session: 'sess1234',
      status: 'active',
      last_active: new Date().toISOString(),
    }, null, 2),
  );

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const first = api.handleToolCall('coord_send_message', {
      from: 'lead',
      to: 'sess1234',
      content: 'Please sync status.',
    });
    assert.match(first?.content?.[0]?.text || '', /Message sent/);

    const second = api.handleToolCall('coord_send_message', {
      from: 'lead',
      to: 'sess1234',
      content: 'Please sync status.',
    });
    assert.match(second?.content?.[0]?.text || '', /Duplicate message suppressed/);

    const inboxLines = readFileSync(join(inbox, 'sess1234.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(inboxLines.length, 1);
  } finally {
    restore();
  }
});
