import { createHash } from "crypto";
import type {
  MaintenanceSweepDeps,
  MaintenanceSweepResult,
  DiagnosticsBundleDeps,
  DiagnosticsResult,
} from "./types.js";

export function createMaintenanceSweep({
  actionQueue,
  paths,
  findStuckBridgeRequests,
  sweepBridgeQueues,
  store,
  rateLimiter,
  getAllTasksSnapshot,
  applyPriorityAging,
  getTeamsSnapshot,
  shouldAutoRebalance,
  coordinatorAdapter,
  metrics,
  createCheckpoint,
  rotateCheckpoints,
  checkTerminalHealth,
  suggestRecovery,
  validateHooks,
}: MaintenanceSweepDeps) {
  const seenBridgeStuck = new Set<string>();
  let lastCheckpointTime = 0;
  let sweepCount = 0;
  const autoRebalanceTimes = new Map<string, number>();

  return function maintenanceSweep({
    source = "periodic",
  } = {}): MaintenanceSweepResult {
    const recovered = actionQueue.recoverStaleInflight(
      Number(process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS || 5 * 60_000),
    );
    const actionGc = actionQueue.sweep({
      pendingMaxAgeMs: Number(
        process.env.LEAD_SIDECAR_PENDING_RETENTION_MS || 24 * 60 * 60_000,
      ),
      doneMaxAgeMs: Number(
        process.env.LEAD_SIDECAR_DONE_RETENTION_MS || 24 * 60 * 60_000,
      ),
      failedMaxAgeMs: Number(
        process.env.LEAD_SIDECAR_FAILED_RETENTION_MS || 7 * 24 * 60 * 60_000,
      ),
    });
    const bridgeGc = sweepBridgeQueues(paths, {
      requestMaxAgeMs: Number(
        process.env.LEAD_SIDECAR_BRIDGE_REQ_RETENTION_MS || 30 * 60_000,
      ),
      responseMaxAgeMs: Number(
        process.env.LEAD_SIDECAR_BRIDGE_RESP_RETENTION_MS || 30 * 60_000,
      ),
    });
    const stuck = findStuckBridgeRequests(
      paths,
      Number(process.env.LEAD_SIDECAR_BRIDGE_STUCK_MS || 30_000),
    );
    for (const s of stuck) {
      if (seenBridgeStuck.has(s.request_id)) continue;
      seenBridgeStuck.add(s.request_id);
      store.raiseAlert({
        level: "warn",
        code: "bridge_stuck_request",
        message: `Bridge request ${s.request_id} stuck for ${s.age_ms}ms`,
        request_id: s.request_id,
        team_name: s.team_name || undefined,
      });
    }
    rateLimiter.gc();
    const report = {
      source,
      recovered_inflight: recovered.length,
      action_gc: actionGc,
      bridge_gc: bridgeGc,
      stuck_bridge_requests: stuck.length,
    };
    if (
      recovered.length ||
      actionGc.pending ||
      actionGc.done ||
      actionGc.failed ||
      bridgeGc.requests ||
      bridgeGc.responses ||
      stuck.length
    ) {
      store.emitTimeline({ type: "maintenance.sweep", ...report });
    }

    const allTasks = getAllTasksSnapshot();
    const agingResult = applyPriorityAging(allTasks, {});
    if (agingResult.aged.length > 0) {
      for (const task of agingResult.tasks) {
        coordinatorAdapter
          .execute("update_task", {
            task_id: task.task_id,
            priority: task.priority,
            metadata: task.metadata,
          })
          .catch(() => {});
      }
      store.emitTimeline({ type: "priority.aged", task_ids: agingResult.aged });
    }

    let autoRebalanced = false;
    for (const teamEntry of getTeamsSnapshot()) {
      const autoConfig = teamEntry.policy?.auto_rebalance as any;
      if (!autoConfig?.enabled) continue;
      try {
        const teamSnap = getTeamsSnapshot(true)?.find(
          (t: any) => t.team_name === teamEntry.team_name,
        );
        if (!teamSnap) continue;
        const check = shouldAutoRebalance(teamSnap, autoConfig);
        if (check.trigger) {
          const cooldownMs = autoConfig.cooldown_ms || 60000;
          const lastTime = autoRebalanceTimes.get(teamEntry.team_name) || 0;
          if (Date.now() - lastTime > cooldownMs) {
            autoRebalanceTimes.set(teamEntry.team_name, Date.now());
            coordinatorAdapter
              .execute("rebalance", {
                team_name: teamEntry.team_name,
                apply: true,
              })
              .catch(() => {});
            store.emitTimeline({
              type: "auto_rebalance.triggered",
              team_name: teamEntry.team_name,
              reason: check.reason,
              conditions: check.conditions_met,
            });
            autoRebalanced = true;
          }
        }
      } catch {}
    }

    metrics.persistSnapshot(paths.metricsHistoryDir);

    let checkpointed = false;
    if (Date.now() - lastCheckpointTime > 5 * 60_000) {
      try {
        createCheckpoint(paths, "periodic");
        rotateCheckpoints(paths);
        lastCheckpointTime = Date.now();
        checkpointed = true;
      } catch {}
    }

    let terminalHealth: any = null;
    try {
      terminalHealth = checkTerminalHealth(paths);
      if (terminalHealth.zombies.length || terminalHealth.dead_shells.length) {
        const suggestions = suggestRecovery(terminalHealth);
        store.raiseAlert({
          level: "warn",
          code: "terminal_health_issue",
          message: `Terminal health: ${terminalHealth.summary}`,
          findings: {
            zombies: terminalHealth.zombies.length,
            stale: terminalHealth.stale.length,
            dead_shells: terminalHealth.dead_shells.length,
          },
          suggestions: suggestions.slice(0, 5),
        });
      }
    } catch {}

    sweepCount += 1;
    if (sweepCount % 10 === 0) {
      try {
        const hookReport = validateHooks(paths.hooksDir);
        if (!hookReport.all_valid) {
          store.raiseAlert({
            level: "warn",
            code: "hook_validation_failure",
            message: `Hook validation: ${hookReport.hooks
              .filter((h) => h.issues.length)
              .map((h) => h.name)
              .join(", ")} have issues`,
            findings: hookReport.hooks.filter((h) => h.issues.length),
          });
        }
      } catch {}
    }

    return {
      ...report,
      recovered,
      aged_tasks: agingResult.aged.length,
      auto_rebalanced: autoRebalanced,
      checkpointed,
      terminal_health: terminalHealth?.summary || null,
    };
  };
}

