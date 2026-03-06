import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPreOpBackup, restoreFromBackup } from '../core/pre-op-backup.js';
import { writeJSON, readJSON } from '../core/fs-utils.js';

function tmpPaths() {
  const root = mkdtempSync(join(tmpdir(), 'pre-backup-test-'));
  const stateDir = join(root, 'state');
  const terminalsDir = join(root, 'terminals');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(join(terminalsDir, 'teams'), { recursive: true });
  mkdirSync(join(terminalsDir, 'tasks'), { recursive: true });
  return {
    root,
    snapshotFile: join(stateDir, 'latest.json'),
    backupsDir: join(stateDir, 'backups'),
    teamsDir: join(terminalsDir, 'teams'),
    tasksDir: join(terminalsDir, 'tasks'),
  };
}

test('restoreFromBackup uses additive semantics', () => {
  const paths = tmpPaths();
  writeJSON(paths.snapshotFile, { teams: [{ team_name: 'alpha' }] });
  writeJSON(join(paths.teamsDir, 'alpha.json'), { team_name: 'alpha', members: ['a'] });
  writeJSON(join(paths.tasksDir, 'task-1.json'), { id: 'task-1', subject: 'baseline' });

  const backup = createPreOpBackup(paths, 'replace', { scope: 'all' });

  writeJSON(paths.snapshotFile, { teams: [{ team_name: 'beta' }] });
  writeJSON(join(paths.teamsDir, 'alpha.json'), { team_name: 'alpha', members: ['override'] });
  writeJSON(join(paths.teamsDir, 'beta.json'), { team_name: 'beta', members: ['extra'] });
  writeJSON(join(paths.tasksDir, 'task-2.json'), { id: 'task-2', subject: 'extra' });

  const restored = restoreFromBackup(paths, backup.file);
  assert.equal(restored.restored, true);
  assert.equal(restored.restore_mode, 'additive');

  const alpha = readJSON(join(paths.teamsDir, 'alpha.json'));
  assert.deepEqual(alpha.members, ['a']);

  const beta = readJSON(join(paths.teamsDir, 'beta.json'));
  assert.equal(beta.team_name, 'beta', 'additive backup restore should preserve extra team files');

  const task2 = readJSON(join(paths.tasksDir, 'task-2.json'));
  assert.equal(task2.id, 'task-2', 'additive backup restore should preserve extra task files');

  rmSync(paths.root, { recursive: true, force: true });
});
