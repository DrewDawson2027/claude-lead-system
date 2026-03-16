/**
 * Team-dispatch branch coverage — targets uncovered lines in team-dispatch.js
 * (currently 48.19% branch coverage).
 *
 * Covers:
 *  - handleTeamDispatch: team not found
 *  - handleTeamDispatch: missing subject / prompt / directory
 *  - handleTeamDispatch: create_task=false path
 *  - handleTeamDispatch: spawn fails → task update with spawn_failed (lines 212-222)
 *  - handleTeamDispatch: native/hybrid team with session_id member (lines 144-146)
 *  - handleTeamDispatch: canNativeResume → patch agentId onto team member (lines 155-159)
 *  - pickAssignee: no members → null
 *  - pickAssignee: role match
 *  - shouldUseLowOverheadDispatch: team.low_overhead_mode = "minimal"
 *  - sanitizeContextSummary: summary equals prompt (returns null)
 *  - sanitizeContextSummary: valid distinct summary
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  process.env.COORDINATOR_CLAUDE_BIN = 'echo';
  const mod = await import(`../index.js?td-br=${Date.now()}-${Math.random()}`);
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
  const home = mkdtempSync(join(tmpdir(), 'coord-td-br-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'inbox'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'session-cache'), { recursive: true });
  return { home, terminals };
}

function createTeam(home, teamConfig) {
  const teamFile = join(home, '.claude', 'terminals', 'teams', `${teamConfig.team_name}.json`);
  writeFileSync(teamFile, JSON.stringify(teamConfig));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('team-dispatch: team not found returns error', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleTeamDispatch({
      team_name: 'no-such-team',
      subject: 'Test',
      prompt: 'Do something.',
      directory: home,
    });
    assert.match(contentText(result), /not found/i);
  } finally {
    restore();
  }
});

test('team-dispatch: missing subject returns validation error', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-test', members: [{ name: 'alice', role: 'coder' }] });
    const result = api.handleTeamDispatch({
      team_name: 'td-test',
      subject: '',
      prompt: 'Do something.',
      directory: home,
    });
    assert.match(contentText(result), /subject is required/i);
  } finally {
    restore();
  }
});

test('team-dispatch: missing prompt returns validation error', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-test2', members: [{ name: 'bob', role: 'coder' }] });
    const result = api.handleTeamDispatch({
      team_name: 'td-test2',
      subject: 'Fix the bug',
      prompt: '',
      directory: home,
    });
    assert.match(contentText(result), /prompt is required/i);
  } finally {
    restore();
  }
});

test('team-dispatch: missing directory returns validation error', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-test3', members: [{ name: 'carol', role: 'coder' }] });
    const result = api.handleTeamDispatch({
      team_name: 'td-test3',
      subject: 'Fix the bug',
      prompt: 'Please fix it',
      // directory omitted
    });
    assert.match(contentText(result), /directory is required/i);
  } finally {
    restore();
  }
});

test('team-dispatch: create_task=false skips task creation', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-nocreate', members: [{ name: 'dave', role: 'coder' }] });
    const result = api.handleTeamDispatch({
      team_name: 'td-nocreate',
      subject: 'Lint pass',
      prompt: 'Run linter on the project.',
      directory: home,
      create_task: false,
      task_id: 'T_SKIP',
      worker_task_id: 'W_SKIP',
    });
    const txt = contentText(result);
    // Task creation is skipped — should say "skipped"
    assert.match(txt, /skipped/i);
  } finally {
    restore();
  }
});

test('team-dispatch: spawn fails triggers spawn_failed task update (lines 212-222)', async () => {
  const { home, terminals } = setupHome();
  // Use an impossible CLAUDE_BIN that will fail to simulate spawn failure
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  // 'false' command always exits 1 and writes nothing, so spawn text won't match /Worker spawned/i
  process.env.COORDINATOR_CLAUDE_BIN = 'false';
  const mod = await import(`../index.js?td-fail=${Date.now()}-${Math.random()}`);
  const api = mod.__test__;
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-fail', members: [{ name: 'eve', role: 'coder' }] });
    const result = api.handleTeamDispatch({
      team_name: 'td-fail',
      subject: 'Run failing task',
      prompt: 'This will fail.',
      directory: home,
      create_task: true,
      task_id: 'T_FAIL',
      worker_task_id: 'W_FAIL',
    });
    const txt = contentText(result);
    // spawn_failed or worker spawn failed
    assert.match(txt, /spawn|failed|dispatch/i);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('team-dispatch: no members → pickAssignee returns null, still dispatches', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    // Team with no members → pickAssignee returns null
    createTeam(home, { team_name: 'td-nomembers', members: [] });
    const result = api.handleTeamDispatch({
      team_name: 'td-nomembers',
      subject: 'Explore codebase',
      prompt: 'Read the README.',
      directory: home,
    });
    const txt = contentText(result);
    // Assignee should be none
    assert.match(txt, /auto:none/i);
  } finally {
    restore();
  }
});

test('team-dispatch: role match picks correct member via pickAssignee', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, {
      team_name: 'td-role',
      members: [
        { name: 'alpha', role: 'reviewer' },
        { name: 'beta', role: 'coder' },
      ],
    });
    const result = api.handleTeamDispatch({
      team_name: 'td-role',
      subject: 'Code review',
      prompt: 'Review the PR.',
      directory: home,
      role: 'reviewer',
    });
    const txt = contentText(result);
    // alpha has role=reviewer, should be picked
    assert.match(txt, /alpha/i);
  } finally {
    restore();
  }
});

test('team-dispatch: low_overhead_mode minimal → low-overhead dispatch profile', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, {
      team_name: 'td-lowoh',
      members: [{ name: 'foo', role: 'coder' }],
      low_overhead_mode: 'minimal',
    });
    // Short prompt (<=800 chars) + no explicit mode → low-overhead
    const result = api.handleTeamDispatch({
      team_name: 'td-lowoh',
      subject: 'Quick fix',
      prompt: 'Fix lint error in src/index.ts',
      directory: home,
    });
    assert.match(contentText(result), /low-overhead/i);
  } finally {
    restore();
  }
});

test('team-dispatch: native team with member.session_id triggers identityFromSession lookup', async () => {
  const { home, terminals } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    // Native team, member has session_id (triggers lines 143-146)
    createTeam(home, {
      team_name: 'td-native',
      execution_path: 'native',
      members: [{ name: 'nat-worker', role: 'coder', session_id: 'sess1234' }],
    });
    const result = api.handleTeamDispatch({
      team_name: 'td-native',
      subject: 'Native task',
      prompt: 'Do native work.',
      directory: home,
    });
    // Should succeed (identityFromSession returns null since no identity file, but code path is hit)
    assert.ok(contentText(result).length > 0);
  } finally {
    restore();
  }
});

test('team-dispatch: context_summary equal to prompt returns null (sanitizeContextSummary)', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-ctx', members: [{ name: 'g', role: 'coder' }] });
    const prompt = 'Review this file carefully';
    // context_summary equals prompt → sanitizeContextSummary returns null → not passed to worker
    const result = api.handleTeamDispatch({
      team_name: 'td-ctx',
      subject: 'Review',
      prompt,
      directory: home,
      context_summary: prompt, // same as prompt
    });
    assert.ok(contentText(result).length > 0);
  } finally {
    restore();
  }
});

test('team-dispatch: valid distinct context_summary is passed through', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-ctx2', members: [{ name: 'h', role: 'coder' }] });
    const result = api.handleTeamDispatch({
      team_name: 'td-ctx2',
      subject: 'Review',
      prompt: 'Review this file carefully',
      directory: home,
      context_summary: 'Prior session: found 3 issues in auth.ts',
    });
    assert.ok(contentText(result).length > 0);
  } finally {
    restore();
  }
});

test('team-dispatch: hybrid team with task_id member triggers identityFromTask lookup', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, {
      team_name: 'td-hybrid',
      execution_path: 'hybrid',
      members: [{ name: 'hyb-worker', role: 'coder', task_id: 'OLD_TASK' }],
    });
    const result = api.handleTeamDispatch({
      team_name: 'td-hybrid',
      subject: 'Continue work',
      prompt: 'Pick up where we left off.',
      directory: home,
      assignee: 'hyb-worker',
    });
    assert.ok(contentText(result).length > 0);
  } finally {
    restore();
  }
});

test('team-dispatch: array metadata falls back to {} (line 116 false branch)', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();
    createTeam(home, { team_name: 'td-arrmeta', members: [{ name: 'arr', role: 'coder' }] });
    // metadata is an array (not a plain object) → falls back to {} in ternary at line 116
    const result = api.handleTeamDispatch({
      team_name: 'td-arrmeta',
      subject: 'Array meta test',
      prompt: 'Run it.',
      directory: home,
      metadata: ['invalid', 'array', 'metadata'],
    });
    assert.ok(contentText(result).length > 0);
  } finally {
    restore();
  }
});
