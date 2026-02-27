import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve as pathResolve } from 'node:path';
import { isPathWithin } from '../server/routes/shared.js';

test('isPathWithin blocks sibling-prefix bypasses and allows real descendants', () => {
  const base = '/tmp/lead-sidecar/logs/diagnostics';
  assert.equal(isPathWithin(base, '/tmp/lead-sidecar/logs/diagnostics/report.json', pathResolve), true);
  assert.equal(isPathWithin(base, '/tmp/lead-sidecar/logs/diagnostics', pathResolve), false);
  assert.equal(isPathWithin(base, '/tmp/lead-sidecar/logs/diagnostics-evil/report.json', pathResolve), false);
  assert.equal(isPathWithin(base, '/tmp/lead-sidecar/logs/../logs/diagnostics-evil/report.json', pathResolve), false);
});

test('isPathWithin property check: prefix-collision paths are never considered descendants', () => {
  const base = '/tmp/lead-sidecar/state/backups';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < 200; i += 1) {
    const suffix = alphabet[i % alphabet.length] + String(i);
    const candidate = `/tmp/lead-sidecar/state/backups-${suffix}/file-${i}.json`;
    assert.equal(
      isPathWithin(base, candidate, pathResolve),
      false,
      `expected false for candidate ${candidate}`,
    );
  }
});