const REDACT_KEY_PATTERNS = /token|secret|password|key|auth|credential/i;
const REDACT_SAFE_KEYS = new Set([
  "csrf_token_present",
  "api_token_present",
  "token_required",
  "action_counts",
]);

function redactSecrets(obj: unknown, depth = 0): unknown {
  if (depth > 20 || !obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_SAFE_KEYS.has(k)) {
      out[k] = v;
    } else if (
      typeof v === "string" &&
      REDACT_KEY_PATTERNS.test(k) &&
      v.length > 4
    ) {
      out[k] = `[REDACTED:${v.slice(0, 4)}...]`;
    } else if (typeof v === "string" && /^[0-9a-f]{20,}$/i.test(v)) {
      out[k] = `[REDACTED:${v.slice(0, 4)}...]`;
    } else if (typeof v === "string" && /^Bearer\s+\S{8,}/.test(v)) {
      out[k] = `[REDACTED:Bearer...]`;
    } else if (v && typeof v === "object") {
      out[k] = redactSecrets(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createDiagnosticsBundle({
  store,
  paths,
  readJSON,
  fileExists,
  actionQueue,
  metrics,
  lockMetrics,
  checkTerminalHealth,
  CURRENT_SCHEMA_VERSION,
  writeJSON,
  trimLongStrings,
  appendJSONL,
}: DiagnosticsBundleDeps) {
  return function diagnosticsBundle(label = "manual"): DiagnosticsResult {
    const snapshot = store.getSnapshot();
    const nativeBridgeStatus = readJSON(paths.nativeBridgeStatusFile);
    const nativeBridgeHeartbeat = readJSON(paths.nativeBridgeHeartbeatFile);
    const nativeBridgeValidation = readJSON(paths.nativeBridgeValidationFile);
    const bundle = {
      schema_version: CURRENT_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      label,
      process: { pid: process.pid, cwd: process.cwd() },
      runtime: {
        sidecar: readJSON(paths.lockFile),
        port: readJSON(paths.portFile),
        api_token_present: fileExists(paths.apiTokenFile),
        csrf_token_present: fileExists(paths.csrfTokenFile),
        action_counts: actionQueue.counts(),
      },
      native: {
        status: nativeBridgeStatus,
        heartbeat: nativeBridgeHeartbeat,
        validation: nativeBridgeValidation,
        capabilities: readJSON(paths.nativeCapabilitiesFile),
      },
      snapshot,
      actions: actionQueue.list(200),
      metrics: snapshot.metrics || metrics.snapshot(),
      lock_metrics: lockMetrics.snapshot(),
      terminal_health: checkTerminalHealth(paths),
    };
    const redacted = redactSecrets(trimLongStrings(bundle, 2048));

    const manifest: Record<string, number> = {};
    for (const [section, value] of Object.entries(
      redacted as Record<string, unknown>,
    )) {
      manifest[section] = JSON.stringify(value).length;
    }
    (redacted as any).manifest = manifest;

    const withoutChecksum = JSON.stringify(redacted);
    const checksum = createHash("sha256").update(withoutChecksum).digest("hex");
    (redacted as any).checksum = checksum;

    const file = `${paths.diagnosticsDir}/diag-${Date.now()}.json`;
    writeJSON(file, redacted);
    try {
      appendJSONL(paths.logFile, {
        ts: new Date().toISOString(),
        type: "diagnostics.export",
        file,
        label,
      });
    } catch {}
    return {
      ok: true,
      file,
      generated_at: bundle.generated_at,
      counts: bundle.runtime.action_counts as Record<string, number>,
      checksum,
    };
  };
}
