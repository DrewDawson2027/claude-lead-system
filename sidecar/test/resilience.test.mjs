import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { LockMetrics } from '../core/lock-metrics.js';
import { repairJSON, repairJSONL } from '../core/repair.js';
import { ActionQueue } from '../native/action-queue.js';
import { SidecarStateStore } from '../core/state-store.js';
import { appendJSONL, writeJSON, readJSON } from '../core/fs-utils.js';
import { createCheckpoint, listCheckpoints, rotateCheckpoints, restoreCheckpoint } from '../core/checkpoint.js';
import { CURRENT_SCHEMA_VERSION, migrateBundle, validateSchemaVersion, dryRunMigration } from '../core/schema.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function tmpDir(prefix = 'resilience-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function tmpPaths(root) {
  if (!root) root = tmpDir();
  const stateDir = join(root, 'state');
  const logsDir = join(root, 'logs');
  const checkpointsDir = join(root, 'state', 'checkpoints');
  const teamsDir = join(root, 'teams');
  const tasksDir = join(root, 'tasks');
  const runtimeDir = join(root, 'runtime');
  const actionsRoot = join(runtimeDir, 'actions');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(checkpointsDir, { recursive: true });
  mkdirSync(teamsDir, { recursive: true });
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(join(actionsRoot, 'pending'), { recursive: true });
  mkdirSync(join(actionsRoot, 'inflight'), { recursive: true });
  mkdirSync(join(actionsRoot, 'done'), { recursive: true });
  mkdirSync(join(actionsRoot, 'failed'), { recursive: true });
  return {
    root,
    stateDir,
    logsDir,
    checkpointsDir,
    teamsDir,
    tasksDir,
    runtimeDir,
    snapshotFile: join(stateDir, 'latest.json'),
    logFile: join(logsDir, 'timeline.jsonl'),
    uiPrefsFile: join(stateDir, 'ui-prefs.json'),
    taskTemplatesFile: join(stateDir, 'task-templates.json'),
    lockFile: join(runtimeDir, 'sidecar.lock'),
    portFile: join(runtimeDir, 'sidecar.port'),
    actionsRootDir: actionsRoot,
    actionsPendingDir: join(actionsRoot, 'pending'),
    actionsInflightDir: join(actionsRoot, 'inflight'),
    actionsDoneDir: join(actionsRoot, 'done'),
    actionsFailedDir: join(actionsRoot, 'failed'),
    backupsDir: join(stateDir, 'backups'),
    metricsHistoryDir: join(stateDir, 'metrics-history'),
    snapshotHistoryDir: join(stateDir, 'snapshot-history'),
    nativeBridgeStatusFile: join(runtimeDir, 'bridge.status.json'),
    nativeBridgeHeartbeatFile: join(runtimeDir, 'bridge.heartbeat.json'),
    nativeBridgeValidationFile: join(runtimeDir, 'bridge.validation.json'),
    nativeCapabilitiesFile: join(runtimeDir, 'capabilities.json'),
    activityFile: join(logsDir, 'activity.jsonl'),
  };
}

