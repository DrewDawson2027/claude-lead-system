import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rebuildFromTimeline, consistencyCheck } from '../core/event-replay.js';

function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  mkdirSync(join(dir, 'logs'), { recursive: true });
  return dir;
}

function writeTimeline(dir, events) {
  const logFile = join(dir, 'logs', 'timeline.jsonl');
  writeFileSync(logFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return logFile;
}

test('rebuilds state from timeline events', () => {
  const dir = tmpDir();
  const now = Date.now();
  const logFile = writeTimeline(dir, [
    { ts: new Date(now).toISOString(), type: 'snapshot.rebuilt', source: 'boot' },
    { ts: new Date(now + 1000).toISOString(), type: 'maintenance.sweep', source: 'startup' },
    { ts: new Date(now + 2000).toISOString(), type: 'alert.raised', level: 'warn' },
    { ts: new Date(now + 3000).toISOString(), type: 'snapshot.rebuilt', source: 'manual', team_name: 'alpha' },
    { ts: new Date(now + 4000).toISOString(), type: 'auto_rebalance.triggered', team_name: 'alpha' },
  ]);

  const result = rebuildFromTimeline(logFile);
  assert.equal(result.event_count, 5);
  assert.equal(result.derived_state.snapshots_rebuilt, 2);
  assert.equal(result.derived_state.maintenance_sweeps, 1);
  assert.equal(result.derived_state.alerts_raised, 1);
  assert.equal(result.derived_state.auto_rebalances, 1);
  assert.ok(result.derived_state.teams_seen.includes('alpha'));
  assert.equal(result.gaps.length, 0, 'No time gaps expected');
  rmSync(dir, { recursive: true, force: true });
});

test('detects time gaps in timeline', () => {
  const dir = tmpDir();
  const now = Date.now();
  const logFile = writeTimeline(dir, [
    { ts: new Date(now).toISOString(), type: 'snapshot.rebuilt' },
    { ts: new Date(now + 10 * 60_000).toISOString(), type: 'snapshot.rebuilt' }, // 10 min gap
  ]);

  const result = rebuildFromTimeline(logFile);
  assert.equal(result.gaps.length, 1, 'Should detect the 10-minute gap');
  assert.ok(result.gaps[0].includes('10.0min'));
  rmSync(dir, { recursive: true, force: true });
});

test('consistency check finds missing teams', () => {
  const dir = tmpDir();
  const now = Date.now();
  const logFile = writeTimeline(dir, [
    { ts: new Date(now).toISOString(), type: 'snapshot.rebuilt', team_name: 'alpha' },
    { ts: new Date(now + 1000).toISOString(), type: 'snapshot.rebuilt', team_name: 'beta' },
  ]);

  const derived = rebuildFromTimeline(logFile);
  const actual = { teams: [{ team_name: 'alpha' }], alerts: [] };
  const check = consistencyCheck(derived, actual);
  assert.equal(check.consistent, false);
  assert.ok(check.diffs.some(d => d.expected === 'beta'));
  rmSync(dir, { recursive: true, force: true });
});

test('consistency check passes when all teams present', () => {
  const dir = tmpDir();
  const now = Date.now();
  const logFile = writeTimeline(dir, [
    { ts: new Date(now).toISOString(), type: 'snapshot.rebuilt', team_name: 'alpha' },
  ]);

  const derived = rebuildFromTimeline(logFile);
  const actual = { teams: [{ team_name: 'alpha' }], alerts: [] };
  const check = consistencyCheck(derived, actual);
  assert.ok(check.consistent);
  assert.equal(check.diffs.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('handles empty timeline', () => {
  const dir = tmpDir();
  const logFile = join(dir, 'logs', 'timeline.jsonl');
  writeFileSync(logFile, '');

  const result = rebuildFromTimeline(logFile);
  assert.equal(result.event_count, 0);
  assert.equal(result.gaps.length, 0);
  rmSync(dir, { recursive: true, force: true });
});
