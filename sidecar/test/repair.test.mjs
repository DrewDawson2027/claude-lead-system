import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { repairJSON, repairJSONL, scanForCorruption } from '../core/repair.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'repair-test-'));
}

test('repairJSON backs up and repairs corrupt file with trailing garbage', () => {
  const dir = tmpDir();
  const fp = join(dir, 'test.json');
  writeFileSync(fp, '{"key": "value"}EXTRA_GARBAGE_AFTER_JSON');

  const result = repairJSON(fp);
  assert.ok(result.repaired, 'Should be repaired');
  assert.ok(result.backup_path, 'Should have backup');
  assert.ok(existsSync(result.backup_path), 'Backup file should exist');

  // Repaired file should be valid JSON with original data
  const repaired = JSON.parse(readFileSync(fp, 'utf-8'));
  assert.equal(repaired.key, 'value');

  // Backup should contain original corrupt content
  const backup = readFileSync(result.backup_path, 'utf-8');
  assert.ok(backup.includes('EXTRA_GARBAGE'));
  rmSync(dir, { recursive: true, force: true });
});

test('repairJSON falls back to empty object for unrecoverable corruption', () => {
  const dir = tmpDir();
  const fp = join(dir, 'hopeless.json');
  writeFileSync(fp, 'totally not json at all!!!');

  const result = repairJSON(fp);
  assert.ok(result.repaired, 'Should be repaired (to empty object)');
  assert.ok(result.backup_path, 'Should have backup');
  assert.ok(result.error, 'Should note it was replaced with empty object');

  const repaired = JSON.parse(readFileSync(fp, 'utf-8'));
  assert.deepEqual(repaired, {});
  rmSync(dir, { recursive: true, force: true });
});

test('repairJSON returns false for already valid file', () => {
  const dir = tmpDir();
  const fp = join(dir, 'valid.json');
  writeFileSync(fp, '{"valid": true}');

  const result = repairJSON(fp);
  assert.equal(result.repaired, false);
  assert.equal(result.error, null);
  rmSync(dir, { recursive: true, force: true });
});

test('repairJSON handles missing file', () => {
  const result = repairJSON('/nonexistent/file.json');
  assert.equal(result.repaired, false);
  assert.equal(result.error, 'file not found');
});

test('repairJSONL quarantines bad lines', () => {
  const dir = tmpDir();
  const fp = join(dir, 'test.jsonl');
  writeFileSync(fp, [
    '{"valid": 1}',
    'THIS IS NOT JSON',
    '{"valid": 2}',
    'ALSO BAD',
    '{"valid": 3}',
  ].join('\n'));

  const result = repairJSONL(fp);
  assert.equal(result.total_lines, 5);
  assert.equal(result.valid_lines, 3);
  assert.equal(result.quarantined_lines, 2);
  assert.ok(result.quarantine_path);

  // Main file should only have valid lines
  const repaired = readFileSync(fp, 'utf-8').trim().split('\n');
  assert.equal(repaired.length, 3);
  for (const line of repaired) {
    assert.doesNotThrow(() => JSON.parse(line));
  }

  // Quarantine should have the bad lines
  const quarantined = readFileSync(result.quarantine_path, 'utf-8').trim().split('\n');
  assert.equal(quarantined.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('repairJSONL returns no quarantine for all-valid file', () => {
  const dir = tmpDir();
  const fp = join(dir, 'clean.jsonl');
  writeFileSync(fp, '{"a":1}\n{"b":2}\n');

  const result = repairJSONL(fp);
  assert.equal(result.quarantined_lines, 0);
  assert.equal(result.quarantine_path, null);
  rmSync(dir, { recursive: true, force: true });
});

test('scanForCorruption detects corrupt files', () => {
  const root = tmpDir();
  const stateDir = join(root, 'state');
  const logsDir = join(root, 'logs');
  const terminalsDir = join(root, 'terminals');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(join(terminalsDir, 'teams'), { recursive: true });
  mkdirSync(join(terminalsDir, 'tasks'), { recursive: true });
  mkdirSync(join(root, 'runtime', 'actions', 'pending'), { recursive: true });
  mkdirSync(join(root, 'runtime', 'actions', 'inflight'), { recursive: true });
  mkdirSync(join(root, 'runtime', 'actions', 'done'), { recursive: true });
  mkdirSync(join(root, 'runtime', 'actions', 'failed'), { recursive: true });

  const paths = {
    snapshotFile: join(stateDir, 'latest.json'),
    uiPrefsFile: join(stateDir, 'ui-prefs.json'),
    taskTemplatesFile: join(stateDir, 'task-templates.json'),
    nativeBridgeStatusFile: join(root, 'runtime', 'bridge.status.json'),
    nativeBridgeHeartbeatFile: join(root, 'runtime', 'bridge.heartbeat.json'),
    nativeBridgeValidationFile: join(root, 'runtime', 'bridge.validation.json'),
    nativeCapabilitiesFile: join(root, 'runtime', 'capabilities.json'),
    logFile: join(logsDir, 'timeline.jsonl'),
    activityFile: join(terminalsDir, 'activity.jsonl'),
    teamsDir: join(terminalsDir, 'teams'),
    tasksDir: join(terminalsDir, 'tasks'),
    actionsPendingDir: join(root, 'runtime', 'actions', 'pending'),
    actionsInflightDir: join(root, 'runtime', 'actions', 'inflight'),
    actionsDoneDir: join(root, 'runtime', 'actions', 'done'),
    actionsFailedDir: join(root, 'runtime', 'actions', 'failed'),
  };

  // Create a valid and a corrupt file
  writeFileSync(paths.snapshotFile, '{"teams": []}');
  writeFileSync(join(paths.teamsDir, 'good.json'), '{"team_name": "good"}');
  writeFileSync(join(paths.teamsDir, 'bad.json'), '{corrupt!!}');

  const result = scanForCorruption(paths);
  assert.ok(result.files_checked >= 2);
  assert.ok(result.corrupt_files.length >= 1, 'Should detect at least one corrupt file');
  assert.ok(result.corrupt_files.some(f => f.path.includes('bad.json')));
  rmSync(root, { recursive: true, force: true });
});
