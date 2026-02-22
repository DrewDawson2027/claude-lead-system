import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetricsTracker } from '../native/metrics.js';
import { applyPriorityAging, applyQueuePolicy } from '../core/policy-engine.js';
import { diffSnapshots, replayTimeline, buildTimelineReport } from '../core/snapshot-diff.js';
import { SidecarStateStore } from '../core/state-store.js';

function tmpPaths() {
  const root = mkdtempSync(join(tmpdir(), 'scale-test-'));
  mkdirSync(join(root, 'state'), { recursive: true });
  mkdirSync(join(root, 'logs'), { recursive: true });
  return {
    snapshotFile: join(root, 'state', 'latest.json'),
    logFile: join(root, 'logs', 'timeline.jsonl'),
    root,
  };
}

test('handles 200 tasks with priority aging efficiently', () => {
  const tasks = Array.from({ length: 200 }, (_, i) => ({
    task_id: `task-${i}`,
    status: 'pending',
    priority: ['low', 'normal', 'high', 'critical'][i % 4],
    created: new Date(Date.now() - i * 3600_000).toISOString(),
    assignee: null,
    metadata: {},
  }));

  const t0 = performance.now();
  applyPriorityAging(tasks, { aging_interval_ms: 3600_000, max_bumps: 2 });
  const ordered = applyQueuePolicy(tasks, 'priority_first');
  const elapsed = performance.now() - t0;

  assert.equal(ordered.length, 200);
  assert.ok(elapsed < 50, `Should complete in <50ms, took ${elapsed.toFixed(1)}ms`);
});

test('handles 1000 timeline events in replay', () => {
  const paths = tmpPaths();
  const lines = Array.from({ length: 1000 }, (_, i) => JSON.stringify({
    ts: new Date(Date.now() - (1000 - i) * 1000).toISOString(),
    type: ['snapshot.rebuilt', 'action.completed', 'alert.raised', 'timeline.event'][i % 4],
    data: { index: i },
  }));
  writeFileSync(paths.logFile, lines.join('\n'));

  const t0 = performance.now();
  const events = replayTimeline(paths.logFile, null, null, null);
  const report = buildTimelineReport(events);
  const elapsed = performance.now() - t0;

  assert.equal(events.length, 1000);
  assert.equal(report.total_events, 1000);
  assert.ok(Object.keys(report.by_type).length === 4);
  assert.ok(elapsed < 500, `Should complete in <500ms, took ${elapsed.toFixed(1)}ms`);
  rmSync(paths.root, { recursive: true, force: true });
});

test('MetricsTracker handles 500 samples correctly', () => {
  const m = new MetricsTracker(500);

  for (let i = 0; i < 500; i++) {
    m.observeAction({ latency_ms: i * 0.1, path_key: `path-${i % 5}`, ok: i % 10 !== 0, fallback_used: i % 20 === 0 });
  }

  const snap = m.snapshot();
  assert.equal(snap.action_latency_ms.sample_size, 500);
  assert.ok(snap.action_latency_ms.p50 != null, 'p50 should be calculated');
  assert.ok(snap.action_latency_ms.p95 != null, 'p95 should be calculated');
  assert.ok(snap.counts.success > 0);
  assert.ok(snap.counts.failure > 0);
  assert.ok(snap.counts.fallback > 0);
  assert.equal(Object.keys(snap.by_path).length, 5);
});

test('MetricsTracker respects maxSamples', () => {
  const m = new MetricsTracker(10);

  for (let i = 0; i < 50; i++) {
    m.observeAction({ latency_ms: i, path_key: 'test', ok: true });
  }

  const snap = m.snapshot();
  assert.equal(snap.action_latency_ms.sample_size, 10, 'Should cap at maxSamples');
  // Last 10 samples should be 40-49
  assert.ok(snap.action_latency_ms.p50 >= 40, 'Oldest samples should be evicted');
});

test('snapshot diff handles large teammate lists', () => {
  const before = {
    teammates: Array.from({ length: 50 }, (_, i) => ({
      id: `member-${i}`, display_name: `Worker ${i}`, presence: 'active', load_score: 30,
    })),
    tasks: [],
    alerts: [],
  };
  const after = {
    teammates: [
      ...Array.from({ length: 45 }, (_, i) => ({
        id: `member-${i}`, display_name: `Worker ${i}`, presence: i < 5 ? 'stale' : 'active', load_score: i < 5 ? 80 : 30,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `member-new-${i}`, display_name: `New Worker ${i}`, presence: 'active', load_score: 10,
      })),
    ],
    tasks: [],
    alerts: [],
  };

  const t0 = performance.now();
  const diff = diffSnapshots(before, after);
  const elapsed = performance.now() - t0;

  assert.equal(diff.added.length, 5, '5 new members');
  assert.equal(diff.removed.length, 5, '5 removed members (50-55 -> 45+5)');
  assert.ok(diff.changed.length >= 5, 'At least 5 changed (presence/load)');
  assert.ok(elapsed < 50, `Should complete in <50ms, took ${elapsed.toFixed(1)}ms`);
});

test('metrics history loads efficiently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-metrics-'));
  for (let i = 0; i < 100; i++) {
    writeFileSync(join(dir, `metrics-${1000000 + i}.json`), JSON.stringify({
      generated_at: new Date(Date.now() - (100 - i) * 60000).toISOString(),
      counts: { success: i * 10, failure: i, fallback: 0 },
      action_latency_ms: { p50: 1 + i * 0.01, p95: 5 + i * 0.05, sample_size: 100 },
    }));
  }

  const t0 = performance.now();
  const history = MetricsTracker.loadHistory(dir, 100);
  const elapsed = performance.now() - t0;

  assert.equal(history.length, 100);
  assert.ok(elapsed < 200, `Should load in <200ms, took ${elapsed.toFixed(1)}ms`);
  rmSync(dir, { recursive: true, force: true });
});

test('rapid snapshot persistence does not corrupt', () => {
  const paths = tmpPaths();
  const store = new SidecarStateStore(paths);

  // Rapidly set 20 snapshots
  for (let i = 0; i < 20; i++) {
    store.setSnapshot({
      teams: Array.from({ length: i + 1 }, (_, j) => ({ team_name: `team-${j}` })),
      teammates: Array.from({ length: (i + 1) * 3 }, (_, j) => ({
        id: `m-${j}`, display_name: `W${j}`, presence: 'active',
      })),
      generated_at: new Date().toISOString(),
    });
  }

  const final = store.getSnapshot();
  assert.equal(final.teams.length, 20, 'Last snapshot should have 20 teams');
  assert.ok(final.schema_version, 'Schema version should be stamped');
  rmSync(paths.root, { recursive: true, force: true });
});
