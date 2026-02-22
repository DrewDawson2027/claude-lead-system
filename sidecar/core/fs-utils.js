import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync, renameSync } from 'fs';

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function ensureDirs(dirs) {
  for (const d of dirs) ensureDir(d);
}

export function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

export function writeJSON(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export function readJSONL(path) {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function appendJSONL(path, obj) {
  appendFileSync(path, `${JSON.stringify(obj)}\n`);
}

export function readText(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

export function fileExists(path) {
  return existsSync(path);
}

export function listDir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

export function removeFile(path) {
  try { unlinkSync(path); return true; } catch { return false; }
}

export function moveFile(from, to) {
  renameSync(from, to);
}
