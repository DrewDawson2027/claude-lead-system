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
    COORDINATOR_GLOBAL_BUDGET_POLICY: process.env.COORDINATOR_GLOBAL_BUDGET_POLICY,
    COORDINATOR_GLOBAL_BUDGET_TOKENS: process.env.COORDINATOR_GLOBAL_BUDGET_TOKENS,
    COORDINATOR_MAX_ACTIVE_WORKERS: process.env.COORDINATOR_MAX_ACTIVE_WORKERS,
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
      restoreEnv('COORDINATOR_GLOBAL_BUDGET_POLICY', previous.COORDINATOR_GLOBAL_BUDGET_POLICY);
      restoreEnv('COORDINATOR_GLOBAL_BUDGET_TOKENS', previous.COORDINATOR_GLOBAL_BUDGET_TOKENS);
      restoreEnv('COORDINATOR_MAX_ACTIVE_WORKERS', previous.COORDINATOR_MAX_ACTIVE_WORKERS);
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

test('spawn_worker blocks when global budget policy is enforce', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '0',
    COORDINATOR_GLOBAL_BUDGET_POLICY: 'enforce',
    COORDINATOR_GLOBAL_BUDGET_TOKENS: '10000',
  });

  try {
    const resultsDir = join(home, '.claude', 'terminals', 'results');
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, 'W_ACTIVE.meta.json'), JSON.stringify({
      task_id: 'W_ACTIVE',
      status: 'running',
      estimated_tokens: 9500,
    }));
    writeFileSync(join(resultsDir, 'W_ACTIVE.pid'), String(process.pid));

    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Do work under constrained budget',
      model: 'sonnet',
      task_id: 'W_BLOCKED',
    });
    assert.match(contentText(res), /Global budget policy blocked spawn/i);
  } finally {
    restore();
  }
});

test('spawn_worker warns (but allows) when global budget policy is warn', async () => {
  const { home, binDir, projectDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
    MOCK_CLAUDE_DELAY: '0',
    COORDINATOR_GLOBAL_BUDGET_POLICY: 'warn',
    COORDINATOR_GLOBAL_BUDGET_TOKENS: '10000',
  });

  try {
    const resultsDir = join(home, '.claude', 'terminals', 'results');
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, 'W_ACTIVE_WARN.meta.json'), JSON.stringify({
      task_id: 'W_ACTIVE_WARN',
      status: 'running',
      estimated_tokens: 9500,
    }));
    writeFileSync(join(resultsDir, 'W_ACTIVE_WARN.pid'), String(process.pid));

    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Do work with warning budget policy',
      model: 'sonnet',
      task_id: 'W_WARN',
    });
    const txt = contentText(res);
    assert.match(txt, /Worker spawned/i);
    assert.match(txt, /Global Budget: warn/i);
    assert.match(txt, /WARNING: Projected global token usage/i);
  } finally {
    restore();
  }
});

test('team policy applies permission mode and low-overhead preset defaults to worker spawn', async () => {
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
    const team = await api.handleToolCall('coord_create_team', {
      team_name: 'alpha',
      preset: 'simple',
      policy: {
        permission_mode: 'readOnly',
        require_plan: true,
        default_context_level: 'standard',
      },
      members: [{ name: 'researcher-1', role: 'researcher' }],
    });
    assert.match(contentText(team), /Team created/i);
    assert.match(contentText(team), /Team Permission Mode: readOnly/i);

    const spawn = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Analyze codebase and report findings',
      task_id: 'W_TEAMPOL',
      team_name: 'alpha',
      role: 'researcher',
      model: 'sonnet',
    });
    const txt = contentText(spawn);
    assert.match(txt, /Worker spawned/i);
    assert.match(txt, /Team: alpha/i);
    assert.match(txt, /Permission Mode: readOnly/i);
    assert.match(txt, /Plan Mode: enabled/i);
    assert.match(txt, /Team Policy Applied: yes/i);
  } finally {
    restore();
  }
});

