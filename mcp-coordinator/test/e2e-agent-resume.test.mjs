/**
 * E2E tests for Agent Resume round-trip.
 *
 * Proves that coord_resume_worker performs a true resume (using buildResumeWorkerScript
 * with the original claude_session_id) when the dead worker's meta file has a
 * claude_session_id. No real Claude process is needed — we write meta files exactly
 * as a real worker's heartbeat hook would.
 *
 * Coverage:
 *   1. True resume path: meta has claude_session_id → "Worker resumed (true resume)"
 *   2. New meta file records resumed_from_session = original claude_session_id
 *   3. Resume-by-agentId path when native identity exists
 *   4. Summary fallback when native identity is absent
 *   5. Error path: task not found
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { upsertIdentityRecord } from '../lib/identity-map.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function contentText(result) {
  return result?.content?.[0]?.text || '';
}

async function loadCoord(home) {
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
  delete process.env.TMUX;
  const mod = await import(`../index.js?e2e-resume=${Date.now()}-${Math.random()}`);
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

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-e2e-resume-'));
  const terminals = join(home, '.claude', 'terminals');
  const results = join(terminals, 'results');
  mkdirSync(join(terminals, 'inbox'), { recursive: true });
  mkdirSync(results, { recursive: true });
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'session-cache'), { recursive: true });
  return { home, terminals, results };
}

/**
 * Write a completed-worker meta file — what a real worker writes on exit.
 * claude_session_id is optional: present = true resume, absent = fallback continuation.
 */
function writeWorkerMeta(results, home, taskId, opts = {}) {
  writeFileSync(
    join(results, `${taskId}.meta.json`),
    JSON.stringify({
      task_id: taskId,
      worker_name: opts.workerName || 'worker-alpha',
      mode: opts.mode || 'interactive',
      model: opts.model || 'sonnet',
      prompt: opts.prompt || 'Build the auth module',
      directory: home,
      original_directory: home,
      claude_session_id: opts.claudeSessionId || undefined,
      spawned: new Date().toISOString(),
      status: 'completed',
      resume_count: opts.resumeCount || 0,
    }),
  );
  if (opts.output) {
    writeFileSync(join(results, `${taskId}.txt`), opts.output);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('E2E Resume: coord_resume_worker takes true-resume path when claude_session_id is present', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const taskId = 'e2e-resume-01';
    const claudeSessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    writeWorkerMeta(results, home, taskId, {
      claudeSessionId,
      output: 'Completed auth module skeleton',
    });

    const result = api.handleToolCall('coord_resume_worker', {
      task_id: taskId,
      mode: 'interactive',
    });
    const txt = contentText(result);

    assert.match(txt, /Worker resumed \(true resume\)/i, 'must confirm true resume path');
    assert.match(txt, /route_mode: claude-session-resume/i);
    assert.ok(txt.includes(claudeSessionId), 'must reference the original session_id');
    assert.match(txt, /Full conversation history preserved/i, 'must claim history preserved');
  } finally {
    restore();
  }
});

test('E2E Resume: new meta file records resumed_from_session = original claude_session_id', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const taskId = 'e2e-resume-02';
    const claudeSessionId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
    writeWorkerMeta(results, home, taskId, { claudeSessionId });

    api.handleToolCall('coord_resume_worker', { task_id: taskId, mode: 'interactive' });

    // The coordinator creates a new task ID: <original>-r<resumeCount>
    const newTaskId = `${taskId}-r1`;
    const newMetaFile = join(results, `${newTaskId}.meta.json`);
    assert.ok(existsSync(newMetaFile), 'new meta file must be created for resumed task');

    const parsed = JSON.parse(readFileSync(newMetaFile, 'utf8'));
    assert.equal(
      parsed.resumed_from_session,
      claudeSessionId,
      'must record original session_id in resumed_from_session',
    );
    assert.equal(parsed.original_task_id, taskId, 'must record original task_id');
    assert.equal(parsed.resume_count, 1, 'resume_count must be incremented');
  } finally {
    restore();
  }
});

