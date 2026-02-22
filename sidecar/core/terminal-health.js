/**
 * Terminal/worker health monitoring — zombie, stale, and dead shell detection.
 */

import { join } from 'path';
import { readJSON, listDir } from './fs-utils.js';

/**
 * Check if a process is alive by PID.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Scan all session and worker files for health issues.
 * @param {object} paths - sidecarPaths() output
 * @returns {{ healthy: object[], zombies: object[], stale: object[], dead_shells: object[], summary: string }}
 */
export function checkTerminalHealth(paths) {
  const healthy = [];
  const zombies = [];
  const stale = [];
  const dead_shells = [];
  const now = Date.now();
  const staleThresholdMs = 5 * 60_000;

  // Check session files
  for (const f of listDir(paths.terminalsDir).filter(x => x.startsWith('session-') && x.endsWith('.json'))) {
    const fp = join(paths.terminalsDir, f);
    const session = readJSON(fp);
    if (!session) continue;

    const sessionId = session.session_id || f.replace('session-', '').replace('.json', '');
    const pid = session.pid;
    const status = session.status || 'unknown';
    const updatedAt = session.updated_at || session.last_active;
    const ageMs = updatedAt ? (now - new Date(updatedAt).getTime()) : Infinity;

    const entry = { session_id: sessionId, file: f, pid, status, age_ms: ageMs };

    if (status === 'stale' || status === 'closed') continue; // Already marked

    if (pid && !isProcessAlive(pid)) {
      zombies.push({ ...entry, issue: 'PID not alive but session file still active' });
    } else if (Number.isFinite(ageMs) && ageMs > staleThresholdMs && status === 'active') {
      stale.push({ ...entry, issue: `No update for ${(ageMs / 60_000).toFixed(1)} minutes` });
    } else {
      healthy.push(entry);
    }
  }

  // Check worker meta files for dead shells
  const resultsDir = join(paths.terminalsDir, 'results');
  for (const f of listDir(resultsDir).filter(x => x.endsWith('.meta.json') && !x.includes('.done'))) {
    const fp = join(resultsDir, f);
    const meta = readJSON(fp);
    if (!meta) continue;

    const taskId = meta.task_id || f.replace('.meta.json', '');
    const doneFile = join(resultsDir, `${taskId}.meta.json.done`);
    const pidFile = join(resultsDir, `${taskId}.pid`);

    // Skip completed workers
    const doneData = readJSON(doneFile);
    if (doneData) continue;

    // Check if worker PID is still alive
    const pidData = readJSON(pidFile);
    const pid = pidData?.pid || meta.pid;
    if (pid && !isProcessAlive(pid)) {
      dead_shells.push({
        task_id: taskId,
        file: f,
        pid,
        issue: 'Worker PID not alive but no .done marker',
        name: meta.name,
      });
    }
  }

  const parts = [];
  if (healthy.length) parts.push(`${healthy.length} healthy`);
  if (zombies.length) parts.push(`${zombies.length} zombies`);
  if (stale.length) parts.push(`${stale.length} stale`);
  if (dead_shells.length) parts.push(`${dead_shells.length} dead shells`);

  return {
    healthy,
    zombies,
    stale,
    dead_shells,
    summary: parts.join(', ') || 'No sessions found',
  };
}

/**
 * Generate recovery suggestions for unhealthy entries.
 * @param {{ zombies: object[], stale: object[], dead_shells: object[] }} findings
 * @returns {Array<{ id: string, issue: string, suggested_action: string }>}
 */
export function suggestRecovery(findings) {
  const suggestions = [];
  for (const z of (findings.zombies || [])) {
    suggestions.push({
      id: z.session_id || z.task_id,
      issue: z.issue,
      suggested_action: 'clean_session',
      detail: `Remove session file and mark as closed`,
    });
  }
  for (const s of (findings.stale || [])) {
    suggestions.push({
      id: s.session_id,
      issue: s.issue,
      suggested_action: 'remove_stale',
      detail: `Mark session as stale or remove if no longer needed`,
    });
  }
  for (const d of (findings.dead_shells || [])) {
    suggestions.push({
      id: d.task_id,
      issue: d.issue,
      suggested_action: 'restart_worker',
      detail: `Worker died without completing — mark .done or restart`,
    });
  }
  return suggestions;
}
