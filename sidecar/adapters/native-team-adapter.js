import { readJSON } from "../core/fs-utils.js";
import { sidecarPaths } from "../core/paths.js";
import { NativeActionRunner } from "../native/native-runner.js";
import { NativeCapabilityDetector } from "../native/capability-detector.js";
import { BridgeController } from "../native/bridge-controller.js";
import { getBridgeHealth } from "../native/bridge-health.js";

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
    const out = {
      ok: Boolean(caps.available),
      mode:
        bridge.bridge_status === "healthy"
          ? "bridge"
          : caps.available
            ? "ephemeral"
            : "unavailable",
      note:
        caps.last_probe_error ||
        (caps.available ? "native tools available" : "native unavailable"),
      capabilities: caps,
      bridge,
    };
    this.store?.setNativeCapabilities?.({
      ...caps,
      bridge_status: bridge.bridge_status,
      bridge,
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

  _shouldTryBridge(actionKey, team = {}, health = null) {
    const mode =
      team?.policy?.native_bridge_mode ||
      process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MODE ||
      "hybrid";
    if (mode === "ephemeral_only") return false;
    if (
      ["send-message", "task", "team-status", "team-create"].includes(
        actionKey,
      ) === false
    )
      return false;
    if (mode === "bridge_only") return true;
    const bridge = health?.bridge || this.bridge.getHealth();
    return bridge.bridge_status === "healthy";
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
    if (!caps.available) {
      throw new Error(caps.last_probe_error || "tool_unavailable");
    }

    const normalized = normalizeNativePayload(mapped, payload);
    const timeoutMs = Number(
      team?.policy?.native_action_timeout_ms || payload.timeout_ms || 15000,
    );

    let triedBridge = false;
    if (
      force_path_mode === "bridge" ||
      (!force_path_mode && this._shouldTryBridge(mapped, team, health))
    ) {
      triedBridge = true;
      try {
        if (health.bridge?.bridge_status !== "healthy") {
          await this.ensureBridge(team);
        }
        const res = await this.bridge.execute(mapped, normalized, {
          timeoutMs,
        });
        return {
          ok: Boolean(res.ok ?? true),
          action: mapped,
          native_tool: res.native_tool || null,
          result: res.result ?? res,
          error: res.error || null,
          path_mode: "bridge",
          latency_ms: res.latency_ms || null,
          notes: res.notes || null,
          bridge_session_id:
            res.bridge_session_id || this.bridge.getHealth().session_id || null,
        };
      } catch (err) {
        this.store?.raiseAlert?.({
          level: "warn",
          code: "bridge_timeout",
          message: `Native bridge failed for ${mapped}: ${err.message}`,
        });
        if (
          force_path_mode === "bridge" ||
          (team?.policy?.native_fallback_policy || "coordinator") === "error"
        ) {
          return {
            ok: false,
            action: mapped,
            native_tool: null,
            error: {
              code: String(err.message || "bridge_timeout"),
              message: "Bridge execution failed",
            },
            path_mode: "bridge",
            notes: "bridge-only mode or fallback disabled",
          };
        }
      }
    }

    const runnerRes = await this.runner.run(mapped, normalized, {
      timeoutMs,
      model: payload.model || "sonnet",
    });
    return {
      ...runnerRes,
      action: mapped,
      fallback_from_bridge: triedBridge,
    };
  }
}
