import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-'));
  const claude = join(home, '.claude');
  const terminals = join(claude, 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'alpha.json'), JSON.stringify({
    team_name: 'alpha',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 'alice', role: 'implementer', session_id: 'abcd1234' }],
    policy: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }));
  writeFileSync(join(terminals, 'tasks', 'T1.json'), JSON.stringify({
    task_id: 'T1', subject: 'Task one', status: 'pending', priority: 'normal', assignee: 'alice',
    team_name: 'alpha', files: [], blocked_by: [], metadata: { dispatch: { status: 'queued', prompt: 'Do task one' }, team_name: 'alpha' },
    created: new Date().toISOString(), updated: new Date().toISOString(),
  }));
  writeFileSync(join(terminals, 'session-abcd1234.json'), JSON.stringify({
    session: 'abcd1234', status: 'active', project: 'demo', last_active: new Date().toISOString(), recent_ops: [], files_touched: [], tool_counts: {},
  }));
  return home;
}

test('snapshot builder emits normalized teams/teammates/tasks', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  try {
    const mod = await import(`../server/snapshot-builder.js?t=${Date.now()}-${Math.random()}`);
    const snap = mod.buildSidecarSnapshot();
    assert.equal(Array.isArray(snap.teams), true);
    assert.equal(snap.teams.length, 1);
    assert.equal(snap.teams[0].team_name, 'alpha');
    assert.equal(snap.teammates[0].display_name, 'alice');
    assert.equal(snap.tasks[0].task_id, 'T1');
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});
