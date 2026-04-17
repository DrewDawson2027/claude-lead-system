import type {
  TrackedActionRunnerDeps,
  BatchTriageDeps,
  TrackedActionInput,
  BatchTriageInput,
} from "./types.js";

const COMPACT_LIFECYCLE_ACTIONS = new Set([
  "approve-plan",
  "reject-plan",
  "wake",
  "rebalance",
  "assign-next",
  "queue-task",
  "dispatch",
]);
const PREVIEW_MAX_DEPTH = 2;
const PREVIEW_MAX_STRING = 240;
const PREVIEW_MAX_ARRAY = 8;
const PREVIEW_MAX_KEYS = 20;
const NON_RETRYABLE_FALLBACK_TOKENS = [
  "approval",
  "plan_approval",
  "waiting_for_plan",
  "validation",
  "invalid",
  "bad_request",
  "unauthorized",
  "forbidden",
  "permission",
  "policy",
  "operator_required",
  "human_required",
  "human_intervention",
  "interrupt_required",
  "unsupported",
  "not_implemented",
];
const orchestrationRollup = {
  actions_total: 0,
  lifecycle_events_total: 0,
  compact_lifecycle_actions: 0,
  fallback_attempts_total: 0,
  fallback_skipped_total: 0,
  alerts_total: 0,
  payload_preview_trims_total: 0,
};

function compactForPreview(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length <= PREVIEW_MAX_STRING) return value;
    return `${value.slice(0, PREVIEW_MAX_STRING)}…[trimmed:${value.length - PREVIEW_MAX_STRING}]`;
  }
  if (typeof value !== "object") return value;
  if (depth >= PREVIEW_MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    const trimmed = value
      .slice(0, PREVIEW_MAX_ARRAY)
      .map((entry) => compactForPreview(entry, depth + 1));
    if (value.length > PREVIEW_MAX_ARRAY) {
      trimmed.push(`[+${value.length - PREVIEW_MAX_ARRAY} more]`);
    }
    return trimmed;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(
    0,
    PREVIEW_MAX_KEYS,
  );
  const out: Record<string, unknown> = {};
  for (const [key, raw] of entries)
    out[key] = compactForPreview(raw, depth + 1);
  const allKeys = Object.keys(value as Record<string, unknown>);
  if (allKeys.length > PREVIEW_MAX_KEYS) {
    out.__trimmed_keys = allKeys.length - PREVIEW_MAX_KEYS;
  }
  return out;
}

function estimateSerializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function compactPayloadPreview(payload: Record<string, unknown>) {
  const rawSize = estimateSerializedLength(payload);
  const preview = compactForPreview(payload) as Record<string, unknown>;
  const previewSize = estimateSerializedLength(preview);
  const trimmed = Math.max(0, rawSize - previewSize);
  return {
    preview,
    trimmed,
    rawSize,
    previewSize,
  };
}

function isCompactLifecycleAction(action: string, routeMode: string) {
  return routeMode !== "native-direct" && COMPACT_LIFECYCLE_ACTIONS.has(action);
}

function shouldAttemptFallback({
  teamPolicy = {},
  error = null,
  fallbackAttempts = 0,
}: {
  teamPolicy?: Record<string, unknown>;
  error?: any;
  fallbackAttempts?: number;
}) {
  if (String(teamPolicy?.native_fallback_policy || "coordinator") === "error") {
    return {
      allow: false,
      reason: "native_fallback_policy=error",
    };
  }
  if (fallbackAttempts >= 1) {
    return {
      allow: false,
      reason: "fallback already attempted",
    };
  }
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  const nonRetryable = NON_RETRYABLE_FALLBACK_TOKENS.find(
    (token) => code.includes(token) || message.includes(token),
  );
  if (nonRetryable) {
    return {
      allow: false,
      reason: `non-retryable error token: ${nonRetryable}`,
    };
  }
  return { allow: true, reason: "retryable failure" };
}

