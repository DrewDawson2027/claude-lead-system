import { readJSON } from "../core/fs-utils.js";
import { sidecarPaths } from "../core/paths.js";
import { NativeActionRunner } from "../native/native-runner.js";
import { NativeCapabilityDetector } from "../native/capability-detector.js";
import { BridgeController } from "../native/bridge-controller.js";
import { getBridgeHealth } from "../native/bridge-health.js";
import { upsertIdentityRecord } from "../../mcp-coordinator/lib/identity-map.js";

const ACTION_MAP = {
  message: "send-message",
  "native-send-message": "send-message",
  "native-message": "send-message",
  "native-task": "task",
  task: "task",
  "team-status": "team-status",
  "native-team-status": "team-status",
  "team-create": "team-create",
  "native-team-create": "team-create",
};

function settingsReader(paths) {
  return () =>
    readJSON(paths.settingsFile || `${paths.claudeDir}/settings.local.json`) ||
    {};
}

function normalizeNativePayload(action, payload = {}) {
  if (action === "send-message") {
    return {
      team_name: payload.team_name || null,
      agent: payload.agent || payload.target_name || payload.to || null,
      message: payload.message || payload.content || "",
      metadata: payload.metadata || {},
    };
  }
  if (action === "task") {
    return {
      team_name: payload.team_name || null,
      agent: payload.agent || payload.target_name || null,
      task: payload.task || payload.prompt || payload.content || "",
      metadata: payload.metadata || {},
    };
  }
  if (action === "team-status") {
    return {
      team_name: payload.team_name || null,
      metadata: payload.metadata || {},
    };
  }
  if (action === "team-create") {
    return {
      team_name: payload.team_name || payload.name || null,
      goal: payload.goal || payload.description || "",
      members: payload.members || [],
      metadata: payload.metadata || {},
    };
  }
  return payload;
}

