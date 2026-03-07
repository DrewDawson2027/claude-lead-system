/**
 * Corruption repair utilities — JSON/JSONL repair, corruption scanning, backup-before-fix.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from "fs";
import { join, basename } from "path";
import { readJSON, readText, writeJSON, listDir } from "./fs-utils.js";

/**
 * Attempt to repair a corrupt JSON file.
 * Backs up original, writes repaired version.
 * @param {string} filePath
 * @returns {{ repaired: boolean, backup_path: string|null, error: string|null }}
 */
export function repairJSON(filePath) {
  if (!existsSync(filePath))
    return { repaired: false, backup_path: null, error: "file not found" };

  const raw = readText(filePath);
  if (raw === null)
    return { repaired: false, backup_path: null, error: "unreadable" };

  // Try normal parse first
  try {
    JSON.parse(raw);
    return { repaired: false, backup_path: null, error: null }; // Already valid
  } catch {
    /* needs repair */
  }

  const backupPath = `${filePath}.corrupt.${Date.now()}`;
  try {
    copyFileSync(filePath, backupPath);
  } catch {
    return { repaired: false, backup_path: null, error: "backup failed" };
  }

  // Attempt recovery strategies
  const trimmed = raw.trim();

  // Strategy 1: trailing garbage after valid JSON
  for (let i = trimmed.length; i > 0; i--) {
    try {
      const candidate = trimmed.slice(0, i);
      const parsed = JSON.parse(candidate);
      writeFileSync(filePath, JSON.stringify(parsed, null, 2));
      return { repaired: true, backup_path: backupPath, error: null };
    } catch {
      continue;
    }
  }

  // Strategy 2: write empty object as fallback
  writeFileSync(filePath, "{}");
  return {
    repaired: true,
    backup_path: backupPath,
    error: "replaced with empty object",
  };
}

/**
 * Repair a JSONL file by quarantining unparseable lines.
 * @param {string} filePath
 * @returns {{ total_lines: number, valid_lines: number, quarantined_lines: number, quarantine_path: string|null }}
 */
export function repairJSONL(filePath) {
  if (!existsSync(filePath))
    return {
      total_lines: 0,
      valid_lines: 0,
      quarantined_lines: 0,
      quarantine_path: null,
    };

  const raw = readText(filePath);
  if (raw === null)
    return {
      total_lines: 0,
      valid_lines: 0,
      quarantined_lines: 0,
      quarantine_path: null,
    };

  const lines = raw.split("\n").filter((l) => l.trim());
  const valid = [];
  const quarantined = [];

  for (const line of lines) {
    try {
      JSON.parse(line);
      valid.push(line);
    } catch {
      quarantined.push(line);
    }
  }

  if (quarantined.length === 0) {
    return {
      total_lines: lines.length,
      valid_lines: valid.length,
      quarantined_lines: 0,
      quarantine_path: null,
    };
  }

  const quarantinePath = `${filePath}.quarantine`;
  try {
    writeFileSync(quarantinePath, quarantined.join("\n") + "\n");
    writeFileSync(filePath, valid.join("\n") + (valid.length ? "\n" : ""));
  } catch {
    return {
      total_lines: lines.length,
      valid_lines: valid.length,
      quarantined_lines: quarantined.length,
      quarantine_path: null,
    };
  }

  return {
    total_lines: lines.length,
    valid_lines: valid.length,
    quarantined_lines: quarantined.length,
    quarantine_path: quarantinePath,
  };
}

/**
 * Repair all JSON files in a directory matching a pattern.
 * @param {string} dirPath
 * @param {string} suffix - file suffix to match (e.g., '.json')
 * @returns {{ files_checked: number, repaired: object[] }}
 */
export function repairDir(dirPath, suffix = ".json") {
  const files = listDir(dirPath).filter((f) => f.endsWith(suffix));
  const results = [];
  for (const f of files) {
    const result = repairJSON(join(dirPath, f));
    if (result.repaired) results.push({ file: f, ...result });
  }
  return { files_checked: files.length, repaired: results };
}

/**
 * Scan all critical state files for corruption.
 * @param {object} paths - sidecarPaths() output
 * @returns {{ files_checked: number, corrupt_files: { path: string, error: string }[] }}
 */
export function scanForCorruption(paths) {
  const corrupt = [];
  let checked = 0;

  // Check JSON files
  const jsonFiles = [
    paths.snapshotFile,
    paths.uiPrefsFile,
    paths.taskTemplatesFile,
    paths.nativeBridgeStatusFile,
    paths.nativeBridgeHeartbeatFile,
    paths.nativeBridgeValidationFile,
    paths.nativeCapabilitiesFile,
  ];

  for (const f of jsonFiles) {
    if (!existsSync(f)) continue;
    checked++;
    const raw = readText(f);
    if (raw === null) {
      corrupt.push({ path: f, error: "unreadable" });
      continue;
    }
    try {
      JSON.parse(raw);
    } catch (e) {
      corrupt.push({ path: f, error: e.message });
    }
  }

  // Check JSONL files
  const jsonlFiles = [paths.logFile, paths.activityFile];
  for (const f of jsonlFiles) {
    if (!existsSync(f)) continue;
    checked++;
    const raw = readText(f);
    if (raw === null) {
      corrupt.push({ path: f, error: "unreadable" });
      continue;
    }
    const lines = raw.split("\n").filter((l) => l.trim());
    let badLines = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
      } catch {
        badLines++;
      }
    }
    if (badLines > 0)
      corrupt.push({
        path: f,
        error: `${badLines} of ${lines.length} lines corrupt`,
      });
  }

  // Check team config files
  for (const dir of [paths.teamsDir, paths.tasksDir]) {
    for (const f of listDir(dir).filter((x) => x.endsWith(".json"))) {
      checked++;
      const fp = join(dir, f);
      const raw = readText(fp);
      if (raw === null) {
        corrupt.push({ path: fp, error: "unreadable" });
        continue;
      }
      try {
        JSON.parse(raw);
      } catch (e) {
        corrupt.push({ path: fp, error: e.message });
      }
    }
  }

  // Check action queue dirs
  for (const dir of [
    paths.actionsPendingDir,
    paths.actionsInflightDir,
    paths.actionsDoneDir,
    paths.actionsFailedDir,
  ]) {
    for (const f of listDir(dir).filter((x) => x.endsWith(".json"))) {
      checked++;
      const fp = join(dir, f);
      const raw = readText(fp);
      if (raw === null) {
        corrupt.push({ path: fp, error: "unreadable" });
        continue;
      }
      try {
        JSON.parse(raw);
      } catch (e) {
        corrupt.push({ path: fp, error: e.message });
      }
    }
  }

  return { files_checked: checked, corrupt_files: corrupt };
}
