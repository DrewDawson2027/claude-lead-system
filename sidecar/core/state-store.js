import { EventEmitter } from 'events';
import { writeJSON, appendJSONL } from './fs-utils.js';
import { CURRENT_SCHEMA_VERSION } from './schema.js';

export class SidecarStateStore extends EventEmitter {
  constructor(paths, options = {}) {
    super();
    this.paths = paths;
    this.logger = options.logger || null;
    this.metricSink = typeof options.onMetric === 'function' ? options.onMetric : null;
    this.persistenceMetrics = {
      snapshot_write_fail: 0,
      timeline_append_fail: 0,
      log_append_fail: 0,
    };
    this.snapshot = {
      generated_at: null,
      teams: [],
      teammates: [],
      tasks: [],
      timeline: [],
      adapters: {},
      policy_alerts: [],
      native: null,
      actions: { recent: [] },
      alerts: [],
      metrics: null,
      ui: {},
    };
  }

  _recordMetric(name, value = 1) {
    if (Object.prototype.hasOwnProperty.call(this.persistenceMetrics, name)) {
      this.persistenceMetrics[name] += value;
    } else {
      this.persistenceMetrics[name] = (this.persistenceMetrics[name] || 0) + value;
    }
    if (this.metricSink) {
      try { this.metricSink(name, value); } catch (err) { void err; }
    }
  }

  _log(level, message, meta = {}) {
    if (!this.logger || typeof this.logger[level] !== 'function') return;
    try { this.logger[level](message, meta); } catch (err) { void err; }
  }

  _isTransientFsError(err) {
    const code = err?.code || '';
    return code === 'EINTR' || code === 'EBUSY';
  }

  _safeMeta(meta) {
    const out = { ...meta };
    if (out.snapshot) delete out.snapshot;
    if (out.event && typeof out.event === 'object') {
      out.event = { type: out.event.type || null, ts: out.event.ts || null };
    }
    return out;
  }

  _attemptWrite(fn, { metricName, errorCodePrefix, alertCode, alertMessage, logLevel = 'warn', meta = {} }) {
    let attemptedRetry = false;
    while (true) {
      try {
        fn();
        return { ok: true };
      } catch (err) {
        if (!attemptedRetry && this._isTransientFsError(err)) {
          attemptedRetry = true;
          continue;
        }
        this._recordMetric(metricName);
        const error_code = `${errorCodePrefix}${err?.code ? `:${err.code}` : ''}`;
        const message = err?.message || 'unknown error';
        this.raiseAlert({
          level: 'warn',
          code: alertCode,
          message: alertMessage,
          error_code,
        });
        this._log(logLevel, alertMessage, this._safeMeta({ ...meta, error_code, message }));
        return { ok: false, error_code, message, retry_attempted: attemptedRetry };
      }
    }
  }

  getSnapshot() {
    return this.snapshot;
  }

  setSnapshot(next) {
    this.snapshot = {
      ...this.snapshot,
      ...next,
      native: next.native ?? this.snapshot.native ?? null,
      actions: next.actions ?? this.snapshot.actions ?? { recent: [] },
      alerts: next.alerts ?? this.snapshot.alerts ?? [],
      metrics: next.metrics ?? this.snapshot.metrics ?? null,
      ui: next.ui ?? this.snapshot.ui ?? {},
    };
    this.snapshot.schema_version = CURRENT_SCHEMA_VERSION;
    const snapshotWrite = this._attemptWrite(
      () => writeJSON(this.paths.snapshotFile, this.snapshot),
      {
        metricName: 'snapshot_write_fail',
        errorCodePrefix: 'state_store_snapshot_write_fail',
        alertCode: 'state_store_snapshot_write_fail',
        alertMessage: 'Failed to persist sidecar snapshot',
        meta: { file: this.paths.snapshotFile, snapshot: true },
      },
    );
    const timelineAppend = this._attemptWrite(() => {
      appendJSONL(this.paths.logFile, {
        ts: new Date().toISOString(),
        type: 'snapshot',
        team_count: Array.isArray(next.teams) ? next.teams.length : 0,
      });
    }, {
      metricName: 'log_append_fail',
      errorCodePrefix: 'state_store_log_append_fail',
      alertCode: 'state_store_log_append_fail',
      alertMessage: 'Failed to append snapshot event to sidecar log',
      meta: { file: this.paths.logFile, event: { type: 'snapshot' } },
    });
    this.emit('snapshot', this.snapshot);
    this.emit('team.updated', { ts: new Date().toISOString(), teams: this.snapshot.teams || [] });
    if (snapshotWrite.ok && timelineAppend.ok) return { ok: true };
    return {
      ok: false,
      error_code: !snapshotWrite.ok ? snapshotWrite.error_code : timelineAppend.error_code,
      message: !snapshotWrite.ok ? snapshotWrite.message : timelineAppend.message,
      details: { snapshotWrite, timelineAppend },
    };
  }

  emitTimeline(event) {
    this.emit('timeline.event', event);
    return this._attemptWrite(
      () => appendJSONL(this.paths.logFile, { ...event, ts: event.ts || new Date().toISOString() }),
      {
        metricName: 'timeline_append_fail',
        errorCodePrefix: 'state_store_timeline_append_fail',
        alertCode: 'state_store_timeline_append_fail',
        alertMessage: 'Failed to append timeline event to sidecar log',
        meta: { file: this.paths.logFile, event },
      },
    );
  }

  emitAdapterHealth(adapter, health) {
    this.emit('adapter.health', { ts: new Date().toISOString(), adapter, ...health });
  }

  emitPolicyAlert(alert) {
    this.emit('policy.alert', { ts: new Date().toISOString(), ...alert });
  }

  setNativeCapabilities(native) {
    this.snapshot.native = { ...(this.snapshot.native || {}), ...native, updated_at: new Date().toISOString() };
    this.emit('native.capabilities.updated', this.snapshot.native);
  }

  emitBridgeStatus(status) {
    this.snapshot.native = { ...(this.snapshot.native || {}), bridge: status, bridge_status: status.bridge_status || status.status || null };
    this.emit('native.bridge.status', { ts: new Date().toISOString(), ...status });
  }

  setActionsRecent(actions) {
    this.snapshot.actions = { ...(this.snapshot.actions || {}), recent: actions };
  }

  setMetrics(metrics) {
    this.snapshot.metrics = metrics;
    this.emit('metrics.updated', { ts: new Date().toISOString(), metrics });
  }

  getPersistenceMetrics() {
    return { ...this.persistenceMetrics };
  }

  raiseAlert(alert) {
    const next = { ts: new Date().toISOString(), level: 'info', ...alert };
    const alerts = Array.isArray(this.snapshot.alerts) ? this.snapshot.alerts : [];
    this.snapshot.alerts = [next, ...alerts].slice(0, 100);
    this.emit('alert.raised', next);
    if (next.level === 'warn' || next.level === 'error') this.emitPolicyAlert(next);
  }

  emitActionQueued(action) {
    this.emit('action.queued', { ts: new Date().toISOString(), ...action });
  }

  emitActionStarted(action) {
    this.emit('action.started', { ts: new Date().toISOString(), ...action });
  }

  emitActionCompleted(action) {
    this.emit('action.completed', { ts: new Date().toISOString(), ...action });
  }

  emitActionFailed(action) {
    this.emit('action.failed', { ts: new Date().toISOString(), ...action });
  }
}