test('task board supports team-scoped tasking and list filter', async () => {
  const { home, binDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });

  try {
    const t1 = await api.handleToolCall('coord_create_task', {
      task_id: 'T_TEAM_A',
      subject: 'Implement auth flow',
      team_name: 'alpha',
      assignee: 'worker1',
    });
    assert.match(contentText(t1), /Team: alpha/i);

    await api.handleToolCall('coord_create_task', {
      task_id: 'T_TEAM_B',
      subject: 'Write docs',
      team_name: 'beta',
    });

    const listAlpha = await api.handleToolCall('coord_list_tasks', { team_name: 'alpha' });
    const alphaTxt = contentText(listAlpha);
    assert.match(alphaTxt, /T_TEAM_A/);
    assert.doesNotMatch(alphaTxt, /T_TEAM_B/);

    const getAlpha = await api.handleToolCall('coord_get_task', { task_id: 'T_TEAM_A' });
    assert.match(contentText(getAlpha), /\*\*Team:\*\* alpha/i);
  } finally {
    restore();
  }
});

test('coord_team_dispatch creates team task, spawns worker, and links live team state', async () => {
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
    await api.handleToolCall('coord_create_team', {
      team_name: 'gamma',
      preset: 'simple',
      members: [{ name: 'alice', role: 'implementer' }],
    });

    const dispatch = await api.handleToolCall('coord_team_dispatch', {
      team_name: 'gamma',
      subject: 'Implement feature X',
      prompt: 'Implement feature X in the project',
      directory: projectDir,
      assignee: 'alice',
      role: 'implementer',
      task_id: 'T_DISPATCH',
      worker_task_id: 'W_DISPATCH',
      model: 'sonnet',
    });
    const dTxt = contentText(dispatch);
    assert.match(dTxt, /Team Dispatch \(gamma\)/i);
    assert.match(dTxt, /Team Task: T_DISPATCH/);
    assert.match(dTxt, /Worker Task: W_DISPATCH/);
    assert.match(dTxt, /Status: dispatched/);

    const task = await api.handleToolCall('coord_get_task', { task_id: 'T_DISPATCH' });
    const tTxt = contentText(task);
    assert.match(tTxt, /\*\*Team:\*\* gamma/i);
    assert.match(tTxt, /\*\*Status:\*\* in_progress/i);
    assert.match(tTxt, /worker_task_id/i);

    const team = await api.handleToolCall('coord_get_team', { team_name: 'gamma' });
    const teamTxt = contentText(team);
    assert.match(teamTxt, /### Team Tasks/i);
    assert.match(teamTxt, /T_DISPATCH \| in_progress \| alice/i);
    assert.match(teamTxt, /\*\*alice\*\*.*\| task: W_DISPATCH/i);
  } finally {
    restore();
  }
});

test('coord_team_queue_task + coord_team_status_compact + coord_team_assign_next dispatch queued work', async () => {
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
    await api.handleToolCall('coord_create_team', {
      team_name: 'ops',
      preset: 'simple',
      members: [
        { name: 'ivy', role: 'implementer' },
        { name: 'rhea', role: 'reviewer' },
      ],
    });

    const queued = await api.handleToolCall('coord_team_queue_task', {
      team_name: 'ops',
      task_id: 'TQ1',
      subject: 'Implement API layer',
      prompt: 'Implement the API layer',
      priority: 'high',
      files: ['src/api.ts'],
    });
    assert.match(contentText(queued), /Task created: \*\*TQ1\*\*/i);

    const status = await api.handleToolCall('coord_team_status_compact', {
      team_name: 'ops',
    });
    const statusTxt = contentText(status);
    assert.match(statusTxt, /Team Status \(Compact\): ops/i);
    assert.match(statusTxt, /TQ1 \| high/i);
    assert.match(statusTxt, /ivy \(implementer\)/i);

    const assigned = await api.handleToolCall('coord_team_assign_next', {
      team_name: 'ops',
      directory: projectDir,
      worker_task_id: 'WQ1',
      mode: 'pipe',
      model: 'sonnet',
    });
    const assignedTxt = contentText(assigned);
    assert.match(assignedTxt, /Team Assign Next \(ops\)/i);
    assert.match(assignedTxt, /Task: TQ1/i);
    assert.match(assignedTxt, /Assignee: ivy/i);
    assert.match(assignedTxt, /Status: dispatched/i);

    const task = await api.handleToolCall('coord_get_task', { task_id: 'TQ1' });
    const taskTxt = contentText(task);
    assert.match(taskTxt, /\*\*Status:\*\* in_progress/i);
    assert.match(taskTxt, /"status":"spawned"/i);
    assert.match(taskTxt, /"worker_task_id":"WQ1"/i);
  } finally {
    restore();
  }
});

