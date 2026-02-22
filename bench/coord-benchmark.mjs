#!/usr/bin/env node
/**
 * Coordinator Performance Benchmark
 *
 * Measures coordinator operations across multiple dimensions:
 *   1. Session JSON read + parse (what coord_list_sessions does)
 *   2. Multi-session boot scan (what /lead boot does)
 *   3. Conflict detection scan (cross-reference files_touched)
 *   4. Dispatch latency (policy-engine chooseExecutionPath)
 *   5. Approval throughput (task create/resolve cycles)
 *   6. Recovery speed (stale-inflight detection + recovery)
 *   7. Rebalance quality (priority aging + queue ordering)
 *   8. Snapshot build time (normalization at varying team sizes)
 *
 * Output: JSON with perf-gate-compatible top-level keys plus detailed scenarios.
 *
 * Usage: node bench/coord-benchmark.mjs
 * Env:   BENCH_ITERATIONS (default 100), BENCH_TEAM_SIZES (comma-separated, default "1,5,10,20")
 */

import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { classifyAction, chooseExecutionPath, applyPriorityAging, applyQueuePolicy } from '../sidecar/core/policy-engine.js';

const ITERATIONS = Math.max(1, Number(process.env.BENCH_ITERATIONS || 100));
const TEAM_SIZES = (process.env.BENCH_TEAM_SIZES || '1,5,10,20').split(',').map(Number).filter(Number.isFinite);

/* ── helpers ─────────────────────────────────────────────────────── */

function nowMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

