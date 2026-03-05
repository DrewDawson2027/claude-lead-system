/**
 * Recovery checkpoints — periodic snapshots of team state with restore capability.
 */

import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { readJSON, writeJSON, ensureDir, listDir } from './fs-utils.js';
import { CURRENT_SCHEMA_VERSION, migrateBundle } from './schema.js';

/**
 * Create a checkpoint capturing full team/task/snapshot state.
 * @param {object} paths - sidecarPaths() output
 * @param {string} label - human-readable label
 * @returns {{ file: string, teams_count: number, tasks_count: number }}
 */
export function createCheckpoint(paths, label = 'manual') {
  ensureDir(paths.checkpointsDir);

  const snapshot = readJSON(paths.snapshotFile) || {};
  const teams = listDir(paths.teamsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: f, data: readJSON(join(paths.teamsDir, f)) }))
    .filter(e => e.data);
  const tasks = listDir(paths.tasksDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: f, data: readJSON(join(paths.tasksDir, f)) }))
    .filter(e => e.data);

  const checkpoint = {
    schema_version: CURRENT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    label,
    snapshot,
    teams,
    tasks,
  };

  const file = join(paths.checkpointsDir, `cp-${Date.now()}-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  writeJSON(file, checkpoint);
  return { file, teams_count: teams.length, tasks_count: tasks.length };
}

/**
 * List all checkpoints sorted by creation time.
 * @param {object} paths
 * @returns {Array<{ file: string, label: string, created_at: string, size_bytes: number }>}
 */
export function listCheckpoints(paths) {
  const files = listDir(paths.checkpointsDir)
    .filter(f => f.startsWith('cp-') && f.endsWith('.json'))
    .sort();

  return files.map(f => {
    const fp = join(paths.checkpointsDir, f);
    try {
      const st = statSync(fp);
      const data = readJSON(fp);
      return {
        file: f,
        path: fp,
        label: data?.label || 'unknown',
        created_at: data?.created_at || null,
        schema_version: data?.schema_version || null,
        teams_count: data?.teams?.length || 0,
        tasks_count: data?.tasks?.length || 0,
        size_bytes: st.size,
      };
    } catch { return null; }
  }).filter(Boolean);
}

/**
 * Restore state from a checkpoint file.
 * Additive semantics: files present in the checkpoint are restored/overwritten,
 * but files not present in the checkpoint are left untouched.
 * @param {object} paths
 * @param {string} checkpointFile - full path to checkpoint file
 * @returns {{ restored: boolean, teams_count: number, tasks_count: number, error?: string }}
 */
export function restoreCheckpoint(paths, checkpointFile) {
  const cp = readJSON(checkpointFile);
  if (!cp) return { restored: false, teams_count: 0, tasks_count: 0, error: 'checkpoint file unreadable' };

  // Migrate if needed
  if (cp.schema_version && cp.schema_version < CURRENT_SCHEMA_VERSION) {
    try { migrateBundle(cp); } catch { /* best effort */ }
  }

  // Restore snapshot
  if (cp.snapshot) {
    try { writeJSON(paths.snapshotFile, cp.snapshot); } catch { /* continue */ }
  }

  // Restore team configs
  let teamsRestored = 0;
  ensureDir(paths.teamsDir);
  for (const team of (cp.teams || [])) {
    if (!team.file || !team.data) continue;
    try {
      writeJSON(join(paths.teamsDir, team.file), team.data);
      teamsRestored++;
    } catch { /* skip */ }
  }

  // Restore task files
  let tasksRestored = 0;
  ensureDir(paths.tasksDir);
  for (const task of (cp.tasks || [])) {
    if (!task.file || !task.data) continue;
    try {
      writeJSON(join(paths.tasksDir, task.file), task.data);
      tasksRestored++;
    } catch { /* skip */ }
  }

  return { restored: true, restore_mode: 'additive', teams_count: teamsRestored, tasks_count: tasksRestored };
}

/**
 * Keep only the newest maxCount checkpoints, remove older ones.
 * @param {object} paths
 * @param {number} maxCount
 * @returns {{ kept: number, removed: number }}
 */
export function rotateCheckpoints(paths, maxCount = 20) {
  const files = listDir(paths.checkpointsDir)
    .filter(f => f.startsWith('cp-') && f.endsWith('.json'))
    .sort();

  if (files.length <= maxCount) return { kept: files.length, removed: 0 };

  const toRemove = files.slice(0, files.length - maxCount);
  let removed = 0;
  for (const f of toRemove) {
    try { unlinkSync(join(paths.checkpointsDir, f)); removed++; } catch { /* skip */ }
  }
  return { kept: files.length - removed, removed };
}
