import { spawnSync } from "child_process";
import { readJSON } from "../core/fs-utils.js";

export function getBridgeHealth(paths, staleMs = 30000) {
  const status = readJSON(paths.nativeBridgeStatusFile) || {};
  const heartbeat = readJSON(paths.nativeBridgeHeartbeatFile) || {};
  const pid = status.pid || heartbeat.pid || null;
  let process_alive = false;
  if (pid && Number.isInteger(Number(pid)) && Number(pid) > 0) {
    try {
      if (process.platform === "win32") {
        const out = spawnSync(
          "tasklist",
          ["/FI", `PID eq ${Number(pid)}`, "/NH"],
          { encoding: "utf-8" },
        );
        process_alive = String(out.stdout || "").includes(String(pid));
      } else {
        process.kill(Number(pid), 0);
        process_alive = true;
      }
    } catch {
      process_alive = false;
    }
  }
  const last = heartbeat.ts
    || (status.session_id ? status.updated_at || status.started_at || null : null)
    || (status.starting ? status.updated_at || status.started_at || null : null);
  const ageMs = last ? Date.now() - new Date(last).getTime() : Infinity;
  const hasFreshnessSignal = Number.isFinite(ageMs) && ageMs >= 0;
  let bridge_status = "down";
  if (status.starting) bridge_status = "starting";
  else if (hasFreshnessSignal && ageMs <= staleMs) bridge_status = "healthy";
  else if (hasFreshnessSignal && ageMs <= staleMs * 3) bridge_status = "stale";
  else if (hasFreshnessSignal) bridge_status = "degraded";
  else if (process_alive) bridge_status = "degraded";

  return {
    ok: bridge_status === "healthy",
    bridge_status,
    pid: pid || null,
    session_id: status.session_id || heartbeat.session_id || null,
    task_id: status.task_id || null,
    worker_name: status.worker_name || "sidecar-native-bridge",
    last_heartbeat_at: heartbeat.ts || null,
    age_ms: Number.isFinite(ageMs) ? ageMs : null,
    capabilities: heartbeat.capabilities || status.capabilities || null,
    process_alive,
    note: status.note || null,
  };
}
