import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRouter } from '../core/action-router.js';

function makeStore() {
  return { emitAdapterHealth() {}, emitPolicyAlert() {}, raiseAlert() {} };
}

test('router prefers coordinator for coordinator-only actions in hybrid mode', async () => {
  const router = new ActionRouter({
    coordinatorAdapter: {
      async health() { return { ok: true }; },
      async execute(action) { return { text: `coord:${action}` }; },
    },
    nativeAdapter: {
      async health() { return { ok: true, capabilities: { available: true }, bridge: { bridge_status: 'healthy' } }; },
      async execute(action) { return { text: `native:${action}` }; },
    },
    store: makeStore(),
  });
  const res = await router.route({ execution_path: 'hybrid' }, 'rebalance', { team_name: 'x' });
  assert.equal(res.ok, true);
  assert.equal(res.adapter, 'coordinator');
  assert.match(res.result.text, /coord:rebalance/);
});

test('router falls back to coordinator when native adapter fails', async () => {
  const router = new ActionRouter({
    coordinatorAdapter: {
      async health() { return { ok: true }; },
      async execute(action) { return { text: `coord:${action}` }; },
    },
    nativeAdapter: {
      async health() { return { ok: true, capabilities: { available: true }, bridge: { bridge_status: 'healthy' } }; },
      async execute() { throw new Error('boom'); },
    },
    store: makeStore(),
  });
  const res = await router.route({ execution_path: 'native' }, 'message', {});
  assert.equal(res.ok, true);
  assert.equal(res.adapter, 'coordinator');
  assert.match(res.reason, /native failed/i);
  assert.equal(res.fallback_used, true);
});
