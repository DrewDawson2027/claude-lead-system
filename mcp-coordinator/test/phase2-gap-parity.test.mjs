/**
 * Phase 2 gap parity tests.
 *
 * Gap 6: Split Pane Auto-Management — tmux detection, auto-layout selection,
 *   tmux_pane_id + backend_type stored in meta, discover_peers returns pane IDs.
 *
 * Gap 4: Bidirectional Communication — CLAUDE_LEAD_SESSION_ID and
 *   CLAUDE_LEAD_PANE_ID env exports in worker script, instruction block
 *   teaches bidirectional messaging with coord_discover_peers and coord_send_protocol.
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
  const home = mkdtempSync(join(tmpdir(), 'coord-p2-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'inbox'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'session-cache'), { recursive: true });
  return { home, results: join(terminals, 'results') };
}

async function loadForTest(home, envOverrides = {}) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
    TMUX: process.env.TMUX,
    TMUX_PANE: process.env.TMUX_PANE,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  process.env.COORDINATOR_CLAUDE_BIN = 'echo';
  delete process.env.TMUX;
  delete process.env.TMUX_PANE;
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  const mod = await import(`../index.js?p2=${Date.now()}-${Math.random()}`);
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

// ─── Gap 6: Split Pane Auto-Management ───────────────────────────────────────

test('Gap 6: auto-tmux detection — team_name + TMUX env → backend_type=tmux in meta', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  // Simulate being inside tmux with a known pane
  const { api, restore } = await loadForTest(home, {
    TMUX: '/tmp/tmux-501/test,12345,0',
    TMUX_PANE: '%3',
  });
  try {
    api.ensureDirsOnce();
    const taskId = 'W_AUTOTMUX';
    // team_name triggers auto-tmux: if inside tmux + team → layout switches to "tmux"
    api.handleToolCall('coord_spawn_worker', {
      task_id: taskId,
      directory: projectDir,
      prompt: 'test auto-tmux',
      team_name: 'alpha',
      mode: 'pipe',
    });
    // Meta is written before and after spawn attempt — backend_type survives even if tmux fails
    const meta = readJson(join(results, `${taskId}.meta.json`));
    assert.equal(meta.backend_type, 'tmux', 'auto-tmux detection must set backend_type="tmux"');
  } finally {
    restore();
  }
});

test('Gap 6: no auto-tmux when TMUX env is absent — stays background', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home); // TMUX deleted by default
  try {
    api.ensureDirsOnce();
    const taskId = 'W_NOTMUX';
    api.handleToolCall('coord_spawn_worker', {
      task_id: taskId,
      directory: projectDir,
      prompt: 'test no auto-tmux',
      team_name: 'alpha',
      mode: 'pipe',
    });
    const meta = readJson(join(results, `${taskId}.meta.json`));
    assert.notEqual(meta.backend_type, 'tmux', 'without TMUX env, backend_type must not be tmux');
  } finally {
    restore();
  }
});

test('Gap 6: coord_discover_peers returns tmux_pane_id from worker meta', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Write a meta file simulating a tmux-pane worker in team "bravo"
    writeFileSync(join(results, 'W_PEER1.meta.json'), JSON.stringify({
      task_id: 'W_PEER1',
      team_name: 'bravo',
      worker_name: 'coder',
      role: 'implementer',
      model: 'sonnet',
      permission_mode: 'acceptEdits',
      status: 'running',
      tmux_pane_id: '%7',
      backend_type: 'tmux',
    }));
    const result = api.handleToolCall('coord_discover_peers', { team_name: 'bravo' });
    const txt = textOf(result);
    assert.match(txt, /Team: bravo/, 'response must identify the team');
    assert.match(txt, /coder/, 'response must include peer name');
    assert.match(txt, /%7/, 'response must include the tmux pane ID from meta');
    assert.match(txt, /implementer/, 'response must include the role');
  } finally {
    restore();
  }
});

test('Gap 6: coord_discover_peers with no workers returns not-found message', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_discover_peers', { team_name: 'empty-team' });
    assert.match(textOf(result), /No peers found/i);
  } finally {
    restore();
  }
});

test('Gap 6: coord_discover_peers table has correct column headers', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(results, 'W_PEER2.meta.json'), JSON.stringify({
      task_id: 'W_PEER2',
      team_name: 'charlie',
      worker_name: 'reviewer',
      role: 'reviewer',
      model: 'opus',
      permission_mode: 'readOnly',
      status: 'running',
      tmux_pane_id: '%9',
    }));
    const result = api.handleToolCall('coord_discover_peers', { team_name: 'charlie' });
    const txt = textOf(result);
    // Verify the markdown table has all required columns from the spec
    assert.match(txt, /Name/, 'table must have Name column');
    assert.match(txt, /Task ID/, 'table must have Task ID column');
    assert.match(txt, /Pane/, 'table must have Pane column');
    assert.match(txt, /Role/, 'table must have Role column');
    assert.match(txt, /Status/, 'table must have Status column');
  } finally {
    restore();
  }
});

// ─── Gap 4: Bidirectional Communication ──────────────────────────────────────

test('Gap 4: buildInteractiveWorkerScript exports CLAUDE_LEAD_SESSION_ID when leadSessionId is set', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_BIDI',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    leadSessionId: 'aaaa5678',
  });
  assert.match(cmd, /export CLAUDE_LEAD_SESSION_ID='aaaa5678'/, 'lead session ID must be exported');
});

test('Gap 4: buildInteractiveWorkerScript exports CLAUDE_LEAD_PANE_ID when leadPaneId is set', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_BIDI2',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    leadPaneId: '%5',
  });
  assert.match(cmd, /export CLAUDE_LEAD_PANE_ID='%5'/, 'lead pane ID must be exported');
});

test('Gap 4: buildInteractiveWorkerScript omits lead env vars when not provided', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_BIDI3',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    // no leadSessionId or leadPaneId
  });
  assert.doesNotMatch(cmd, /CLAUDE_LEAD_SESSION_ID/, 'lead session ID must not appear without value');
  assert.doesNotMatch(cmd, /CLAUDE_LEAD_PANE_ID/, 'lead pane ID must not appear without value');
});

test('Gap 4: worker instructions state plain text output is NOT visible to teammates', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const taskId = 'W_INSTR';
    api.handleToolCall('coord_spawn_worker', {
      task_id: taskId,
      directory: projectDir,
      prompt: 'do the task',
      mode: 'interactive',
      notify_session_id: 'lead5678',
    });
    const promptFile = join(results, `${taskId}.prompt`);
    const promptContent = readFileSync(promptFile, 'utf8');
    assert.match(
      promptContent,
      /NOT visible to the team lead or other teammates/,
      'worker instructions must warn that plain text is not visible',
    );
  } finally {
    restore();
  }
});

test('Gap 4: worker instructions include coord_discover_peers when team_name is set', async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const taskId = 'W_INSTR2';
    api.handleToolCall('coord_spawn_worker', {
      task_id: taskId,
      directory: projectDir,
      prompt: 'work with team',
      mode: 'interactive',
      team_name: 'delta',
      notify_session_id: 'lead5678',
    });
    const promptContent = readFileSync(join(results, `${taskId}.prompt`), 'utf8');
    assert.match(promptContent, /coord_discover_peers/, 'team instructions must include peer discovery tool');
    assert.match(promptContent, /coord_send_protocol/, 'team instructions must include protocol messaging tool');
  } finally {
    restore();
  }
});

test('Gap 4: buildResumeWorkerScript exports CLAUDE_LEAD_SESSION_ID and CLAUDE_LEAD_PANE_ID', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_RESUME_BIDI',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    leadSessionId: 'lead5678',
    leadPaneId: '%3',
  });
  assert.match(cmd, /CLAUDE_LEAD_SESSION_ID='lead5678'/, 'resume script must export lead session ID');
  assert.match(cmd, /CLAUDE_LEAD_PANE_ID='%3'/, 'resume script must export lead pane ID');
});
