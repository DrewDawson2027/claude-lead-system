import test from 'node:test';
import assert from 'node:assert/strict';
import { LockMetrics } from '../core/lock-metrics.js';

test('tracks lock attempts and computes stats', () => {
  const m = new LockMetrics();
  m.recordAttempt('state.lock', 5, true);
  m.recordAttempt('state.lock', 10, true);
  m.recordAttempt('state.lock', 15, true);
  m.recordAttempt('state.lock', 100, false);

  const snap = m.snapshot();
  assert.equal(snap.locks['state.lock'].attempts, 4);
  assert.equal(snap.locks['state.lock'].acquisitions, 3);
  assert.equal(snap.locks['state.lock'].failures, 1);
  assert.equal(snap.locks['state.lock'].collisions, 1);
  assert.equal(snap.locks['state.lock'].sample_count, 4);
  assert.ok(snap.locks['state.lock'].avg_wait_ms > 0);
  assert.equal(snap.locks['state.lock'].max_wait_ms, 100);
});

test('computes percentiles correctly', () => {
  const m = new LockMetrics();
  // Add 100 samples with values 1-100
  for (let i = 1; i <= 100; i++) {
    m.recordAttempt('test.lock', i, true);
  }

  const snap = m.snapshot();
  assert.equal(snap.locks['test.lock'].p95_wait_ms, 95);
  assert.equal(snap.locks['test.lock'].max_wait_ms, 100);
  assert.equal(snap.locks['test.lock'].avg_wait_ms, 50.5);
});

test('identifies hot paths by max wait time', () => {
  const m = new LockMetrics();
  m.recordAttempt('fast.lock', 1, true);
  m.recordAttempt('medium.lock', 50, true);
  m.recordAttempt('slow.lock', 200, true);
  m.recordAttempt('slower.lock', 500, true);

  const snap = m.snapshot();
  assert.equal(snap.hot_paths.length, 3, 'Should return top 3 hot paths');
  assert.equal(snap.hot_paths[0].name, 'slower.lock', 'Slowest lock should be first');
  assert.equal(snap.hot_paths[1].name, 'slow.lock');
  assert.equal(snap.hot_paths[2].name, 'medium.lock');
});

test('respects max samples limit', () => {
  const m = new LockMetrics(10); // Small limit for testing
  for (let i = 0; i < 20; i++) {
    m.recordAttempt('test.lock', i, true);
  }

  const snap = m.snapshot();
  assert.equal(snap.locks['test.lock'].sample_count, 10, 'Should keep only 10 samples');
  assert.equal(snap.locks['test.lock'].attempts, 20, 'Attempts count should be 20');
});

test('reset clears all metrics', () => {
  const m = new LockMetrics();
  m.recordAttempt('test.lock', 5, true);
  assert.equal(Object.keys(m.snapshot().locks).length, 1);

  m.reset();
  assert.equal(Object.keys(m.snapshot().locks).length, 0);
  assert.equal(m.snapshot().hot_paths.length, 0);
});

test('handles empty state', () => {
  const m = new LockMetrics();
  const snap = m.snapshot();
  assert.deepEqual(snap.locks, {});
  assert.deepEqual(snap.hot_paths, []);
});
