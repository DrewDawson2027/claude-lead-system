import {
  chooseExecutionPath,
  classifyAction,
  shouldAttemptCoordinatorFallback,
} from "./policy-engine.js";

export class ActionRouter {
  constructor({ coordinatorAdapter, nativeAdapter, store }) {
    this.coordinator = coordinatorAdapter;
    this.native = nativeAdapter;
    this.store = store;
  }

  async route(team, action, payload = {}) {
    const semantic = classifyAction(action);
    const forcePath = payload?.force_path || payload?.forcePath || null;
    const skipNativeHealth =
      semantic === "coordinator_only" && forcePath !== "native";
    const orchestration = {
      health_probes: 0,
      fallback_attempts: 0,
      alerts_raised: 0,
      fallback_skipped: false,
    };
    let nativeHealth = {
      ok: false,
      capabilities: { available: false },
      bridge: { bridge_status: "unknown" },
    };
    if (!skipNativeHealth) {
      nativeHealth = await this.native.health(team);
      this.store.emitAdapterHealth("native", nativeHealth);
      orchestration.health_probes += 1;
    }

    const decision = chooseExecutionPath(
      team,
      action,
      nativeHealth,
      payload || {},
    );
    const started = Date.now();
    try {
      const primaryResult =
        decision.adapter === "native"
          ? await this.native.execute(action, payload, {
              team,
              force_path_mode: decision.path_mode,
            })
          : await this.coordinator.execute(action, payload);

      const latency_ms = Date.now() - started;
      const ok = primaryResult?.ok !== false;
      const route_mode =
        decision.adapter === "native"
          ? primaryResult?.route_mode ||
            primaryResult?.path_mode ||
            decision.path_mode ||
            "native-direct"
          : "coordinator-local";
      const route_reason = primaryResult?.route_reason || decision.reason;
      const response = {
        ok,
        adapter: decision.adapter,
        path_mode:
          decision.adapter === "native"
            ? primaryResult?.path_mode || decision.path_mode
            : "local-module",
        route_mode,
        route_reason,
        reason: route_reason,
        fallback_plan: decision.fallback_plan,
        fallback_used: false,
        cost_estimate_class: decision.cost_estimate_class,
        latency_ms,
        result: primaryResult,
        orchestration,
      };
      if (
        !ok &&
        decision.adapter === "native"
      ) {
        const fallbackPolicy = shouldAttemptCoordinatorFallback({
          teamPolicy: team?.policy || {},
          error: primaryResult?.error || null,
          fallbackAttempts: orchestration.fallback_attempts,
        });
        if (!fallbackPolicy.allow) {
          return {
            ...response,
            fallback_skipped: true,
            fallback_skip_reason: fallbackPolicy.reason,
            route_reason: `${route_reason}; fallback skipped (${fallbackPolicy.reason})`,
            reason: `${route_reason}; fallback skipped (${fallbackPolicy.reason})`,
            orchestration: {
              ...orchestration,
              fallback_skipped: true,
            },
          };
        }
        orchestration.fallback_attempts += 1;
        const fallback = await this.coordinator.execute(action, payload);
        const fallbackReason = `native route failed (${primaryResult?.error?.code || primaryResult?.error?.message || "error"}); coordinator fallback`;
        this.store?.raiseAlert?.({
          level: "warn",
          code: "native_fallback_to_coordinator",
          message: fallbackReason,
          action,
          team_name: team?.team_name || payload?.team_name || null,
        });
        orchestration.alerts_raised += 1;
        return {
          ok: fallback?.ok !== false,
          adapter: "coordinator",
          path_mode: "local-module",
          route_mode: "coordinator-fallback",
          route_reason: fallbackReason,
          reason: fallbackReason,
          fallback_plan: decision.fallback_plan,
          fallback_used: true,
          cost_estimate_class: "low",
          latency_ms: Date.now() - started,
          result: fallback,
          fallback_from: {
            adapter: "native",
            path_mode: primaryResult?.path_mode || decision.path_mode,
            error: primaryResult?.error || null,
          },
          orchestration,
        };
      }
      return response;
    } catch (err) {
      if (decision.adapter === "native") {
        const fallbackPolicy = shouldAttemptCoordinatorFallback({
          teamPolicy: team?.policy || {},
          error: err || null,
          fallbackAttempts: orchestration.fallback_attempts,
        });
        if (!fallbackPolicy.allow) {
          return {
            ok: false,
            adapter: decision.adapter,
            path_mode:
              decision.adapter === "native" ? decision.path_mode : "local-module",
            route_mode:
              decision.adapter === "native"
                ? decision.path_mode
                : "coordinator-local",
            route_reason: `${decision.reason}; fallback skipped (${fallbackPolicy.reason})`,
            reason: `${decision.reason}; fallback skipped (${fallbackPolicy.reason})`,
            fallback_plan: decision.fallback_plan,
            fallback_used: false,
            fallback_skipped: true,
            fallback_skip_reason: fallbackPolicy.reason,
            cost_estimate_class: decision.cost_estimate_class,
            error: err.message,
            latency_ms: Date.now() - started,
            orchestration: {
              ...orchestration,
              fallback_skipped: true,
            },
          };
        }
        orchestration.fallback_attempts += 1;
        const fallback = await this.coordinator.execute(action, payload);
        const fallbackReason = `native route exception (${err.message}); coordinator fallback`;
        this.store?.raiseAlert?.({
          level: "warn",
          code: "native_fallback_to_coordinator",
          message: fallbackReason,
          action,
          team_name: team?.team_name || payload?.team_name || null,
        });
        orchestration.alerts_raised += 1;
        return {
          ok: fallback?.ok !== false,
          adapter: "coordinator",
          path_mode: "local-module",
          route_mode: "coordinator-fallback",
          route_reason: fallbackReason,
          reason: fallbackReason,
          fallback_plan: decision.fallback_plan,
          fallback_used: true,
          cost_estimate_class: "low",
          latency_ms: Date.now() - started,
          result: fallback,
          fallback_from: {
            adapter: "native",
            path_mode: decision.path_mode,
            error: { message: err.message },
          },
          orchestration,
        };
      }
      return {
        ok: false,
        adapter: decision.adapter,
        path_mode:
          decision.adapter === "native" ? decision.path_mode : "local-module",
        route_mode:
          decision.adapter === "native" ? decision.path_mode : "coordinator-local",
        route_reason: decision.reason,
        reason: decision.reason,
        fallback_plan: decision.fallback_plan,
        fallback_used: false,
        cost_estimate_class: decision.cost_estimate_class,
        error: err.message,
        latency_ms: Date.now() - started,
        orchestration,
      };
    }
  }

  async simulate(team, action, payload = {}) {
    const semantic = classifyAction(action);
    const forcePath = payload?.force_path || payload?.forcePath || null;
    const skipNativeHealth =
      semantic === "coordinator_only" && forcePath !== "native";
    let nativeHealth = {
      ok: false,
      capabilities: { available: false },
      bridge: { bridge_status: "unknown" },
    };
    if (!skipNativeHealth) {
      nativeHealth = await this.native.health(team);
      this.store.emitAdapterHealth("native", nativeHealth);
    }
    const decision = chooseExecutionPath(
      team,
      action,
      nativeHealth,
      payload || {},
    );
    return {
      ok: true,
      action,
      team_name: team?.team_name || null,
      decision,
      health: {
        native: nativeHealth,
        coordinator: null,
      },
      orchestration: {
        health_probes: skipNativeHealth ? 0 : 1,
      },
      simulated_at: new Date().toISOString(),
    };
  }
}
