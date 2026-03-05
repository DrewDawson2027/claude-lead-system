import { readdirSync } from 'fs';
import { join } from 'path';
import { writeJSON, readJSON, ensureDirs, appendJSONL } from '../core/fs-utils.js';
import { ensureBridgeDirs, newRequestId, writeBridgeRequest, waitForBridgeResponse } from './bridge-protocol.js';
import { getBridgeHealth } from './bridge-health.js';

function findBridgeSession(paths, workerName = 'sidecar-native-bridge') {
  try {
    const files = readdirSync(paths.terminalsDir).filter((f) => f.startsWith('session-') && f.endsWith('.json'));
    for (const f of files) {
      const s = readJSON(join(paths.terminalsDir, f));
      if (s?.worker_name === workerName && s?.session) return s;
    }
  } catch { }
  return null;
}

function parseSpawnedTaskId(text) {
  const m = String(text || '').match(/Worker spawned:\s*\*\*(W[^*]+)\*\*/i);
  return m ? m[1] : null;
}

export class BridgeController {
  constructor({ paths, coordinatorAdapter, store }) {
    this.paths = paths;
    this.coordinator = coordinatorAdapter;
    this.store = store;
    ensureBridgeDirs(paths);
  }

  getHealth() {
    return getBridgeHealth(this.paths);
  }

  _queueCounts() {
    try {
      return {
        request_queue: readdirSync(this.paths.nativeBridgeRequestDir).filter((f) => f.endsWith('.json')).length,
        response_queue: readdirSync(this.paths.nativeBridgeResponseDir).filter((f) => f.endsWith('.json')).length,
      };
    } catch {
      return { request_queue: 0, response_queue: 0 };
    }
  }

  _statusPatch(patch) {
    const prev = readJSON(this.paths.nativeBridgeStatusFile) || {};
    const next = {
      ...prev,
      ...patch,
      pid: patch?.pid ?? prev?.pid ?? process.pid,
      updated_at: new Date().toISOString(),
    };
    writeJSON(this.paths.nativeBridgeStatusFile, next);
    this.store?.emitBridgeStatus?.(next);
    return next;
  }

  heartbeat(session_id, extras = {}) {
    const status = readJSON(this.paths.nativeBridgeStatusFile) || {};
    const hb = {
      ts: new Date().toISOString(),
      session_id,
      pid: extras?.pid ?? status?.pid ?? process.pid,
      ...extras,
    };
    writeJSON(this.paths.nativeBridgeHeartbeatFile, hb);
    this.store?.emitBridgeStatus?.({ bridge_status: 'healthy', ...hb });
    return hb;
  }

  async ensureBridge({ autostart = false, directory = process.cwd() } = {}) {
    const session = findBridgeSession(this.paths);
    if (session?.session) {
      this._statusPatch({ session_id: session.session, worker_name: session.worker_name || 'sidecar-native-bridge', pid: session.pid || process.pid, note: 'bridge session discovered' });
      this.heartbeat(session.session, { capabilities: ['TeamCreate', 'TeamStatus', 'SendMessage', 'Task'] });
      return { ok: true, status: 'healthy', session_id: session.session, discovered: true };
    }

    if (process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK === '1') {
      const sid = 'bridge001';
      this._statusPatch({ session_id: sid, worker_name: 'sidecar-native-bridge', pid: process.pid, starting: false, note: 'mock bridge' });
      this.heartbeat(sid, { capabilities: ['TeamCreate', 'TeamStatus', 'SendMessage', 'Task'] });
      return { ok: true, status: 'healthy', session_id: sid, mock: true };
    }

    if (!autostart) return { ok: false, status: 'down', error: 'bridge_not_running' };
    this._statusPatch({ starting: true, worker_name: 'sidecar-native-bridge', note: 'starting bridge' });

    const prompt = [
      'You are the sidecar native bridge worker.',
      'Continuously watch ~/.claude/lead-sidecar/runtime/native/bridge.request-queue for request JSON files.',
      'When a request file appears, execute exactly one native tool action (TeamCreate, TeamStatus, SendMessage, or Task).',
      'Write a strict JSON response to ~/.claude/lead-sidecar/runtime/native/bridge.response-queue/<request_id>.json.',
      'Do not edit project files. Only read/write sidecar runtime queue files and use native team tools.',
      'After each action, continue watching for more requests.',
      'Also periodically write heartbeat JSON to ~/.claude/lead-sidecar/runtime/native/bridge.heartbeat.json with ts, session_id, and pid.',
    ].join(' ');

    const res = await this.coordinator.execute('spawn-worker-raw', {
      directory,
      prompt,
      mode: 'interactive',
      runtime: 'claude',
      layout: 'background',
      team_name: '__sidecar_native__',
      worker_name: 'sidecar-native-bridge',
      role: 'planner',
      permission_mode: 'readOnly',
      context_level: 'minimal',
    }).catch((err) => ({ text: `spawn failed: ${err.message}` }));

    const task_id = parseSpawnedTaskId(res?.text || '');
    const session2 = findBridgeSession(this.paths);
    if (task_id || session2?.session) {
      this._statusPatch({ starting: false, task_id: task_id || null, session_id: session2?.session || null, pid: session2?.pid || process.pid, note: 'bridge spawned' });
      return { ok: true, status: 'starting', task_id: task_id || null, session_id: session2?.session || null };
    }

    this._statusPatch({ starting: false, note: 'bridge spawn failed', last_error: res?.text || 'unknown spawn failure' });
    return { ok: false, status: 'down', error: 'bridge_spawn_failed', detail: res?.text || '' };
  }

