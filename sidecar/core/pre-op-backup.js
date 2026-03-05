/**
 * Pre-destructive-operation backups — snapshot state before teardown/archive/gc/replace.
 */

import { join } from 'path';
import { readJSON, writeJSON, ensureDir, listDir } from './fs-utils.js';
import { statSync } from 'fs';

/**
 * Create a backup before a destructive operation.
 * @param {object} paths - sidecarPaths() output
 * @param {string} operation - operation type: teardown, archive, gc, replace, restore
 * @param {object} targets - what's being affected: { team_name?, task_ids?, scope? }
 * @returns {{ file: string, operation: string, targets: object }}
 */
export function createPreOpBackup(paths, operation, targets = {}) {
  ensureDir(paths.backupsDir);

  const snapshot = readJSON(paths.snapshotFile) || {};
  const teamConfigs = [];
  const taskFiles = [];

  // If targeting a specific team, only backup that team's data
  if (targets.team_name) {
    const teamFile = `${targets.team_name}.json`;
    const teamData = readJSON(join(paths.teamsDir, teamFile));
    if (teamData) teamConfigs.push({ file: teamFile, data: teamData });
  } else {
    // Backup all team configs
    for (const f of listDir(paths.teamsDir).filter(x => x.endsWith('.json'))) {
      const data = readJSON(join(paths.teamsDir, f));
      if (data) teamConfigs.push({ file: f, data });
    }
  }

  // If targeting specific tasks, only backup those
  if (targets.task_ids && Array.isArray(targets.task_ids)) {
    for (const id of targets.task_ids) {
      const f = `${id}.json`;
      const data = readJSON(join(paths.tasksDir, f));
      if (data) taskFiles.push({ file: f, data });
    }
  } else {
    for (const f of listDir(paths.tasksDir).filter(x => x.endsWith('.json'))) {
      const data = readJSON(join(paths.tasksDir, f));
      if (data) taskFiles.push({ file: f, data });
    }
  }

  const backup = {
    created_at: new Date().toISOString(),
    operation,
    targets,
    snapshot,
    teams: teamConfigs,
    tasks: taskFiles,
  };

  const safe = operation.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = join(paths.backupsDir, `pre-${safe}-${Date.now()}.json`);
  writeJSON(file, backup);
  return { file, operation, targets };
}

/**
 * List all pre-op backups, optionally filtered by operation type.
 * @param {object} paths
 * @param {string|null} operation - filter by operation type
 * @returns {Array<{ file: string, operation: string, created_at: string, size_bytes: number }>}
 */
export function listBackups(paths, operation = null) {
  const files = listDir(paths.backupsDir)
    .filter(f => f.startsWith('pre-') && f.endsWith('.json'))
    .sort();

  return files.map(f => {
    const fp = join(paths.backupsDir, f);
    try {
      const st = statSync(fp);
      const data = readJSON(fp);
      if (operation && data?.operation !== operation) return null;
      return {
        file: f,
        path: fp,
        operation: data?.operation || 'unknown',
        created_at: data?.created_at || null,
        teams_count: data?.teams?.length || 0,
        tasks_count: data?.tasks?.length || 0,
        size_bytes: st.size,
      };
    } catch { return null; }
  }).filter(Boolean);
}

/**
 * Restore state from a pre-op backup.
 * Additive semantics: files present in the backup are restored/overwritten,
 * but files not present in the backup are left untouched.
 * @param {object} paths
 * @param {string} backupFile - full path to backup file
 * @returns {{ restored: boolean, teams_count: number, tasks_count: number, error?: string }}
 */
export function restoreFromBackup(paths, backupFile) {
  const backup = readJSON(backupFile);
  if (!backup) return { restored: false, teams_count: 0, tasks_count: 0, error: 'backup file unreadable' };

  if (backup.snapshot) {
    try { writeJSON(paths.snapshotFile, backup.snapshot); } catch { /* continue */ }
  }

  let teamsRestored = 0;
  ensureDir(paths.teamsDir);
  for (const team of (backup.teams || [])) {
    if (!team.file || !team.data) continue;
    try { writeJSON(join(paths.teamsDir, team.file), team.data); teamsRestored++; } catch { /* skip */ }
  }

  let tasksRestored = 0;
  ensureDir(paths.tasksDir);
  for (const task of (backup.tasks || [])) {
    if (!task.file || !task.data) continue;
    try { writeJSON(join(paths.tasksDir, task.file), task.data); tasksRestored++; } catch { /* skip */ }
  }

  return { restored: true, restore_mode: 'additive', teams_count: teamsRestored, tasks_count: tasksRestored };
}
