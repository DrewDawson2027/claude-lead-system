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
  assert.match(res.route_reason || res.reason, /native/i);
  assert.equal(res.route_mode, 'coordinator-fallback');
  assert.equal(res.fallback_used, true);
});

test('router skips native health probes for coordinator-only actions', async () => {
  let nativeHealthCalls = 0;
  const router = new ActionRouter({
    coordinatorAdapter: {
      async execute(action) { return { text: `coord:${action}` }; },
    },
    nativeAdapter: {
      async health() {
        nativeHealthCalls += 1;
        return { ok: true, capabilities: { available: true }, bridge: { bridge_status: 'healthy' } };
      },
      async execute(action) { return { text: `native:${action}` }; },
    },
    store: makeStore(),
  });
  const res = await router.route({ execution_path: 'hybrid' }, 'approve-plan', { task_id: 'W1' });
  assert.equal(res.ok, true);
  assert.equal(res.adapter, 'coordinator');
  assert.equal(nativeHealthCalls, 0);
  assert.equal(res.orchestration?.health_probes, 0);
});

test('router skips coordinator fallback for non-retryable native errors', async () => {
  let coordinatorExecCalls = 0;
  let alerts = 0;
  const router = new ActionRouter({
    coordinatorAdapter: {
      async execute() {
        coordinatorExecCalls += 1;
        return { ok: true, text: 'coord:should-not-run' };
      },
    },
    nativeAdapter: {
      async health() {
        return { ok: true, capabilities: { available: true }, bridge: { bridge_status: 'healthy' } };
      },
      async execute() {
        return { ok: false, error: { code: 'validation_error', message: 'invalid payload' } };
      },
    },
    store: {
      emitAdapterHealth() {},
      emitPolicyAlert() {},
      raiseAlert() { alerts += 1; },
    },
  });
  const res = await router.route({ execution_path: 'native' }, 'message', {});
  assert.equal(res.ok, false);
  assert.equal(res.adapter, 'native');
  assert.equal(res.fallback_used, false);
  assert.equal(res.fallback_skipped, true);
  assert.match(String(res.fallback_skip_reason || ''), /non-retryable/i);
  assert.equal(coordinatorExecCalls, 0);
  assert.equal(alerts, 0);
});