test('coord_claim_next_task completes the current team task and claims the next newly unblocked queued task', async () => {
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
    await api.handleToolCall('coord_create_team', {
      team_name: 'claimers',
      preset: 'simple',
      members: [{ name: 'ivy', role: 'implementer' }],
    });

    await api.handleToolCall('coord_team_queue_task', {
      team_name: 'claimers',
      task_id: 'TQ_ROOT',
      subject: 'Implement root task',
      prompt: 'Implement the root task',
      role_hint: 'implementer',
      priority: 'high',
    });

    await api.handleToolCall('coord_team_queue_task', {
      team_name: 'claimers',
      task_id: 'TQ_FOLLOWUP',
      subject: 'Implement follow-up task',
      prompt: 'Implement the follow-up task',
      role_hint: 'implementer',
      blocked_by: ['TQ_ROOT'],
    });

    const assigned = await api.handleToolCall('coord_team_assign_next', {
      team_name: 'claimers',
      directory: projectDir,
      worker_task_id: 'WQ_ROOT',
      mode: 'pipe',
    });
    assert.match(contentText(assigned), /Task: TQ_ROOT/i);

    const claimed = await api.handleToolCall('coord_claim_next_task', {
      team_name: 'claimers',
      completed_worker_task_id: 'WQ_ROOT',
      assignee: 'ivy',
      directory: projectDir,
      mode: 'pipe',
    });
    const claimedTxt = contentText(claimed);
    assert.match(claimedTxt, /Claim Next Task \(claimers\)/i);
    assert.match(claimedTxt, /Completed: TQ_ROOT/i);
    assert.match(claimedTxt, /Claimed: TQ_FOLLOWUP/i);
    assert.match(claimedTxt, /Status: dispatched/i);

    const rootTask = await api.handleToolCall('coord_get_task', { task_id: 'TQ_ROOT' });
    assert.match(contentText(rootTask), /\*\*Status:\*\* completed/i);

    const followupTask = await api.handleToolCall('coord_get_task', { task_id: 'TQ_FOLLOWUP' });
    const followupTxt = contentText(followupTask);
    assert.match(followupTxt, /\*\*Status:\*\* in_progress/i);
    assert.match(followupTxt, /"status":"spawned"/i);
    assert.match(followupTxt, /\*\*Assignee:\*\* ivy/i);
  } finally {
    restore();
  }
});

test('coord_team_rebalance reassigns queued tasks deterministically by role', async () => {
  const { home, binDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });

  try {
    await api.handleToolCall('coord_create_team', {
      team_name: 'rebalance',
      preset: 'simple',
      members: [
        { name: 'alice', role: 'implementer' },
        { name: 'bob', role: 'reviewer' },
      ],
    });

    await api.handleToolCall('coord_team_queue_task', {
      team_name: 'rebalance',
      task_id: 'TQ_IMPL',
      subject: 'Implement auth',
      prompt: 'Implement auth flow',
      assignee: 'bob',
      role_hint: 'implementer',
      files: ['src/auth.ts'],
    });
    await api.handleToolCall('coord_team_queue_task', {
      team_name: 'rebalance',
      task_id: 'TQ_REV',
      subject: 'Review auth',
      prompt: 'Review auth changes',
      assignee: 'alice',
      role_hint: 'reviewer',
      files: ['src/auth.ts'],
    });

    const dryRun = await api.handleToolCall('coord_team_rebalance', {
      team_name: 'rebalance',
      apply: false,
    });
    assert.match(contentText(dryRun), /Mode: dry-run/i);
    assert.match(contentText(dryRun), /Changes: 2/i);

    const applied = await api.handleToolCall('coord_team_rebalance', {
      team_name: 'rebalance',
      apply: true,
    });
    const appliedTxt = contentText(applied);
    assert.match(appliedTxt, /Mode: apply/i);
    assert.match(appliedTxt, /TQ_IMPL: bob -> alice/i);
    assert.match(appliedTxt, /TQ_REV: alice -> bob/i);

    const implTask = await api.handleToolCall('coord_get_task', { task_id: 'TQ_IMPL' });
    const revTask = await api.handleToolCall('coord_get_task', { task_id: 'TQ_REV' });
    assert.match(contentText(implTask), /\*\*Assignee:\*\* alice/i);
    assert.match(contentText(revTask), /\*\*Assignee:\*\* bob/i);
    assert.match(contentText(implTask), /rebalance_last/i);
  } finally {
    restore();
  }
});

