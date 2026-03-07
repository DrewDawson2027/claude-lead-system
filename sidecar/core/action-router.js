import { chooseExecutionPath } from "./policy-engine.js";

export class ActionRouter {
  constructor({ coordinatorAdapter, nativeAdapter, store }) {
    this.coordinator = coordinatorAdapter;
    this.native = nativeAdapter;
    this.store = store;
  }

  async route(team, action, payload = {}) {
    const nativeHealth = await this.native.health(team);
    this.store.emitAdapterHealth("native", nativeHealth);
    const coordinatorHealth = await this.coordinator.health();
    this.store.emitAdapterHealth("coordinator", coordinatorHealth);

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
      const response = {
        ok,
        adapter: decision.adapter,
        path_mode:
          decision.adapter === "native"
            ? primaryResult?.path_mode || decision.path_mode
            : "local-module",
        reason: decision.reason,
        fallback_plan: decision.fallback_plan,
        fallback_used: false,
        cost_estimate_class: decision.cost_estimate_class,
        latency_ms,
        result: primaryResult,
      };
      if (
        !ok &&
        decision.adapter === "native" &&
        (team?.policy?.native_fallback_policy || "coordinator") !== "error"
      ) {
        const fallback = await this.coordinator.execute(action, payload);
        return {
          ok: true,
          adapter: "coordinator",
          path_mode: "local-module",
          reason: `native failed (${primaryResult?.error?.code || primaryResult?.error?.message || "error"}); coordinator fallback`,
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
        };
      }
      return response;
    } catch (err) {
      if (
        decision.adapter === "native" &&
        (team?.policy?.native_fallback_policy || "coordinator") !== "error"
      ) {
        const fallback = await this.coordinator.execute(action, payload);
        return {
          ok: true,
          adapter: "coordinator",
          path_mode: "local-module",
          reason: `native failed (${err.message}); coordinator fallback`,
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
        };
      }
      return {
        ok: false,
        adapter: decision.adapter,
        path_mode:
          decision.adapter === "native" ? decision.path_mode : "local-module",
        reason: decision.reason,
        fallback_plan: decision.fallback_plan,
        fallback_used: false,
        cost_estimate_class: decision.cost_estimate_class,
        error: err.message,
        latency_ms: Date.now() - started,
      };
    }
  }

  async simulate(team, action, payload = {}) {
    const nativeHealth = await this.native.health(team);
    this.store.emitAdapterHealth("native", nativeHealth);
    const coordinatorHealth = await this.coordinator.health();
    this.store.emitAdapterHealth("coordinator", coordinatorHealth);
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
        coordinator: coordinatorHealth,
      },
      simulated_at: new Date().toISOString(),
    };
  }
}
