import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { isPathWithin } from '../server/routes/shared.js';

test('isPathWithin blocks sibling-prefix bypasses and allows real descendants', () => {
  const root = mkdtempSync(join(tmpdir(), 'containment-'));
  const base = join(root, 'lead-sidecar', 'logs', 'diagnostics');
  const sibling = join(root, 'lead-sidecar', 'logs', 'diagnostics-evil');
  mkdirSync(base, { recursive: true });
  mkdirSync(sibling, { recursive: true });

  const baseReport = join(base, 'report.json');
  const siblingReport = join(sibling, 'report.json');
  writeFileSync(baseReport, JSON.stringify({ ok: true }));
  writeFileSync(siblingReport, JSON.stringify({ ok: false }));

  try {
    assert.equal(isPathWithin(base, baseReport, pathResolve), true);
    assert.equal(isPathWithin(base, base, pathResolve), false);
    assert.equal(isPathWithin(base, siblingReport, pathResolve), false);
    assert.equal(isPathWithin(base, join(base, '..', 'diagnostics-evil', 'report.json'), pathResolve), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isPathWithin property check: prefix-collision paths are never considered descendants', () => {
  const root = mkdtempSync(join(tmpdir(), 'containment-'));
  const base = join(root, 'lead-sidecar', 'state', 'backups');
  mkdirSync(base, { recursive: true });
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  try {
    for (let i = 0; i < 200; i += 1) {
      const suffix = alphabet[i % alphabet.length] + String(i);
      const candidate = join(root, 'lead-sidecar', 'state', `backups-${suffix}`, `file-${i}.json`);
      assert.equal(
        isPathWithin(base, candidate, pathResolve),
        false,
        `expected false for candidate ${candidate}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isPathWithin blocks symlink escapes from inside an allowed directory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'containment-'));
  const base = join(root, 'lead-sidecar', 'state', 'checkpoints');
  const outsideDir = join(root, 'outside-target');
  mkdirSync(base, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  const outsideFile = join(outsideDir, 'outside.json');
  const insideFile = join(base, 'inside.json');
  writeFileSync(outsideFile, JSON.stringify({ secret: true }));
  writeFileSync(insideFile, JSON.stringify({ ok: true }));

  const symlinkedOutside = join(base, 'linked-outside');
  try {
    symlinkSync(outsideDir, symlinkedOutside);
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    t.skip(`symlink unsupported in test environment: ${err.message}`);
    return;
  }

  try {
    const escaped = join(symlinkedOutside, 'outside.json');
    assert.equal(isPathWithin(base, escaped, pathResolve), false);
    assert.equal(isPathWithin(base, insideFile, pathResolve), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