function withOrchestrationMetrics(metricsSnapshot: Record<string, unknown>) {
  const actionsTotal = orchestrationRollup.actions_total || 1;
  return {
    ...metricsSnapshot,
    orchestration: {
      actions_total: orchestrationRollup.actions_total,
      lifecycle_events_total: orchestrationRollup.lifecycle_events_total,
      compact_lifecycle_actions: orchestrationRollup.compact_lifecycle_actions,
      fallback_attempts_total: orchestrationRollup.fallback_attempts_total,
      fallback_skipped_total: orchestrationRollup.fallback_skipped_total,
      alerts_total: orchestrationRollup.alerts_total,
      payload_preview_trims_total:
        orchestrationRollup.payload_preview_trims_total,
      avg_lifecycle_events_per_action:
        orchestrationRollup.lifecycle_events_total / actionsTotal,
    },
  };
}

function uniqueInterrupts<T>(
  interrupts: T[],
  keySelector: (interrupt: T) => string,
  max: number,
) {
  const selected: T[] = [];
  const seen = new Set<string>();
  let deduped = 0;
  for (const interrupt of interrupts) {
    const key = keySelector(interrupt);
    if (seen.has(key)) {
      deduped += 1;
      continue;
    }
    seen.add(key);
    selected.push(interrupt);
    if (selected.length >= max) break;
  }
  return { selected, deduped };
}

