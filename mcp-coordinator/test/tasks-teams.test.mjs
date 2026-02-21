import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function loadForTest(home) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  const mod = await import(`../index.js?tasks-teams=${Date.now()}-${Math.random()}`);
  return {
    api: mod.__test__,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    },
  };
}

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-tasks-teams-'));
  const terminals = join(home, '.claude', 'terminals');
  const inbox = join(terminals, 'inbox');
  const results = join(terminals, 'results');
  const sessionCache = join(home, '.claude', 'session-cache');
  mkdirSync(inbox, { recursive: true });
  mkdirSync(results, { recursive: true });
  mkdirSync(sessionCache, { recursive: true });
  return { home, terminals };
}

// ─── Tasks ────────────────────────────────────────────────

test('create_task requires subject', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_create_task', {});
    assert.match(result?.content?.[0]?.text || '', /Subject is required/);
  } finally {
    restore();
  }
});

test('create_task creates a task and returns id', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_create_task', {
      subject: 'Fix login bug',
      task_id: 'T001',
      priority: 'high',
      assignee: 'alice',
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /T001/);
    assert.match(text, /Fix login bug/);
    assert.match(text, /high/);
    assert.match(text, /alice/);
  } finally {
    restore();
  }
});

test('create_task rejects duplicate task id', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'First', task_id: 'TDUP' });
    const result = api.handleToolCall('coord_create_task', { subject: 'Second', task_id: 'TDUP' });
    assert.match(result?.content?.[0]?.text || '', /already exists/);
  } finally {
    restore();
  }
});

test('create_task with blocked_by sets reverse ref', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'Blocker', task_id: 'TBLOCK' });
    const result = api.handleToolCall('coord_create_task', {
      subject: 'Dependent',
      task_id: 'TDEP',
      blocked_by: ['TBLOCK'],
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /TBLOCK/);
  } finally {
    restore();
  }
});

test('list_tasks returns no tasks message when empty', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_list_tasks', {});
    assert.match(result?.content?.[0]?.text || '', /No tasks found/);
  } finally {
    restore();
  }
});

test('list_tasks shows all tasks in table', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'Alpha', task_id: 'TALPHA', priority: 'high' });
    api.handleToolCall('coord_create_task', { subject: 'Beta', task_id: 'TBETA', priority: 'low' });
    const result = api.handleToolCall('coord_list_tasks', {});
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /TALPHA/);
    assert.match(text, /TBETA/);
    assert.match(text, /Tasks \(2\)/);
  } finally {
    restore();
  }
});

test('list_tasks filters by status', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'Alpha', task_id: 'TSTA' });
    api.handleToolCall('coord_update_task', { task_id: 'TSTA', status: 'completed' });
    api.handleToolCall('coord_create_task', { subject: 'Beta', task_id: 'TSTB' });
    const result = api.handleToolCall('coord_list_tasks', { status: 'pending' });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /TSTB/);
    assert.doesNotMatch(text, /TSTA/);
  } finally {
    restore();
  }
});

test('get_task returns not found for missing task', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_get_task', { task_id: 'TMISSING' });
    assert.match(result?.content?.[0]?.text || '', /not found/);
  } finally {
    restore();
  }
});

test('get_task returns full details', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', {
      subject: 'Detail task',
      task_id: 'TDETAIL',
      description: 'A longer description here',
      assignee: 'bob',
      files: ['/src/app.ts'],
    });
    const result = api.handleToolCall('coord_get_task', { task_id: 'TDETAIL' });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /TDETAIL/);
    assert.match(text, /Detail task/);
    assert.match(text, /A longer description here/);
    assert.match(text, /bob/);
    assert.match(text, /\/src\/app\.ts/);
  } finally {
    restore();
  }
});

test('update_task changes status', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'Update me', task_id: 'TUPD' });
    const result = api.handleToolCall('coord_update_task', { task_id: 'TUPD', status: 'in_progress' });
    assert.match(result?.content?.[0]?.text || '', /in_progress/);
  } finally {
    restore();
  }
});

test('update_task rejects invalid status', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'Status test', task_id: 'TBADST' });
    const result = api.handleToolCall('coord_update_task', { task_id: 'TBADST', status: 'bogus' });
    assert.match(result?.content?.[0]?.text || '', /Invalid status/);
  } finally {
    restore();
  }
});

test('update_task returns not found for missing task', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_update_task', { task_id: 'TGONE', status: 'completed' });
    assert.match(result?.content?.[0]?.text || '', /not found/);
  } finally {
    restore();
  }
});

test('update_task returns no changes when nothing specified', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'Noop', task_id: 'TNOOP' });
    const result = api.handleToolCall('coord_update_task', { task_id: 'TNOOP' });
    assert.match(result?.content?.[0]?.text || '', /No changes/);
  } finally {
    restore();
  }
});

