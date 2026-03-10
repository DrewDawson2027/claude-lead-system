#!/usr/bin/env node
/**
 * Workflow Benchmark
 *
 * Times end-to-end coordination workflow cycles:
 *   1. Policy classification (dispatch vs. task route)
 *   2. Execution path selection (chooseExecutionPath)
 *   3. Priority aging (applyPriorityAging)
 *   4. Queue policy application (applyQueuePolicy)
 *   5. Combined dispatch-cycle throughput
 *
 * Exits 1 if any scenario exceeds its regression threshold.
 *
 * Usage: node bench/workflow-benchmark.mjs
 */

import { classifyAction, chooseExecutionPath, applyPriorityAging, applyQueuePolicy } from '../sidecar/core/policy-engine.js';

const ITERATIONS = Math.max(1, Number(process.env.BENCH_ITERATIONS || 200));

/* ── helpers ─────────────────────────────────────────────────── */

function nowMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

function measure(label, fn, iterations = ITERATIONS) {
  for (let i = 0; i < 10; i++) fn(0);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = nowMs();
    fn(i);
    samples.push(nowMs() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    avg_ms: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(4),
    p50_ms: +samples[Math.floor(samples.length * 0.5)].toFixed(4),
    p95_ms: +samples[Math.floor(samples.length * 0.95)].toFixed(4),
    p99_ms: +samples[Math.floor(samples.length * 0.99)].toFixed(4),
    sample_size: iterations,
  };
}

/* ── fixture data ────────────────────────────────────────────── */

const DISPATCH_ACTION = { tool: 'dispatch', input: { team_name: 'bench-team', agent_name: 'worker-1' } };
const TASK_ACTION = { tool: 'coord_create_task', input: { team_name: 'bench-team', title: 'bench task' } };
const MOCK_TEAM = {
  name: 'bench-team',
  policy: { mode: 'simple', max_agents: 5, budget_mode: 'off' },
  members: Array.from({ length: 5 }, (_, i) => ({
    name: `worker-${i}`,
    status: i < 3 ? 'active' : 'idle',
    task_count: i,
  })),
};

const MOCK_QUEUE = Array.from({ length: 20 }, (_, i) => ({
  id: `task-${i}`,
  priority: Math.floor(Math.random() * 3),
  created_at: Date.now() - i * 60000,
  status: 'pending',
}));

/* ── regression gates (p95 max ms) ──────────────────────────── */

const GATES = {
  classify_dispatch: 0.05,
  classify_task: 0.05,
  choose_path: 0.1,
  priority_aging: 0.5,
  queue_policy: 0.5,
  dispatch_cycle: 0.5,
};

/* ── run scenarios ───────────────────────────────────────────── */

const results = [];
let failed = false;

results.push(measure('classify_dispatch', () => classifyAction(DISPATCH_ACTION)));
results.push(measure('classify_task', () => classifyAction(TASK_ACTION)));
results.push(measure('choose_path', () => chooseExecutionPath(DISPATCH_ACTION, MOCK_TEAM)));
results.push(measure('priority_aging', () => applyPriorityAging([...MOCK_QUEUE])));
results.push(measure('queue_policy', () => applyQueuePolicy([...MOCK_QUEUE], MOCK_TEAM.policy)));
results.push(
  measure('dispatch_cycle', () => {
    const cls = classifyAction(DISPATCH_ACTION);
    const path = chooseExecutionPath(DISPATCH_ACTION, MOCK_TEAM);
    applyQueuePolicy([...MOCK_QUEUE], MOCK_TEAM.policy);
    return { cls, path };
  })
);

/* ── output + verdict ────────────────────────────────────────── */

console.log('\nWorkflow Benchmark Results');
console.log('══════════════════════════════════════════════════════');
for (const r of results) {
  const gate = GATES[r.label];
  const pass = r.p95_ms <= gate;
  if (!pass) failed = true;
  const status = pass ? '  PASS' : '  FAIL';
  console.log(`${status}  ${r.label.padEnd(20)} p95=${r.p95_ms.toFixed(4)}ms  gate=${gate}ms`);
}
console.log('══════════════════════════════════════════════════════\n');

if (failed) {
  console.error('workflow-benchmark: REGRESSION DETECTED — see above');
  process.exit(1);
}
console.log('workflow-benchmark: OK');