test('E2E Resume: fallback continuation-spawn when no claude_session_id', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    // No claude_session_id — simulates a worker that ran in pipe mode
    const taskId = 'e2e-resume-03';
    writeWorkerMeta(results, home, taskId, {
      mode: 'pipe',
      output: 'Found 3 errors in auth.log',
      // claudeSessionId intentionally omitted
    });

    const result = api.handleToolCall('coord_resume_worker', { task_id: taskId });
    const txt = contentText(result);

    assert.match(txt, /summary fallback/i, 'must make fallback mode explicit');
    assert.match(txt, /route_mode: summary-fallback/i, 'must expose fallback route mode');
    assert.match(txt, /route_reason:/i, 'must expose fallback reason');
    assert.ok(!txt.includes('true resume'), 'must not claim true resume when no session_id is available');
  } finally {
    restore();
  }
});

test('E2E Resume: resume-by-agentId when identity map has native agent_id', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const taskId = 'e2e-resume-agent-01';
    writeWorkerMeta(results, home, taskId, {
      mode: 'interactive',
      output: 'partial output',
      claudeSessionId: undefined,
    });
    upsertIdentityRecord({
      team_name: 'agent-team',
      task_id: taskId,
      agent_id: 'agent-native-42',
      session_id: 'facefeed',
    });
    const metaPath = join(results, `${taskId}.meta.json`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.team_name = 'agent-team';
    writeFileSync(metaPath, JSON.stringify(meta));

    const result = api.handleToolCall('coord_resume_worker', {
      task_id: taskId,
      mode: 'interactive',
    });
    const txt = contentText(result);
    assert.match(txt, /native agentId/i, 'must prefer agentId resume when identity exists');
    assert.match(txt, /route_mode: native-agent-resume/i);
    assert.match(txt, /probe_source: identity-map/i);
    assert.match(txt, /fallback_history: \[\]/i);
    assert.match(txt, /agent-native-42/i);
  } finally {
    restore();
  }
});

test('E2E Resume: resume-by-agentId wins when task identity is partial but session identity has agent_id', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const taskId = 'e2e-resume-agent-02';
    const claudeSessionId = 'd4e5f6a7-b8c9-0123-def0-1234567890ab';
    writeWorkerMeta(results, home, taskId, {
      workerName: 'worker-split',
      claudeSessionId,
      output: 'partial output',
    });
    const metaPath = join(results, `${taskId}.meta.json`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.team_name = 'agent-team';
    writeFileSync(metaPath, JSON.stringify(meta));

    // Partial task identity record (no agent_id).
    upsertIdentityRecord({
      team_name: 'agent-team',
      task_id: taskId,
      worker_name: 'worker-split',
    });
    // Session-linked identity record carries the native agent_id.
    upsertIdentityRecord({
      team_name: 'agent-team',
      claude_session_id: claudeSessionId,
      session_id: '11223344',
      agent_id: 'agent-native-99',
      agent_name: 'native-worker',
      worker_name: 'worker-split',
    });

    const result = api.handleToolCall('coord_resume_worker', {
      task_id: taskId,
      mode: 'interactive',
    });
    const txt = contentText(result);
    assert.match(txt, /route_mode: native-agent-resume/i);
    assert.match(txt, /probe_source: identity-map/i);
    assert.match(txt, /fallback_history: \[\]/i);
    assert.match(txt, /agent-native-99/i);
    assert.doesNotMatch(txt, /route_mode: claude-session-resume/i);
  } finally {
    restore();
  }
});

test('E2E Resume: returns task-not-found when meta file does not exist', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const result = api.handleToolCall('coord_resume_worker', {
      task_id: 'nonexistent-task-99',
    });
    assert.match(contentText(result), /not found/i, 'must report task not found');
  } finally {
    restore();
  }
});

test('E2E Resume: uses transcript file for true resume when transcript exists', async () => {
  const { home, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const taskId = 'e2e-resume-04';
    const claudeSessionId = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
    writeWorkerMeta(results, home, taskId, { claudeSessionId });
    // Write a transcript file — resume prefers this over result file
    writeFileSync(join(results, `${taskId}.transcript`), 'Full session transcript content here');

    const result = api.handleToolCall('coord_resume_worker', {
      task_id: taskId,
      mode: 'interactive',
    });
    // True resume should still fire (transcript doesn't block it — session_id does)
    assert.match(contentText(result), /Worker resumed \(true resume\)/i);
  } finally {
    restore();
  }
});
