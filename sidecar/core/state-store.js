import { EventEmitter } from 'events';
import { writeJSON, appendJSONL } from './fs-utils.js';
import { CURRENT_SCHEMA_VERSION } from './schema.js';

export class SidecarStateStore extends EventEmitter {
  constructor(paths) {
    super();
    this.paths = paths;
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
    try { writeJSON(this.paths.snapshotFile, this.snapshot); } catch {}
    try {
      appendJSONL(this.paths.logFile, {
        ts: new Date().toISOString(),
        type: 'snapshot',
        team_count: Array.isArray(next.teams) ? next.teams.length : 0,
      });
    } catch {}
    this.emit('snapshot', this.snapshot);
    this.emit('team.updated', { ts: new Date().toISOString(), teams: this.snapshot.teams || [] });
  }

  emitTimeline(event) {
    this.emit('timeline.event', event);
    try { appendJSONL(this.paths.logFile, { ...event, ts: event.ts || new Date().toISOString() }); } catch {}
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
