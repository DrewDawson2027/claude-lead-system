import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SidecarStateStore } from '../core/state-store.js';
import { MetricsTracker } from '../native/metrics.js';
import { ActionQueue } from '../native/action-queue.js';

function tmpPaths() {
  const root = mkdtempSync(join(tmpdir(), 'chaos-test-'));
  mkdirSync(join(root, 'state'), { recursive: true });
  mkdirSync(join(root, 'logs'), { recursive: true });
  return {
    snapshotFile: join(root, 'state', 'latest.json'),
    logFile: join(root, 'logs', 'timeline.jsonl'),
    root,
  };
}

test('recovers from missing snapshot file', () => {
  const paths = tmpPaths();
  // No snapshot file exists
  const store = new SidecarStateStore(paths);
  const snap = store.getSnapshot();
  assert.ok(snap, 'Should return default snapshot');
  assert.deepEqual(snap.teams, []);
  assert.deepEqual(snap.teammates, []);

  // Setting snapshot should create the file
  store.setSnapshot({ teams: [{ team_name: 'test' }] });
  const updated = store.getSnapshot();
  assert.equal(updated.teams.length, 1);
  rmSync(paths.root, { recursive: true, force: true });
});

test('returns default snapshot on fresh init regardless of disk state', () => {
  const paths = tmpPaths();
  writeFileSync(paths.snapshotFile, '{corrupt json!!!');

  // SidecarStateStore always builds fresh in-memory — does not read from disk in constructor
  const store = new SidecarStateStore(paths);
  const snap = store.getSnapshot();
  assert.ok(snap, 'Should return default snapshot');
  assert.deepEqual(snap.teams, []);
  rmSync(paths.root, { recursive: true, force: true });
});

test('survives rapid concurrent setSnapshot calls', () => {
  const paths = tmpPaths();
  const store = new SidecarStateStore(paths);
  const events = [];
  store.on('snapshot', () => events.push(Date.now()));

  // Fire 10 concurrent setSnapshot calls
  for (let i = 0; i < 10; i++) {
    store.setSnapshot({ teams: [{ team_name: `team-${i}` }], generated_at: new Date().toISOString() });
  }

  assert.equal(events.length, 10, 'All 10 snapshot events should fire');
  const snap = store.getSnapshot();
  assert.equal(snap.teams[0].team_name, 'team-9', 'Last write wins');
  rmSync(paths.root, { recursive: true, force: true });
});

test('MetricsTracker handles zero samples gracefully', () => {
  const m = new MetricsTracker();
  const snap = m.snapshot();
  assert.equal(snap.action_latency_ms.p50, null);
  assert.equal(snap.action_latency_ms.p95, null);
  assert.equal(snap.action_latency_ms.sample_size, 0);
  assert.equal(snap.counts.success, 0);
});

test('MetricsTracker handles negative latency', () => {
  const m = new MetricsTracker();
  m.observeAction({ latency_ms: -5, path_key: 'test', ok: true });
  // Negative should be rejected (not finite and >= 0)
  const snap = m.snapshot();
  assert.equal(snap.action_latency_ms.sample_size, 0, 'Negative latency should be rejected');
  assert.equal(snap.counts.success, 1, 'Count should still increment');
});

test('timeline logging handles missing log directory gracefully', () => {
  const paths = tmpPaths();
  // Delete the logs dir
  rmSync(join(paths.root, 'logs'), { recursive: true, force: true });

  const store = new SidecarStateStore(paths);
  // This should not throw even though the log file directory is missing
  const result = store.emitTimeline({ type: 'test', ts: new Date().toISOString() });
  assert.equal(result.ok, false);
  assert.match(result.error_code, /state_store_timeline_append_fail/);
  assert.ok(store.getSnapshot().alerts.some((a) => a.code === 'state_store_timeline_append_fail'));
  rmSync(paths.root, { recursive: true, force: true });
});

test('setSnapshot returns explicit error and records metrics on snapshot write failure', () => {
  const paths = tmpPaths();
  rmSync(join(paths.root, 'state'), { recursive: true, force: true });
  const metricsSeen = [];
  const store = new SidecarStateStore(paths, { onMetric: (name, value) => metricsSeen.push([name, value]) });
  const result = store.setSnapshot({ teams: [{ team_name: 'x' }] });
  assert.equal(result.ok, false);
  assert.match(String(result.error_code), /state_store_snapshot_write_fail/);
  assert.ok(metricsSeen.some(([n]) => n === 'snapshot_write_fail'));
  assert.ok(store.getSnapshot().alerts.some((a) => a.code === 'state_store_snapshot_write_fail'));
  rmSync(paths.root, { recursive: true, force: true });
});

test('raiseAlert caps at 100 alerts', () => {
  const paths = tmpPaths();
  const store = new SidecarStateStore(paths);

  for (let i = 0; i < 150; i++) {
    store.raiseAlert({ level: 'info', message: `alert-${i}` });
  }

  const snap = store.getSnapshot();
  assert.ok(snap.alerts.length <= 100, `Alerts capped at 100, got ${snap.alerts.length}`);
  rmSync(paths.root, { recursive: true, force: true });
});

test('persistSnapshot handles non-existent directory', () => {
  const m = new MetricsTracker();
  m.observeAction({ latency_ms: 5, path_key: 'test', ok: true });
  const dir = join(tmpdir(), `chaos-metrics-${Date.now()}`);
  const file = m.persistSnapshot(dir, 0); // 0 throttle to force persist
  assert.ok(file, 'Should create directory and persist');
  rmSync(dir, { recursive: true, force: true });
});