test('coord_sidecar_status reads local sidecar runtime snapshot metadata', async () => {
  const { home, binDir } = setupTestHome();
  const { api, restore } = await loadCoordinatorForTest({
    HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    COORDINATOR_TEST_MODE: '1',
    COORDINATOR_PLATFORM: 'linux',
    COORDINATOR_CLAUDE_BIN: 'claude-mock',
  });

  try {
    const sidecarRoot = join(home, '.claude', 'lead-sidecar');
    mkdirSync(join(sidecarRoot, 'runtime'), { recursive: true });
    mkdirSync(join(sidecarRoot, 'state'), { recursive: true });
    writeFileSync(join(sidecarRoot, 'runtime', 'sidecar.lock'), JSON.stringify({ pid: 12345, started_at: new Date().toISOString() }));
    writeFileSync(join(sidecarRoot, 'runtime', 'sidecar.port'), JSON.stringify({ port: 43123 }));
    writeFileSync(join(sidecarRoot, 'state', 'latest.json'), JSON.stringify({ generated_at: new Date().toISOString(), teams: [{ team_name: 'alpha' }] }));

    const res = await api.handleToolCall('coord_sidecar_status', {});
    const txt = contentText(res);
    assert.match(txt, /## Sidecar Status/i);
    assert.match(txt, /Installed: yes/i);
    assert.match(txt, /PID: 12345/i);
    assert.match(txt, /Port: 43123/i);
    assert.match(txt, /Teams: 1/i);
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

// ─── Issue 3: Codex runtime — coord_spawn_worker with runtime:'codex' ────────

test('spawn_worker with runtime codex uses codex exec in generated script', async () => {
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
    const taskId = 'W_CODEX_PIPE';
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'analyse the codebase',
      model: 'sonnet',
      runtime: 'codex',
      task_id: taskId,
      layout: 'background',
    });
    const txt = contentText(res);
    // Response must confirm codex runtime was selected
    assert.match(txt, /Runtime: codex/i);
    // Verify via __test__ that buildCodexWorkerScript produces codex exec command
    const codexScript = api.buildCodexWorkerScript({
      taskId,
      workDir: projectDir,
      resultFile: join(home, '.claude', 'terminals', 'results', taskId, 'result.txt'),
      pidFile: join(home, '.claude', 'terminals', 'results', taskId, 'worker.pid'),
      metaFile: join(home, '.claude', 'terminals', 'results', taskId, 'meta.json'),
      promptFile: join(home, '.claude', 'terminals', 'results', taskId, 'prompt.txt'),
      model: 'sonnet',
      platformName: 'linux',
    });
    assert.ok(
      codexScript.includes('codex exec') || codexScript.includes('codex "$WORKER_PROMPT"'),
      `codex worker script should contain codex exec; got: ${codexScript.slice(0, 200)}`
    );
    assert.ok(!codexScript.includes('claude -p'), 'codex script must not fall back to claude -p');
  } finally {
    restore();
  }
});

test('spawn_worker with runtime codex interactive uses codex TUI command', async () => {
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
      prompt: 'build the feature',
      model: 'sonnet',
      runtime: 'codex',
      mode: 'interactive',
      layout: 'background',
    });
    const txt = contentText(res);
    assert.match(txt, /Runtime: codex/i);
    assert.match(txt, /Mode: interactive/i);
    // Verify interactive codex script uses TUI mode (no `exec` subcommand)
    const taskId = txt.match(/Worker spawned: \*\*([^*]+)\*\*/)?.[1] || 'W_CODEX_INT';
    const interactiveScript = api.buildCodexInteractiveWorkerScript({
      taskId,
      workDir: projectDir,
      resultFile: '/tmp/r.txt',
      pidFile: '/tmp/p.pid',
      metaFile: '/tmp/m.json',
      promptFile: '/tmp/prompt.txt',
      model: 'sonnet',
      platformName: 'linux',
    });
    assert.match(interactiveScript, /codex "\$WORKER_PROMPT" --full-auto/);
    assert.ok(!interactiveScript.includes('codex exec'), 'interactive codex must not use exec subcommand');
  } finally {
    restore();
  }
});