function pickIdentityField(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function coerceResultObject(candidate) {
  if (!candidate || typeof candidate !== "object") return {};
  return candidate;
}

function normalizeFallbackHistory(history) {
  return Array.isArray(history) ? history : [];
}

export class NativeTeamAdapter {
  constructor({
    paths = sidecarPaths(),
    coordinatorAdapter = null,
    store = null,
    runner = null,
    bridgeController = null,
  } = {}) {
    this.paths = paths;
    this.store = store;
    this.coordinator = coordinatorAdapter;
    this.runner = runner || new NativeActionRunner({});
    this.bridge =
      bridgeController ||
      new BridgeController({ paths, coordinatorAdapter, store });
    this.detector = new NativeCapabilityDetector({
      paths,
      runner: this.runner,
      readSettings: settingsReader(paths),
      bridgeHealthFn: () => getBridgeHealth(paths),
    });
  }

  async probe({ force = true } = {}) {
    const caps = await this.detector.detect({
      force,
      ttlMs: this._probeTtlMs(),
      team: { execution_path: "hybrid" },
    });
    this.store?.setNativeCapabilities?.(caps);
    return caps;
  }

  _probeTtlMs(team = {}) {
    const ttlSeconds = Number(
      team?.policy?.native_probe_ttl_seconds ||
        process.env.LEAD_SIDECAR_NATIVE_PROBE_TTL_SECONDS ||
        60,
    );
    return (
      Math.max(
        5,
        Math.min(3600, Number.isFinite(ttlSeconds) ? ttlSeconds : 60),
      ) * 1000
    );
  }

  async health(team = {}) {
    const caps = await this.detector.detect({
      force: false,
      ttlMs: this._probeTtlMs(team),
      team,
    });
    const bridge = this.bridge.getHealth();
    const bridgeHealthy = bridge.bridge_status === "healthy";
    const routeMode =
      caps.route_mode ||
      (caps.available
        ? "native-direct"
        : bridgeHealthy
          ? "bridge"
          : "coordinator");
    const routeReason =
      caps.route_reason ||
      (caps.available
        ? "native capability probe passed"
        : bridgeHealthy
          ? "native unavailable; bridge healthy"
          : "native and bridge are unavailable");
    const out = {
      ok: Boolean(caps.available || bridgeHealthy),
      mode: routeMode === "coordinator" ? "unavailable" : routeMode,
      route_mode: routeMode,
      route_reason: routeReason,
      fallback_history: normalizeFallbackHistory(caps.fallback_history),
      probe_source: caps.probe_source || "unknown",
      note: caps.last_probe_error || routeReason,
      capabilities: caps,
      bridge,
    };
    this.store?.setNativeCapabilities?.({
      ...caps,
      bridge_status: bridge.bridge_status,
      bridge,
      route_mode: routeMode,
      route_reason: routeReason,
      fallback_history: normalizeFallbackHistory(caps.fallback_history),
      probe_source: caps.probe_source || "unknown",
    });
    this.store?.emitAdapterHealth?.("native", out);
    return out;
  }

  async ensureBridge(team = {}) {
    const autostart =
      (team?.policy?.native_bridge_policy || "auto") !== "off" &&
      (process.env.LEAD_SIDECAR_NATIVE_BRIDGE_AUTOSTART || "1") !== "0";
    const directory = team?.policy?.native_bridge_directory || process.cwd();
    const res = await this.bridge.ensureBridge({ autostart, directory });
    this.store?.emitBridgeStatus?.({ ts: new Date().toISOString(), ...res });
    return res;
  }

  async getStatus(team = {}) {
    const health = await this.health(team);
    const lastValidation =
      readJSON(this.paths.nativeBridgeValidationFile) || null;
    return {
      native: health.capabilities,
      bridge: health.bridge,
      bridge_validation: lastValidation,
      adapter_ok: health.ok,
      mode: health.mode,
      route_mode: health.route_mode || health.mode || "unavailable",
      route_reason:
        health.route_reason || health.note || "route metadata unavailable",
      fallback_history: normalizeFallbackHistory(health.fallback_history),
      probe_source: health.probe_source || "unknown",
      generated_at: new Date().toISOString(),
    };
  }

  async validateBridge({
    team = {},
    team_name = null,
    directory = process.cwd(),
    timeoutMs = null,
    simulate = null,
  } = {}) {
    const resolvedTeamName = team_name || team?.team_name || null;
    const timeout = Number(
      timeoutMs || team?.policy?.native_action_timeout_ms || 10000,
    );
    const report = await this.bridge.validate({
      team_name: resolvedTeamName,
      directory,
      timeoutMs: Number.isFinite(timeout) ? timeout : 10000,
      autostart: (team?.policy?.native_bridge_policy || "auto") !== "off",
      simulate: simulate === null ? undefined : Boolean(simulate),
    });
    return report;
  }

  _recordIdentity(action, normalized, response, source) {
    const envelope = coerceResultObject(response);
    const result = coerceResultObject(envelope.result);
    const claudeSessionId =
      pickIdentityField(result, ["claude_session_id", "claudeSessionId"]) ||
      pickIdentityField(envelope, ["claude_session_id", "claudeSessionId"]) ||
      null;
    const sessionId =
      pickIdentityField(result, ["session_id", "sessionId"]) ||
      pickIdentityField(envelope, ["session_id", "sessionId"]) ||
      (claudeSessionId ? claudeSessionId.slice(0, 8) : null);
    const identity = {
      team_name:
        normalized.team_name ||
        pickIdentityField(result, ["team_name", "teamName"]) ||
        null,
      agent_id: pickIdentityField(result, ["agent_id", "agentId"]) || null,
      agent_name:
        normalized.agent ||
        pickIdentityField(result, ["agent_name", "agentName", "agent"]) ||
        pickIdentityField(envelope, ["agent_name", "agentName", "agent"]) ||
        null,
      worker_name:
        pickIdentityField(result, ["worker_name", "workerName"]) ||
        pickIdentityField(envelope, ["worker_name", "workerName"]) ||
        normalized.agent ||
        null,
      session_id: sessionId,
      task_id:
        pickIdentityField(result, ["task_id", "taskId"]) ||
        (action === "task"
          ? pickIdentityField(result, ["id", "task"])
          : null),
      pane_id:
        pickIdentityField(result, ["pane_id", "paneId", "tmux_pane_id"]) ||
        null,
      claude_session_id: claudeSessionId,
      source,
    };
    try {
      upsertIdentityRecord(identity);
    } catch {
      // Identity map is observability metadata and should not block execution.
    }
  }

  _nativeDirectFailure(nativeResult) {
    return (
      nativeResult?.error?.code ||
      nativeResult?.error?.message ||
      nativeResult?.notes ||
      "native_direct_failed"
    );
  }

  async execute(
    action,
    payload = {},
    { team = {}, force_path_mode = null } = {},
  ) {
    const mapped = ACTION_MAP[action];
    if (!mapped) throw new Error(`Unsupported native action: ${action}`);
    const health = await this.health(team);
    const caps = health.capabilities || {};
    const probeSource = caps.probe_source || "unknown";
    const nativeAvailable = Boolean(
      caps.available &&
      (!caps.route_mode || caps.route_mode === "native-direct"),
    );
    const normalizedForceMode =
      force_path_mode === "ephemeral" ? "native-direct" : force_path_mode;

    const normalized = normalizeNativePayload(mapped, payload);
    const timeoutMs = Number(
      team?.policy?.native_action_timeout_ms || payload.timeout_ms || 15000,
    );
    const ensureHealthyBridge = async () => {
      let bridgeHealth = this.bridge.getHealth();
      if (bridgeHealth.bridge_status !== "healthy") {
        await this.ensureBridge(team);
        bridgeHealth = this.bridge.getHealth();
      }
      if (bridgeHealth.bridge_status !== "healthy") {
        throw new Error(
          `bridge_${bridgeHealth.bridge_status || "unavailable"}`,
        );
      }
      return bridgeHealth;
    };
    const runBridge = async ({
      routeReason,
      fallbackHistory = [],
      failureCode = "bridge_failed",
      failureMessage = "Bridge execution failed",
    } = {}) => {
      try {
        await ensureHealthyBridge();
        const bridgeRes = await this.bridge.execute(mapped, normalized, {
          timeoutMs,
        });
        if (bridgeRes?.ok === false) {
          throw new Error(
            bridgeRes?.error?.code ||
            bridgeRes?.error?.message ||
            "bridge_execution_failed",
          );
        }
        const resolvedFallbackHistory = [
          ...normalizeFallbackHistory(fallbackHistory),
          {
            route_mode: "bridge",
            status: "selected",
            reason: routeReason || "bridge route selected",
          },
        ];
        const out = {
          ok: Boolean(bridgeRes.ok ?? true),
          action: mapped,
          native_tool: bridgeRes.native_tool || null,
          result: bridgeRes.result ?? bridgeRes,
          error: bridgeRes.error || null,
          path_mode: "bridge",
          route_mode: "bridge",
          route_reason: routeReason || "bridge route selected",
          latency_ms: bridgeRes.latency_ms || null,
          notes: bridgeRes.notes || null,
          bridge_session_id:
            bridgeRes.bridge_session_id ||
            this.bridge.getHealth().session_id ||
            null,
          fallback_history: resolvedFallbackHistory,
          probe_source: bridgeRes.probe_source || "bridge-controller",
        };
        this._recordIdentity(mapped, normalized, out, "bridge");
        return out;
      } catch (err) {
        this.store?.raiseAlert?.({
          level: "warn",
          code: failureCode,
          message: `${failureMessage} for ${mapped}: ${err.message}`,
        });
        return {
          ok: false,
          action: mapped,
          native_tool: null,
          error: {
            code: String(err.message || failureCode),
            message: failureMessage,
          },
          path_mode: "coordinator",
          route_mode: "coordinator",
          route_reason: `${routeReason || "bridge route selected"}; coordinator fallback required`,
          fallback_required: true,
          fallback_history: [
            ...normalizeFallbackHistory(fallbackHistory),
            {
              route_mode: "bridge",
              status: "failed",
              error: {
                code: String(err.message || failureCode),
                message: String(err.message || failureCode),
              },
            },
          ],
          probe_source: probeSource,
        };
      }
    };

    if (normalizedForceMode === "bridge") {
      return runBridge({
        routeReason: "force_path_mode=bridge",
        fallbackHistory: [
          {
            route_mode: "native-direct",
            status: "skipped",
            reason: "force_path_mode=bridge",
          },
        ],
        failureCode: "bridge_timeout",
        failureMessage: "Forced bridge execution failed",
      });
    }

    if (
      normalizedForceMode &&
      normalizedForceMode !== "native-direct" &&
      normalizedForceMode !== "bridge"
    ) {
      throw new Error(
        `Unsupported force_path_mode for native adapter: ${normalizedForceMode}`,
      );
    }

    if (nativeAvailable) {
      const nativeDirect = await this.runner.run(mapped, normalized, {
        timeoutMs,
        model: payload.model,
      });
      const directOut = {
        ...nativeDirect,
        action: mapped,
        path_mode: "native-direct",
        route_mode: "native-direct",
        route_reason:
          nativeDirect?.ok === false
            ? "native-direct failed; attempting bridge"
            : "native-direct succeeded",
        fallback_history: [],
        probe_source: nativeDirect?.probe_source || "native-runner",
      };
      this._recordIdentity(mapped, normalized, directOut, "native-direct");
      if (nativeDirect?.ok !== false) return directOut;

      const bridged = await runBridge({
        routeReason: `native-direct failed (${this._nativeDirectFailure(nativeDirect)}); bridge selected`,
        fallbackHistory: [
          {
            route_mode: "native-direct",
            error: nativeDirect.error || null,
          },
        ],
        failureCode: "native_bridge_fallback_failed",
        failureMessage: "Native-direct and bridge execution failed",
      });
      if (bridged.ok !== false) return bridged;
      return {
        ...bridged,
        native_tool: nativeDirect.native_tool || bridged.native_tool || null,
        result: nativeDirect.result || bridged.result || null,
        error: {
          code: "native_direct_and_bridge_failed",
          message: "Native-direct and bridge execution failed",
          native_direct_error: nativeDirect.error || null,
          bridge_error: bridged.error || null,
        },
        fallback_history: normalizeFallbackHistory(bridged.fallback_history),
        probe_source: bridged.probe_source || probeSource,
      };
    }

    if (normalizedForceMode === "native-direct") {
      return {
        ok: false,
        action: mapped,
        native_tool: null,
        error: {
          code: "tool_unavailable",
          message: caps.last_probe_error || "native capability unavailable",
        },
        path_mode: "native-direct",
        route_mode: "coordinator",
        route_reason:
          "force_path_mode=native-direct but native capability is unavailable; coordinator fallback required",
        fallback_required: true,
        fallback_history: [
          {
            route_mode: "native-direct",
            status: "unavailable",
            reason: caps.route_reason || "native capability unavailable",
          },
        ],
        probe_source: probeSource,
      };
    }

    return runBridge({
      routeReason: "native unavailable; bridge selected",
      fallbackHistory: [
        {
          route_mode: "native-direct",
          status: "unavailable",
          reason: caps.route_reason || "native capability unavailable",
        },
      ],
      failureCode: "native_unavailable_bridge_failed",
      failureMessage: "Native unavailable and bridge execution failed",
    });
  }
}
