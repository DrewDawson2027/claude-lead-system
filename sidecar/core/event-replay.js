/**
 * Event replay — rebuild derived state from timeline events, consistency checking.
 */

import { replayTimeline } from './snapshot-diff.js';
import { readJSON } from './fs-utils.js';

/**
 * Rebuild derived state by replaying timeline events.
 * @param {string} logFile - path to timeline JSONL
 * @param {number|null} fromTs - start timestamp (ms), null = all
 * @returns {{ event_count: number, derived_state: object, gaps: string[] }}
 */
export function rebuildFromTimeline(logFile, fromTs = null) {
  const events = replayTimeline(logFile, fromTs, null, null);

  const derived = {
    snapshots_rebuilt: 0,
    tasks_created: 0,
    tasks_updated: 0,
    messages_sent: 0,
    alerts_raised: 0,
    maintenance_sweeps: 0,
    auto_rebalances: 0,
    teams_seen: new Set(),
    event_types: {},
  };
  const gaps = [];
  let lastTs = null;

  for (const e of events) {
    const type = e.type || 'unknown';
    derived.event_types[type] = (derived.event_types[type] || 0) + 1;

    // Detect time gaps (>5 minutes between events)
    if (lastTs) {
      const ts = e.ts ? new Date(e.ts).getTime() : 0;
      if (ts - lastTs > 5 * 60_000) {
        gaps.push(`${new Date(lastTs).toISOString()} → ${new Date(ts).toISOString()} (${((ts - lastTs) / 60_000).toFixed(1)}min)`);
      }
      lastTs = ts;
    } else if (e.ts) {
      lastTs = new Date(e.ts).getTime();
    }

    switch (type) {
      case 'snapshot.rebuilt': derived.snapshots_rebuilt++; break;
      case 'snapshot': derived.snapshots_rebuilt++; break;
      case 'task.created': derived.tasks_created++; break;
      case 'task.updated': derived.tasks_updated++; break;
      case 'message.sent': case 'message.delivered': derived.messages_sent++; break;
      case 'alert.raised': derived.alerts_raised++; break;
      case 'maintenance.sweep': derived.maintenance_sweeps++; break;
      case 'auto_rebalance.triggered': derived.auto_rebalances++; break;
    }

    if (e.team_name) derived.teams_seen.add(e.team_name);
  }

  return {
    event_count: events.length,
    derived_state: {
      ...derived,
      teams_seen: [...derived.teams_seen],
    },
    gaps,
  };
}

/**
 * Check consistency between event-derived state and current snapshot.
 * @param {{ event_count: number, derived_state: object }} derived
 * @param {object} actual - current snapshot
 * @returns {{ consistent: boolean, diffs: object[], summary: string }}
 */
export function consistencyCheck(derived, actual) {
  const diffs = [];

  // Check team count
  const actualTeams = (actual.teams || []).map(t => t.team_name).filter(Boolean);
  const derivedTeams = derived.derived_state.teams_seen || [];
  for (const t of derivedTeams) {
    if (!actualTeams.includes(t)) {
      diffs.push({ field: 'team', expected: t, actual: 'missing', issue: 'Team seen in events but not in current snapshot' });
    }
  }

  // Check alert count reasonableness
  const actualAlerts = (actual.alerts || []).length;
  if (derived.derived_state.alerts_raised > 0 && actualAlerts === 0) {
    diffs.push({ field: 'alerts', expected: `>0 (${derived.derived_state.alerts_raised} raised)`, actual: 0, issue: 'Alerts raised in events but none in snapshot' });
  }

  // Check that snapshot was rebuilt at least once
  if (derived.derived_state.snapshots_rebuilt === 0 && derived.event_count > 10) {
    diffs.push({ field: 'snapshots_rebuilt', expected: '>0', actual: 0, issue: 'No snapshot rebuild events found despite activity' });
  }

  const parts = [];
  if (diffs.length) parts.push(`${diffs.length} inconsistencies`);
  if (derived.gaps.length) parts.push(`${derived.gaps.length} time gaps`);

  return {
    consistent: diffs.length === 0,
    diffs,
    event_count: derived.event_count,
    gaps: derived.gaps,
    summary: parts.length ? parts.join(', ') : 'Consistent',
  };
}
