#!/usr/bin/env node
import http from 'http';
import { URL } from 'url';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { resolve as pathResolve } from 'path';
import { randomBytes } from 'crypto';
import { sidecarPaths } from '../core/paths.js';
import { ensureDirs, writeJSON, readJSON, readJSONL, fileExists, writeJSON as writeJsonFile, appendJSONL } from '../core/fs-utils.js';
import { SidecarStateStore } from '../core/state-store.js';
import { HookStreamAdapter } from '../adapters/hook-stream-adapter.js';
import { CoordinatorAdapter } from '../adapters/coordinator-adapter.js';
import { NativeTeamAdapter } from '../adapters/native-team-adapter.js';
import { ActionRouter } from '../core/action-router.js';
import { buildSidecarSnapshot } from './snapshot-builder.js';
import { ActionQueue } from '../native/action-queue.js';
import { MetricsTracker } from '../native/metrics.js';
import { findStuckBridgeRequests, sweepBridgeQueues } from '../native/bridge-protocol.js';
import { getInterruptWeights, interruptPriorityScored, applyPriorityAging, shouldAutoRebalance } from '../core/policy-engine.js';
import { buildComparisonReport } from './report-builder.js';
import { CURRENT_SCHEMA_VERSION, migrateBundle, validateSchemaVersion, dryRunMigration, migrations } from '../core/schema.js';
import { diffSnapshots as snapshotDiff, replayTimeline, buildTimelineReport, loadSnapshotHistory } from '../core/snapshot-diff.js';
import { createCheckpoint, listCheckpoints, restoreCheckpoint, rotateCheckpoints } from '../core/checkpoint.js';
import { rebuildFromTimeline, consistencyCheck } from '../core/event-replay.js';
import { repairJSON, repairJSONL, scanForCorruption } from '../core/repair.js';
import { createPreOpBackup, listBackups, restoreFromBackup } from '../core/pre-op-backup.js';
import { lockMetrics } from '../core/lock-metrics.js';
import { checkTerminalHealth, suggestRecovery } from '../core/terminal-health.js';
import { validateHooks, runHookSelftest } from '../core/hook-watchdog.js';

const DASHBOARD_HTML = readFileSafe(new URL('../ui-web/index.html', import.meta.url));
const DASHBOARD_JS = readFileSafe(new URL('../ui-web/app.js', import.meta.url));

function readFileSafe(url) {
  try { return readFileSync(url, 'utf-8'); } catch { return ''; }
}

function parseArgs(argv) {
  const out = { port: Number(process.env.LEAD_SIDECAR_PORT || 0) || 0, open: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]) || 0;
    else if (a === '--open') out.open = true;
    else if (a === '--safe-mode') out.safeMode = true;
  }
  return out;
}

function ensureApiToken(paths) {
  if (fileExists(paths.apiTokenFile)) {
    return String(readJSON(paths.apiTokenFile)?.token || '').trim() || null;
  }
  const token = randomBytes(24).toString('hex');
  writeJsonFile(paths.apiTokenFile, { token, created_at: new Date().toISOString() });
  return token;
}

function ensureCsrfToken(paths) {
  if (fileExists(paths.csrfTokenFile)) {
    return String(readJSON(paths.csrfTokenFile)?.token || '').trim() || null;
  }
  const token = randomBytes(24).toString('hex');
  writeJsonFile(paths.csrfTokenFile, { token, created_at: new Date().toISOString() });
  return token;
}

function writeRuntimeFiles(paths, server) {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : null;
  writeJSON(paths.lockFile, { pid: process.pid, started_at: new Date().toISOString() });
  writeJSON(paths.portFile, { port, pid: process.pid, updated_at: new Date().toISOString() });
  return port;
}

function sameOriginAllowed(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function baseHeaders(req = null) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  const origin = String(req?.headers?.origin || '');
  if (origin && sameOriginAllowed(req)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Sidecar-CSRF';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  }
  return headers;
}

function sendJson(res, status, payload, req = null) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body, req = null) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(body);
}

function sendHtml(res, status, body, req = null) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(body);
}

function sendJs(res, status, body, req = null) {
  res.writeHead(status, {
    'Content-Type': 'application/javascript; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(body);
}

function sseBroadcast(clients, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch {}
  }
}

async function readBody(req, { limitBytes = 256 * 1024 } = {}) {
  return new Promise((resolve) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limitBytes) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return resolve({ __parse_error: 'payload_too_large' });
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({ __parse_error: 'invalid_json' }); }
    });
    req.on('error', () => resolve(tooLarge ? { __parse_error: 'payload_too_large' } : {}));
  });
}

