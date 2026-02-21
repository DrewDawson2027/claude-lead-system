import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../index.js';
import { resolve, join } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('sanitizeId accepts safe IDs', () => {
  assert.equal(__test__.sanitizeId('W123_abc-DEF', 'task_id'), 'W123_abc-DEF');
});

test('sanitizeId rejects unsafe IDs', () => {
  assert.throws(() => __test__.sanitizeId('bad;rm -rf', 'task_id'));
});

test('sanitizeShortSessionId enforces minimum length and truncates to 8', () => {
  assert.equal(__test__.sanitizeShortSessionId('abcd1234zzzz'), 'abcd1234');
  assert.throws(() => __test__.sanitizeShortSessionId('abc123'));
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

test('wake text always returns empty (safe mode only, no injection)', () => {
  assert.equal(__test__.selectWakeText('run rm -rf /'), '');
  assert.equal(__test__.selectWakeText('status check'), '');
});

test('batQuote escapes cmd.exe metacharacters', () => {
  assert.equal(__test__.batQuote('simple'), '"simple"');
  assert.equal(__test__.batQuote('foo&bar'), '"foo^&bar"');
  assert.equal(__test__.batQuote('a|b>c<d'), '"a^|b^>c^<d"');
  assert.equal(__test__.batQuote('100%'), '"100%%"');
  assert.equal(__test__.batQuote('a^b'), '"a^^b"');
  assert.equal(__test__.batQuote(null), '""');
});

test('batQuote fuzz: no unquoted metacharacters in random input', () => {
  const dangerous = /(?<!\^)[&|><]|(?<!%)%(?!%)|(?<!\^)\^(?![&|><^!])/;
  for (let i = 0; i < 200; i++) {
    const len = Math.floor(Math.random() * 50) + 1;
    const input = Array.from({ length: len }, () =>
      String.fromCharCode(Math.floor(Math.random() * 128))
    ).join('');
    const result = __test__.batQuote(input);
    // Must be wrapped in double quotes
    assert.match(result, /^".*"$/s, `batQuote output must be quoted for input ${i}`);
    const inner = result.slice(1, -1);
    // No bare & | > < — each should be preceded by ^
    for (const ch of ['&', '|', '>', '<']) {
      const idx = inner.indexOf(ch);
      if (idx >= 0) {
        assert.equal(inner[idx - 1], '^', `bare '${ch}' found at pos ${idx} in output for input ${i}`);
      }
    }
    // No bare % — each should be doubled
    const singles = inner.match(/(?<!%)%(?!%)/g);
    assert.equal(singles, null, `bare '%' found in output for input ${i}`);
  }
});

test('readJSONLLimited handles truncation and invalid lines', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'jsonl-'));
  const file = join(tmp, 'test.jsonl');
  writeFileSync(file, '{"a":1}\n{"b":2}\nnot-json\n{"c":3}\n');
  const result = __test__.readJSONLLimited(file, 2, 1024 * 1024);
  assert.equal(result.items.length, 2); // limited to 2 lines
  assert.equal(result.truncated, true); // had more lines than limit
  assert.equal(result.items[0].a, 1);
});

test('readJSONLLimited returns empty for missing file', () => {
  const result = __test__.readJSONLLimited('/nonexistent/file.jsonl');
  assert.deepEqual(result.items, []);
  assert.equal(result.truncated, false);
});

test('isSafeTTYPath validates tty paths', () => {
  assert.equal(__test__.isSafeTTYPath('/dev/ttys001'), true);
  assert.equal(__test__.isSafeTTYPath('/dev/pts/0'), true);
  assert.equal(__test__.isSafeTTYPath('/dev/tty42'), true);
  assert.equal(__test__.isSafeTTYPath('/tmp/evil'), false);
  assert.equal(__test__.isSafeTTYPath('/dev/../etc/passwd'), false);
  assert.equal(__test__.isSafeTTYPath(''), false);
});
