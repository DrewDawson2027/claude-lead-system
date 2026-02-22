/**
 * Snapshot diffing and timeline replay.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function diffSnapshots(before, after) {
  if (!before || !after) return { added: [], removed: [], changed: [], summary: 'Missing snapshot data' };

  const added = [];
  const removed = [];
  const changed = [];

  // Diff teammates
  const beforeMembers = new Map((before.teammates || []).map(m => [m.id || m.display_name, m]));
  const afterMembers = new Map((after.teammates || []).map(m => [m.id || m.display_name, m]));
  for (const [id, m] of afterMembers) {
    if (!beforeMembers.has(id)) { added.push({ type: 'teammate', id, detail: m }); continue; }
    const prev = beforeMembers.get(id);
    const changes = [];
    if (prev.presence !== m.presence) changes.push({ field: 'presence', before: prev.presence, after: m.presence });
    if (prev.load_score !== m.load_score) changes.push({ field: 'load_score', before: prev.load_score, after: m.load_score });
    if (changes.length) changed.push({ type: 'teammate', id, changes });
  }
  for (const [id] of beforeMembers) {
    if (!afterMembers.has(id)) removed.push({ type: 'teammate', id });
  }

  // Diff tasks
  const beforeTasks = new Map((before.tasks || []).map(t => [t.task_id || t.id, t]));
  const afterTasks = new Map((after.tasks || []).map(t => [t.task_id || t.id, t]));
  for (const [id, t] of afterTasks) {
    if (!beforeTasks.has(id)) { added.push({ type: 'task', id, detail: { subject: t.subject, status: t.status } }); continue; }
    const prev = beforeTasks.get(id);
    const changes = [];
    if (prev.status !== t.status) changes.push({ field: 'status', before: prev.status, after: t.status });
    if (prev.assignee !== t.assignee) changes.push({ field: 'assignee', before: prev.assignee, after: t.assignee });
    if (prev.priority !== t.priority) changes.push({ field: 'priority', before: prev.priority, after: t.priority });
    if (changes.length) changed.push({ type: 'task', id, changes });
  }
  for (const [id] of beforeTasks) {
    if (!afterTasks.has(id)) removed.push({ type: 'task', id });
  }

  // Diff alerts
  const beforeAlertCount = (before.alerts || []).length;
  const afterAlertCount = (after.alerts || []).length;
  if (beforeAlertCount !== afterAlertCount) {
    changed.push({ type: 'alerts', id: 'count', changes: [{ field: 'count', before: beforeAlertCount, after: afterAlertCount }] });
  }

  const parts = [];
  if (added.length) parts.push(`${added.length} added`);
  if (removed.length) parts.push(`${removed.length} removed`);
  if (changed.length) parts.push(`${changed.length} changed`);
  const summary = parts.length ? parts.join(', ') : 'No changes';

  return { added, removed, changed, summary };
}

export function replayTimeline(logFile, fromTs, toTs, typeFilter = null) {
  try {
    const raw = readFileSync(logFile, 'utf-8');
    const events = raw.trim().split('\n')
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .filter(e => {
        const ts = e.ts ? new Date(e.ts).getTime() : 0;
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
        if (typeFilter && e.type !== typeFilter) return false;
        return true;
      });
    return events;
  } catch { return []; }
}

export function buildTimelineReport(events) {
  const byType = {};
  for (const e of events) {
    const t = e.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  }
  const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  return {
    total_events: events.length,
    by_type: Object.fromEntries(sorted),
    time_range: events.length > 0
      ? { from: events[0].ts, to: events[events.length - 1].ts }
      : null,
  };
}

export function loadSnapshotHistory(dir, maxEntries = 50) {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith('snap-') && f.endsWith('.json'))
      .sort()
      .slice(-maxEntries);
    return files.map(f => {
      try { return { file: f, data: JSON.parse(readFileSync(join(dir, f), 'utf-8')) }; } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
