// @ts-nocheck
import { randomBytes } from 'crypto';

export function readFileSafe(readFileSync, url) {
  try { return readFileSync(url, 'utf-8'); } catch { return ''; }
}

export function parseArgs(argv) {
  const out = { port: Number(process.env.LEAD_SIDECAR_PORT || 0) || 0, open: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]) || 0;
    else if (a === '--open') out.open = true;
    else if (a === '--safe-mode') out.safeMode = true;
  }
  return out;
}

export function ensureApiToken(paths, fileExists, readJSON, writeJsonFile) {
  if (fileExists(paths.apiTokenFile)) {
    return String(readJSON(paths.apiTokenFile)?.token || '').trim() || null;
  }
  const token = randomBytes(24).toString('hex');
  writeJsonFile(paths.apiTokenFile, { token, created_at: new Date().toISOString() });
  return token;
}

export function ensureCsrfToken(paths, fileExists, readJSON, writeJsonFile) {
  if (fileExists(paths.csrfTokenFile)) {
    return String(readJSON(paths.csrfTokenFile)?.token || '').trim() || null;
  }
  const token = randomBytes(24).toString('hex');
  writeJsonFile(paths.csrfTokenFile, { token, created_at: new Date().toISOString() });
  return token;
}

export function writeRuntimeFiles(paths, server, writeJSON) {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : null;
  writeJSON(paths.lockFile, { pid: process.pid, started_at: new Date().toISOString() });
  writeJSON(paths.portFile, { port, pid: process.pid, updated_at: new Date().toISOString() });
  return port;
}
