import { randomUUID } from "crypto";
import { join } from "path";
import {
  ensureDirs,
  writeJSON,
  readJSON,
  listDir,
  removeFile,
} from "../core/fs-utils.js";

export function ensureBridgeDirs(paths) {
  ensureDirs([
    paths.nativeRuntimeDir,
    paths.nativeBridgeRequestDir,
    paths.nativeBridgeResponseDir,
  ]);
}

export function newRequestId() {
  return `NB_${randomUUID()}`;
}

export function requestPath(paths, requestId) {
  return join(paths.nativeBridgeRequestDir, `${requestId}.json`);
}

export function responsePath(paths, requestId) {
  return join(paths.nativeBridgeResponseDir, `${requestId}.json`);
}

export function writeBridgeRequest(paths, req) {
  ensureBridgeDirs(paths);
  writeJSON(requestPath(paths, req.request_id), req);
  return requestPath(paths, req.request_id);
}

export function readBridgeResponse(paths, requestId) {
  return readJSON(responsePath(paths, requestId));
}

export async function waitForBridgeResponse(
  paths,
  requestId,
  timeoutMs = 15000,
  pollMs = 200,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = readBridgeResponse(paths, requestId);
    if (res) return res;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

export function listBridgeRequests(paths, limit = 50) {
  return listDir(paths.nativeBridgeRequestDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-limit)
    .map((f) => readJSON(join(paths.nativeBridgeRequestDir, f)))
    .filter(Boolean);
}

export function listBridgeResponses(paths, limit = 50) {
  return listDir(paths.nativeBridgeResponseDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-limit)
    .map((f) => readJSON(join(paths.nativeBridgeResponseDir, f)))
    .filter(Boolean);
}

export function findStuckBridgeRequests(paths, stuckMs = 30_000) {
  const now = Date.now();
  return listDir(paths.nativeBridgeRequestDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const req = readJSON(join(paths.nativeBridgeRequestDir, f));
      if (!req?.request_id) return null;
      const res = readJSON(responsePath(paths, req.request_id));
      if (res) return null;
      const ts = req.ts || req.created_at;
      const age_ms = ts ? now - new Date(ts).getTime() : null;
      if (!Number.isFinite(age_ms) || age_ms < stuckMs) return null;
      return {
        request_id: req.request_id,
        action: req.action || null,
        team_name: req.team_name || null,
        age_ms,
        timeout_ms: req.timeout_ms || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.age_ms - a.age_ms);
}

export function sweepBridgeQueues(
  paths,
  { requestMaxAgeMs = 30 * 60_000, responseMaxAgeMs = 30 * 60_000 } = {},
) {
  const now = Date.now();
  const removed = { requests: 0, responses: 0 };
  for (const f of listDir(paths.nativeBridgeRequestDir).filter((x) =>
    x.endsWith(".json"),
  )) {
    const p = join(paths.nativeBridgeRequestDir, f);
    const req = readJSON(p);
    const t = req?.ts || req?.created_at;
    const ageMs = t ? now - new Date(t).getTime() : 0;
    if (Number.isFinite(ageMs) && ageMs > requestMaxAgeMs) {
      if (removeFile(p)) removed.requests += 1;
    }
  }
  for (const f of listDir(paths.nativeBridgeResponseDir).filter((x) =>
    x.endsWith(".json"),
  )) {
    const p = join(paths.nativeBridgeResponseDir, f);
    const res = readJSON(p);
    const t = res?.ts || res?.created_at;
    const ageMs = t ? now - new Date(t).getTime() : 0;
    if (Number.isFinite(ageMs) && ageMs > responseMaxAgeMs) {
      if (removeFile(p)) removed.responses += 1;
    }
  }
  return removed;
}

export function cleanupBridgeRequestResponse(paths, requestId) {
  removeFile(requestPath(paths, requestId));
  removeFile(responsePath(paths, requestId));
}
