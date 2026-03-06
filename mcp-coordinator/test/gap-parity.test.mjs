/**
 * Phase 1 gap parity tests.
 *
 * Gap 7: Permission Modes — all 8 modes accepted, planOnly→plan mapping,
 *   invalid mode fallback, native modes pass through to CLI script.
 *
 * Gap 2: Session IDs + True Resume — UUID generated for interactive workers,
 *   --session-id in CLI script, --resume path on coord_resume_worker,
 *   fallback to continuation spawn when no session ID.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __test__ } from '../index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-gap-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'inbox'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'session-cache'), { recursive: true });
  return { home, results: join(terminals, 'results') };
}

async function loadForTest(home) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
    TMUX: process.env.TMUX,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  process.env.COORDINATOR_CLAUDE_BIN = 'echo';
  delete process.env.TMUX; // ensure not inside tmux during tests
  const mod = await import(`../index.js?gap=${Date.now()}-${Math.random()}`);
  return {
    api: mod.__test__,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

function textOf(result) {
  return result?.content?.[0]?.text || '';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ─── Gap 7: Permission Modes ──────────────────────────────────────────────────

test('Gap 7: all 8 permission modes are accepted by coord_spawn_worker', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();

    const modes = [
      'acceptEdits', 'bypassPermissions', 'default', 'dontAsk',
      'plan', 'planOnly', 'readOnly', 'editOnly',
    ];

    for (const mode of modes) {
      const taskId = `W_MODE_${mode}`;
      const result = api.handleToolCall('coord_spawn_worker', {
        task_id: taskId,
        directory: projectDir,
        prompt: 'test task',
        permission_mode: mode,
        mode: 'pipe',
      });
      assert.match(textOf(result), /Worker spawned/, `mode "${mode}" should be accepted`);

      // planOnly is an alias that maps to 'plan' in stored meta
      const expectedInMeta = mode === 'planOnly' ? 'plan' : mode;
      const meta = readJson(join(results, `${taskId}.meta.json`));
      assert.equal(
        meta.permission_mode,
        expectedInMeta,
        `mode "${mode}" should store "${expectedInMeta}" in meta`,
      );
    }
  } finally {
    restore();
  }
});

test('Gap 7: invalid permission_mode falls back to acceptEdits', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const taskId = 'W_BADMODE';
    api.handleToolCall('coord_spawn_worker', {
      task_id: taskId,
      directory: projectDir,
      prompt: 'test task',
      permission_mode: 'superAdmin', // not in validModes
      mode: 'pipe',
    });
    const meta = readJson(join(results, `${taskId}.meta.json`));
    assert.equal(meta.permission_mode, 'acceptEdits', 'invalid mode must fall back to acceptEdits');
  } finally {
    restore();
  }
});

test('Gap 7: planOnly maps to --permission-mode plan in the worker CLI script', () => {
  // planOnly→plan mapping happens before buildInteractiveWorkerScript is called;
  // the script receives the already-mapped value ('plan').
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_PLANONLY',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'plan', // value after planOnly→plan mapping
    platformName: 'linux',
  });
  assert.match(cmd, /--permission-mode 'plan'/, 'mapped plan mode must appear in CLI args');
  assert.doesNotMatch(cmd, /planOnly/, 'planOnly alias must not leak into script');
});

test('Gap 7: native modes bypassPermissions and dontAsk pass through to worker script', () => {
  for (const mode of ['bypassPermissions', 'dontAsk']) {
    const cmd = __test__.buildInteractiveWorkerScript({
      taskId: `W_${mode}`,
      workDir: '/tmp/work',
      resultFile: '/tmp/result.txt',
      pidFile: '/tmp/pid.txt',
      metaFile: '/tmp/meta.json',
      model: 'sonnet',
      agent: '',
      promptFile: '/tmp/prompt.txt',
      permissionMode: mode,
      platformName: 'linux',
    });
    assert.match(
      cmd,
      new RegExp(`--permission-mode '${mode}'`),
      `${mode} must pass through verbatim to claude CLI`,
    );
  }
});

// ─── Gap 2: Session IDs + True Resume ────────────────────────────────────────

test('Gap 2: interactive worker spawn stores a UUID in meta.claude_session_id', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const taskId = `W_SID_${Date.now()}`;
    const result = api.handleToolCall('coord_spawn_worker', {
      task_id: taskId,
      directory: projectDir,
      prompt: 'do something',
      mode: 'interactive',
    });
    assert.match(textOf(result), /Worker spawned/);
    const meta = readJson(join(results, `${taskId}.meta.json`));
    assert.ok(meta.claude_session_id, 'interactive worker must have claude_session_id');
    assert.match(
      meta.claude_session_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'claude_session_id must be a valid UUID v4',
    );
  } finally {
    restore();
  }
});

test('Gap 2: pipe-mode worker has null claude_session_id in meta', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const taskId = `W_NOSID_${Date.now()}`;
    api.handleToolCall('coord_spawn_worker', {
      task_id: taskId,
      directory: projectDir,
      prompt: 'do something',
      mode: 'pipe',
    });
    const meta = readJson(join(results, `${taskId}.meta.json`));
    assert.equal(meta.claude_session_id, null, 'pipe worker must have null claude_session_id');
  } finally {
    restore();
  }
});

test('Gap 2: buildInteractiveWorkerScript includes --session-id when sessionId is provided', () => {
  const sessionId = 'aaaabbbb-cccc-dddd-eeee-000011112222';
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_SESSID',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    sessionId,
  });
  assert.match(
    cmd,
    new RegExp(`--session-id '${sessionId}'`),
    'session ID must be forwarded to claude CLI via --session-id',
  );
});

test('Gap 2: buildInteractiveWorkerScript omits --session-id when sessionId is absent', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_NOSESSID',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    // sessionId intentionally omitted
  });
  assert.doesNotMatch(cmd, /--session-id/, '--session-id must not appear when sessionId is absent');
});

test('Gap 2: coord_resume_worker uses true --resume path when claude_session_id exists', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const taskId = 'W_RESUME_TRUE';
    const sessionId = 'aaaabbbb-cccc-dddd-eeee-000011112222';

    // Simulate a completed interactive worker that has a session ID
    writeFileSync(join(results, `${taskId}.meta.json`), JSON.stringify({
      task_id: taskId,
      directory: projectDir,
      mode: 'interactive',
      model: 'sonnet',
      claude_session_id: sessionId,
      status: 'running',
    }));
    // No PID file → worker is not running, resume is allowed

    const result = api.handleToolCall('coord_resume_worker', {
      task_id: taskId,
      mode: 'interactive',
    });
    const txt = textOf(result);
    assert.match(txt, /true resume/i, 'response must confirm true resume path');
    assert.match(txt, /full conversation history/i, 'response must confirm history is preserved');
    assert.match(txt, new RegExp(sessionId), 'response must reference the resumed session ID');
  } finally {
    restore();
  }
});

test('Gap 2: coord_resume_worker falls back to continuation spawn when no session ID', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const taskId = 'W_RESUME_FALL';

    // Simulate a prior worker WITHOUT a session ID (legacy / pipe worker)
    writeFileSync(join(results, `${taskId}.meta.json`), JSON.stringify({
      task_id: taskId,
      directory: projectDir,
      mode: 'pipe',
      model: 'sonnet',
      prompt: 'original task',
      status: 'running',
    }));
    writeFileSync(join(results, `${taskId}.txt`), 'partial output from prior run');
    // No PID file → worker is not running

    const result = api.handleToolCall('coord_resume_worker', { task_id: taskId });
    const txt = textOf(result);
    // Falls back to handleSpawnWorker → returns "Worker spawned: ..."
    assert.match(txt, /Worker spawned/, 'fallback resume must spawn a new continuation worker');
  } finally {
    restore();
  }
});
