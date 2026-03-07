import { spawnSync } from "child_process";
import { readJSON, writeJSON } from "../core/fs-utils.js";

function hasNativePermissions(settings) {
  const allow = Array.isArray(settings?.permissions?.allow)
    ? settings.permissions.allow
    : [];
  return ["TeamCreate", "TeamStatus", "SendMessage", "Task"].every((t) =>
    allow.includes(t),
  );
}

function commandExists(name) {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const res = spawnSync(cmd, [name], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

export class NativeCapabilityDetector {
  constructor({ paths, runner, readSettings, bridgeHealthFn }) {
    this.paths = paths;
    this.runner = runner;
    this.readSettings = readSettings;
    this.bridgeHealthFn = bridgeHealthFn;
  }

  _staticCheck(team = {}) {
    const settings = this.readSettings?.() || {};
    const enabled =
      process.env.LEAD_SIDECAR_NATIVE_ENABLE === "1" ||
      ["native", "hybrid"].includes(
        String(
          team?.preferred_execution_path || team?.execution_path || "",
        ).trim(),
      );
    const claude_bin =
      Boolean(process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK) ||
      commandExists("claude");
    const permissions_ok =
      Boolean(process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK) ||
      hasNativePermissions(settings);
    return { enabled, claude_bin, permissions_ok };
  }

  _cacheFresh(cache, ttlMs) {
    if (!cache?.last_probe_at) return false;
    const age = Date.now() - new Date(cache.last_probe_at).getTime();
    return Number.isFinite(age) && age >= 0 && age < ttlMs;
  }

  async detect({ force = false, ttlMs = 60000, team = {} } = {}) {
    const cache = readJSON(this.paths.nativeCapabilitiesFile);
    const staticCheck = this._staticCheck(team);
    const bridge = this.bridgeHealthFn
      ? this.bridgeHealthFn()
      : { bridge_status: "down" };

    if (!force && this._cacheFresh(cache, ttlMs)) {
      return {
        ...cache,
        static: staticCheck,
        bridge_status: bridge.bridge_status || "down",
        mode:
          bridge.bridge_status === "healthy"
            ? "bridge"
            : cache.available
              ? "ephemeral"
              : "unavailable",
      };
    }

    let probe = null;
    if (
      staticCheck.enabled &&
      staticCheck.claude_bin &&
      staticCheck.permissions_ok
    ) {
      probe = await this.runner.run("probe", {}, { timeoutMs: 8000 });
    }

    const tools = {
      TeamCreate: Boolean(
        probe?.tool_available ??
        (staticCheck.permissions_ok && staticCheck.enabled),
      ),
      TeamStatus: Boolean(
        probe?.tool_available ??
        (staticCheck.permissions_ok && staticCheck.enabled),
      ),
      SendMessage: Boolean(staticCheck.permissions_ok && staticCheck.enabled),
      Task: Boolean(staticCheck.permissions_ok && staticCheck.enabled),
    };
    const available = Boolean(
      staticCheck.enabled &&
      staticCheck.claude_bin &&
      staticCheck.permissions_ok &&
      probe?.ok !== false,
    );
    const out = {
      available,
      mode:
        bridge.bridge_status === "healthy"
          ? "bridge"
          : available
            ? "ephemeral"
            : "unavailable",
      tools,
      last_probe_at: new Date().toISOString(),
      last_probe_error:
        probe?.ok === false
          ? probe.error?.code || probe.error?.message || "probe_failed"
          : null,
      confidence: probe
        ? probe.ok || probe.tool_available !== false
          ? "high"
          : "medium"
        : "low",
      bridge_status: bridge.bridge_status || "down",
      static: staticCheck,
      probe: probe ? { ok: probe.ok, notes: probe.notes || null } : null,
    };
    writeJSON(this.paths.nativeCapabilitiesFile, out);
    return out;
  }
}
