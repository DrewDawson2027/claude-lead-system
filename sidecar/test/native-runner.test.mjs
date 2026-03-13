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
  assert.equal(res.path_mode, 'native-direct');
  assert.equal(res.route_mode, 'native-direct');
  assert.match(String(res.route_reason || ''), /succeeded/i);
});

test('native runner returns malformed_response envelope when parser fails', async () => {
  const runner = new NativeActionRunner({ execImpl: async () => ({ stdout: 'not json', latency_ms: 4 }) });
  const res = await runner.run('team-status', {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'malformed_response');
  assert.equal(res.route_mode, 'native-direct');
  assert.match(String(res.route_reason || ''), /malformed response/i);
});

test('native runner normalizes supported model aliases before execution', async () => {
  let receivedModel = null;
  const runner = new NativeActionRunner({
    execImpl: async ({ model }) => {
      receivedModel = model;
      return {
        stdout: '{"ok":true,"native_tool":"Task","tool_available":true,"result":{},"error":null,"notes":"ok"}',
        latency_ms: 2,
      };
    },
  });
  const res = await runner.run('task', { team_name: 'alpha' }, { model: 'claude-sonnet-4-6' });
  assert.equal(res.ok, true);
  assert.equal(receivedModel, 'sonnet');
});

test('native runner rejects unsupported models before execution', async () => {
  let calls = 0;
  const runner = new NativeActionRunner({
    execImpl: async () => {
      calls += 1;
      return { stdout: '{"ok":true}', latency_ms: 1 };
    },
  });
  const res = await runner.run('task', {}, { model: 'opus' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'unsupported_model');
  assert.equal(calls, 0);
});
