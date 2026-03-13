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

function buildRouteDecision({
  available,
  bridgeStatus,
  staticCheck,
  probeError,
}) {
  const nativeEligible = Boolean(
    staticCheck.enabled && staticCheck.claude_bin && staticCheck.permissions_ok,
  );
  const nativeAvailable = Boolean(nativeEligible && available);
  const nativeBlockedReason = !staticCheck.enabled
    ? "native execution is disabled by policy"
    : !staticCheck.claude_bin
      ? "native execution unavailable: claude binary not found"
      : !staticCheck.permissions_ok
        ? "native execution unavailable: required native permissions missing"
        : probeError
          ? `native probe failed: ${probeError}`
          : "native capability unavailable";

  if (nativeAvailable) {
    return {
      route_mode: "native-direct",
      route_reason: "native capability probe passed",
      mode: "native-direct",
      fallback_history: [],
    };
  }
  if (bridgeStatus === "healthy") {
    return {
      route_mode: "bridge",
      route_reason: `${nativeBlockedReason}; bridge healthy`,
      mode: "bridge",
      fallback_history: [
        {
          route_mode: "native-direct",
          status: "unavailable",
          reason: nativeBlockedReason,
        },
      ],
    };
  }
  const bridgeUnavailableReason = `bridge status=${String(bridgeStatus || "down")}`;
  return {
    route_mode: "coordinator",
    route_reason: `${nativeBlockedReason}; ${bridgeUnavailableReason}`,
    mode: "unavailable",
    fallback_history: [
      {
        route_mode: "native-direct",
        status: "unavailable",
        reason: nativeBlockedReason,
      },
      {
        route_mode: "bridge",
        status: "unavailable",
        reason: bridgeUnavailableReason,
      },
    ],
  };
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
    const bridgeStatus = bridge.bridge_status || "down";
    const nowIso = new Date().toISOString();
    const cacheAgeMs = cache?.last_probe_at
      ? Date.now() - new Date(cache.last_probe_at).getTime()
      : null;

    if (!force && this._cacheFresh(cache, ttlMs)) {
      const route = buildRouteDecision({
        available: Boolean(cache.available),
        bridgeStatus,
        staticCheck,
        probeError: cache.last_probe_error || null,
      });
      return {
        ...cache,
        available: route.route_mode === "native-direct",
        observed_at: nowIso,
        probe_source: "cache",
        cache_age_ms: Number.isFinite(cacheAgeMs) ? cacheAgeMs : null,
        cache_ttl_ms: ttlMs,
        static: staticCheck,
        bridge_status: bridgeStatus,
        route_mode: route.route_mode,
        route_reason: route.route_reason,
        mode: route.mode,
        fallback_history: route.fallback_history,
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
    const lastProbeError =
      probe?.ok === false
        ? probe.error?.code || probe.error?.message || "probe_failed"
        : null;
    const route = buildRouteDecision({
      available,
      bridgeStatus,
      staticCheck,
      probeError: lastProbeError,
    });
    const out = {
      available,
      mode: route.mode,
      route_mode: route.route_mode,
      route_reason: route.route_reason,
      fallback_history: route.fallback_history,
      tools,
      last_probe_at: nowIso,
      last_probe_error: lastProbeError,
      confidence: probe
        ? probe.ok || probe.tool_available !== false
          ? "high"
          : "medium"
        : "low",
      bridge_status: bridgeStatus,
      observed_at: nowIso,
      probe_source: "fresh",
      cache_age_ms: null,
      cache_ttl_ms: ttlMs,
      static: staticCheck,
      probe: probe ? { ok: probe.ok, notes: probe.notes || null } : null,
    };
    writeJSON(this.paths.nativeCapabilitiesFile, out);
    return out;
  }
}