  async execute(action, payload = {}, { timeoutMs = 15000, allowDegraded = false } = {}) {
    const health = this.getHealth();
    const allowed = allowDegraded
      ? new Set(['healthy', 'starting', 'stale', 'degraded'])
      : new Set(['healthy']);
    if (!allowed.has(health.bridge_status)) throw new Error('bridge_stale');
    const request_id = newRequestId();
    const request = {
      request_id,
      ts: new Date().toISOString(),
      action,
      team_name: payload.team_name || null,
      payload,
      timeout_ms: timeoutMs,
      correlation_id: payload.correlation_id || null,
      source: 'sidecar',
    };
    writeBridgeRequest(this.paths, request);

    const sid = health.session_id;
    if (sid) {
      try {
        await this.coordinator.execute('directive', {
          from: 'sidecar-native-bridge',
          to: sid,
          content: `Process native bridge request ${request_id}. Read ~/.claude/lead-sidecar/runtime/native/bridge.request-queue/${request_id}.json and write response JSON to the response-queue.`,
          priority: 'urgent',
        });
      } catch { }
    }

    const res = await waitForBridgeResponse(this.paths, request_id, timeoutMs);
    if (!res) throw new Error('bridge_timeout');
    return { ...res, path_mode: 'bridge' };
  }

  _simulateBridgeWorkerResponse({ timeoutMs = 5000, once = true } = {}) {
    const started = Date.now();
    const seen = new Set();
    const timer = setInterval(() => {
      try {
        const files = readdirSync(this.paths.nativeBridgeRequestDir).filter((f) => f.endsWith('.json')).sort();
        for (const file of files) {
          if (seen.has(file)) continue;
          const req = readJSON(join(this.paths.nativeBridgeRequestDir, file));
          if (!req?.request_id) continue;
          seen.add(file);
          const response = {
            request_id: req.request_id,
            ts: new Date().toISOString(),
            ok: true,
            action: req.action,
            native_tool:
              req.action === 'team-status' ? 'TeamStatus'
                : req.action === 'team-create' ? 'TeamCreate'
                  : req.action === 'send-message' ? 'SendMessage'
                    : req.action === 'task' ? 'Task'
                      : 'Unknown',
            result: {
              simulated_bridge: true,
              echo: req.payload || {},
              no_team: req.action === 'team-status',
            },
            error: null,
            latency_ms: Math.max(1, Date.now() - started),
            bridge_session_id: this.getHealth().session_id || 'bridge001',
          };
          writeJSON(join(this.paths.nativeBridgeResponseDir, `${req.request_id}.json`), response);
          if (req.payload?.correlation_id) {
            this.store?.emitTimeline?.({
              type: 'native.bridge.simulated_response',
              request_id: req.request_id,
              correlation_id: req.payload.correlation_id,
            });
          }
          if (once) {
            clearInterval(timer);
            return;
          }
        }
        if (Date.now() - started > timeoutMs) clearInterval(timer);
      } catch {
        if (Date.now() - started > timeoutMs) clearInterval(timer);
      }
    }, 60);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  async validate({
    team_name = null,
    directory = process.cwd(),
    timeoutMs = 10000,
    autostart = true,
    simulate = false,
  } = {}) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const pre = this.getHealth();
    const report = {
      ok: false,
      started_at: startedAt,
      finished_at: null,
      latency_ms: null,
      mode: 'bridge',
      team_name,
      simulate: Boolean(simulate || process.env.LEAD_SIDECAR_BRIDGE_VALIDATE_SIMULATE === '1'),
      steps: [],
      diagnostics: {
        pre_health: pre,
        queue_counts_before: this._queueCounts(),
      },
      result: null,
      error: null,
    };

    const step = (name, patch = {}) => report.steps.push({ ts: new Date().toISOString(), name, ...patch });

    try {
      step('ensure_bridge.start');
      const ensured = await this.ensureBridge({ autostart, directory });
      report.diagnostics.ensure_bridge = ensured;
      step('ensure_bridge.done', { ok: ensured.ok !== false, status: ensured.status || null });

      if (!ensured.ok && (ensured.status === 'down' || ensured.error)) {
        throw new Error(ensured.error || 'bridge_not_running');
      }

      const simulateEnabled = report.simulate;
      if (simulateEnabled) {
        step('simulate_bridge_worker.start');
        this._simulateBridgeWorkerResponse({ timeoutMs, once: true });
      }

      step('bridge_execute.start');
      const bridgeRes = await this.execute('team-status', {
        team_name,
        metadata: { validation: true },
        correlation_id: `bridge-validate-${Date.now()}`,
      }, { timeoutMs, allowDegraded: true });
      step('bridge_execute.done', { ok: bridgeRes.ok !== false, path_mode: bridgeRes.path_mode || 'bridge' });

      report.ok = bridgeRes.ok !== false;
      report.result = bridgeRes;
      report.diagnostics.post_health = this.getHealth();
      report.diagnostics.queue_counts_after = this._queueCounts();
    } catch (err) {
      report.ok = false;
      report.error = {
        code: String(err.message || 'bridge_validation_failed'),
        message: String(err.message || 'bridge validation failed'),
      };
      report.diagnostics.post_health = this.getHealth();
      report.diagnostics.queue_counts_after = this._queueCounts();
      step('bridge_execute.error', { error: err.message });
    } finally {
      report.finished_at = new Date().toISOString();
      report.latency_ms = Date.now() - started;
      try { writeJSON(this.paths.nativeBridgeValidationFile, report); } catch { }
      try { appendJSONL(this.paths.nativeBridgeValidationLogFile, report); } catch { }
      this.store?.emitBridgeStatus?.({
        bridge_status: this.getHealth().bridge_status,
        validation: { ok: report.ok, finished_at: report.finished_at, latency_ms: report.latency_ms, error: report.error || null },
      });
    }

    return report;
  }
}
