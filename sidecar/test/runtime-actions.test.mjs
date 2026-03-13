import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrackedActionRunner,
  createBatchTriageRunner,
} from "../server/runtime/actions.ts";

function makeActionQueue() {
  const records = new Map();
  let seq = 0;
  return {
    records,
    create(opts) {
      const action_id = `A${++seq}`;
      const rec = { action_id, state: "pending", ...opts };
      records.set(action_id, rec);
      return rec;
    },
    get(id) {
      return records.get(id) || null;
    },
    markStarted(id, meta) {
      const current = records.get(id) || { action_id: id };
      records.set(id, { ...current, ...meta, state: "inflight" });
    },
    markCompleted(id, meta) {
      const current = records.get(id) || { action_id: id };
      records.set(id, { ...current, ...meta, state: "done" });
    },
    markFailed(id, meta) {
      const current = records.get(id) || { action_id: id };
      records.set(id, { ...current, ...meta, state: "failed" });
    },
    list(limit) {
      return [...records.values()].slice(-limit).reverse();
    },
  };
}

function makeStore() {
  const events = {
    queued: 0,
    started: 0,
    completed: 0,
    failed: 0,
    alerts: 0,
    metrics: null,
  };
  return {
    events,
    snapshot: { alerts: [] },
    getSnapshot() {
      return this.snapshot;
    },
    emitActionQueued() {
      events.queued += 1;
    },
    emitActionStarted() {
      events.started += 1;
    },
    emitActionCompleted() {
      events.completed += 1;
    },
    emitActionFailed() {
      events.failed += 1;
    },
    raiseAlert() {
      events.alerts += 1;
    },
    setActionsRecent(actions) {
      this.snapshot.actions = { recent: actions };
    },
    setMetrics(metrics) {
      events.metrics = metrics;
      this.snapshot.metrics = metrics;
    },
  };
}

function makeMetrics() {
  const samples = [];
  return {
    observeAction(sample) {
      samples.push(sample);
    },
    snapshot() {
      return {
        counts: {
          success: samples.filter((s) => s.ok).length,
          failure: samples.filter((s) => !s.ok).length,
          fallback: samples.filter((s) => s.fallback_used).length,
        },
        by_path: {},
      };
    },
  };
}

test("tracked action uses compact lifecycle and trims payload preview for lightweight actions", async () => {
  const actionQueue = makeActionQueue();
  const store = makeStore();
  const metrics = makeMetrics();
  const runTrackedAction = createTrackedActionRunner({
    actionQueue,
    store,
    metrics,
    nativeAdapter: {
      async execute() {
        return { ok: true };
      },
    },
    router: {
      async route() {
        return {
          ok: true,
          adapter: "coordinator",
          path_mode: "local-module",
          route_mode: "coordinator-local",
          route_reason: "coordinator-only action",
          result: { text: "ok" },
        };
      },
    },
  });

  const out = await runTrackedAction({
    team: { team_name: "delta" },
    action: "wake",
    payload: {
      team_name: "delta",
      session_id: "abcd1234",
      message: "wake " + "x".repeat(1200),
    },
    routeMode: "router",
  });

  assert.equal(out.ok, true);
  assert.equal(store.events.queued, 0);
  assert.equal(store.events.started, 1);
  assert.equal(store.events.completed, 1);
  assert.equal(Boolean(out.orchestration?.compact_lifecycle), true);
  assert.equal((out.orchestration?.payload_preview_trimmed_bytes || 0) > 0, true);

  const record = actionQueue.records.get(out.action_id);
  assert.equal(record.state, "done");
  assert.match(String(record.payload_preview?.message || ""), /\[trimmed:/);
  assert.equal(
    (store.events.metrics?.orchestration?.avg_lifecycle_events_per_action || 0) >=
      1,
    true,
  );
});

test("native-direct tracked action skips non-retryable fallback loops", async () => {
  const actionQueue = makeActionQueue();
  const store = makeStore();
  const metrics = makeMetrics();
  let coordinatorFallbackCalls = 0;
  const runTrackedAction = createTrackedActionRunner({
    actionQueue,
    store,
    metrics,
    nativeAdapter: {
      async execute() {
        return {
          ok: false,
          error: { code: "approval_required", message: "waiting for approval" },
        };
      },
    },
    router: {
      coordinator: {
        async execute() {
          coordinatorFallbackCalls += 1;
          return { ok: true };
        },
      },
      async route() {
        return { ok: true };
      },
    },
  });

  const out = await runTrackedAction({
    team: { team_name: "delta", policy: {} },
    action: "message",
    payload: { team_name: "delta", recipient: "worker", content: "hello" },
    routeMode: "native-direct",
    nativeHttpAction: "native-send-message",
  });

  assert.equal(out.ok, false);
  assert.equal(out.fallback_used, false);
  assert.equal(out.fallback_skipped, true);
  assert.equal(coordinatorFallbackCalls, 0);
  assert.equal(out.orchestration?.fallback_skipped, 1);
});

test("batch triage deduplicates repeated safe interrupts", async () => {
  let trackedCalls = 0;
  const store = makeStore();
  store.snapshot = { alerts: [] };
  const runBatchTriage = createBatchTriageRunner({
    store,
    findTeam() {
      return { team_name: "delta", policy: {} };
    },
    buildTeamInterrupts() {
      return [
        { id: "approval:1", kind: "approval", safe_auto: true, task_id: "W1" },
        { id: "approval:2", kind: "approval", safe_auto: true, task_id: "W1" },
        { id: "approval:3", kind: "approval", safe_auto: true, task_id: "W2" },
      ];
    },
    async runTrackedAction() {
      trackedCalls += 1;
      return { ok: true, action_id: `A${trackedCalls}`, adapter: "coordinator", path_mode: "local-module" };
    },
  });

  const out = await runBatchTriage({
    teamName: "delta",
    op: "approve_all_safe",
    confirm: true,
  });

  assert.equal(out.ok, true);
  assert.equal(out.summary.selected_interrupts, 2);
  assert.equal(out.summary.deduped_interrupts, 1);
  assert.equal(trackedCalls, 2);
});
