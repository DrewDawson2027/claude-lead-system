import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCheckpoint, listCheckpoints, restoreCheckpoint, rotateCheckpoints } from '../core/checkpoint.js';
import { writeJSON, readJSON } from '../core/fs-utils.js';

function tmpPaths() {
  const root = mkdtempSync(join(tmpdir(), 'cp-test-'));
  const stateDir = join(root, 'state');
  const terminalsDir = join(root, 'terminals');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(join(terminalsDir, 'teams'), { recursive: true });
  mkdirSync(join(terminalsDir, 'tasks'), { recursive: true });
  return {
    root,
    snapshotFile: join(stateDir, 'latest.json'),
    checkpointsDir: join(stateDir, 'checkpoints'),
    teamsDir: join(terminalsDir, 'teams'),
    tasksDir: join(terminalsDir, 'tasks'),
  };
}

test('create and list checkpoint', () => {
  const paths = tmpPaths();
  writeJSON(paths.snapshotFile, { teams: [{ team_name: 'alpha' }], generated_at: new Date().toISOString() });
  writeJSON(join(paths.teamsDir, 'alpha.json'), { team_name: 'alpha', policy: {} });
  writeJSON(join(paths.tasksDir, 'task-1.json'), { id: 'task-1', subject: 'Test task' });

  const result = createCheckpoint(paths, 'test-label');
  assert.ok(result.file, 'Should return file path');
  assert.equal(result.teams_count, 1);
  assert.equal(result.tasks_count, 1);

  const list = listCheckpoints(paths);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'test-label');
  assert.equal(list[0].teams_count, 1);
  assert.equal(list[0].tasks_count, 1);
  rmSync(paths.root, { recursive: true, force: true });
});

test('restore checkpoint recovers state', () => {
  const paths = tmpPaths();
  writeJSON(paths.snapshotFile, { teams: [{ team_name: 'alpha' }] });
  writeJSON(join(paths.teamsDir, 'alpha.json'), { team_name: 'alpha', members: ['a', 'b'] });
  writeJSON(join(paths.tasksDir, 'task-1.json'), { id: 'task-1', subject: 'Original' });

  // Create checkpoint
  const cp = createCheckpoint(paths, 'before-change');

  // Modify state
  writeJSON(paths.snapshotFile, { teams: [{ team_name: 'beta' }] });
  writeJSON(join(paths.teamsDir, 'alpha.json'), { team_name: 'alpha', members: ['x'] });
  writeJSON(join(paths.teamsDir, 'beta.json'), { team_name: 'beta', members: ['extra'] });
  writeJSON(join(paths.tasksDir, 'task-2.json'), { id: 'task-2', subject: 'Extra task not in checkpoint' });

  // Restore
  const result = restoreCheckpoint(paths, cp.file);
  assert.ok(result.restored);
  assert.equal(result.restore_mode, 'additive');
  assert.equal(result.teams_count, 1);
  assert.equal(result.tasks_count, 1);

  // Verify restored state
  const snapshot = readJSON(paths.snapshotFile);
  assert.equal(snapshot.teams[0].team_name, 'alpha');
  const teamData = readJSON(join(paths.teamsDir, 'alpha.json'));
  assert.deepEqual(teamData.members, ['a', 'b']);
  const extraTeam = readJSON(join(paths.teamsDir, 'beta.json'));
  assert.equal(extraTeam.team_name, 'beta', 'additive restore should preserve team files not present in checkpoint');
  const extraTask = readJSON(join(paths.tasksDir, 'task-2.json'));
  assert.equal(extraTask.id, 'task-2', 'additive restore should preserve task files not present in checkpoint');
  rmSync(paths.root, { recursive: true, force: true });
});

test('rotate keeps max checkpoints', () => {
  const paths = tmpPaths();
  writeJSON(paths.snapshotFile, { teams: [] });

  // Create 25 checkpoints with small delays to ensure unique names
  for (let i = 0; i < 25; i++) {
    createCheckpoint(paths, `cp-${i}`);
  }

  const before = listCheckpoints(paths);
  assert.equal(before.length, 25);

  rotateCheckpoints(paths, 20);

  const after = listCheckpoints(paths);
  assert.equal(after.length, 20, 'Should keep only 20 checkpoints');
  rmSync(paths.root, { recursive: true, force: true });
});

test('restore handles unreadable checkpoint', () => {
  const paths = tmpPaths();
  const result = restoreCheckpoint(paths, '/nonexistent/checkpoint.json');
  assert.equal(result.restored, false);
  assert.ok(result.error);
  rmSync(paths.root, { recursive: true, force: true });
});

test('list checkpoints on empty dir', () => {
  const paths = tmpPaths();
  const list = listCheckpoints(paths);
  assert.equal(list.length, 0);
  rmSync(paths.root, { recursive: true, force: true });
});