test('update_task add_blocked_by and add_blocks', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_task', { subject: 'A', task_id: 'TDEP_A' });
    api.handleToolCall('coord_create_task', { subject: 'B', task_id: 'TDEP_B' });
    api.handleToolCall('coord_create_task', { subject: 'C', task_id: 'TDEP_C' });

    // B is blocked by A
    const r1 = api.handleToolCall('coord_update_task', { task_id: 'TDEP_B', add_blocked_by: ['TDEP_A'] });
    assert.match(r1?.content?.[0]?.text || '', /TDEP_A/);

    // C blocks B
    const r2 = api.handleToolCall('coord_update_task', { task_id: 'TDEP_C', add_blocks: ['TDEP_B'] });
    assert.match(r2?.content?.[0]?.text || '', /TDEP_B/);
  } finally {
    restore();
  }
});

// ─── Teams ────────────────────────────────────────────────

test('create_team creates a team', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_create_team', {
      team_name: 'frontend',
      project: 'myapp',
      members: [{ name: 'alice', role: 'lead' }],
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /frontend/);
    assert.match(text, /myapp/);
    assert.match(text, /alice/);
  } finally {
    restore();
  }
});

test('create_team updates existing team', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_team', { team_name: 'backend', members: [{ name: 'bob', role: 'worker' }] });
    const result = api.handleToolCall('coord_create_team', {
      team_name: 'backend',
      description: 'API team',
      members: [{ name: 'carol', role: 'worker' }],
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /updated/);
    assert.match(text, /carol/);
  } finally {
    restore();
  }
});

test('create_team updates existing member attributes', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_team', { team_name: 'alpha', members: [{ name: 'dave', role: 'worker' }] });
    const result = api.handleToolCall('coord_create_team', {
      team_name: 'alpha',
      members: [{ name: 'dave', role: 'lead', task_id: 'T001', session_id: 'abcd1234' }],
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /dave/);
  } finally {
    restore();
  }
});

test('get_team returns not found for missing team', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_get_team', { team_name: 'missing-team' });
    assert.match(result?.content?.[0]?.text || '', /not found/);
  } finally {
    restore();
  }
});

test('get_team returns team details', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_team', {
      team_name: 'devops',
      project: 'infra',
      description: 'CI/CD team',
      members: [
        { name: 'eve', role: 'lead', session_id: 'abcd1234', task_id: 'T99' },
      ],
    });
    const result = api.handleToolCall('coord_get_team', { team_name: 'devops' });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /devops/);
    assert.match(text, /infra/);
    assert.match(text, /eve/);
    assert.match(text, /lead/);
    assert.match(text, /abcd1234/);
    assert.match(text, /T99/);
    assert.match(text, /CI\/CD team/);
  } finally {
    restore();
  }
});

test('list_teams returns no teams when none exist', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_list_teams', {});
    assert.match(result?.content?.[0]?.text || '', /No teams found/);
  } finally {
    restore();
  }
});

test('list_teams shows all teams in table', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_create_team', { team_name: 'frontend', project: 'web' });
    api.handleToolCall('coord_create_team', { team_name: 'backend', project: 'api' });
    const result = api.handleToolCall('coord_list_teams', {});
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /frontend/);
    assert.match(text, /backend/);
    assert.match(text, /Teams \(2\)/);
  } finally {
    restore();
  }
});

// ─── Messaging (send_message, broadcast, send_directive) ──

test('send_message requires content', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_send_message', { from: 'lead', to: 'abcd1234', content: '' });
    assert.match(result?.content?.[0]?.text || '', /content is required/i);
  } finally {
    restore();
  }
});

test('send_message writes to inbox', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_send_message', {
      from: 'lead',
      to: 'abcd1234',
      content: 'Hello worker',
      priority: 'urgent',
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /Message sent to abcd1234/);
    assert.match(text, /urgent/);
  } finally {
    restore();
  }
});

test('broadcast requires content', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_broadcast', { from: 'lead', content: '' });
    assert.match(result?.content?.[0]?.text || '', /content is required/i);
  } finally {
    restore();
  }
});

test('broadcast returns no active sessions when none exist', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_broadcast', { from: 'lead', content: 'All hands' });
    assert.match(result?.content?.[0]?.text || '', /No active sessions/);
  } finally {
    restore();
  }
});

test('send_directive requires content', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_send_directive', { from: 'lead', to: 'abcd1234', content: '' });
    assert.match(result?.content?.[0]?.text || '', /content is required/i);
  } finally {
    restore();
  }
});

test('send_directive returns not found for missing session', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_send_directive', {
      from: 'lead',
      to: 'zzzz9999',
      content: 'Do something',
    });
    const text = result?.content?.[0]?.text || '';
    assert.match(text, /not found/i);
    assert.match(text, /zzzz9999/);
  } finally {
    restore();
  }
});