export function createTrackedActionRunner({
  actionQueue,
  store,
  metrics,
  nativeAdapter,
  router,
}: TrackedActionRunnerDeps) {
  return async function runTrackedAction({
    team,
    action,
    payload,
    routeMode = "router",
    nativeHttpAction = null,
    trackedActionId = null,
  }: TrackedActionInput): Promise<Record<string, unknown>> {
    const teamName = team?.team_name || payload?.team_name || null;
    const payloadPreviewStats = compactPayloadPreview(payload || {});
    const payloadPreview = payloadPreviewStats.preview;
    const compactLifecycle = isCompactLifecycleAction(action, routeMode);
    const actionOrchestration = {
      lifecycle_events: 0,
      fallback_attempts: 0,
      fallback_skipped: 0,
      alerts_raised: 0,
      payload_preview_trimmed_bytes: payloadPreviewStats.trimmed,
      compact_lifecycle: compactLifecycle,
    };
    const initialRouteReason =
      routeMode === "native-direct"
        ? "native direct endpoint requested"
        : "router policy dispatch";
    const record = trackedActionId
      ? {
          ...(actionQueue.get(trackedActionId) || {}),
          action_id: trackedActionId,
          team_name: teamName,
          action,
          route_mode: routeMode,
          route_reason: initialRouteReason,
          payload_preview: payloadPreview,
        }
      : actionQueue.create({
          team_name: teamName,
          action,
          route_mode: routeMode,
          route_reason: initialRouteReason,
          payload_preview: payloadPreview,
        });
    if (trackedActionId && !record?.action_id)
      throw new Error(`Action ${trackedActionId} not found`);
    const emitLifecycle = (
      event: "queued" | "started" | "completed" | "failed",
      data: Record<string, unknown>,
    ) => {
      actionOrchestration.lifecycle_events += 1;
      if (event === "queued") store.emitActionQueued(data);
      else if (event === "started") store.emitActionStarted(data);
      else if (event === "completed") store.emitActionCompleted(data);
      else store.emitActionFailed(data);
    };
    const raiseIntervention = (alert: Record<string, unknown>) => {
      actionOrchestration.alerts_raised += 1;
      store.raiseAlert(alert);
    };
    if (!compactLifecycle) {
      emitLifecycle("queued", {
        action_id: record.action_id,
        action,
        team_name: record.team_name,
        route_mode: routeMode,
        route_reason: initialRouteReason,
      });
    }
    actionQueue.markStarted(record.action_id as string, {
      team_name: record.team_name,
      action,
      route_mode: routeMode,
      route_reason: initialRouteReason,
      payload_preview: payloadPreview,
    });
    emitLifecycle("started", {
      action_id: record.action_id,
      action,
      team_name: record.team_name,
      route_mode: routeMode,
      route_reason: initialRouteReason,
    });
    const start = Date.now();
    try {
      const routedPayload = {
        ...payload,
        correlation_id: record.action_id,
      };
      const routed: any =
        routeMode === "native-direct"
          ? await nativeAdapter.execute(nativeHttpAction, routedPayload, {
              team,
              force_path_mode: payload?.force_path_mode || null,
            })
          : await router.route(
              team as Record<string, unknown>,
              action,
              routedPayload,
            );
      const latency_ms = Date.now() - start;
      const wrapper: any =
        routeMode === "native-direct"
          ? await (async () => {
              const nativeOut = {
                ok: routed?.ok !== false,
                adapter: "native",
                path_mode: routed.path_mode || "native-direct",
                route_mode:
                  routed.route_mode || routed.path_mode || "native-direct",
                route_reason:
                  routed.route_reason || "native direct endpoint execution",
                reason:
                  routed.route_reason || "native direct endpoint execution",
                fallback_plan: ["native-direct", "bridge", "coordinator"],
                fallback_used: false,
                cost_estimate_class:
                  routed.path_mode === "bridge" ? "medium" : "high",
                latency_ms,
                result: routed,
                error: routed?.error || null,
              };
              if (nativeOut.ok) return nativeOut;
              const teamData = team as unknown as Record<string, unknown>;
              const teamPolicy = (teamData?.policy || {}) as Record<
                string,
                unknown
              >;
              const fallbackPolicy = shouldAttemptFallback({
                teamPolicy,
                error: routed?.error || null,
                fallbackAttempts: actionOrchestration.fallback_attempts,
              });
              if (!fallbackPolicy.allow) {
                actionOrchestration.fallback_skipped += 1;
                return {
                  ...nativeOut,
                  fallback_skipped: true,
                  fallback_skip_reason: fallbackPolicy.reason,
                  route_reason: `${nativeOut.route_reason}; fallback skipped (${fallbackPolicy.reason})`,
                  reason: `${nativeOut.route_reason}; fallback skipped (${fallbackPolicy.reason})`,
                };
              }
              actionOrchestration.fallback_attempts += 1;
              const fallbackAction = nativeHttpAction || action;
              try {
                const routerData = router as unknown as Record<string, unknown>;
                const coordinatorFallback = await (
                  (routerData.coordinator as unknown as Record<string, unknown>)
                    .execute as Function
                )(fallbackAction, routedPayload);
                const fallbackReason = `native direct route failed (${routed?.error?.code || routed?.error?.message || "error"}); coordinator fallback`;
                raiseIntervention({
                  level: "warn",
                  code: "native_direct_fallback_to_coordinator",
                  message: fallbackReason,
                  action_id: record.action_id as string,
                });
                return {
                  ok: coordinatorFallback?.ok !== false,
                  adapter: "coordinator",
                  path_mode: "local-module",
                  route_mode: "coordinator-fallback",
                  route_reason: fallbackReason,
                  reason: fallbackReason,
                  fallback_plan: ["native-direct", "bridge", "coordinator"],
                  fallback_used: true,
                  fallback_from: {
                    adapter: "native",
                    route_mode: nativeOut.route_mode,
                    error: routed?.error || null,
                  },
                  cost_estimate_class: "low",
                  latency_ms: Date.now() - start,
                  result: coordinatorFallback,
                  error: null,
                };
              } catch (fallbackErr: any) {
                const fallbackReason = `native direct route failed and coordinator fallback failed (${fallbackErr.message})`;
                raiseIntervention({
                  level: "error",
                  code: "native_direct_fallback_failed",
                  message: fallbackReason,
                  action_id: record.action_id as string,
                });
                return {
                  ...nativeOut,
                  route_reason: fallbackReason,
                  reason: fallbackReason,
                  latency_ms: Date.now() - start,
                  error: {
                    native: routed?.error || null,
                    coordinator: { message: fallbackErr.message },
                  },
                };
              }
            })()
          : { ...routed, latency_ms: routed.latency_ms ?? latency_ms };
      wrapper.route_mode =
        wrapper.route_mode ||
        wrapper.path_mode ||
        (wrapper.adapter === "coordinator" ? "coordinator-local" : routeMode);
      wrapper.route_reason =
        wrapper.route_reason || wrapper.reason || initialRouteReason;
      wrapper.reason = wrapper.route_reason;
      wrapper.orchestration = {
        lifecycle_events: actionOrchestration.lifecycle_events,
        fallback_attempts: actionOrchestration.fallback_attempts,
        fallback_skipped: actionOrchestration.fallback_skipped,
        alerts_raised: actionOrchestration.alerts_raised,
        payload_preview_trimmed_bytes:
          actionOrchestration.payload_preview_trimmed_bytes,
        compact_lifecycle: actionOrchestration.compact_lifecycle,
      };

      const ok = wrapper.ok !== false;
      metrics.observeAction({
        latency_ms: wrapper.latency_ms,
        path_key: `${wrapper.adapter}:${wrapper.path_mode || "unknown"}`,
        ok,
        fallback_used: Boolean(wrapper.fallback_used),
      });

      if (ok) {
        actionQueue.markCompleted(record.action_id as string, {
          adapter: wrapper.adapter,
          path_mode: wrapper.path_mode,
          route_mode: wrapper.route_mode,
          route_reason: wrapper.route_reason,
          latency_ms: wrapper.latency_ms,
          result_summary: compactForPreview(
            wrapper.result?.text
              ? String(wrapper.result.text).slice(0, 1000)
              : wrapper.result,
          ),
          fallback_used: Boolean(wrapper.fallback_used),
          fallback_history: wrapper.fallback_used
            ? [wrapper.fallback_from || null].filter(Boolean)
            : [],
          orchestration: wrapper.orchestration,
        });
        emitLifecycle("completed", {
          action_id: record.action_id,
          action,
          adapter: wrapper.adapter,
          path_mode: wrapper.path_mode,
          route_mode: wrapper.route_mode,
          route_reason: wrapper.route_reason,
          latency_ms: wrapper.latency_ms,
          fallback_used: wrapper.fallback_used,
        });
      } else {
        actionQueue.markFailed(record.action_id as string, {
          adapter: wrapper.adapter,
          path_mode: wrapper.path_mode,
          route_mode: wrapper.route_mode,
          route_reason: wrapper.route_reason,
          latency_ms: wrapper.latency_ms,
          error: wrapper.error || wrapper.result?.error || null,
          orchestration: wrapper.orchestration,
        });
        emitLifecycle("failed", {
          action_id: record.action_id,
          action,
          adapter: wrapper.adapter,
          path_mode: wrapper.path_mode,
          route_mode: wrapper.route_mode,
          route_reason: wrapper.route_reason,
          latency_ms: wrapper.latency_ms,
          error: wrapper.error || wrapper.result?.error || null,
        });
        raiseIntervention({
          level: "warn",
          code: "action_failed",
          message: `${action} failed`,
          action_id: record.action_id,
        });
      }

      orchestrationRollup.actions_total += 1;
      orchestrationRollup.lifecycle_events_total +=
        actionOrchestration.lifecycle_events;
      orchestrationRollup.fallback_attempts_total +=
        actionOrchestration.fallback_attempts;
      orchestrationRollup.fallback_skipped_total +=
        actionOrchestration.fallback_skipped;
      orchestrationRollup.alerts_total += actionOrchestration.alerts_raised;
      orchestrationRollup.payload_preview_trims_total +=
        actionOrchestration.payload_preview_trimmed_bytes;
      if (actionOrchestration.compact_lifecycle) {
        orchestrationRollup.compact_lifecycle_actions += 1;
      }
      store.setActionsRecent(actionQueue.list(50));
      store.setMetrics(withOrchestrationMetrics(metrics.snapshot()));
      return { ...wrapper, action_id: record.action_id };
    } catch (err: any) {
      const latency_ms = Date.now() - start;
      metrics.observeAction({
        latency_ms,
        path_key: "error",
        ok: false,
        fallback_used: false,
      });
      actionQueue.markFailed(record.action_id as string, {
        route_mode: routeMode,
        route_reason: `${initialRouteReason}; exception`,
        latency_ms,
        error: { message: err.message },
        orchestration: {
          lifecycle_events: actionOrchestration.lifecycle_events,
          fallback_attempts: actionOrchestration.fallback_attempts,
          fallback_skipped: actionOrchestration.fallback_skipped,
          alerts_raised: actionOrchestration.alerts_raised,
          payload_preview_trimmed_bytes:
            actionOrchestration.payload_preview_trimmed_bytes,
          compact_lifecycle: actionOrchestration.compact_lifecycle,
        },
      });
      emitLifecycle("failed", {
        action_id: record.action_id,
        action,
        route_mode: routeMode,
        route_reason: `${initialRouteReason}; exception`,
        error: { message: err.message },
        latency_ms,
      });
      raiseIntervention({
        level: "error",
        code: "action_exception",
        message: `${action} exception: ${err.message}`,
        action_id: record.action_id,
      });
      orchestrationRollup.actions_total += 1;
      orchestrationRollup.lifecycle_events_total +=
        actionOrchestration.lifecycle_events;
      orchestrationRollup.fallback_attempts_total +=
        actionOrchestration.fallback_attempts;
      orchestrationRollup.fallback_skipped_total +=
        actionOrchestration.fallback_skipped;
      orchestrationRollup.alerts_total += actionOrchestration.alerts_raised;
      orchestrationRollup.payload_preview_trims_total +=
        actionOrchestration.payload_preview_trimmed_bytes;
      if (actionOrchestration.compact_lifecycle) {
        orchestrationRollup.compact_lifecycle_actions += 1;
      }
      store.setActionsRecent(actionQueue.list(50));
      store.setMetrics(withOrchestrationMetrics(metrics.snapshot()));
      throw err;
    }
  };
}

