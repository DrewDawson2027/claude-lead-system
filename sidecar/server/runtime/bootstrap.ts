import { randomBytes } from "crypto";
import { statSync, chmodSync } from "fs";
import type {
  ParseArgsResult,
  SidecarPaths,
  TokenFileData,
  PermissionIssue,
  ReadJSONFn,
  WriteJSONFn,
  FileExistsFn
} from "./types.js";

export function readFileSafe(readFileSync: any, url: URL): string {
  try {
    return readFileSync(url, "utf-8");
  } catch {
    return "";
  }
}

export function parseArgs(argv: string[]): ParseArgsResult {
  const out: ParseArgsResult = {
    port: Number(process.env.LEAD_SIDECAR_PORT || 0) || 0,
    open: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--port" && argv[i + 1]) out.port = Number(argv[++i]) || 0;
    else if (a === "--open") out.open = true;
    else if (a === "--safe-mode") out.safeMode = true;
    else if (a === "--rotate-csrf-on-startup") out.rotateCsrf = true;
    else if (a === "--unix-socket" && argv[i + 1])
      out.unixSocket = String(argv[++i]);
    else if (a === "--tls-cert" && argv[i + 1])
      out.tlsCertFile = String(argv[++i]);
    else if (a === "--tls-key" && argv[i + 1])
      out.tlsKeyFile = String(argv[++i]);
    else if (a === "--tls-ca" && argv[i + 1]) out.tlsCaFile = String(argv[++i]);
    else if (a === "--mtls") out.mtls = true;
  }
  return out;
}

export function ensureApiToken(
  paths: SidecarPaths,
  fileExists: FileExistsFn,
  readJSON: ReadJSONFn,
  writeJsonFile: WriteJSONFn
): string | null {
  if (fileExists(paths.apiTokenFile)) {
    const data = readJSON(paths.apiTokenFile) as TokenFileData;
    return String(data?.token || "").trim() || null;
  }
  const token = randomBytes(24).toString("hex");
  writeJsonFile(paths.apiTokenFile, {
    token,
    created_at: new Date().toISOString(),
  });
  tightenPermissions(paths.apiTokenFile);
  return token;
}

export function rotateApiToken(
  paths: SidecarPaths,
  writeJsonFile: WriteJSONFn
): { new_token: string; rotated_at: string } {
  const token = randomBytes(24).toString("hex");
  writeJsonFile(paths.apiTokenFile, {
    token,
    created_at: new Date().toISOString(),
    rotated_at: new Date().toISOString(),
  });
  tightenPermissions(paths.apiTokenFile);
  return { new_token: token, rotated_at: new Date().toISOString() };
}

export function ensureCsrfToken(
  paths: SidecarPaths,
  fileExists: FileExistsFn,
  readJSON: ReadJSONFn,
  writeJsonFile: WriteJSONFn,
  { rotateCsrf = false }: { rotateCsrf?: boolean } = {},
): string {
  if (fileExists(paths.csrfTokenFile) && !rotateCsrf) {
    const existing = readJSON(paths.csrfTokenFile) as TokenFileData;
    const existingToken = String(existing?.token || "").trim();
    if (existingToken) {
      const ttlHours = Number(process.env.LEAD_SIDECAR_CSRF_TTL_HOURS || 0);
      if (ttlHours > 0 && existing?.created_at) {
        const ageMs = Date.now() - new Date(existing.created_at).getTime();
        if (ageMs > ttlHours * 3600_000) {
          const token = randomBytes(24).toString("hex");
          writeJsonFile(paths.csrfTokenFile, {
            token,
            created_at: new Date().toISOString(),
            previous_rotated_at: existing.created_at,
          });
          tightenPermissions(paths.csrfTokenFile);
          return token;
        }
      }
      return existingToken;
    }
  }
  const token = randomBytes(24).toString("hex");
  writeJsonFile(paths.csrfTokenFile, {
    token,
    created_at: new Date().toISOString(),
  });
  tightenPermissions(paths.csrfTokenFile);
  return token;
}

function tightenPermissions(filePath: string): void {
  try {
    chmodSync(filePath, 0o600);
  } catch { }
}

function tightenDirPermissions(dirPath: string): void {
  try {
    chmodSync(dirPath, 0o700);
  } catch { }
}

export function checkFilePermissions(
  paths: SidecarPaths,
  fileExists: FileExistsFn
): { ok: boolean; issues: PermissionIssue[] } {
  const sensitiveDirs = [
    { path: paths.root, name: 'lead-sidecar' },
    { path: paths.runtimeDir, name: 'runtime/' },
    { path: paths.stateDir, name: 'state/' },
    { path: paths.logsDir, name: 'logs/' },
    { path: paths.diagnosticsDir, name: 'logs/diagnostics/' },
  ];
  const sensitiveFiles = [
    { path: paths.apiTokenFile, name: "api.token" },
    { path: paths.csrfTokenFile, name: "csrf.token" },
    { path: paths.lockFile, name: "sidecar.lock" },
    { path: paths.portFile, name: "sidecar.port" },
  ];
  const issues: PermissionIssue[] = [];
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  for (const { path, name } of sensitiveDirs) {
    if (!fileExists(path)) continue;
    try {
      const st = statSync(path);
      const mode = st.mode & 0o777;
      if (mode & 0o077) {
        try {
          tightenDirPermissions(path);
        } catch { }
        issues.push({
          file: name,
          expected: '0700',
          actual: `0${mode.toString(8)}`,
          action: 'auto-fixed',
        });
      }
      if (uid !== null && st.uid !== uid) {
        issues.push({
          file: name,
          expected_uid: uid,
          actual_uid: st.uid,
          action: 'warning',
        });
      }
    } catch { }
  }
  for (const { path, name } of sensitiveFiles) {
    if (!fileExists(path)) continue;
    try {
      const st = statSync(path);
      const mode = st.mode & 0o777;
      if (mode & 0o077) {
        try {
          chmodSync(path, 0o600);
        } catch { }
        issues.push({
          file: name,
          expected: "0600",
          actual: `0${mode.toString(8)}`,
          action: "auto-fixed",
        });
      }
      if (uid !== null && st.uid !== uid) {
        issues.push({
          file: name,
          expected_uid: uid,
          actual_uid: st.uid,
          action: "warning",
        });
      }
    } catch { }
  }
  return { ok: issues.length === 0, issues };
}

export function writeRuntimeFiles(
  paths: SidecarPaths,
  server: any,
  writeJSON: WriteJSONFn
): number | null {
  const addr = server.address();
  const isSocket = typeof addr === "string";
  const port = typeof addr === "object" && addr ? addr.port : null;
  tightenDirPermissions(paths.root);
  tightenDirPermissions(paths.runtimeDir);
  tightenDirPermissions(paths.stateDir);
  tightenDirPermissions(paths.logsDir);
  tightenDirPermissions(paths.diagnosticsDir);
  writeJSON(paths.lockFile, {
    pid: process.pid,
    started_at: new Date().toISOString(),
  });
  writeJSON(paths.portFile, {
    port,
    socket: isSocket ? addr : null,
    transport: isSocket ? "unix" : "tcp",
    pid: process.pid,
    updated_at: new Date().toISOString(),
  });
  tightenPermissions(paths.lockFile);
  tightenPermissions(paths.portFile);
  return port;
}