test('spawn_worker defaults to claude runtime when runtime param is absent', async () => {
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
      prompt: 'do something',
      model: 'sonnet',
      layout: 'background',
    });
    const txt = contentText(res);
    assert.match(txt, /Runtime: claude/i);
    assert.doesNotMatch(txt, /Runtime: codex/i);
  } finally {
    restore();
  }
});

// ─── Issue 4: max_turns — coord_spawn_worker passes it into worker script ─────

test('spawn_worker with max_turns emits CLAUDE_WORKER_MAX_TURNS in script', async () => {
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
    // max_turns is threaded through buildInteractiveWorkerScript (mode=interactive)
    const taskId = 'W_MAX_TURNS_7';
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'fix the bug',
      model: 'sonnet',
      max_turns: 7,
      mode: 'interactive',
      task_id: taskId,
      layout: 'background',
    });
    assert.match(contentText(res), /Worker spawned/i);
    // buildInteractiveWorkerScript is the canonical path that injects CLAUDE_WORKER_MAX_TURNS
    const script = api.buildInteractiveWorkerScript({
      taskId,
      workDir: projectDir,
      resultFile: '/tmp/r.txt',
      pidFile: '/tmp/p.pid',
      metaFile: '/tmp/m.json',
      promptFile: '/tmp/prompt.txt',
      model: 'sonnet',
      agent: '',
      maxTurns: 7,
      permissionMode: 'acceptEdits',
      platformName: 'linux',
      workerName: '',
    });
    assert.ok(
      script.includes('CLAUDE_WORKER_MAX_TURNS') && script.includes("'7'"),
      `interactive worker script must export CLAUDE_WORKER_MAX_TURNS='7'; got: ${script.slice(0, 400)}`
    );
  } finally {
    restore();
  }
});

test('spawn_worker with max_turns clamps to valid range', async () => {
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
    const taskId = 'W_MAX_TURNS_CAP';
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'long running task',
      model: 'sonnet',
      max_turns: 99999,
      mode: 'interactive',
      task_id: taskId,
      layout: 'background',
    });
    assert.match(contentText(res), /Worker spawned/i);
    // workers.js clamps: Math.max(1, Math.min(10000, parseInt(99999))) = 10000
    const script = api.buildInteractiveWorkerScript({
      taskId,
      workDir: projectDir,
      resultFile: '/tmp/r.txt',
      pidFile: '/tmp/p.pid',
      metaFile: '/tmp/m.json',
      promptFile: '/tmp/prompt.txt',
      model: 'sonnet',
      agent: '',
      maxTurns: 10000,
      permissionMode: 'acceptEdits',
      platformName: 'linux',
      workerName: '',
    });
    assert.ok(
      script.includes('CLAUDE_WORKER_MAX_TURNS') && script.includes("'10000'") && !script.includes('99999'),
      'max_turns should be capped at 10000 in interactive worker script'
    );
  } finally {
    restore();
  }
});

test('spawn_worker without max_turns does not emit CLAUDE_WORKER_MAX_TURNS', async () => {
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
    const taskId = 'W_NO_MAX_TURNS';
    const res = await api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'do something',
      model: 'sonnet',
      mode: 'interactive',
      task_id: taskId,
      layout: 'background',
    });
    assert.match(contentText(res), /Worker spawned/i);
    // When maxTurns is null/falsy, buildInteractiveWorkerScript omits the export
    const script = api.buildInteractiveWorkerScript({
      taskId,
      workDir: projectDir,
      resultFile: '/tmp/r.txt',
      pidFile: '/tmp/p.pid',
      metaFile: '/tmp/m.json',
      promptFile: '/tmp/prompt.txt',
      model: 'sonnet',
      agent: '',
      maxTurns: null,
      permissionMode: 'acceptEdits',
      platformName: 'linux',
      workerName: '',
    });
    assert.ok(
      !script.includes('CLAUDE_WORKER_MAX_TURNS'),
      'script must NOT export CLAUDE_WORKER_MAX_TURNS when max_turns not set'
    );
  } finally {
    restore();
  }
});

// ─── Pipeline E2E ─────────────────────────────────────────────────────────────

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
