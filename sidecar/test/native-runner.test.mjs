import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeActionRunner } from '../native/native-runner.js';

test('native runner parses final-line JSON from execImpl', async () => {
  const runner = new NativeActionRunner({
    execImpl: async () => ({ stdout: 'noise\n{"ok":true,"native_tool":"TeamStatus","tool_available":true,"result":{"x":1},"error":null,"notes":"ok"}\n', latency_ms: 9 }),
  });
  const res = await runner.run('team-status', { team_name: 'alpha' });
  assert.equal(res.ok, true);
  assert.equal(res.native_tool, 'TeamStatus');
  assert.equal(res.result.x, 1);
  assert.equal(res.path_mode, 'ephemeral');
});

test('native runner returns malformed_response envelope when parser fails', async () => {
  const runner = new NativeActionRunner({ execImpl: async () => ({ stdout: 'not json', latency_ms: 4 }) });
  const res = await runner.run('team-status', {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'malformed_response');
});
