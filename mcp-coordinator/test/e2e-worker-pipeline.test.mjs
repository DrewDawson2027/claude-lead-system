import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const canRunE2E = process.platform === 'linux' || process.env.COORDINATOR_FORCE_E2E === '1';
const runOnLinux = canRunE2E ? test : test.skip;

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

runOnLinux('spawn worker -> completion -> get result', async () => {
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

runOnLinux('spawn worker -> kill worker', async () => {
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

runOnLinux('run pipeline -> completion -> get pipeline status', async () => {
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