export function createBatchTriageRunner({
  store,
  findTeam,
  buildTeamInterrupts,
  runTrackedAction,
}: BatchTriageDeps) {
  return async function runBatchTriage({
    teamName,
    op,
    confirm = false,
    message = "",
    limit = 20,
  }: BatchTriageInput): Promise<Record<string, unknown>> {
    if (!confirm)
      return {
        ok: false,
        error: "confirm=true required",
        results: [],
        summary: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
      };
    const max = Math.max(1, Math.min(100, Number(limit || 20)));
    const team = findTeam(store.getSnapshot(), teamName);
    const interrupts = buildTeamInterrupts({
      snapshot: store.getSnapshot(),
      teamName,
      teamPolicy: team?.policy,
    });
    const results: any[] = [];
    let selected: any[] = [];
    let dedupedInterrupts = 0;

    if (op === "approve_all_safe") {
      const deduped = uniqueInterrupts(
        interrupts.filter((i) => i.kind === "approval" && i.safe_auto),
        (i: any) => `approval:${i.task_id || i.id || "unknown"}`,
        max,
      );
      selected = deduped.selected;
      dedupedInterrupts += deduped.deduped;
      for (const it of selected) {
        if (!it.task_id) {
          results.push({
            interrupt_id: it.id,
            ok: false,
            skipped: true,
            reason: "missing task_id",
          });
          continue;
        }
        try {
          const t = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({
            team: t,
            action: "approve-plan",
            payload: {
              team_name: teamName,
              task_id: it.task_id,
              message: message || "Batch triage auto-approve",
            },
            routeMode: "router",
          });
          results.push({
            interrupt_id: it.id,
            ok: out.ok !== false,
            action_id: out.action_id || null,
            adapter: out.adapter,
            path_mode: out.path_mode,
            reason: out.reason || null,
          });
        } catch (err: any) {
          results.push({ interrupt_id: it.id, ok: false, error: err.message });
        }
      }
    } else if (op === "wake_all_stale") {
      const deduped = uniqueInterrupts(
        interrupts.filter(
          (i) => i.kind === "stale" && i.safe_auto && i.session_id,
        ),
        (i: any) => `stale:${i.session_id || i.id || "unknown"}`,
        max,
      );
      selected = deduped.selected;
      dedupedInterrupts += deduped.deduped;
      for (const it of selected) {
        try {
          const t = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({
            team: t,
            action: "wake",
            payload: {
              team_name: teamName,
              session_id: it.session_id,
              message: message || "Batch triage wake (stale worker)",
            },
            routeMode: "router",
          });
          results.push({
            interrupt_id: it.id,
            ok: out.ok !== false,
            action_id: out.action_id || null,
            adapter: out.adapter,
            path_mode: out.path_mode,
            reason: out.reason || null,
          });
        } catch (err: any) {
          results.push({ interrupt_id: it.id, ok: false, error: err.message });
        }
      }
    } else if (op === "reject_all_risky") {
      const deduped = uniqueInterrupts(
        interrupts.filter((i) => i.kind === "approval" && !i.safe_auto),
        (i: any) => `approval:${i.task_id || i.id || "unknown"}`,
        max,
      );
      selected = deduped.selected;
      dedupedInterrupts += deduped.deduped;
      for (const it of selected) {
        if (!it.task_id) {
          results.push({
            interrupt_id: it.id,
            ok: false,
            skipped: true,
            reason: "missing task_id",
          });
          continue;
        }
        try {
          const t = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({
            team: t,
            action: "reject-plan",
            payload: {
              team_name: teamName,
              task_id: it.task_id,
              feedback: message || "Batch triage: rejected due to risk flags",
            },
            routeMode: "router",
          });
          results.push({
            interrupt_id: it.id,
            ok: out.ok !== false,
            action_id: out.action_id || null,
            adapter: out.adapter,
            path_mode: out.path_mode,
            reason: out.reason || null,
          });
        } catch (err: any) {
          results.push({ interrupt_id: it.id, ok: false, error: err.message });
        }
      }
    } else if (op === "dismiss_resolved") {
      const currentInterrupts = buildTeamInterrupts({
        snapshot: store.getSnapshot(),
        teamName,
        teamPolicy: findTeam(store.getSnapshot(), teamName)?.policy,
      });
      const currentIds = new Set(currentInterrupts.map((i) => i.id));
      let dismissed = 0;
      const alertsData = store.getSnapshot() as unknown as Record<
        string,
        unknown
      >;
      const freshAlerts = ((alertsData.alerts as unknown[]) || []).filter(
        (a: unknown) => {
          const alert = a as Record<string, unknown>;
          if (alert.team_name && alert.team_name !== teamName) return true;
          const matchId = `alert:${alert.action_id || alert.request_id || ""}`;
          if (!currentIds.has(matchId)) {
            dismissed += 1;
            return false;
          }
          return true;
        },
      );
      store.snapshot.alerts = freshAlerts;
      results.push({ ok: true, dismissed });
    } else {
      return {
        ok: false,
        error: `unsupported op: ${op}`,
        results: [],
        summary: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
      };
    }

    const summary = {
      attempted: results.length,
      selected_interrupts: selected.length,
      deduped_interrupts: dedupedInterrupts,
      succeeded: results.filter((r) => r.ok && !r.skipped).length,
      failed: results.filter((r) => r.ok === false && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    };
    return {
      ok: summary.failed === 0,
      team_name: teamName,
      op,
      results,
      summary,
    };
  };
}
