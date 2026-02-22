import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkTerminalHealth, suggestRecovery } from '../core/terminal-health.js';

function tmpPaths() {
  const root = mkdtempSync(join(tmpdir(), 'term-health-'));
  const terminalsDir = join(root, 'terminals');
  mkdirSync(terminalsDir, { recursive: true });
  mkdirSync(join(terminalsDir, 'results'), { recursive: true });
  return { root, terminalsDir };
}

test('detects zombie sessions (dead PID)', () => {
  const paths = tmpPaths();
  // Use PID 999999 which almost certainly doesn't exist
  writeFileSync(
    join(paths.terminalsDir, 'session-zombie123.json'),
    JSON.stringify({
      session_id: 'zombie123',
      pid: 999999,
      status: 'active',
      updated_at: new Date().toISOString(),
    }),
  );

  const report = checkTerminalHealth(paths);
  assert.equal(report.zombies.length, 1, 'Should detect 1 zombie');
  assert.equal(report.zombies[0].session_id, 'zombie123');
  assert.ok(report.zombies[0].issue.includes('PID not alive'));
  rmSync(paths.root, { recursive: true, force: true });
});

test('detects stale sessions (old timestamp)', () => {
  const paths = tmpPaths();
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  writeFileSync(
    join(paths.terminalsDir, 'session-stale456.json'),
    JSON.stringify({
      session_id: 'stale456',
      pid: process.pid, // Current process PID so it's alive
      status: 'active',
      updated_at: tenMinAgo,
    }),
  );

  const report = checkTerminalHealth(paths);
  assert.equal(report.stale.length, 1, 'Should detect 1 stale session');
  assert.ok(report.stale[0].issue.includes('minutes'));
  rmSync(paths.root, { recursive: true, force: true });
});

test('healthy sessions pass detection', () => {
  const paths = tmpPaths();
  writeFileSync(
    join(paths.terminalsDir, 'session-healthy789.json'),
    JSON.stringify({
      session_id: 'healthy789',
      pid: process.pid,
      status: 'active',
      updated_at: new Date().toISOString(),
    }),
  );

  const report = checkTerminalHealth(paths);
  assert.equal(report.healthy.length, 1);
  assert.equal(report.zombies.length, 0);
  assert.equal(report.stale.length, 0);
  rmSync(paths.root, { recursive: true, force: true });
});

test('skips closed and stale-status sessions', () => {
  const paths = tmpPaths();
  writeFileSync(
    join(paths.terminalsDir, 'session-closed.json'),
    JSON.stringify({ session_id: 'closed', pid: 999999, status: 'closed', updated_at: new Date().toISOString() }),
  );
  writeFileSync(
    join(paths.terminalsDir, 'session-markedstale.json'),
    JSON.stringify({ session_id: 'markedstale', pid: 999999, status: 'stale', updated_at: new Date().toISOString() }),
  );

  const report = checkTerminalHealth(paths);
  assert.equal(report.zombies.length, 0, 'Should skip closed/stale sessions');
  assert.equal(report.healthy.length, 0);
  rmSync(paths.root, { recursive: true, force: true });
});

test('detects dead worker shells', () => {
  const paths = tmpPaths();
  const resultsDir = join(paths.terminalsDir, 'results');
  writeFileSync(
    join(resultsDir, 'worker-dead.meta.json'),
    JSON.stringify({ task_id: 'worker-dead', pid: 999999, name: 'test-worker' }),
  );
  // No .done marker exists

  const report = checkTerminalHealth(paths);
  assert.equal(report.dead_shells.length, 1);
  assert.equal(report.dead_shells[0].task_id, 'worker-dead');
  rmSync(paths.root, { recursive: true, force: true });
});

test('suggestRecovery generates suggestions', () => {
  const findings = {
    zombies: [{ session_id: 'z1', issue: 'PID dead' }],
    stale: [{ session_id: 's1', issue: '10 minutes' }],
    dead_shells: [{ task_id: 'd1', issue: 'no done marker' }],
  };

  const suggestions = suggestRecovery(findings);
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.some(s => s.suggested_action === 'clean_session'));
  assert.ok(suggestions.some(s => s.suggested_action === 'remove_stale'));
  assert.ok(suggestions.some(s => s.suggested_action === 'restart_worker'));
});

test('handles empty terminals directory', () => {
  const paths = tmpPaths();
  const report = checkTerminalHealth(paths);
  assert.equal(report.healthy.length, 0);
  assert.equal(report.zombies.length, 0);
  assert.equal(report.summary, 'No sessions found');
  rmSync(paths.root, { recursive: true, force: true });
});