function requireApiAuth(req, res, apiToken) {
  if (process.env.LEAD_SIDECAR_REQUIRE_TOKEN !== '1') return true;
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${apiToken}`) return true;
  sendJson(res, 401, { error: 'Unauthorized' }, req);
  return false;
}

function requireSameOrigin(req, res) {
  if (sameOriginAllowed(req)) return true;
  sendJson(res, 403, { error: 'Origin not allowed' }, req);
  return false;
}

function requireCsrf(req, res, csrfToken) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const auth = String(req.headers.authorization || '');
  if (auth) return true;
  const csrf = String(req.headers['x-sidecar-csrf'] || '');
  if (csrf && csrf === csrfToken) return true;
  sendJson(res, 403, { error: 'CSRF validation failed' }, req);
  return false;
}

function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const buckets = new Map();
  return {
    check(key) {
      const now = Date.now();
      const b = buckets.get(key);
      if (!b || now - b.start > windowMs) {
        buckets.set(key, { start: now, count: 1 });
        return { ok: true, remaining: max - 1 };
      }
      b.count += 1;
      if (b.count > max) {
        return { ok: false, retry_after_ms: Math.max(0, windowMs - (now - b.start)) };
      }
      return { ok: true, remaining: max - b.count };
    },
    gc() {
      const now = Date.now();
      for (const [k, v] of buckets.entries()) {
        if (now - v.start > windowMs * 2) buckets.delete(k);
      }
    },
  };
}

function trimLongStrings(obj, maxLen = 512) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.length > maxLen ? `${obj.slice(0, maxLen)}…` : obj;
  if (Array.isArray(obj)) return obj.map((x) => trimLongStrings(x, maxLen));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = trimLongStrings(v, maxLen);
    return out;
  }
  return obj;
}

function latestJsonFileName(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().pop() || null;
  } catch {
    return null;
  }
}

const BODY_ALLOWLISTS = [
  { rx: /^\/native\/probe$/, keys: [] },
  { rx: /^\/native\/bridge\/ensure$/, keys: ['team_name', 'directory'] },
  { rx: /^\/native\/bridge\/validate$/, keys: ['team_name', 'directory', 'timeout_ms', 'timeoutMs', 'simulate'] },
  { rx: /^\/native\/actions\/[^/]+$/, keys: ['team_name', 'agent', 'task', 'message', 'metadata', 'goal', 'members', 'force_path_mode', 'timeout_ms', 'model'] },
  { rx: /^\/actions\/[^/]+\/retry$/, keys: [] },
  { rx: /^\/actions\/[^/]+\/fallback$/, keys: ['force_path'] },
  { rx: /^\/teams\/[^/]+\/rebalance$/, keys: ['apply', 'force_path', 'limit', 'dispatch_next', 'include_in_progress'] },
  { rx: /^\/teams\/[^/]+\/rebalance-explain$/, keys: ['limit', 'assignee'] },
  { rx: /^\/teams\/[^/]+\/actions\/[^/]+$/, keys: ['team_name', 'subject', 'prompt', 'priority', 'role_hint', 'role', 'directory', 'force_path', 'to', 'content', 'message', 'task_id', 'feedback', 'session_id', 'target_name', 'from', 'files', 'blocked_by', 'acceptance_criteria', 'metadata', 'agent'] },
  { rx: /^\/teams\/[^/]+\/batch-triage$/, keys: ['op', 'confirm', 'message', 'limit'] },
  { rx: /^\/dispatch$/, keys: ['team_name', 'subject', 'prompt', 'directory', 'priority', 'role', 'files', 'blocked_by', 'metadata', 'force_path'] },
  { rx: /^\/route\/simulate$/, keys: ['team_name', 'action', 'payload'] },
  { rx: /^\/open-dashboard$/, keys: [] },
  { rx: /^\/maintenance\/run$/, keys: ['source'] },
  { rx: /^\/diagnostics\/export$/, keys: ['label'] },
  { rx: /^\/teams\/[^/]+\/interrupt-priorities$/, keys: ['approval', 'bridge', 'stale', 'conflict', 'budget', 'error', 'warn', 'default'] },
  { rx: /^\/ui\/preferences$/, keys: [] },
  { rx: /^\/checkpoints\/create$/, keys: ['label'] },
  { rx: /^\/checkpoints\/restore$/, keys: ['file'] },
  { rx: /^\/repair\/scan$/, keys: [] },
  { rx: /^\/repair\/fix$/, keys: ['path', 'dry_run'] },
  { rx: /^\/events\/rebuild-check$/, keys: ['from_ts'] },
  { rx: /^\/backups\/restore$/, keys: ['file'] },
  { rx: /^\/health\/hooks\/selftest$/, keys: [] },
  { rx: /^\/task-templates$/, keys: ['id', 'name', 'subject_template', 'prompt_template', 'role_hint', 'priority', 'quality_gates', 'acceptance_criteria'] },
];

function validateBody(pathname, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: true };
  if (body.__parse_error) return { ok: false, status: body.__parse_error === 'payload_too_large' ? 413 : 400, error: body.__parse_error };
  const rule = BODY_ALLOWLISTS.find((r) => r.rx.test(pathname));
  if (rule) {
    const badKeys = Object.keys(body).filter((k) => !rule.keys.includes(k));
    if (badKeys.length) return { ok: false, status: 400, error: `Unexpected keys: ${badKeys.join(', ')}` };
  }
  const stack = [body];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    for (const v of Object.values(cur)) {
      if (typeof v === 'string' && v.length > 100_000) return { ok: false, status: 413, error: 'String field too large' };
      if (Array.isArray(v)) {
        if (v.length > 1000) return { ok: false, status: 413, error: 'Array field too large' };
        stack.push(...v);
      } else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return { ok: true };
}

function findTeam(snapshot, teamName) {
  return (snapshot.teams || []).find((t) => t.team_name === teamName) || { team_name: teamName, execution_path: 'hybrid', policy: {} };
}

function buildActionPayload(teamName, action, body) {
  if (action === 'dispatch') return { team_name: teamName, ...body };
  if (action === 'queue-task') return { team_name: teamName, ...body };
  if (action === 'assign-next') return { team_name: teamName, ...body };
  if (action === 'rebalance') return { team_name: teamName, ...body };
  if (action === 'message') return { from: body.from || 'sidecar', target_name: body.target_name, to: body.to, content: body.content, priority: body.priority, team_name: teamName };
  if (action === 'directive') return { from: body.from || 'sidecar', to: body.to, content: body.content, priority: body.priority, team_name: teamName };
  if (action === 'approve-plan') return { task_id: body.task_id, message: body.message, team_name: teamName };
  if (action === 'reject-plan') return { task_id: body.task_id, feedback: body.feedback, team_name: teamName };
  if (action === 'wake') return { session_id: body.session_id, message: body.message || 'Lead sidecar wake request', team_name: teamName };
  return { team_name: teamName, ...body };
}

function interruptPriority(code = '', severity = 'info', weights = null) {
  if (weights) return interruptPriorityScored(code, severity, weights);
  // Legacy fallback
  const c = String(code || '');
  if (c.includes('waiting_for_plan_approval') || c.includes('approval')) return 100;
  if (c.includes('bridge_') || c.includes('native')) return 90;
  if (c.includes('stale')) return 80;
  if (c.includes('conflict')) return 70;
  if (c.includes('budget')) return 60;
  if (severity === 'error') return 50;
  if (severity === 'warn') return 40;
  return 10;
}

function buildTeamInterrupts({ snapshot, teamName, teamPolicy = null }) {
  const teammates = (snapshot.teammates || []).filter((t) => t.team_name === teamName);
  const alerts = (snapshot.alerts || []).filter((a) => !a.team_name || a.team_name === teamName);
  const weights = getInterruptWeights(teamPolicy || {});
  const interrupts = [];

  for (const m of teammates) {
    if (m.presence === 'waiting_for_plan_approval') {
      interrupts.push({
        id: `approval:${m.id}`,
        kind: 'approval',
        severity: 'warn',
        code: 'waiting_for_plan_approval',
        teammate_id: m.id,
        teammate_name: m.display_name,
        task_id: m.worker_task_id || m.current_task_ref || null,
        title: `${m.display_name} waiting for plan approval`,
        message: `Approve or reject plan for ${m.display_name}`,
        suggested_actions: ['approve-plan', 'reject-plan'],
        safe_auto: !(m.risk_flags || []).includes('conflict_risk') && !(m.risk_flags || []).includes('over_budget_risk'),
        created_at: m.last_active || null,
      });
    }
    if (m.presence === 'stale') {
      interrupts.push({
        id: `stale:${m.id}`,
        kind: 'stale',
        severity: 'warn',
        code: 'stale_worker',
        teammate_id: m.id,
        teammate_name: m.display_name,
        session_id: m.session_id || null,
        title: `${m.display_name} is stale`,
        message: `Wake ${m.display_name} or send directive`,
        suggested_actions: ['wake', 'directive'],
        safe_auto: Boolean(m.session_id),
        created_at: m.last_active || null,
      });
    }
    for (const rf of (m.risk_flags || [])) {
      if (!['conflict_risk', 'over_budget_risk'].includes(rf)) continue;
      interrupts.push({
        id: `${rf}:${m.id}`,
        kind: 'risk',
        severity: 'warn',
        code: rf,
        teammate_id: m.id,
        teammate_name: m.display_name,
        title: `${m.display_name} ${rf.replaceAll('_', ' ')}`,
        message: `${m.display_name} has ${rf.replaceAll('_', ' ')}`,
        suggested_actions: ['view-detail', 'directive'],
        safe_auto: false,
        created_at: m.last_active || null,
      });
    }
  }

  for (const a of alerts) {
    interrupts.push({
      id: `alert:${a.action_id || a.request_id || a.ts || Math.random().toString(36).slice(2)}`,
      kind: 'alert',
      severity: a.level || 'info',
      code: a.code || 'alert',
      title: a.code || 'alert',
      message: a.message || '',
      action_id: a.action_id || null,
      request_id: a.request_id || null,
      suggested_actions: a.code === 'bridge_stuck_request' ? ['bridge-validate', 'bridge-ensure'] : ['view-action'],
      safe_auto: false,
      created_at: a.ts || null,
    });
  }

  interrupts.sort((a, b) => {
    const pa = interruptPriority(a.code, a.severity, weights);
    const pb = interruptPriority(b.code, b.severity, weights);
    if (pb !== pa) return pb - pa;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return interrupts.map((i, idx) => ({ ...i, priority_score: interruptPriority(i.code, i.severity, weights), rank: idx + 1 }));
}

function mapNativeHttpAction(httpAction) {
  const a = String(httpAction || '');
  if (a === 'team-create') return 'team-create';
  if (a === 'team-status') return 'team-status';
  if (a === 'send-message') return 'native-send-message';
  if (a === 'task') return 'native-task';
  return null;
}

export async function startSidecarServer(options = {}) {
  const args = { ...parseArgs(process.argv.slice(2)), ...options };
  const paths = sidecarPaths();
  ensureDirs([
    paths.root, paths.runtimeDir, paths.nativeRuntimeDir, paths.nativeBridgeRequestDir, paths.nativeBridgeResponseDir,
    paths.actionsRootDir, paths.actionsPendingDir, paths.actionsInflightDir, paths.actionsDoneDir, paths.actionsFailedDir,
    paths.stateDir, paths.logsDir, paths.diagnosticsDir,
  ]);
  const apiToken = ensureApiToken(paths);
  const csrfToken = ensureCsrfToken(paths);

  const store = new SidecarStateStore(paths);
  const actionQueue = new ActionQueue(paths);
  const metrics = new MetricsTracker();
  const coordinatorAdapter = new CoordinatorAdapter();
  const nativeAdapter = new NativeTeamAdapter({ paths, coordinatorAdapter, store });
  const router = new ActionRouter({ coordinatorAdapter, nativeAdapter, store });
  const clients = new Set();
  const rateLimiter = createRateLimiter({
    windowMs: Number(process.env.LEAD_SIDECAR_RATE_WINDOW_MS || 60_000),
    max: Number(process.env.LEAD_SIDECAR_RATE_LIMIT || 180),
  });
  const seenBridgeStuck = new Set();
  const SAFE_MODE = Boolean(args.safeMode);
  let lastCheckpointTime = 0;
  let sweepCount = 0;

  function maintenanceSweep({ source = 'periodic' } = {}) {
    const recovered = actionQueue.recoverStaleInflight(Number(process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS || 5 * 60_000));
    const actionGc = actionQueue.sweep({
      pendingMaxAgeMs: Number(process.env.LEAD_SIDECAR_PENDING_RETENTION_MS || 24 * 60 * 60_000),
      doneMaxAgeMs: Number(process.env.LEAD_SIDECAR_DONE_RETENTION_MS || 24 * 60 * 60_000),
      failedMaxAgeMs: Number(process.env.LEAD_SIDECAR_FAILED_RETENTION_MS || 7 * 24 * 60 * 60_000),
    });
    const bridgeGc = sweepBridgeQueues(paths, {
      requestMaxAgeMs: Number(process.env.LEAD_SIDECAR_BRIDGE_REQ_RETENTION_MS || 30 * 60_000),
      responseMaxAgeMs: Number(process.env.LEAD_SIDECAR_BRIDGE_RESP_RETENTION_MS || 30 * 60_000),
    });
    const stuck = findStuckBridgeRequests(paths, Number(process.env.LEAD_SIDECAR_BRIDGE_STUCK_MS || 30_000));
    for (const s of stuck) {
      if (seenBridgeStuck.has(s.request_id)) continue;
      seenBridgeStuck.add(s.request_id);
      store.raiseAlert({
        level: 'warn',
        code: 'bridge_stuck_request',
        message: `Bridge request ${s.request_id} stuck for ${s.age_ms}ms`,
        request_id: s.request_id,
        team_name: s.team_name || undefined,
      });
    }
    rateLimiter.gc();
    const report = { source, recovered_inflight: recovered.length, action_gc: actionGc, bridge_gc: bridgeGc, stuck_bridge_requests: stuck.length };
    if (recovered.length || actionGc.pending || actionGc.done || actionGc.failed || bridgeGc.requests || bridgeGc.responses || stuck.length) {
      store.emitTimeline({ type: 'maintenance.sweep', ...report });
    }
    // C4: Priority aging
    const snap = store.getSnapshot();
    const allTasks = snap.tasks || [];
    const aged = applyPriorityAging(allTasks, {});

    // C5: Auto-rebalance check
    let autoRebalanced = false;
    for (const teamEntry of (snap.teams || [])) {
      const autoConfig = teamEntry.policy?.auto_rebalance;
      if (!autoConfig?.enabled) continue;
      try {
        const teamSnap = buildSidecarSnapshot().teams?.find((t) => t.team_name === teamEntry.team_name);
        if (!teamSnap) continue;
        const check = shouldAutoRebalance(teamSnap, autoConfig);
        if (check.trigger) {
          const cooldownMs = autoConfig.cooldown_ms || 60000;
          const lastAutoKey = `_auto_rebalance_last_${teamEntry.team_name}`;
          const lastTime = store[lastAutoKey] || 0;
          if (Date.now() - lastTime > cooldownMs) {
            store[lastAutoKey] = Date.now();
            coordinatorAdapter.execute('rebalance', { team_name: teamEntry.team_name, apply: true }).catch(() => {});
            store.emitTimeline({ type: 'auto_rebalance.triggered', team_name: teamEntry.team_name, reason: check.reason, conditions: check.conditions_met });
            autoRebalanced = true;
          }
        }
      } catch {}
    }

    // D2: Persist metrics snapshot (throttled to once per 60s inside persistSnapshot)
    metrics.persistSnapshot(paths.metricsHistoryDir);

    // E1a: Periodic checkpoint (every 5 minutes)
    let checkpointed = false;
    if (Date.now() - lastCheckpointTime > 5 * 60_000) {
      try {
        createCheckpoint(paths, 'periodic');
        rotateCheckpoints(paths);
        lastCheckpointTime = Date.now();
        checkpointed = true;
      } catch {}
    }

    // E2b: Terminal health check
    let terminalHealth = null;
    try {
      terminalHealth = checkTerminalHealth(paths);
      if (terminalHealth.zombies.length || terminalHealth.dead_shells.length) {
        const suggestions = suggestRecovery(terminalHealth);
        store.raiseAlert({
          level: 'warn',
          code: 'terminal_health_issue',
          message: `Terminal health: ${terminalHealth.summary}`,
          findings: { zombies: terminalHealth.zombies.length, stale: terminalHealth.stale.length, dead_shells: terminalHealth.dead_shells.length },
          suggestions: suggestions.slice(0, 5),
        });
      }
    } catch {}

    // E2c: Hook validation (every 10 sweeps ≈ 150s)
    sweepCount++;
    if (sweepCount % 10 === 0) {
      try {
        const hookReport = validateHooks(paths.hooksDir);
        if (!hookReport.all_valid) {
          store.raiseAlert({
            level: 'warn',
            code: 'hook_validation_failure',
            message: `Hook validation: ${hookReport.hooks.filter(h => h.issues.length).map(h => h.name).join(', ')} have issues`,
            findings: hookReport.hooks.filter(h => h.issues.length),
          });
        }
      } catch {}
    }

    return { ...report, recovered, aged_tasks: aged.length, auto_rebalanced: autoRebalanced, checkpointed, terminal_health: terminalHealth?.summary || null };
  }

  function diagnosticsBundle(label = 'manual') {
    const snapshot = store.getSnapshot();
    const nativeBridgeStatus = readJSON(paths.nativeBridgeStatusFile);
    const nativeBridgeHeartbeat = readJSON(paths.nativeBridgeHeartbeatFile);
    const nativeBridgeValidation = readJSON(paths.nativeBridgeValidationFile);
    const bundle = {
      schema_version: CURRENT_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      label,
      process: { pid: process.pid, cwd: process.cwd() },
      runtime: {
        sidecar: readJSON(paths.lockFile),
        port: readJSON(paths.portFile),
        api_token_present: fileExists(paths.apiTokenFile),
        csrf_token_present: fileExists(paths.csrfTokenFile),
        action_counts: actionQueue.counts(),
      },
      native: {
        status: nativeBridgeStatus,
        heartbeat: nativeBridgeHeartbeat,
        validation: nativeBridgeValidation,
        capabilities: readJSON(paths.nativeCapabilitiesFile),
      },
      snapshot,
      actions: actionQueue.list(200),
      metrics: snapshot.metrics || metrics.snapshot(),
      lock_metrics: lockMetrics.snapshot(),
      terminal_health: checkTerminalHealth(paths),
    };
    const file = `${paths.diagnosticsDir}/diag-${Date.now()}.json`;
    writeJSON(file, trimLongStrings(bundle, 2048));
    try { appendJSONL(paths.logFile, { ts: new Date().toISOString(), type: 'diagnostics.export', file, label }); } catch {}
    return { ok: true, file, generated_at: bundle.generated_at, counts: bundle.runtime.action_counts };
  }

  let rebuilding = false;
  async function enrichDynamicState() {
    const nativeStatus = await nativeAdapter.getStatus().catch((err) => ({ adapter_ok: false, mode: 'unavailable', error: err.message }));
    store.setNativeCapabilities({
      ...(nativeStatus.native || { available: false, last_probe_error: nativeStatus.error || null }),
      validation: nativeStatus.bridge_validation || null,
    });
    if (nativeStatus.bridge) store.emitBridgeStatus(nativeStatus.bridge);
    store.setActionsRecent(actionQueue.list(50));
    store.setMetrics(metrics.snapshot());
  }

  async function rebuild(source = 'manual') {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const base = buildSidecarSnapshot();
      await enrichDynamicState();
      store.setSnapshot({
        ...base,
        native: store.getSnapshot().native,
        actions: store.getSnapshot().actions,
        alerts: store.getSnapshot().alerts,
        metrics: store.getSnapshot().metrics,
      });
      store.emitTimeline({ type: 'snapshot.rebuilt', source, generated_at: base.generated_at });
      // E2: Save snapshot to history (keep last 50)
      try {
        mkdirSync(paths.snapshotHistoryDir, { recursive: true });
        writeJSON(`${paths.snapshotHistoryDir}/snap-${Date.now()}.json`, store.getSnapshot());
        const histFiles = readdirSync(paths.snapshotHistoryDir).filter(f => f.startsWith('snap-')).sort();
        if (histFiles.length > 50) {
          for (const f of histFiles.slice(0, histFiles.length - 50)) {
            try { unlinkSync(`${paths.snapshotHistoryDir}/${f}`); } catch {}
          }
        }
      } catch {}
    } finally {
      rebuilding = false;
    }
  }

  async function runTrackedAction({ team, action, payload, routeMode = 'router', nativeHttpAction = null }) {
    const record = actionQueue.create({ team_name: team?.team_name || payload?.team_name || null, action, route_mode: routeMode, payload_preview: payload });
    store.emitActionQueued({ action_id: record.action_id, action, team_name: record.team_name, route_mode: routeMode });
    actionQueue.markStarted(record.action_id, {});
    store.emitActionStarted({ action_id: record.action_id, action, team_name: record.team_name, route_mode: routeMode });
    const start = Date.now();
    try {
      const routed = routeMode === 'native-direct'
        ? await nativeAdapter.execute(
          nativeHttpAction,
          { ...payload, correlation_id: record.action_id },
          { team, force_path_mode: payload?.force_path_mode || null },
        )
        : await router.route(team, action, { ...payload, correlation_id: record.action_id });
      const latency_ms = Date.now() - start;
      const wrapper = routeMode === 'native-direct'
        ? {
            ok: routed?.ok !== false,
            adapter: 'native',
            path_mode: routed.path_mode || 'ephemeral',
            reason: 'native direct action endpoint',
            fallback_plan: ['native-bridge', 'native-ephemeral', 'coordinator'],
            fallback_used: false,
            cost_estimate_class: routed.path_mode === 'bridge' ? 'medium' : 'high',
            latency_ms,
            result: routed,
          }
        : { ...routed, latency_ms: routed.latency_ms ?? latency_ms };

      const ok = wrapper.ok !== false;
      metrics.observeAction({
        latency_ms: wrapper.latency_ms,
        path_key: `${wrapper.adapter}:${wrapper.path_mode || 'unknown'}`,
        ok,
        fallback_used: Boolean(wrapper.fallback_used),
      });

      if (ok) {
        actionQueue.markCompleted(record.action_id, {
          adapter: wrapper.adapter,
          path_mode: wrapper.path_mode,
          latency_ms: wrapper.latency_ms,
          result_summary: wrapper.result?.text ? String(wrapper.result.text).slice(0, 1000) : wrapper.result,
          fallback_used: Boolean(wrapper.fallback_used),
          fallback_history: wrapper.fallback_used ? [wrapper.fallback_from || null].filter(Boolean) : [],
        });
        store.emitActionCompleted({ action_id: record.action_id, action, adapter: wrapper.adapter, path_mode: wrapper.path_mode, latency_ms: wrapper.latency_ms, fallback_used: wrapper.fallback_used });
      } else {
        actionQueue.markFailed(record.action_id, {
          adapter: wrapper.adapter,
          path_mode: wrapper.path_mode,
          latency_ms: wrapper.latency_ms,
          error: wrapper.error || wrapper.result?.error || null,
        });
        store.emitActionFailed({ action_id: record.action_id, action, adapter: wrapper.adapter, path_mode: wrapper.path_mode, latency_ms: wrapper.latency_ms, error: wrapper.error || wrapper.result?.error || null });
        store.raiseAlert({ level: 'warn', code: 'action_failed', message: `${action} failed`, action_id: record.action_id });
      }

      store.setActionsRecent(actionQueue.list(50));
      store.setMetrics(metrics.snapshot());
      return { ...wrapper, action_id: record.action_id };
    } catch (err) {
      const latency_ms = Date.now() - start;
      metrics.observeAction({ latency_ms, path_key: 'error', ok: false, fallback_used: false });
      actionQueue.markFailed(record.action_id, { latency_ms, error: { message: err.message } });
      store.emitActionFailed({ action_id: record.action_id, action, error: { message: err.message }, latency_ms });
      store.raiseAlert({ level: 'error', code: 'action_exception', message: `${action} exception: ${err.message}`, action_id: record.action_id });
      store.setActionsRecent(actionQueue.list(50));
      store.setMetrics(metrics.snapshot());
      throw err;
    }
  }

  async function runBatchTriage({ teamName, op, confirm = false, message = '', limit = 20 }) {
    if (!confirm) {
      return { ok: false, error: 'confirm=true required', results: [], summary: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 } };
    }
    const max = Math.max(1, Math.min(100, Number(limit || 20)));
    const team = findTeam(store.getSnapshot(), teamName);
    const interrupts = buildTeamInterrupts({ snapshot: store.getSnapshot(), teamName, teamPolicy: team?.policy });
    const results = [];
    let selected = [];

    if (op === 'approve_all_safe') {
      selected = interrupts.filter((i) => i.kind === 'approval' && i.safe_auto).slice(0, max);
      for (const it of selected) {
        if (!it.task_id) {
          results.push({ interrupt_id: it.id, ok: false, skipped: true, reason: 'missing task_id' });
          continue;
        }
        try {
          const team = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({
            team,
            action: 'approve-plan',
            payload: { team_name: teamName, task_id: it.task_id, message: message || 'Batch triage auto-approve' },
            routeMode: 'router',
          });
          results.push({ interrupt_id: it.id, ok: out.ok !== false, action_id: out.action_id || null, adapter: out.adapter, path_mode: out.path_mode, reason: out.reason || null });
        } catch (err) {
          results.push({ interrupt_id: it.id, ok: false, error: err.message });
        }
      }
    } else if (op === 'wake_all_stale') {
      selected = interrupts.filter((i) => i.kind === 'stale' && i.safe_auto && i.session_id).slice(0, max);
      for (const it of selected) {
        try {
          const team = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({
            team,
            action: 'wake',
            payload: { team_name: teamName, session_id: it.session_id, message: message || 'Batch triage wake (stale worker)' },
            routeMode: 'router',
          });
          results.push({ interrupt_id: it.id, ok: out.ok !== false, action_id: out.action_id || null, adapter: out.adapter, path_mode: out.path_mode, reason: out.reason || null });
        } catch (err) {
          results.push({ interrupt_id: it.id, ok: false, error: err.message });
        }
      }
    } else if (op === 'reject_all_risky') {
      selected = interrupts.filter((i) => i.kind === 'approval' && !i.safe_auto).slice(0, max);
      for (const it of selected) {
        if (!it.task_id) {
          results.push({ interrupt_id: it.id, ok: false, skipped: true, reason: 'missing task_id' });
          continue;
        }
        try {
          const team = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({
            team,
            action: 'reject-plan',
            payload: { team_name: teamName, task_id: it.task_id, feedback: message || 'Batch triage: rejected due to risk flags' },
            routeMode: 'router',
          });
          results.push({ interrupt_id: it.id, ok: out.ok !== false, action_id: out.action_id || null, adapter: out.adapter, path_mode: out.path_mode, reason: out.reason || null });
        } catch (err) {
          results.push({ interrupt_id: it.id, ok: false, error: err.message });
        }
      }
    } else if (op === 'dismiss_resolved') {
      // Clear alerts no longer in current snapshot state
      const currentInterrupts = buildTeamInterrupts({ snapshot: store.getSnapshot(), teamName, teamPolicy: findTeam(store.getSnapshot(), teamName)?.policy });
      const currentIds = new Set(currentInterrupts.map((i) => i.id));
      const staleAlerts = (store.getSnapshot().alerts || []).filter((a) => (!a.team_name || a.team_name === teamName));
      let dismissed = 0;
      const freshAlerts = (store.getSnapshot().alerts || []).filter((a) => {
        if (a.team_name && a.team_name !== teamName) return true;
        const matchId = `alert:${a.action_id || a.request_id || ''}`;
        if (!currentIds.has(matchId)) { dismissed += 1; return false; }
        return true;
      });
      store.snapshot.alerts = freshAlerts;
      results.push({ ok: true, dismissed });
    } else {
      return { ok: false, error: `unsupported op: ${op}`, results: [], summary: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 } };
    }

    const summary = {
      attempted: results.length,
      selected_interrupts: selected.length,
      succeeded: results.filter((r) => r.ok && !r.skipped).length,
      failed: results.filter((r) => r.ok === false && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    };
    return { ok: summary.failed === 0, team_name: teamName, op, results, summary };
  }

  await rebuild('boot');
  maintenanceSweep({ source: 'startup' });
  if (SAFE_MODE) store.emitTimeline({ type: 'startup.safe_mode', timestamp: new Date().toISOString() });

  const hookStream = new HookStreamAdapter(paths, (evt) => {
    store.emitTimeline({ type: 'filesystem.change', ...evt });
    rebuild(evt.source).catch(() => {});
  });
  hookStream.start();
  const maintenanceTimer = setInterval(() => {
    try { maintenanceSweep({ source: 'interval' }); } catch {}
  }, Number(process.env.LEAD_SIDECAR_MAINTENANCE_MS || 15_000));
  if (typeof maintenanceTimer.unref === 'function') maintenanceTimer.unref();

  store.on('snapshot', (snap) => {
    sseBroadcast(clients, 'team.updated', { teams: snap.teams || [], generated_at: snap.generated_at });
    sseBroadcast(clients, 'teammate.updated', { teammates: snap.teammates || [], generated_at: snap.generated_at });
    sseBroadcast(clients, 'task.updated', { tasks: snap.tasks || [], generated_at: snap.generated_at });
    sseBroadcast(clients, 'timeline.event', { latest: (snap.timeline || []).slice(-10), generated_at: snap.generated_at });
  });
  for (const evt of ['adapter.health', 'policy.alert', 'timeline.event', 'native.capabilities.updated', 'native.bridge.status', 'action.queued', 'action.started', 'action.completed', 'action.failed', 'alert.raised', 'metrics.updated']) {
    store.on(evt, (payload) => sseBroadcast(clients, evt, payload));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const snapshot = store.getSnapshot();

    if (req.method === 'OPTIONS') {
      if (!requireSameOrigin(req, res)) return;
      res.writeHead(204, baseHeaders(req));
      res.end();
      return;
    }
    if (!requireSameOrigin(req, res)) return;

    if (req.method === 'POST') {
      const rlKey = `${req.socket?.remoteAddress || 'local'}:${url.pathname}`;
      const rl = rateLimiter.check(rlKey);
      if (!rl.ok) return sendJson(res, 429, { error: 'Rate limit exceeded', retry_after_ms: rl.retry_after_ms }, req);
      if (!requireApiAuth(req, res, apiToken)) return;
      if (!requireCsrf(req, res, csrfToken)) return;
      // E2d: Safe mode — block mutation POST endpoints
      if (SAFE_MODE) {
        const safeModeBlocked = [
          /^\/dispatch$/, /^\/teams\/[^/]+\/actions\//, /^\/teams\/[^/]+\/batch-triage$/,
          /^\/teams\/[^/]+\/rebalance$/, /^\/native\/actions\//, /^\/native\/bridge\/ensure$/,
          /^\/native\/probe$/, /^\/maintenance\/run$/,
        ];
        if (safeModeBlocked.some(rx => rx.test(url.pathname))) {
          return sendJson(res, 503, { error: 'Server is in safe mode — mutation endpoints disabled' }, req);
        }
      }
    }
    // E2d: Safe mode — block PATCH endpoints
    if (SAFE_MODE && req.method === 'PATCH') {
      return sendJson(res, 503, { error: 'Server is in safe mode — mutation endpoints disabled' }, req);
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        generated_at: snapshot.generated_at,
        teams: (snapshot.teams || []).length,
        native: snapshot.native || null,
        safe_mode: SAFE_MODE,
      }, req);
    }
    if (req.method === 'GET' && url.pathname === '/metrics.json') {
      return sendJson(res, 200, snapshot.metrics || metrics.snapshot(), req);
    }
    if (req.method === 'GET' && url.pathname === '/metrics/history') {
      const limit = Number(url.searchParams.get('limit') || 100);
      const history = MetricsTracker.loadHistory(paths.metricsHistoryDir, limit);
      return sendJson(res, 200, { ok: true, count: history.length, snapshots: history }, req);
    }
    if (req.method === 'GET' && url.pathname === '/metrics/diff') {
      const history = MetricsTracker.loadHistory(paths.metricsHistoryDir, 100);
      if (history.length < 2) return sendJson(res, 200, { ok: true, diff: null, reason: 'need at least 2 snapshots' }, req);
      const diff = MetricsTracker.diffSnapshots(history[0], history[history.length - 1]);
      return sendJson(res, 200, { ok: true, diff }, req);
    }
    // D3: Comparison report
    if (req.method === 'POST' && url.pathname === '/reports/comparison') {
      const body = await readBody(req);
      const bundle = diagnosticsBundle(String(body.label || 'report'));
      let fullBundle = readJSON(bundle.file) || {};
      if (fullBundle.schema_version && fullBundle.schema_version < CURRENT_SCHEMA_VERSION) {
        fullBundle = migrateBundle(fullBundle).bundle;
      }
      let baseline = null;
      if (body.baseline_file) {
        const resolved = pathResolve(String(body.baseline_file));
        if (!resolved.startsWith(pathResolve(paths.diagnosticsDir))) {
          return sendJson(res, 400, { error: 'baseline_file must be within diagnostics directory' }, req);
        }
        baseline = readJSON(resolved);
        if (baseline?.schema_version && baseline.schema_version < CURRENT_SCHEMA_VERSION) {
          baseline = migrateBundle(baseline).bundle;
        }
      }
      const report = buildComparisonReport(fullBundle, { baseline });
      const reportFile = `${paths.diagnosticsDir}/report-${Date.now()}.md`;
      try { writeJsonFile(reportFile.replace('.md', '.json'), report.json); } catch {}
      try { writeFileSync(reportFile, report.markdown); } catch {}
      return sendJson(res, 200, { ok: true, file: reportFile, markdown: report.markdown, json: report.json }, req);
    }
    // E2: Snapshot diff
    if (req.method === 'POST' && url.pathname === '/snapshots/diff') {
      const body = await readBody(req);
      const history = loadSnapshotHistory(paths.snapshotHistoryDir, 50);
      if (history.length < 2) return sendJson(res, 200, { ok: true, diff: null, reason: 'need at least 2 snapshots in history' }, req);
      const beforeIdx = body.before_ts
        ? history.findIndex(h => h.data?.generated_at >= body.before_ts)
        : 0;
      const afterIdx = body.after_ts
        ? history.findLastIndex(h => h.data?.generated_at <= body.after_ts)
        : history.length - 1;
      const before = history[Math.max(0, beforeIdx)]?.data;
      const after = history[Math.min(history.length - 1, afterIdx)]?.data;
      const diff = snapshotDiff(before, after);
      return sendJson(res, 200, { ok: true, diff, before_ts: before?.generated_at, after_ts: after?.generated_at }, req);
    }
    // E2: Timeline replay
    if (req.method === 'GET' && url.pathname === '/timeline/replay') {
      const fromTs = url.searchParams.get('from') ? new Date(url.searchParams.get('from')).getTime() : null;
      const toTs = url.searchParams.get('to') ? new Date(url.searchParams.get('to')).getTime() : null;
      const typeFilter = url.searchParams.get('type') || null;
      const events = replayTimeline(paths.logFile, fromTs, toTs, typeFilter);
      const report = buildTimelineReport(events);
      return sendJson(res, 200, { ok: true, events: events.slice(-200), report }, req);
    }
    // E1: Schema version
    if (req.method === 'GET' && url.pathname === '/schema/version') {
      return sendJson(res, 200, { ok: true, version: CURRENT_SCHEMA_VERSION, validate: validateSchemaVersion(store.getSnapshot()) }, req);
    }
    if (req.method === 'GET' && url.pathname === '/reports/latest') {
      try {
        const files = readdirSync(paths.diagnosticsDir).filter(f => f.startsWith('report-') && f.endsWith('.md')).sort();
        if (files.length === 0) return sendJson(res, 200, { ok: true, report: null }, req);
        const latest = readFileSync(`${paths.diagnosticsDir}/${files[files.length - 1]}`, 'utf-8');
        return sendJson(res, 200, { ok: true, file: files[files.length - 1], markdown: latest }, req);
      } catch { return sendJson(res, 200, { ok: true, report: null }, req); }
    }
    if (req.method === 'GET' && url.pathname === '/ui/bootstrap.json') {
      return sendJson(res, 200, {
        ok: true,
        csrf_token: csrfToken,
        token_required: process.env.LEAD_SIDECAR_REQUIRE_TOKEN === '1',
        api_token: process.env.LEAD_SIDECAR_REQUIRE_TOKEN === '1' ? apiToken : null,
        generated_at: new Date().toISOString(),
      }, req);
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        ...baseHeaders(req),
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => { clients.delete(res); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/teams') {
      return sendJson(res, 200, { teams: snapshot.teams || [], generated_at: snapshot.generated_at, native: snapshot.native || null }, req);
    }
    if (req.method === 'GET' && /^\/teams\/[^/]+$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const team = (snapshot.teams || []).find((t) => t.team_name === teamName);
      const teammates = (snapshot.teammates || []).filter((t) => t.team_name === teamName);
      const tasks = (snapshot.tasks || []).filter((t) => t.team_name === teamName);
      const timeline = (snapshot.timeline || []).filter((t) => t.team_name === teamName).slice(-50);
      const alerts = (snapshot.alerts || []).filter((a) => !a.team_name || a.team_name === teamName).slice(0, 30);
      if (!team) return sendJson(res, 404, { error: `Team ${teamName} not found` }, req);
      return sendJson(res, 200, { team, teammates, tasks, timeline, alerts, native: snapshot.native || null, actions: snapshot.actions || { recent: [] }, generated_at: snapshot.generated_at }, req);
    }
    if (req.method === 'GET' && /^\/teams\/[^/]+\/interrupts$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const team = findTeam(snapshot, teamName);
      const interrupts = buildTeamInterrupts({ snapshot, teamName, teamPolicy: team?.policy });
      return sendJson(res, 200, { ok: true, team_name: teamName, interrupts, generated_at: new Date().toISOString() }, req);
    }
    // B1: Dedicated approvals endpoint
    if (req.method === 'GET' && /^\/teams\/[^/]+\/approvals$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const team = findTeam(snapshot, teamName);
      const interrupts = buildTeamInterrupts({ snapshot, teamName, teamPolicy: team?.policy });
      const approvals = interrupts.filter((i) => i.kind === 'approval');
      return sendJson(res, 200, { ok: true, team_name: teamName, approvals, generated_at: new Date().toISOString() }, req);
    }
    // B2: Interrupt priority weight config
    if (req.method === 'PATCH' && /^\/teams\/[^/]+\/interrupt-priorities$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const body = await readBody(req);
      const weights = {};
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'number' && v >= 0 && v <= 200) weights[k] = v;
      }
      // Persist via coordinator
      try {
        await coordinatorAdapter.execute('update-team-policy', { team_name: teamName, interrupt_weights: weights });
      } catch {}
      return sendJson(res, 200, { ok: true, team_name: teamName, interrupt_weights: weights }, req);
    }
    // B6: UI preferences persistence
    if (req.method === 'GET' && url.pathname === '/ui/preferences') {
      const prefs = readJSON(paths.uiPrefsFile) || {};
      return sendJson(res, 200, { ok: true, preferences: prefs }, req);
    }
    if (req.method === 'PUT' && url.pathname === '/ui/preferences') {
      const body = await readBody(req);
      if (body.__parse_error) return sendJson(res, 400, { error: body.__parse_error }, req);
      writeJSON(paths.uiPrefsFile, body);
      return sendJson(res, 200, { ok: true, saved: true }, req);
    }
    // C3: Task templates
    if (req.method === 'GET' && url.pathname === '/task-templates') {
      const templates = readJSON(paths.taskTemplatesFile) || [];
      return sendJson(res, 200, { ok: true, templates }, req);
    }
    if (req.method === 'POST' && url.pathname === '/task-templates') {
      const body = await readBody(req);
      if (body.__parse_error) return sendJson(res, 400, { error: body.__parse_error }, req);
      const templates = readJSON(paths.taskTemplatesFile) || [];
      const tpl = {
        id: body.id || `tpl-${Date.now()}`,
        name: body.name || 'Unnamed Template',
        subject_template: body.subject_template || '',
        prompt_template: body.prompt_template || '',
        role_hint: body.role_hint || '',
        priority: body.priority || 'normal',
        quality_gates: Array.isArray(body.quality_gates) ? body.quality_gates : [],
        acceptance_criteria: Array.isArray(body.acceptance_criteria) ? body.acceptance_criteria : [],
        created_at: new Date().toISOString(),
      };
      templates.push(tpl);
      writeJSON(paths.taskTemplatesFile, templates);
      return sendJson(res, 200, { ok: true, template: tpl }, req);
    }
    // C2: Task audit trail
    if (req.method === 'GET' && /^\/teams\/[^/]+\/tasks\/[^/]+\/audit$/.test(url.pathname)) {
      const parts = url.pathname.split('/');
      const taskId = decodeURIComponent(parts[4]);
      const auditFile = `${paths.resultsDir}/${taskId}.audit.jsonl`;
      const entries = readJSONL(auditFile);
      return sendJson(res, 200, { ok: true, task_id: taskId, audit: entries }, req);
    }
    // C1: Task reassignment
    if (req.method === 'POST' && /^\/teams\/[^/]+\/tasks\/[^/]+\/reassign$/.test(url.pathname)) {
      const parts = url.pathname.split('/');
      const teamName = decodeURIComponent(parts[2]);
      const taskId = decodeURIComponent(parts[4]);
      const body = await readBody(req);
      const result = await router.execute(teamName, 'reassign-task', {
        task_id: taskId,
        new_assignee: body.new_assignee,
        reason: body.reason || 'manual reassignment via dashboard',
        progress_context: body.progress_context || null,
      });
      return sendJson(res, 200, { ok: true, result }, req);
    }
    // C3: Quality gate check
    if (req.method === 'POST' && /^\/teams\/[^/]+\/tasks\/[^/]+\/gate-check$/.test(url.pathname)) {
      const parts = url.pathname.split('/');
      const taskId = decodeURIComponent(parts[4]);
      const result = await router.execute(parts[2], 'gate-check', { task_id: taskId });
      return sendJson(res, 200, { ok: true, result }, req);
    }
    if (req.method === 'POST' && url.pathname === '/route/simulate') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      if (!body.team_name || !body.action) return sendJson(res, 400, { error: 'team_name and action are required' }, req);
      const team = findTeam(snapshot, body.team_name);
      const sim = await router.simulate(team, String(body.action), body.payload || {});
      return sendJson(res, 200, sim, req);
    }
    if (req.method === 'GET' && url.pathname === '/native/status') {
      const native = await nativeAdapter.getStatus().catch((err) => ({ adapter_ok: false, error: err.message, mode: 'unavailable' }));
      store.setNativeCapabilities({
        ...(native.native || { available: false, last_probe_error: native.error || null }),
        validation: native.bridge_validation || null,
      });
      if (native.bridge) store.emitBridgeStatus(native.bridge);
      store.setSnapshot({ native: store.getSnapshot().native, actions: store.getSnapshot().actions, alerts: store.getSnapshot().alerts, metrics: store.getSnapshot().metrics });
      return sendJson(res, 200, native, req);
    }
    if (req.method === 'GET' && url.pathname === '/native/bridge/status') {
      return sendJson(res, 200, nativeAdapter.bridge.getHealth(), req);
    }
    if (req.method === 'GET' && url.pathname === '/native/bridge/validation') {
      const native = await nativeAdapter.getStatus().catch((err) => ({ adapter_ok: false, error: err.message, mode: 'unavailable' }));
      return sendJson(res, 200, { ok: true, validation: native.bridge_validation || null, bridge: native.bridge || null }, req);
    }
    if (req.method === 'POST' && url.pathname === '/native/bridge/ensure') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const team = body.team_name ? findTeam(snapshot, body.team_name) : { team_name: null, execution_path: 'hybrid', policy: { native_bridge_policy: 'auto' } };
      const ensured = await nativeAdapter.ensureBridge(team);
      await rebuild('bridge-ensure');
      return sendJson(res, ensured.ok ? 200 : 400, ensured, req);
    }
    if (req.method === 'POST' && url.pathname === '/native/bridge/validate') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const team = body.team_name ? findTeam(snapshot, body.team_name) : { team_name: null, execution_path: 'hybrid', policy: { native_bridge_policy: 'auto' } };
      const report = await nativeAdapter.validateBridge({
        team,
        team_name: body.team_name || null,
        directory: body.directory || process.cwd(),
        timeoutMs: body.timeout_ms || body.timeoutMs || null,
        simulate: typeof body.simulate === 'boolean' ? body.simulate : null,
      });
      await rebuild('bridge-validate');
      return sendJson(res, report.ok ? 200 : 400, report, req);
    }
    if (req.method === 'POST' && url.pathname === '/native/probe') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const caps = await nativeAdapter.probe({ force: true });
      await rebuild('native-probe');
      return sendJson(res, 200, { ok: true, capabilities: caps }, req);
    }
    if (req.method === 'POST' && /^\/native\/actions\/[^/]+$/.test(url.pathname)) {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const action = mapNativeHttpAction(url.pathname.split('/').pop());
      if (!action) return sendJson(res, 400, { error: 'Unsupported native action' }, req);
      const team = body.team_name ? findTeam(snapshot, body.team_name) : { team_name: body.team_name || null, execution_path: 'native', policy: { preferred_execution_path: 'native' } };
      const out = await runTrackedAction({ team, action, payload: body, routeMode: 'native-direct', nativeHttpAction: action });
      await rebuild(`native:${action}`);
      return sendJson(res, out.ok ? 200 : 400, out, req);
    }
    if (req.method === 'GET' && url.pathname === '/actions') {
      return sendJson(res, 200, { actions: actionQueue.list(200) }, req);
    }
    if (req.method === 'GET' && /^\/actions\/[^/]+$/.test(url.pathname)) {
      const actionId = decodeURIComponent(url.pathname.split('/')[2]);
      const record = actionQueue.get(actionId);
      if (!record) return sendJson(res, 404, { error: 'Action not found' }, req);
      return sendJson(res, 200, record, req);
    }
    if (req.method === 'POST' && /^\/actions\/[^/]+\/retry$/.test(url.pathname)) {
      const actionId = decodeURIComponent(url.pathname.split('/')[2]);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const record = actionQueue.get(actionId);
      if (!record) return sendJson(res, 404, { error: 'Action not found' }, req);
      actionQueue.retry(actionId, { retry_requested_at: new Date().toISOString() });
      const team = record.team_name ? findTeam(snapshot, record.team_name) : { team_name: null, execution_path: 'hybrid', policy: {} };
      const result = await runTrackedAction({ team, action: record.action, payload: record.payload_preview || {}, routeMode: record.route_mode === 'native-direct' ? 'native-direct' : 'router', nativeHttpAction: record.action });
      await rebuild('action-retry');
      return sendJson(res, result.ok ? 200 : 400, result, req);
    }
    if (req.method === 'POST' && /^\/actions\/[^/]+\/fallback$/.test(url.pathname)) {
      const actionId = decodeURIComponent(url.pathname.split('/')[2]);
      const record = actionQueue.get(actionId);
      if (!record) return sendJson(res, 404, { error: 'Action not found' }, req);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const force_path = body.force_path === 'native' ? 'native' : 'coordinator';
      actionQueue.retry(actionId, { forced_fallback_at: new Date().toISOString(), force_path });
      const team = record.team_name ? findTeam(snapshot, record.team_name) : { team_name: null, execution_path: 'hybrid', policy: {} };
      const result = await runTrackedAction({ team, action: record.action, payload: { ...(record.payload_preview || {}), force_path }, routeMode: 'router' });
      await rebuild('action-fallback');
      return sendJson(res, result.ok ? 200 : 400, result, req);
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return sendHtml(res, 200, DASHBOARD_HTML, req);
    }
    if (req.method === 'GET' && url.pathname === '/ui/app.js') {
      return sendJs(res, 200, DASHBOARD_JS, req);
    }
    if (req.method === 'POST' && /^\/teams\/[^/]+\/rebalance$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const team = findTeam(snapshot, teamName);
      const routed = await runTrackedAction({ team, action: 'rebalance', payload: { team_name: teamName, ...body }, routeMode: 'router' });
      if (!routed.ok) return sendJson(res, 400, routed, req);
      await rebuild('rebalance');
      return sendJson(res, 200, routed, req);
    }
    if (req.method === 'GET' && /^\/teams\/[^/]+\/rebalance-explain$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const limit = Number(url.searchParams.get('limit') || 10);
      const out = await coordinatorAdapter.execute('rebalance-explain', { team_name: teamName, limit });
      return sendJson(res, 200, out, req);
    }
    if (req.method === 'POST' && /^\/teams\/[^/]+\/rebalance-explain$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const out = await coordinatorAdapter.execute('rebalance-explain', { team_name: teamName, ...body });
      return sendJson(res, 200, out, req);
    }
    if (req.method === 'POST' && /^\/teams\/[^/]+\/actions\/[^/]+$/.test(url.pathname)) {
      const [, , rawTeam, , rawAction] = url.pathname.split('/');
      const teamName = decodeURIComponent(rawTeam);
      const action = decodeURIComponent(rawAction);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const payload = buildActionPayload(teamName, action, body);
      const team = findTeam(snapshot, teamName);
      const routed = await runTrackedAction({ team, action, payload, routeMode: 'router' });
      if (!routed.ok) return sendJson(res, 400, routed, req);
      await rebuild(`action:${action}`);
      return sendJson(res, 200, routed, req);
    }
    if (req.method === 'POST' && /^\/teams\/[^/]+\/batch-triage$/.test(url.pathname)) {
      const teamName = decodeURIComponent(url.pathname.split('/')[2]);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const out = await runBatchTriage({
        teamName,
        op: String(body.op || ''),
        confirm: body.confirm === true,
        message: String(body.message || ''),
        limit: body.limit,
      });
      await rebuild('batch-triage');
      return sendJson(res, out.ok ? 200 : 400, out, req);
    }
    if (req.method === 'POST' && url.pathname === '/dispatch') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      if (!body.team_name) return sendJson(res, 400, { error: 'team_name is required' }, req);
      const team = findTeam(snapshot, body.team_name);
      const routed = await runTrackedAction({ team, action: 'dispatch', payload: body, routeMode: 'router' });
      if (!routed.ok) return sendJson(res, 400, routed, req);
      await rebuild('dispatch');
      return sendJson(res, 200, routed, req);
    }
    if (req.method === 'POST' && url.pathname === '/maintenance/run') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const out = maintenanceSweep({ source: body?.source || 'manual' });
      await rebuild('maintenance');
      return sendJson(res, 200, { ok: true, maintenance: out }, req);
    }
    if (req.method === 'POST' && url.pathname === '/diagnostics/export') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const out = diagnosticsBundle(String(body.label || 'manual'));
      return sendJson(res, 200, out, req);
    }
    if (req.method === 'GET' && url.pathname === '/diagnostics/latest') {
      const latestName = latestJsonFileName(paths.diagnosticsDir);
      const latest = latestName ? readJSON(`${paths.diagnosticsDir}/${latestName}`) : null;
      return sendJson(res, 200, { ok: true, latest }, req);
    }
    if (req.method === 'POST' && url.pathname === '/open-dashboard') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      try {
        const port = readJSON(paths.portFile)?.port;
        const target = `http://127.0.0.1:${port || server.address().port}/`;
        if (process.platform === 'darwin') spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
        return sendJson(res, 200, { ok: true, target }, req);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, req);
      }
    }
    // ── Phase E: Reliability / Recovery / Safety endpoints ──

    // E1a: Checkpoints
    if (req.method === 'POST' && url.pathname === '/checkpoints/create') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      try {
        const result = createCheckpoint(paths, String(body.label || 'manual'));
        return sendJson(res, 200, { ok: true, ...result }, req);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, req);
      }
    }
    if (req.method === 'GET' && url.pathname === '/checkpoints') {
      return sendJson(res, 200, { ok: true, checkpoints: listCheckpoints(paths) }, req);
    }
    if (req.method === 'POST' && url.pathname === '/checkpoints/restore') {
      if (SAFE_MODE) return sendJson(res, 503, { error: 'Safe mode: mutation disabled' }, req);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      if (!body.file) return sendJson(res, 400, { error: 'file is required' }, req);
      const resolved = pathResolve(String(body.file));
      if (!resolved.startsWith(pathResolve(paths.checkpointsDir))) {
        return sendJson(res, 400, { error: 'file must be within checkpoints directory' }, req);
      }
      try {
        const result = restoreCheckpoint(paths, resolved);
        await rebuild('checkpoint-restore');
        return sendJson(res, 200, { ok: true, ...result }, req);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message }, req);
      }
    }

    // E1b: Event replay / consistency
    if (req.method === 'POST' && url.pathname === '/events/rebuild-check') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const fromTs = body.from_ts ? new Date(body.from_ts).getTime() : null;
      const derived = rebuildFromTimeline(paths.logFile, fromTs);
      const actual = store.getSnapshot();
      const check = consistencyCheck(derived, actual);
      return sendJson(res, 200, { ok: true, ...check, derived_summary: { event_count: derived.event_count, gaps: derived.gaps } }, req);
    }
    if (req.method === 'GET' && url.pathname === '/events/consistency') {
      const derived = rebuildFromTimeline(paths.logFile);
      const actual = store.getSnapshot();
      const check = consistencyCheck(derived, actual);
      return sendJson(res, 200, { ok: true, ...check }, req);
    }

    // E1c: Repair
    if (req.method === 'POST' && url.pathname === '/repair/scan') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const results = scanForCorruption(paths);
      return sendJson(res, 200, { ok: true, ...results }, req);
    }
    if (req.method === 'POST' && url.pathname === '/repair/fix') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      if (!body.path) return sendJson(res, 400, { error: 'path is required' }, req);
      const resolved = pathResolve(String(body.path));
      if (!resolved.startsWith(pathResolve(paths.root)) && !resolved.startsWith(pathResolve(paths.terminalsDir))) {
        return sendJson(res, 400, { error: 'path must be within sidecar or terminals directory' }, req);
      }
      if (body.dry_run) {
        try {
          const data = readJSON(resolved);
          return sendJson(res, 200, { ok: true, dry_run: true, valid: data !== null, path: resolved }, req);
        } catch (err) {
          return sendJson(res, 200, { ok: true, dry_run: true, valid: false, error: err.message, path: resolved }, req);
        }
      }
      const result = resolved.endsWith('.jsonl') ? repairJSONL(resolved) : repairJSON(resolved);
      return sendJson(res, 200, { ok: true, ...result }, req);
    }

    // E1d: Schema migrations
    if (req.method === 'GET' && url.pathname === '/schema/migrations') {
      const current = store.getSnapshot();
      const dryRun = dryRunMigration(current);
      return sendJson(res, 200, {
        ok: true,
        current_version: CURRENT_SCHEMA_VERSION,
        migrations: migrations.map(m => ({ from: m.from, to: m.to, description: m.description })),
        dry_run: dryRun,
      }, req);
    }

    // E2a: Lock metrics
    if (req.method === 'GET' && url.pathname === '/health/locks') {
      return sendJson(res, 200, { ok: true, ...lockMetrics.snapshot() }, req);
    }

    // E2b: Terminal health
    if (req.method === 'GET' && url.pathname === '/health/terminals') {
      const report = checkTerminalHealth(paths);
      const suggestions = suggestRecovery(report);
      return sendJson(res, 200, { ok: true, ...report, suggestions }, req);
    }

    // E2c: Hook watchdog
    if (req.method === 'GET' && url.pathname === '/health/hooks') {
      const report = validateHooks(paths.hooksDir);
      return sendJson(res, 200, { ok: true, ...report }, req);
    }
    if (req.method === 'POST' && url.pathname === '/health/hooks/selftest') {
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      const results = runHookSelftest(paths.hooksDir);
      return sendJson(res, 200, { ok: true, results }, req);
    }

    // E2e: Pre-op backups
    if (req.method === 'GET' && url.pathname === '/backups') {
      const operation = url.searchParams.get('operation') || null;
      return sendJson(res, 200, { ok: true, backups: listBackups(paths, operation) }, req);
    }
    if (req.method === 'POST' && url.pathname === '/backups/restore') {
      if (SAFE_MODE) return sendJson(res, 503, { error: 'Safe mode: mutation disabled' }, req);
      const body = await readBody(req);
      const v = validateBody(url.pathname, body);
      if (!v.ok) return sendJson(res, v.status, { error: v.error }, req);
      if (!body.file) return sendJson(res, 400, { error: 'file is required' }, req);
      const resolved = pathResolve(String(body.file));
      if (!resolved.startsWith(pathResolve(paths.backupsDir))) {
        return sendJson(res, 400, { error: 'file must be within backups directory' }, req);
      }
      const result = restoreFromBackup(paths, resolved);
      if (result.restored) await rebuild('backup-restore');
      return sendJson(res, result.restored ? 200 : 400, { ok: result.restored, ...result }, req);
    }

    return sendText(res, 404, 'Not found', req);
  });

  await new Promise((resolve) => server.listen(args.port || 0, '127.0.0.1', resolve));
  const port = writeRuntimeFiles(paths, server);

  if (args.open && process.platform === 'darwin') {
    try { spawn('open', [`http://127.0.0.1:${port}/`], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }

  const cleanup = (exitAfter = false) => {
    hookStream.stop();
    try { clearInterval(maintenanceTimer); } catch {}
    try { unlinkSync(paths.lockFile); } catch {}
    try { unlinkSync(paths.portFile); } catch {}
    for (const res of clients) { try { res.end(); } catch {} }
    server.close(() => { if (exitAfter) process.exit(0); });
    if (exitAfter) setTimeout(() => process.exit(0), 1000).unref();
  };
  const shutdown = () => cleanup(true);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`lead-sidecar listening on http://127.0.0.1:${port}`);
  return {
    server,
    port,
    apiToken,
    store,
    router,
    nativeAdapter,
    actionQueue,
    metrics,
    close: () => cleanup(false),
    maintenanceSweep,
    diagnosticsBundle,
  };
}

const isDirect = Boolean(process.argv[1] && /(^|[\\/])server[\\/]index\\.js$/.test(process.argv[1]));
if (isDirect) {
  startSidecarServer().catch((err) => {
    console.error('lead-sidecar failed:', err);
    process.exit(1);
  });
}
