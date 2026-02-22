import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../index.js';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

test('wake text defaults to safe empty payload unless explicitly unsafe', () => {
  assert.equal(__test__.selectWakeText('run rm -rf /', false), '');
  assert.equal(__test__.selectWakeText('status check', true), 'status check');
});

test('legacy cost JSON output is decorated with deprecation metadata', () => {
  const raw = JSON.stringify({ window: 'today', totalUSD: 12.34 });
  const out = __test__.applyLegacyDeprecationToOutput('coord_cost_summary', raw);
  const parsed = JSON.parse(out);
  assert.equal(parsed.deprecated, true);
  assert.equal(parsed.canonical_tool, 'coord_cost_overview');
  assert.match(parsed.canonical_command, /cost overview/);
});

test('legacy envelope-mode output preserves deprecation metadata inside data.text', () => {
  const script = `
    process.env.CLAUDE_COORDINATOR_RESULT_ENVELOPE = "1";
    const mod = await import('./index.js');
    const r = mod.__test__.withEnvelope(
      'coord_cost_trends',
      Date.now(),
      'req-test',
      () => JSON.stringify({ period: 'week', series: [] })
    );
    console.log(JSON.stringify(r));
  `;
  const cp = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: resolve(process.cwd()),
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(cp.status, 0, cp.stderr || cp.stdout);
  const outer = JSON.parse(cp.stdout.trim());
  const envelope = JSON.parse(outer.content[0].text);
  const inner = JSON.parse(envelope.data.text);
  assert.equal(inner.deprecated, true);
  assert.equal(inner.canonical_tool, 'coord_ops_trends');
  assert.match(inner.canonical_command, /ops trends/);
});
