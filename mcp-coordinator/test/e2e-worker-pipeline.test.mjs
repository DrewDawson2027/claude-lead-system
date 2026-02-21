import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const canRunE2E = process.platform !== 'win32' || process.env.COORDINATOR_FORCE_E2E === '1';
const runE2E = canRunE2E ? test : test.skip;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 10000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function loadCoordinatorForTest(envOverrides = {}) {
  const previous = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
    MOCK_CLAUDE_DELAY: process.env.MOCK_CLAUDE_DELAY,
    COORDINATOR_MAX_MESSAGE_BYTES: process.env.COORDINATOR_MAX_MESSAGE_BYTES,
    COORDINATOR_MAX_INBOX_LINES: process.env.COORDINATOR_MAX_INBOX_LINES,
    COORDINATOR_MAX_INBOX_BYTES: process.env.COORDINATOR_MAX_INBOX_BYTES,
    COORDINATOR_MAX_MESSAGES_PER_MINUTE: process.env.COORDINATOR_MAX_MESSAGES_PER_MINUTE,
  };

  Object.assign(process.env, envOverrides);
  const mod = await import(`../index.js?e2e=${Date.now()}-${Math.random()}`);

  const restoreEnv = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  return {
    api: mod.__test__,
    restore: () => {
      restoreEnv('HOME', previous.HOME);
      restoreEnv('PATH', previous.PATH);
      restoreEnv('COORDINATOR_TEST_MODE', previous.COORDINATOR_TEST_MODE);
      restoreEnv('COORDINATOR_PLATFORM', previous.COORDINATOR_PLATFORM);
      restoreEnv('COORDINATOR_CLAUDE_BIN', previous.COORDINATOR_CLAUDE_BIN);
      restoreEnv('MOCK_CLAUDE_DELAY', previous.MOCK_CLAUDE_DELAY);
      restoreEnv('COORDINATOR_MAX_MESSAGE_BYTES', previous.COORDINATOR_MAX_MESSAGE_BYTES);
      restoreEnv('COORDINATOR_MAX_INBOX_LINES', previous.COORDINATOR_MAX_INBOX_LINES);
      restoreEnv('COORDINATOR_MAX_INBOX_BYTES', previous.COORDINATOR_MAX_INBOX_BYTES);
      restoreEnv('COORDINATOR_MAX_MESSAGES_PER_MINUTE', previous.COORDINATOR_MAX_MESSAGES_PER_MINUTE);
    },
  };
}

function setupTestHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-e2e-'));
  const binDir = join(home, 'bin');
  const projectDir = join(home, 'project');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  const mockClaude = join(binDir, 'claude-mock');
  writeFileSync(
    mockClaude,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${MOCK_CLAUDE_DELAY:-0}" != "0" ]; then
  sleep "\${MOCK_CLAUDE_DELAY}"
fi
input=$(cat)
echo "MOCK_CLAUDE_BEGIN"
echo "$input"
echo "MOCK_CLAUDE_END"
`,
  );
  chmodSync(mockClaude, 0o755);

  return { home, binDir, projectDir };
}

function contentText(result) {
  return result?.content?.[0]?.text || '';
}

test('check_inbox truncates oversized inbox output safely', async () => {
  const { home, binDir } = setupTestHome();
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'inbox'), { recursive: true });
  writeFileSync(
    join(terminals, 'session-abcd1234.json'),
    JSON.stringify({ session: 'abcd1234', status: 'active', cwd: '/tmp', project: 'demo', last_active: new Date().toISOString() }),
  );
  const inbox = join(terminals, 'inbox', 'abcd1234.jsonl');
  for (let i = 0; i < 20; i += 1) {
    appendFileSync(inbox, `${JSON.stringify({ ts: new Date().toISOString(), from: 'x', content: `m-${i}` })}\n`);
  }

  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    COORDINATOR_MAX_INBOX_LINES: '5',
    COORDINATOR_MAX_INBOX_BYTES: '4096',
  });

  try {
    const res = await api.handleToolCall('coord_check_inbox', { session_id: 'abcd1234' });
    const text = contentText(res);
    assert.match(text, /truncated/i);
    assert.equal((text.match(/### Message/g) || []).length, 5);
  } finally {
    restore();
  }
});

test('check_inbox preserves inbox when rename fallback path is used', async () => {
  const { home, binDir } = setupTestHome();
  const terminals = join(home, '.claude', 'terminals');
  const inboxDir = join(terminals, 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(
    join(terminals, 'session-abcd1234.json'),
    JSON.stringify({ session: 'abcd1234', status: 'active', cwd: '/tmp', project: 'demo', last_active: new Date().toISOString() }),
  );
  const inbox = join(inboxDir, 'abcd1234.jsonl');
  appendFileSync(inbox, `${JSON.stringify({ ts: new Date().toISOString(), from: 'x', content: 'hello' })}\n`);

  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });

  try {
    // Trigger lazy dir initialization before locking down permissions
    api.handleToolCall('coord_list_sessions', {});
    chmodSync(inboxDir, 0o500);
    const res = await api.handleToolCall('coord_check_inbox', { session_id: 'abcd1234' });
    assert.match(contentText(res), /Message 1/i);
    assert.equal(existsSync(inbox), true);
    assert.match(readFileSync(inbox, 'utf-8'), /hello/);
  } finally {
    chmodSync(inboxDir, 0o700);
    restore();
  }
});

test('coordinator creates secure state directories', async () => {
  const { home, binDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });

  try {
    // Trigger lazy directory initialization
    api.ensureDirsOnce();
    const terminalsMode = statSync(join(home, '.claude', 'terminals')).mode & 0o777;
    const inboxMode = statSync(join(home, '.claude', 'terminals', 'inbox')).mode & 0o777;
    assert.equal(terminalsMode, 0o700);
    assert.equal(inboxMode, 0o700);
  } finally {
    restore();
  }
});

test('spawn_worker rejects duplicate task_id collisions', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '0',
  });

  try {
    const first = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'First task',
      model: 'sonnet',
      task_id: 'W_COLLIDE',
    });
    assert.match(contentText(first), /Worker spawned/i);

    const second = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Second task',
      model: 'sonnet',
      task_id: 'W_COLLIDE',
    });
    assert.match(contentText(second), /already exists/i);
  } finally {
    restore();
  }
});

runE2E('spawn worker -> completion -> get result', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '0',
  });

  try {
    const spawn = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Implement auth tests',
      model: 'sonnet',
      task_id: 'W_E2E_A',
      layout: 'tab',
    });
    assert.match(contentText(spawn), /Worker spawned: \*\*W_E2E_A\*\*/);

    const doneFile = join(home, '.claude', 'terminals', 'results', 'W_E2E_A.meta.json.done');
    const completed = await waitFor(() => existsSync(doneFile), 10000, 100);
    assert.equal(completed, true, 'worker should complete and write done file');

    const result = await api.handleToolCall('coord_get_result', { task_id: 'W_E2E_A' });
    const text = contentText(result);
    assert.match(text, /completed/i);
    assert.match(text, /MOCK_CLAUDE_BEGIN/);
  } finally {
    restore();
  }
});

runE2E('spawn worker -> kill worker', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '20',
  });

  try {
    await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Long running task',
      model: 'sonnet',
      task_id: 'W_E2E_KILL',
      layout: 'tab',
    });

    const pidFile = join(home, '.claude', 'terminals', 'results', 'W_E2E_KILL.pid');
    const pidReady = await waitFor(() => existsSync(pidFile), 5000, 100);
    assert.equal(pidReady, true, 'pid file should exist before kill');

    const kill = await api.handleToolCall('coord_kill_worker', { task_id: 'W_E2E_KILL' });
    assert.match(contentText(kill), /killed/i);

    const doneFile = join(home, '.claude', 'terminals', 'results', 'W_E2E_KILL.meta.json.done');
    const doneData = JSON.parse(readFileSync(doneFile, 'utf-8'));
    assert.equal(doneData.status, 'cancelled');
  } finally {
    restore();
  }
});

test('spawn_worker with notify_session_id records in meta', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '0',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Test with notify',
      model: 'sonnet',
      task_id: 'W_NOTIFY',
      notify_session_id: 'abcd1234',
    });
    assert.match(contentText(res), /Worker spawned/i);
    const meta = JSON.parse(readFileSync(join(home, '.claude', 'terminals', 'results', 'W_NOTIFY.meta.json'), 'utf-8'));
    assert.equal(meta.notify_session_id, 'abcd1234');
  } finally {
    restore();
  }
});

test('spawn_worker with files records in meta', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '0',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Test with files',
      model: 'sonnet',
      task_id: 'W_FILES',
      files: ['src/a.ts', 'src/b.ts'],
    });
    assert.match(contentText(res), /Worker spawned/i);
    assert.match(contentText(res), /a\.ts/);
  } finally {
    restore();
  }
});

test('spawn_worker rejects empty prompt', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: '',
      model: 'sonnet',
    });
    assert.match(contentText(res), /required/i);
  } finally {
    restore();
  }
});

test('spawn_worker rejects missing directory', async () => {
  const { home, binDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: '/nonexistent/dir',
      prompt: 'test',
      model: 'sonnet',
    });
    assert.match(contentText(res), /not found/i);
  } finally {
    restore();
  }
});

test('run_pipeline rejects empty tasks', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_run_pipeline', {
      directory: projectDir,
      tasks: [],
    });
    assert.match(contentText(res), /No tasks/i);
  } finally {
    restore();
  }
});

test('run_pipeline rejects nonexistent directory', async () => {
  const { home, binDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_run_pipeline', {
      directory: '/nonexistent/dir',
      tasks: [{ name: 'step1', prompt: 'do thing', model: 'sonnet' }],
    });
    assert.match(contentText(res), /not found/i);
  } finally {
    restore();
  }
});

test('run_pipeline rejects duplicate pipeline_id', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const results = join(home, '.claude', 'terminals', 'results');
  mkdirSync(join(results, 'P_DUP'), { recursive: true });
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_run_pipeline', {
      directory: projectDir,
      pipeline_id: 'P_DUP',
      tasks: [{ name: 'step1', prompt: 'do thing', model: 'sonnet' }],
    });
    assert.match(contentText(res), /already exists/i);
  } finally {
    restore();
  }
});

test('get_pipeline shows pending status for not-yet-started pipeline', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const results = join(home, '.claude', 'terminals', 'results');
  const pDir = join(results, 'P_STATUS');
  mkdirSync(pDir, { recursive: true });
  writeFileSync(join(pDir, 'pipeline.meta.json'), JSON.stringify({
    pipeline_id: 'P_STATUS', directory: projectDir, total_steps: 2,
    tasks: [{ step: 0, name: 'step-a', model: 'sonnet' }, { step: 1, name: 'step-b', model: 'sonnet' }],
    started: new Date().toISOString(), status: 'running',
  }));
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_get_pipeline', { pipeline_id: 'P_STATUS' });
    const text = contentText(res);
    assert.match(text, /starting/i);
    assert.match(text, /0\/2/);
  } finally {
    restore();
  }
});

test('spawn_terminal with initial_prompt includes prompt in command', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });
  try {
    api.ensureDirsOnce();
    const res = await api.handleToolCall('coord_spawn_terminal', {
      directory: projectDir,
      initial_prompt: 'write tests',
      layout: 'split',
    });
    assert.match(contentText(res), /spawned/i);
    assert.match(contentText(res), /split/i);
  } finally {
    restore();
  }
});

runE2E('run pipeline -> completion -> get pipeline status', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '0',
  });

  try {
    const run = await api.handleToolCall('coord_run_pipeline', {
      directory: projectDir,
      pipeline_id: 'P_E2E_A',
      tasks: [
        { name: 'step one', prompt: 'collect metrics', model: 'sonnet' },
        { name: 'step two', prompt: 'write report', model: 'sonnet' },
      ],
    });
    assert.match(contentText(run), /Pipeline: \*\*P_E2E_A\*\*/);

    const doneFile = join(home, '.claude', 'terminals', 'results', 'P_E2E_A', 'pipeline.done');
    const completed = await waitFor(() => existsSync(doneFile), 10000, 100);
    assert.equal(completed, true, 'pipeline should complete');

    const status = await api.handleToolCall('coord_get_pipeline', { pipeline_id: 'P_E2E_A' });
    const text = contentText(status);
    assert.match(text, /completed/i);
    assert.match(text, /2\/2/);
  } finally {
    restore();
  }
});
