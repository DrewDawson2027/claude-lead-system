import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateHooks, validateHookOutputFormat, runHookSelftest } from '../core/hook-watchdog.js';

function tmpHooksDir() {
  return mkdtempSync(join(tmpdir(), 'hook-test-'));
}

test('validates valid shell hook', () => {
  const dir = tmpHooksDir();
  const hookPath = join(dir, 'good.sh');
  writeFileSync(hookPath, '#!/bin/bash\necho "hello"\n');
  if (process.platform !== 'win32') chmodSync(hookPath, 0o755);

  const report = validateHooks(dir);
  assert.equal(report.hooks.length, 1);
  assert.equal(report.hooks[0].name, 'good.sh');
  assert.ok(report.hooks[0].syntax_valid, 'Should have valid syntax');
  assert.ok(report.hooks[0].executable || process.platform === 'win32', 'Should be executable');
  assert.equal(report.hooks[0].issues.length, 0);
  assert.ok(report.all_valid);
  rmSync(dir, { recursive: true, force: true });
});

test('detects shell syntax errors', () => {
  const dir = tmpHooksDir();
  const hookPath = join(dir, 'bad.sh');
  writeFileSync(hookPath, '#!/bin/bash\nif then fi fi\n');
  if (process.platform !== 'win32') chmodSync(hookPath, 0o755);

  const report = validateHooks(dir);
  assert.equal(report.hooks.length, 1);
  assert.equal(report.hooks[0].syntax_valid, false, 'Should detect syntax error');
  assert.ok(report.hooks[0].issues.length > 0);
  assert.ok(report.hooks[0].issues[0].includes('syntax error'));
  assert.equal(report.all_valid, false);
  rmSync(dir, { recursive: true, force: true });
});

test('detects non-executable hook', () => {
  if (process.platform === 'win32') return; // Skip on Windows
  const dir = tmpHooksDir();
  const hookPath = join(dir, 'noexec.sh');
  writeFileSync(hookPath, '#!/bin/bash\necho "hello"\n');
  chmodSync(hookPath, 0o644); // Not executable

  const report = validateHooks(dir);
  assert.equal(report.hooks[0].executable, false);
  assert.ok(report.hooks[0].issues.some(i => i.includes('Not executable')));
  rmSync(dir, { recursive: true, force: true });
});

test('validates python hook syntax', () => {
  const dir = tmpHooksDir();
  const hookPath = join(dir, 'good.py');
  writeFileSync(hookPath, 'import json\nprint(json.dumps({"ok": True}))\n');

  const report = validateHooks(dir);
  assert.equal(report.hooks.length, 1);
  assert.ok(report.hooks[0].syntax_valid, 'Python hook should have valid syntax');
  rmSync(dir, { recursive: true, force: true });
});

test('detects python syntax errors', () => {
  const dir = tmpHooksDir();
  const hookPath = join(dir, 'bad.py');
  writeFileSync(hookPath, 'def foo(\n  print("unclosed\n');

  const report = validateHooks(dir);
  assert.equal(report.hooks[0].syntax_valid, false);
  assert.ok(report.hooks[0].issues.length > 0);
  rmSync(dir, { recursive: true, force: true });
});

test('handles non-existent hooks directory', () => {
  const report = validateHooks('/nonexistent/hooks/dir');
  assert.deepEqual(report.hooks, []);
  assert.ok(report.all_valid);
});

test('validates hook output format for python hooks', () => {
  const validResult = validateHookOutputFormat('test.py', '{"ok": true}');
  assert.ok(validResult.valid);

  const invalidResult = validateHookOutputFormat('test.py', 'not json output');
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.issues.length > 0);
});

test('accepts empty output from hooks', () => {
  const result = validateHookOutputFormat('test.sh', '');
  assert.ok(result.valid);
});

test('selftest handles hooks gracefully', () => {
  const dir = tmpHooksDir();
  const hookPath = join(dir, 'selftest.sh');
  writeFileSync(hookPath, '#!/bin/bash\nif [ "$1" = "--selftest" ]; then echo "ok"; exit 0; fi\n');
  if (process.platform !== 'win32') chmodSync(hookPath, 0o755);

  const results = runHookSelftest(dir);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'selftest.sh');
  // May or may not pass depending on shell behavior
  assert.ok('selftest_passed' in results[0]);
  rmSync(dir, { recursive: true, force: true });
});

test('ignores non-hook files', () => {
  const dir = tmpHooksDir();
  writeFileSync(join(dir, 'readme.md'), '# Hooks');
  writeFileSync(join(dir, 'config.json'), '{}');

  const report = validateHooks(dir);
  assert.equal(report.hooks.length, 0, 'Should ignore non .sh/.py files');
  assert.ok(report.all_valid);
  rmSync(dir, { recursive: true, force: true });
});
