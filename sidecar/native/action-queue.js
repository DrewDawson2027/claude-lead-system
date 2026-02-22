import { randomUUID } from 'crypto';
import { join } from 'path';
import { ensureDirs, writeJSON, readJSON, listDir, removeFile } from '../core/fs-utils.js';

const STATES = ['pending', 'inflight', 'done', 'failed'];

export class ActionQueue {
  constructor(paths) {
    this.paths = paths;
    ensureDirs([paths.actionsRootDir, paths.actionsPendingDir, paths.actionsInflightDir, paths.actionsDoneDir, paths.actionsFailedDir]);
  }

  _dirFor(state) {
    switch (state) {
      case 'pending': return this.paths.actionsPendingDir;
      case 'inflight': return this.paths.actionsInflightDir;
      case 'done': return this.paths.actionsDoneDir;
      case 'failed': return this.paths.actionsFailedDir;
      default: throw new Error(`Unknown action queue state: ${state}`);
    }
  }

  _path(state, action_id) {
    return join(this._dirFor(state), `${action_id}.json`);
  }

  create(record) {
    const action_id = record.action_id || `A_${randomUUID()}`;
    const now = new Date().toISOString();
    const full = {
      action_id,
      state: 'pending',
      created_at: now,
      updated_at: now,
      retry_count: 0,
      fallback_history: [],
      audit: [{ ts: now, type: 'queued' }],
      ...record,
    };
    writeJSON(this._path('pending', action_id), full);
    return full;
  }

  _readAny(action_id) {
    for (const s of STATES) {
      const p = this._path(s, action_id);
      const v = readJSON(p);
      if (v) return { path: p, state: s, value: v };
    }
    return null;
  }

  get(action_id) {
    return this._readAny(action_id)?.value || null;
  }

  list(limit = 200) {
    const out = [];
    for (const s of STATES) {
      for (const f of listDir(this._dirFor(s)).filter((x) => x.endsWith('.json')).sort()) {
        const v = readJSON(join(this._dirFor(s), f));
        if (v) out.push(v);
      }
    }
    out.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return out.slice(0, limit);
  }

  counts() {
    return {
      pending: listDir(this.paths.actionsPendingDir).filter((x) => x.endsWith('.json')).length,
      inflight: listDir(this.paths.actionsInflightDir).filter((x) => x.endsWith('.json')).length,
      done: listDir(this.paths.actionsDoneDir).filter((x) => x.endsWith('.json')).length,
      failed: listDir(this.paths.actionsFailedDir).filter((x) => x.endsWith('.json')).length,
    };
  }

  _transition(action_id, nextState, patch = {}) {
    const found = this._readAny(action_id);
    if (!found) throw new Error(`Action ${action_id} not found`);
    const now = new Date().toISOString();
    const next = {
      ...found.value,
      ...patch,
      state: nextState,
      updated_at: now,
      audit: [...(found.value.audit || []), { ts: now, type: `state:${nextState}`, patch }],
    };
    const nextPath = this._path(nextState, action_id);
    writeJSON(nextPath, next);
    if (found.path !== nextPath) {
      removeFile(found.path);
    }
    return next;
  }

  markStarted(action_id, patch = {}) {
    return this._transition(action_id, 'inflight', { started_at: new Date().toISOString(), ...patch });
  }

  markCompleted(action_id, patch = {}) {
    return this._transition(action_id, 'done', { completed_at: new Date().toISOString(), ...patch });
  }

  markFailed(action_id, patch = {}) {
    return this._transition(action_id, 'failed', { failed_at: new Date().toISOString(), ...patch });
  }

  retry(action_id, patch = {}) {
    const found = this._readAny(action_id);
    if (!found) throw new Error(`Action ${action_id} not found`);
    const rec = found.value;
    const next = {
      ...rec,
      ...patch,
      retry_count: (rec.retry_count || 0) + 1,
      error: null,
    };
    return this._transition(action_id, 'pending', next);
  }

  recoverStaleInflight(maxAgeMs = 5 * 60_000) {
    const now = Date.now();
    const recovered = [];
    for (const f of listDir(this.paths.actionsInflightDir).filter((x) => x.endsWith('.json'))) {
      const rec = readJSON(join(this.paths.actionsInflightDir, f));
      if (!rec?.action_id) continue;
      const started = rec.started_at || rec.updated_at || rec.created_at;
      const ageMs = started ? (now - new Date(started).getTime()) : Infinity;
      if (!Number.isFinite(ageMs) || ageMs < maxAgeMs) continue;
      const next = this.markFailed(rec.action_id, {
        error: { code: 'recovered_after_restart', message: 'Inflight action recovered after sidecar restart/timeout sweep' },
        recovered_at: new Date().toISOString(),
        recovery_reason: 'stale_inflight',
      });
      recovered.push({ action_id: next.action_id, age_ms: ageMs });
    }
    return recovered;
  }

  sweep({ doneMaxAgeMs = 24 * 60 * 60_000, failedMaxAgeMs = 7 * 24 * 60 * 60_000, pendingMaxAgeMs = 24 * 60 * 60_000 } = {}) {
    const now = Date.now();
    const removed = { pending: 0, done: 0, failed: 0 };
    const sweepState = (state, maxAgeMs) => {
      for (const f of listDir(this._dirFor(state)).filter((x) => x.endsWith('.json'))) {
        const p = join(this._dirFor(state), f);
        const rec = readJSON(p);
        if (!rec) continue;
        const t = rec.updated_at || rec.completed_at || rec.failed_at || rec.created_at;
        const ageMs = t ? (now - new Date(t).getTime()) : 0;
        if (Number.isFinite(ageMs) && ageMs > maxAgeMs) {
          if (removeFile(p)) removed[state] += 1;
        }
      }
    };
    sweepState('pending', pendingMaxAgeMs);
    sweepState('done', doneMaxAgeMs);
    sweepState('failed', failedMaxAgeMs);
    return removed;
  }
}