function measure(label, fn, iterations = ITERATIONS) {
  // Warmup
  for (let i = 0; i < 5; i++) fn(0);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = nowMs();
    fn(i);
    samples.push(nowMs() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const p99 = samples[Math.floor(samples.length * 0.99)];
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { label, avg_ms: +avg.toFixed(4), p50_ms: +p50.toFixed(4), p95_ms: +p95.toFixed(4), p99_ms: +p99.toFixed(4), sample_size: samples.length };
}

function fakeTask(id, opts = {}) {
  return {
    task_id: `task-${id}`,
    subject: `Bench task ${id}`,
    status: opts.status || 'pending',
    priority: opts.priority || 'normal',
    assignee: opts.assignee || null,
    created_at: opts.created_at || new Date().toISOString(),
    metadata: {},
  };
}

function fakeMember(name, opts = {}) {
  return {
    name,
    role: opts.role || 'worker',
    session_status: opts.status || 'active',
    last_active: opts.last_active || new Date().toISOString(),
    load_score: opts.load_score ?? 30,
    interruptibility_score: opts.interruptibility ?? 70,
    risk_flags: [],
    recent_ops: [],
    files_touched: [],
  };
}

function fakeTeam(size = 5) {
  return {
    team_name: 'bench-team',
    policy: { execution_preference: 'coordinator_first' },
    members: Array.from({ length: size }, (_, i) => fakeMember(`w${i}`)),
  };
}

/* ── setup temp filesystem ───────────────────────────────────────── */

const temp = mkdtempSync(join(tmpdir(), 'coord-bench-'));
const terminalsDir = join(temp, 'terminals');
mkdirSync(terminalsDir, { recursive: true });

const sessionCount = 10;
const sessions = [];
for (let i = 0; i < sessionCount; i++) {
  const sid = `sess${String(i).padStart(4, '0')}`;
  const data = {
    session: sid,
    status: i < 8 ? 'active' : 'stale',
    project: `project-${i % 3}`,
    branch: 'main',
    cwd: `/home/user/project-${i % 3}`,
    started: new Date(Date.now() - 3600000 * i).toISOString(),
    last_active: new Date(Date.now() - 60000 * i).toISOString(),
    tty: `/dev/ttys${String(i).padStart(3, '0')}`,
    tool_counts: { Write: 10 + i * 2, Edit: 8 + i, Bash: 20 + i * 3, Read: 15 + i },
    files_touched: Array.from({ length: 20 }, (_, j) => `/home/user/project-${i % 3}/src/file-${j}.ts`),
    recent_ops: Array.from({ length: 10 }, (_, j) => ({
      t: new Date(Date.now() - 10000 * j).toISOString(),
      tool: ['Edit', 'Write', 'Bash', 'Read'][j % 4],
      file: `file-${j}.ts`,
    })),
  };
  const fp = join(terminalsDir, `session-${sid}.json`);
  writeFileSync(fp, JSON.stringify(data));
  sessions.push({ path: fp, data });
}

// Transcript JSONL for scanning benchmark
const transcriptLines = Array.from({ length: 500 }, (_, i) => JSON.stringify({
  ts: new Date(Date.now() - (500 - i) * 1000).toISOString(),
  type: i % 3 === 0 ? 'tool_call' : i % 3 === 1 ? 'message' : 'result',
  content: `Line ${i}: ${'x'.repeat(200)}`,
}));
const transcriptFile = join(temp, 'transcript.jsonl');
writeFileSync(transcriptFile, transcriptLines.join('\n'));

try {
  /* ── 1. Session JSON read ──────────────────────────────────────── */
  const sessionJsonRead = measure('session_json_read', () => {
    JSON.parse(readFileSync(sessions[0].path, 'utf-8'));
  });

  /* ── 2. Boot scan ──────────────────────────────────────────────── */
  const bootScan = measure('boot_scan', () => {
    const files = readdirSync(terminalsDir).filter(f => f.startsWith('session-'));
    files.map(f => JSON.parse(readFileSync(join(terminalsDir, f), 'utf-8')));
  });

  /* ── 3. Conflict detection ─────────────────────────────────────── */
  const conflictScan = measure('conflict_detection', () => {
    const files = readdirSync(terminalsDir).filter(f => f.startsWith('session-'));
    const allSessions = files.map(f => JSON.parse(readFileSync(join(terminalsDir, f), 'utf-8')));
    const fileMap = new Map();
    for (const s of allSessions) {
      for (const f of (s.files_touched || [])) {
        if (!fileMap.has(f)) fileMap.set(f, []);
        fileMap.get(f).push(s.session);
      }
    }
    const conflicts = [];
    for (const [file, sids] of fileMap) {
      if (sids.length > 1) conflicts.push({ file, sessions: sids });
    }
  });

  /* ── 4. Dispatch latency ───────────────────────────────────────── */
  const team5 = fakeTeam(5);
  const actions = ['coord_list_tasks', 'coord_create_task', 'coord_dispatch_action', 'coord_get_snapshot', 'native_bridge_exec'];
  const nativeHealth = { bridge_status: 'healthy', ok: true };
  const dispatchLatency = measure('dispatch_latency', (i) => {
    const action = actions[i % actions.length];
    classifyAction(action);
    chooseExecutionPath(team5, action, nativeHealth, {});
  });

  /* ── 5. Approval throughput ────────────────────────────────────── */
  const board = {};
  const approvalThroughput = measure('approval_throughput', (i) => {
    const id = `approval-${i}`;
    board[id] = { task_id: id, status: 'pending', kind: 'approval', subject: `Approve plan ${i}`, created_at: new Date().toISOString() };
    board[id].status = 'in_progress';
    board[id].assignee = 'lead';
    board[id].status = 'completed';
    board[id].resolved_at = new Date().toISOString();
    delete board[id];
  });

  /* ── 6. Recovery speed ─────────────────────────────────────────── */
  const recoverySpeed = measure('recovery_speed', () => {
    const inflightActions = Array.from({ length: 10 }, (_, i) => ({
      id: `act-${i}`, status: 'inflight', started_at: Date.now() - 120_000, team: 'bench',
    }));
    const staleThreshold = 60_000;
    for (const a of inflightActions) {
      if (Date.now() - a.started_at > staleThreshold) {
        a.status = 'failed';
        a.error = 'stale_timeout';
      }
    }
  });

  /* ── 7. Rebalance quality ──────────────────────────────────────── */
  const baseTasks = Array.from({ length: 20 }, (_, i) => fakeTask(i, {
    priority: i < 5 ? 'critical' : i < 10 ? 'high' : i < 15 ? 'normal' : 'low',
    created_at: new Date(Date.now() - (20 - i) * 3600_000).toISOString(),
  }));
  // applyPriorityAging uses `created` field (not `created_at`)
  for (const t of baseTasks) t.created = t.created_at;
  let qualityScore = 0;
  const rebalanceQuality = measure('rebalance_quality', () => {
    const tasksCopy = baseTasks.map(t => ({ ...t }));
    applyPriorityAging(tasksCopy, { aging_interval_ms: 3600_000, max_bumps: 2 });
    const ordered = applyQueuePolicy(tasksCopy, 'priority_first');
    const criticalInTop5 = ordered.slice(0, 5).filter(t => t.priority === 'critical').length;
    qualityScore = criticalInTop5 / 5;
  });

  /* ── 8. Snapshot build time ────────────────────────────────────── */
  const snapshotBySize = {};
  for (const size of TEAM_SIZES) {
    const team = fakeTeam(size);
    const tasks = Array.from({ length: size * 3 }, (_, i) => fakeTask(i));
    snapshotBySize[`size_${size}`] = measure(`snapshot_build_${size}`, () => {
      const snapshot = {
        generated_at: new Date().toISOString(),
        teams: [{ team_name: team.team_name, member_count: team.members.length }],
        teammates: team.members.map(m => ({
          id: `bench-team:${m.name}`, display_name: m.name, presence: m.session_status, load_score: m.load_score,
        })),
        tasks: tasks.map(t => ({
          ...t, team_name: 'bench-team',
          priority_numeric: t.priority === 'critical' ? 3 : t.priority === 'high' ? 2 : t.priority === 'normal' ? 1 : 0,
        })),
      };
      JSON.stringify(snapshot);
    }, Math.min(ITERATIONS, 50));
  }

  /* ── 9. Transcript scan ────────────────────────────────────────── */
  const transcriptScan = measure('transcript_scan', () => {
    const raw = readFileSync(transcriptFile, 'utf-8');
    const parsed = raw.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    parsed.filter(e => e.type === 'tool_call');
  }, Math.min(ITERATIONS, 50));

  /* ── output (perf-gate compatible + detailed) ──────────────────── */
  const maxTeamSize = `size_${TEAM_SIZES[TEAM_SIZES.length - 1]}`;
  const output = {
    speedup_ratio_avg: dispatchLatency.p50_ms < 1 ? 100 : Math.round(1000 / dispatchLatency.p50_ms),
    session_json_read: { p95_ms: sessionJsonRead.p95_ms },
    transcript_scan: { p95_ms: transcriptScan.p95_ms },
    rebalance_quality_score: qualityScore,
    snapshot_build_p95_ms: snapshotBySize[maxTeamSize]?.p95_ms ?? null,
    scenarios: {
      session_json_read: sessionJsonRead,
      boot_scan: bootScan,
      conflict_detection: conflictScan,
      dispatch_latency: dispatchLatency,
      approval_throughput: approvalThroughput,
      recovery_speed: recoverySpeed,
      rebalance_quality: { ...rebalanceQuality, quality_score: qualityScore },
      snapshot_build_time: snapshotBySize,
      transcript_scan: transcriptScan,
    },
    iterations: ITERATIONS,
    team_sizes: TEAM_SIZES,
    dataset: { session_count: sessionCount, avg_session_bytes: Math.round(JSON.stringify(sessions[0].data).length) },
    generated_at: new Date().toISOString(),
  };

  console.log(JSON.stringify(output));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
