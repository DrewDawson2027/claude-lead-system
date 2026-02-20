import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../index.js';
import { resolve } from 'node:path';

test('sanitizeId accepts safe IDs', () => {
  assert.equal(__test__.sanitizeId('W123_abc-DEF', 'task_id'), 'W123_abc-DEF');
});

test('sanitizeId rejects unsafe IDs', () => {
  assert.throws(() => __test__.sanitizeId('bad;rm -rf', 'task_id'));
});

test('sanitizeModel defaults to sonnet', () => {
  assert.equal(__test__.sanitizeModel(undefined), 'sonnet');
});

test('sanitizeModel rejects shell metacharacters', () => {
  assert.throws(() => __test__.sanitizeModel('sonnet;echo hacked'));
});

test('sanitizeName accepts safe pipeline step names', () => {
  assert.equal(__test__.sanitizeName('step_1.build-v2', 'task name'), 'step_1.build-v2');
});

test('sanitizeName normalizes common unsafe characters', () => {
  assert.equal(__test__.sanitizeName('step one', 'task name'), 'step-one');
  assert.equal(__test__.sanitizeName('../escape', 'task name'), 'escape');
});

test('requireDirectoryPath rejects empty and newline values', () => {
  assert.throws(() => __test__.requireDirectoryPath(''));
  assert.throws(() => __test__.requireDirectoryPath('/tmp\nfoo'));
  assert.throws(() => __test__.requireDirectoryPath('/tmp/"quoted"'));
});

test('normalizeFilePath resolves relative paths consistently', () => {
  const base = '/tmp/demo-project';
  const normalized = __test__.normalizeFilePath('./src/../src/index.ts', base);
  let expected = resolve(base, 'src/index.ts').replace(/\\/g, '/');
  if (__test__.PLATFORM === 'win32') expected = expected.toLowerCase();
  assert.equal(normalized, expected);
});

test('process helpers reject invalid PID input safely', () => {
  assert.equal(__test__.isProcessAlive('bad-pid'), false);
  assert.throws(() => __test__.killProcess('bad-pid'));
});