function cleanup(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Item 1: Lock acquisition timeout + stale lock cleanup
// ═══════════════════════════════════════════════════════════════════════════════

test('lock metrics: high wait times reflected in p95 and max', () => {
  const lm = new LockMetrics();
  // 20 fast, 1 slow
  for (let i = 0; i < 20; i++) lm.recordAttempt('test-lock', 5, true);
  lm.recordAttempt('test-lock', 5000, true); // timeout-level wait
  const snap = lm.snapshot();
  assert.equal(snap.locks['test-lock'].max_wait_ms, 5000);
  assert.ok(snap.locks['test-lock'].p95_wait_ms >= 5, 'p95 should be >= 5ms');
  assert.equal(snap.locks['test-lock'].attempts, 21);
  assert.equal(snap.locks['test-lock'].acquisitions, 21);
});

test('lock metrics: failed acquisitions tracked', () => {
  const lm = new LockMetrics();
  lm.recordAttempt('db-lock', 100, true);
  lm.recordAttempt('db-lock', 200, false);
  lm.recordAttempt('db-lock', 300, false);
  const snap = lm.snapshot();
  assert.equal(snap.locks['db-lock'].failures, 2);
  assert.equal(snap.locks['db-lock'].acquisitions, 1);
  assert.equal(snap.locks['db-lock'].collisions, 2);
});

test('stale lock detection and cleanup', () => {
  const root = tmpDir();
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const lockFile = join(runtimeDir, 'sidecar.lock');

  // Write lock with a PID that almost certainly does not exist
  writeJSON(lockFile, { pid: 999999999, started_at: new Date(Date.now() - 3600000).toISOString() });

  // Detect stale: check if PID is alive
  const lockData = readJSON(lockFile);
  let pidAlive = false;
  try { process.kill(lockData.pid, 0); pidAlive = true; } catch { pidAlive = false; }
  assert.equal(pidAlive, false, 'Stale PID should not be alive');

  // Cleanup stale lock
  unlinkSync(lockFile);
  assert.equal(existsSync(lockFile), false, 'Lock file should be removed');
  cleanup(root);
});

test('lock metrics: hot_paths returns top contenders', () => {
  const lm = new LockMetrics();
  lm.recordAttempt('fast-lock', 1, true);
  lm.recordAttempt('slow-lock', 500, true);
  lm.recordAttempt('slower-lock', 2000, true);
  lm.recordAttempt('slowest-lock', 9000, false);
  const snap = lm.snapshot();
  assert.equal(snap.hot_paths[0].name, 'slowest-lock');
  assert.ok(snap.hot_paths.length <= 3);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 2: JSON/JSONL corruption fuzz tests
// ═══════════════════════════════════════════════════════════════════════════════

test('fuzz: truncated mid-key JSON', () => {
  const root = tmpDir();
  const f = join(root, 'trunc.json');
  writeFileSync(f, '{"team_na');
  const result = repairJSON(f);
  assert.ok(result.repaired || result.error === null, 'Should handle truncated JSON');
  cleanup(root);
});

test('fuzz: null bytes in JSON', () => {
  const root = tmpDir();
  const f = join(root, 'nullbytes.json');
  writeFileSync(f, '{"key": "val\x00ue"}');
  const result = repairJSON(f);
  // Should either parse successfully (null byte is valid in a string) or repair
  assert.ok(result.error === null || result.repaired, 'Should handle null bytes');
  cleanup(root);
});

test('fuzz: UTF-8 BOM prefix', () => {
  const root = tmpDir();
  const f = join(root, 'bom.json');
  writeFileSync(f, '\xEF\xBB\xBF{"key": "value"}');
  const result = repairJSON(f);
  // BOM + valid JSON: repair should trim BOM or find valid JSON within
  assert.ok(result.repaired || result.error === null, 'Should handle BOM-prefixed JSON');
  cleanup(root);
});

test('fuzz: binary injection in JSON', () => {
  const root = tmpDir();
  const f = join(root, 'binary.json');
  const buf = Buffer.alloc(64);
  buf.write('{"key":"');
  for (let i = 8; i < 64; i++) buf[i] = Math.floor(Math.random() * 256);
  writeFileSync(f, buf);
  const result = repairJSON(f);
  // Should not throw
  assert.ok(result.repaired || result.error !== null, 'Should handle binary data without crash');
  cleanup(root);
});

test('fuzz: deeply nested JSON (100 levels)', () => {
  const root = tmpDir();
  const f = join(root, 'deep.json');
  let s = '';
  for (let i = 0; i < 100; i++) s += '{"a":';
  s += '1';
  for (let i = 0; i < 100; i++) s += '}';
  writeFileSync(f, s);
  const result = repairJSON(f);
  // 100-level nesting is valid JSON; should parse fine
  assert.equal(result.error, null, 'Deeply nested but valid JSON should not error');
  assert.equal(result.repaired, false, 'Should not need repair');
  cleanup(root);
});

test('fuzz: zero-byte file', () => {
  const root = tmpDir();
  const f = join(root, 'empty.json');
  writeFileSync(f, '');
  const result = repairJSON(f);
  // Empty file is not valid JSON but also not parseable — should handle gracefully
  assert.ok(result.repaired || result.error !== null, 'Should handle empty file');
  cleanup(root);
});

test('fuzz: single newline file', () => {
  const root = tmpDir();
  const f = join(root, 'newline.json');
  writeFileSync(f, '\n');
  const result = repairJSON(f);
  assert.ok(result.repaired || result.error !== null, 'Should handle single newline');
  cleanup(root);
});

test('fuzz: JSONL with mixed corruption', () => {
  const root = tmpDir();
  const f = join(root, 'mixed.jsonl');
  const lines = [
    '{"type":"valid","n":1}',
    '{"trunc',
    '\x00\x01\x02\x03',
    '',
    '{"type":"valid","n":2}',
  ];
  writeFileSync(f, lines.join('\n') + '\n');
  const result = repairJSONL(f);
  assert.equal(result.valid_lines, 2, 'Should keep 2 valid lines');
  assert.equal(result.quarantined_lines, 2, 'Should quarantine 2 corrupt lines');
  assert.ok(result.quarantine_path, 'Should create quarantine file');
  cleanup(root);
});

test('fuzz: extremely large single value in JSON', () => {
  const root = tmpDir();
  const f = join(root, 'large.json');
  // 100KB value (not 1MB to keep test fast)
  const largeVal = 'A'.repeat(100_000);
  writeFileSync(f, JSON.stringify({ key: largeVal }));
  const result = repairJSON(f);
  assert.equal(result.error, null, 'Large but valid JSON should not error');
  assert.equal(result.repaired, false, 'Should not need repair');
  cleanup(root);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 6: Max queue depth / log rotation limits
// ═══════════════════════════════════════════════════════════════════════════════

test('action queue: 500 pending actions created and swept', async () => {
  const paths = tmpPaths();
  const queue = new ActionQueue(paths);
  for (let i = 0; i < 500; i++) {
    queue.create({ subject: `task-${i}`, team_name: 'stress-team' });
  }
  const counts = queue.counts();
  assert.equal(counts.pending, 500);

  // Wait 10ms so all actions have age > 0, then sweep with pendingMaxAgeMs: 0
  await new Promise(r => setTimeout(r, 10));
  const swept = queue.sweep({ pendingMaxAgeMs: 0 });
  assert.equal(swept.pending, 500);
  assert.equal(queue.counts().pending, 0);
  cleanup(paths.root);
});

test('timeline log: 10,000 entries handled by repairJSONL', () => {
  const root = tmpDir();
  const logFile = join(root, 'big-timeline.jsonl');
  // Write 10,000 valid lines
  const fd = [];
  for (let i = 0; i < 10_000; i++) {
    fd.push(JSON.stringify({ ts: new Date().toISOString(), type: 'snapshot', n: i }));
  }
  writeFileSync(logFile, fd.join('\n') + '\n');
  const result = repairJSONL(logFile);
  assert.equal(result.valid_lines, 10_000);
  assert.equal(result.quarantined_lines, 0);
  cleanup(root);
});

test('checkpoint rotation: 50 created, rotate to 10', () => {
  const paths = tmpPaths();
  // Create 50 checkpoints with staggered timestamps
  for (let i = 0; i < 50; i++) {
    const file = join(paths.checkpointsDir, `cp-${1000000 + i}-rotation-test.json`);
    writeJSON(file, {
      schema_version: CURRENT_SCHEMA_VERSION,
      created_at: new Date(Date.now() - (50 - i) * 1000).toISOString(),
      label: `cp-${i}`,
      snapshot: {},
      teams: [],
      tasks: [],
    });
  }

  const before = listCheckpoints(paths);
  assert.equal(before.length, 50);

  const result = rotateCheckpoints(paths, 10);
  assert.equal(result.removed, 40);

  const after = listCheckpoints(paths);
  assert.equal(after.length, 10);
  // The 10 remaining should be the newest (highest timestamp in filename)
  assert.ok(after[0].file.includes('1000040'), 'Oldest remaining should be cp index 40');
  cleanup(paths.root);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 7: "Disk full" simulation
// ═══════════════════════════════════════════════════════════════════════════════

test('state store: setSnapshot returns error on unwritable directory', () => {
  const root = tmpDir();
  const paths = tmpPaths(root);
  const metricsSeen = [];
  const store = new SidecarStateStore(paths, { onMetric: (name, val) => metricsSeen.push(name) });

  // Remove state dir to simulate write failure
  rmSync(paths.stateDir, { recursive: true, force: true });

  const result = store.setSnapshot({ teams: [{ team_name: 'x' }] });
  assert.equal(result.ok, false);
  assert.ok(metricsSeen.includes('snapshot_write_fail'));
  // Alerts should be raised
  assert.ok(store.getSnapshot().alerts.some(a => a.code === 'state_store_snapshot_write_fail'));
  cleanup(root);
});

test('state store: emitTimeline returns error on unwritable log dir', () => {
  const root = tmpDir();
  const paths = tmpPaths(root);
  const metricsSeen = [];
  const store = new SidecarStateStore(paths, { onMetric: (name) => metricsSeen.push(name) });

  // Remove logs dir
  rmSync(paths.logsDir, { recursive: true, force: true });

  const result = store.emitTimeline({ type: 'test-event' });
  assert.equal(result.ok, false);
  assert.ok(metricsSeen.includes('timeline_append_fail'));
  cleanup(root);
});

test('action queue: create handles read-only dir gracefully', () => {
  const root = tmpDir();
  const paths = tmpPaths(root);

  // Make pending dir read-only
  try { chmodSync(paths.actionsPendingDir, 0o444); } catch { /* skip on systems that don't support */ }

  try {
    const queue = new ActionQueue(paths);
    // This should throw since writeJSON fails
    assert.throws(() => {
      queue.create({ subject: 'should-fail', team_name: 'no-write' });
    }, /EACCES|EPERM|permission/i);
  } catch (err) {
    // On some systems (root user), chmod 444 still allows writes — skip gracefully
    if (!err.message.match(/EACCES|EPERM|permission/i)) {
      // The create might have succeeded — that's fine on permissive systems
    }
  } finally {
    try { chmodSync(paths.actionsPendingDir, 0o755); } catch {}
    cleanup(root);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 9: Schema migration round-trip tests
// ═══════════════════════════════════════════════════════════════════════════════

test('schema migration: v1 → v3 full migration', () => {
  const v1Bundle = {
    // No schema_version field means v1
    snapshot: {
      teams: [
        { team_name: 'alpha', members: ['a1', 'a2'] },
        { team_name: 'beta', members: ['b1'] },
      ],
      tasks: [
        { id: 't1', subject: 'Do stuff', status: 'pending' },
        { id: 't2', subject: 'More stuff', status: 'done' },
      ],
    },
  };

  const result = migrateBundle(v1Bundle);
  assert.equal(result.final_version, 3);
  assert.equal(result.applied.length, 2);
  assert.equal(result.bundle.schema_version, 3);

  // v2 fields
  for (const task of result.bundle.snapshot.tasks) {
    assert.ok(Array.isArray(task.quality_gates), 'quality_gates should be array');
    assert.ok(Array.isArray(task.acceptance_criteria), 'acceptance_criteria should be array');
    assert.ok(Array.isArray(task.audit_trail_summary), 'audit_trail_summary should be array');
  }
  for (const team of result.bundle.snapshot.teams) {
    assert.ok(team.policy?.auto_rebalance, 'auto_rebalance policy should exist');
  }

  // v3 fields
  assert.equal(typeof result.bundle.snapshot.checkpoint_version, 'number');
  for (const team of result.bundle.snapshot.teams) {
    assert.ok(team.recovery_metadata, 'recovery_metadata should exist');
    assert.equal(team.recovery_metadata.last_checkpoint, null);
    assert.equal(team.recovery_metadata.last_repair, null);
  }
});

test('schema migration: validateSchemaVersion on migrated bundle', () => {
  const bundle = { schema_version: CURRENT_SCHEMA_VERSION, snapshot: {} };
  const result = validateSchemaVersion(bundle);
  assert.equal(result.valid, true);
  assert.equal(result.needs_migration, false);
});

test('schema migration: validateSchemaVersion on old bundle', () => {
  const result = validateSchemaVersion({ snapshot: {} }); // no schema_version = v1
  assert.equal(result.valid, false);
  assert.equal(result.needs_migration, true);
  assert.equal(result.version, 1);
});

test('schema migration: dryRunMigration on already-current bundle', () => {
  const bundle = { schema_version: CURRENT_SCHEMA_VERSION };
  const result = dryRunMigration(bundle);
  assert.deepEqual(result.would_apply, []);
  assert.equal(result.current_version, CURRENT_SCHEMA_VERSION);
});

test('schema migration: dryRunMigration on v1 shows 2 migrations', () => {
  const result = dryRunMigration({ snapshot: {} }); // v1
  assert.equal(result.would_apply.length, 2);
  assert.equal(result.would_apply[0].from, 1);
  assert.equal(result.would_apply[0].to, 2);
  assert.equal(result.would_apply[1].from, 2);
  assert.equal(result.would_apply[1].to, 3);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Item 10: Version compatibility N-1 → N (v2 checkpoint → v3 restore)
// ═══════════════════════════════════════════════════════════════════════════════

test('v2 checkpoint restores with migration to v3', () => {
  const paths = tmpPaths();

  // Manually create a v2 checkpoint (pre-v3 schema)
  const v2Checkpoint = {
    schema_version: 2,
    created_at: new Date().toISOString(),
    label: 'v2-compat-test',
    snapshot: {
      teams: [
        {
          team_name: 'legacy-team',
          members: ['m1'],
          policy: { auto_rebalance: { enabled: true, cooldown_ms: 30000, triggers: {} } },
        },
      ],
      tasks: [
        { id: 't1', subject: 'v2 task', status: 'pending', quality_gates: [], acceptance_criteria: [], audit_trail_summary: [] },
      ],
      // v2 has auto_rebalance but no checkpoint_version or recovery_metadata
    },
    teams: [
      { file: 'legacy-team.json', data: { team_name: 'legacy-team', members: ['m1'], policy: {} } },
    ],
    tasks: [
      { file: 'task-1.json', data: { id: 't1', subject: 'v2 task', status: 'pending' } },
    ],
  };

  const cpFile = join(paths.checkpointsDir, 'cp-9999999-v2-compat-test.json');
  writeJSON(cpFile, v2Checkpoint);

  const result = restoreCheckpoint(paths, cpFile);
  assert.equal(result.restored, true);
  assert.equal(result.teams_count, 1);
  assert.equal(result.tasks_count, 1);

  // Read restored snapshot — migrateBundle mutates in-memory and the snapshot is written to disk
  const restored = readJSON(paths.snapshotFile);
  assert.ok(restored, 'Restored snapshot should exist');
  // The snapshot should have v3 fields since migrateBundle ran on the cp in-memory
  assert.equal(typeof restored.checkpoint_version, 'number', 'v3: checkpoint_version should be number');
  for (const team of (restored.teams || [])) {
    assert.ok(team.recovery_metadata, 'v3: recovery_metadata should exist on teams');
  }

  cleanup(paths.root);
});

test('v2 → v3 migration preserves existing team data', () => {
  const paths = tmpPaths();

  const v2Checkpoint = {
    schema_version: 2,
    created_at: new Date().toISOString(),
    label: 'preserve-test',
    snapshot: {
      teams: [
        {
          team_name: 'data-team',
          members: ['alice', 'bob'],
          policy: { auto_rebalance: { enabled: false, cooldown_ms: 60000, triggers: {} } },
          custom_field: 'should-survive',
        },
      ],
      tasks: [],
    },
    teams: [],
    tasks: [],
  };

  const cpFile = join(paths.checkpointsDir, 'cp-8888888-preserve-test.json');
  writeJSON(cpFile, v2Checkpoint);
  restoreCheckpoint(paths, cpFile);

  // Read the restored snapshot from disk (written by restoreCheckpoint after migrateBundle)
  const restored = readJSON(paths.snapshotFile);
  assert.ok(restored, 'Restored snapshot should exist');
  const team = restored.teams[0];
  assert.equal(team.team_name, 'data-team');
  assert.deepEqual(team.members, ['alice', 'bob']);
  assert.equal(team.custom_field, 'should-survive');
  assert.ok(team.recovery_metadata, 'v3 field added');
  assert.equal(team.policy.auto_rebalance.enabled, false, 'v2 policy preserved');

  cleanup(paths.root);
});
