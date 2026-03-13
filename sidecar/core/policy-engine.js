const COORDINATOR_ONLY = new Set([
  "directive",
  "dispatch",
  "queue-task",
  "assign-next",
  "rebalance",
  "approve-plan",
  "reject-plan",
  "wake",
]);
const NATIVE_CAPABLE = new Set([
  "message",
  "native-message",
  "native-send-message",
  "native-task",
  "task",
  "team-status",
  "native-team-status",
  "team-create",
  "native-team-create",
]);
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

export function classifyAction(action = "") {
  if (COORDINATOR_ONLY.has(action)) return "coordinator_only";
  if (NATIVE_CAPABLE.has(action)) {
    if (
      action === "message" ||
      action === "native-message" ||
      action === "native-send-message"
    )
      return "prefer_native_for_ux";
    return "native_only";
  }
  return "equivalent";
}

// --- B3: Decision trace support ---
export function chooseExecutionPath(
  team = {},
  action = "",
  nativeHealth = {},
  opts = {},
) {
  const trace = [];
  const semantic = classifyAction(action);
  trace.push(`classify action '${action}' -> ${semantic}`);

  const policy = team.policy || {};
  const preferred =
    policy.preferred_execution_path || team.execution_path || "hybrid";
  const costPolicy =
    policy.cost_policy || process.env.LEAD_SIDECAR_COST_POLICY || "cost_first";
  const forcePath = opts.force_path || opts.forcePath || null;
  const forceMode =
    opts.force_path_mode === "ephemeral"
      ? "native-direct"
      : opts.force_path_mode || null;

  const nativeOk = Boolean(
    nativeHealth?.ok && nativeHealth?.capabilities?.available,
  );
  const bridgeHealthy = nativeHealth?.bridge?.bridge_status === "healthy";
  const nativePathMode = forceMode || "native-direct";
  trace.push(
    `native health: ok=${nativeOk} bridge=${bridgeHealthy} path_mode=${nativePathMode}`,
  );

  const coordinatorDecision = {
    adapter: "coordinator",
    path_mode: "local-module",
    reason: "coordinator policy/default",
    fallback_plan: nativeOk
      ? ["coordinator", "native-direct"]
      : ["coordinator"],
    cost_estimate_class: "low",
    semantic,
  };
  const nativeDecision = {
    adapter: "native",
    path_mode: nativePathMode,
    reason: bridgeHealthy
      ? "native-direct primary; bridge available for fallback"
      : "native-direct primary; bridge fallback may autostart",
    fallback_plan: ["native-direct", "bridge", "coordinator"],
    cost_estimate_class: nativePathMode === "bridge" ? "medium" : "high",
    semantic,
  };

  if (forcePath === "coordinator") {
    trace.push("force_path=coordinator -> coordinator");
    return {
      ...coordinatorDecision,
      reason: "operator forced coordinator",
      decision_trace: trace,
    };
  }
  if (forcePath === "native") {
    trace.push(
      `force_path=native -> ${nativeOk ? "native" : "coordinator (native unavailable)"}`,
    );
    return nativeOk
      ? {
          ...nativeDecision,
          reason: "operator forced native",
          decision_trace: trace,
        }
      : {
          ...coordinatorDecision,
          reason: "operator forced native but native unavailable",
          decision_trace: trace,
        };
  }

  if (semantic === "coordinator_only") {
    trace.push("semantic=coordinator_only -> coordinator");
    return {
      ...coordinatorDecision,
      reason: "coordinator-only action",
      decision_trace: trace,
    };
  }
  if (!nativeOk) {
    trace.push("native unavailable -> coordinator fallback");
    return {
      ...coordinatorDecision,
      reason: "native unavailable fallback",
      decision_trace: trace,
    };
  }
  if (semantic === "prefer_native_for_ux" || semantic === "native_only") {
    trace.push("semantic requires native execution engine -> native");
    return {
      ...nativeDecision,
      reason: "native execution required for team semantics",
      decision_trace: trace,
    };
  }
  if (preferred === "coordinator") {
    trace.push(`team preferred=${preferred} -> coordinator`);
    return {
      ...coordinatorDecision,
      reason: "team policy coordinator",
      decision_trace: trace,
    };
  }
  if (preferred === "native") {
    trace.push(`team preferred=${preferred} -> native`);
    return {
      ...nativeDecision,
      reason: "team policy native",
      decision_trace: trace,
    };
  }

  // hybrid defaults (cost-first)
  trace.push(`hybrid mode: cost_policy=${costPolicy}`);
  if (costPolicy === "native_first") {
    trace.push("native_first policy -> native");
    return {
      ...nativeDecision,
      reason: "hybrid native-first policy",
      decision_trace: trace,
    };
  }
  if (costPolicy === "team_config_required") {
    trace.push("team_config_required -> coordinator default");
    return {
      ...coordinatorDecision,
      reason: "team-config-required defaulted to coordinator",
      decision_trace: trace,
    };
  }

  trace.push("cost-first default -> coordinator");
  return {
    ...coordinatorDecision,
    reason: "cost-first hybrid chose coordinator for equivalent action",
    decision_trace: trace,
  };
}

export function shouldAttemptCoordinatorFallback({
  teamPolicy = {},
  error = null,
  fallbackAttempts = 0,
} = {}) {
  if (String(teamPolicy?.native_fallback_policy || "coordinator") === "error") {
    return {
      allow: false,
      reason: "native_fallback_policy=error",
      category: "policy",
    };
  }
  if (Number(fallbackAttempts) >= 1) {
    return {
      allow: false,
      reason: "fallback already attempted",
      category: "loop_guard",
    };
  }

  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  const tokenMatched = NON_RETRYABLE_FALLBACK_TOKENS.find(
    (token) => code.includes(token) || message.includes(token),
  );
  if (tokenMatched) {
    return {
      allow: false,
      reason: `non-retryable error token: ${tokenMatched}`,
      category: "non_retryable",
    };
  }

  return { allow: true, reason: "retryable failure", category: "retryable" };
}

// --- B2: Configurable interrupt priority ---
const DEFAULT_INTERRUPT_WEIGHTS = {
  approval: 100,
  bridge: 90,
  stale: 80,
  conflict: 70,
  budget: 60,
  error: 50,
  warn: 40,
  default: 10,
};

export function getInterruptWeights(teamPolicy = {}) {
  return {
    ...DEFAULT_INTERRUPT_WEIGHTS,
    ...(teamPolicy.interrupt_weights || {}),
  };
}

export function interruptPriorityScored(
  code = "",
  severity = "info",
  weights = DEFAULT_INTERRUPT_WEIGHTS,
) {
  const c = String(code || "");
  if (c.includes("waiting_for_plan_approval") || c.includes("approval"))
    return weights.approval ?? 100;
  if (c.includes("bridge_") || c.includes("native"))
    return weights.bridge ?? 90;
  if (c.includes("stale")) return weights.stale ?? 80;
  if (c.includes("conflict")) return weights.conflict ?? 70;
  if (c.includes("budget")) return weights.budget ?? 60;
  if (severity === "error") return weights.error ?? 50;
  if (severity === "warn") return weights.warn ?? 40;
  return weights.default ?? 10;
}

// --- C4: Queue policies + priority aging ---
const PRIORITY_ORDER = ["low", "normal", "high", "critical"];

export function applyPriorityAging(tasks = [], config = {}) {
  const intervalMs = config.aging_interval_ms || 3600000;
  const maxBumps = config.max_bumps ?? 2;
  const now = Date.now();
  const aged = [];
  for (const t of tasks) {
    if (t.status === "completed" || t.status === "failed") continue;
    const created = t.created ? new Date(t.created).getTime() : now;
    const ageMs = now - created;
    const bumps = Math.min(maxBumps, Math.floor(ageMs / intervalMs));
    if (bumps <= 0) continue;
    const curIdx = PRIORITY_ORDER.indexOf(t.priority || "normal");
    const newIdx = Math.min(PRIORITY_ORDER.length - 1, curIdx + bumps);
    if (newIdx > curIdx) {
      t.priority = PRIORITY_ORDER[newIdx];
      t.metadata = {
        ...(t.metadata || {}),
        priority_aged: {
          from: PRIORITY_ORDER[curIdx],
          to: PRIORITY_ORDER[newIdx],
          bumps,
          at: new Date().toISOString(),
        },
      };
      aged.push(t.task_id);
    }
  }
  return { aged, tasks: tasks.filter((t) => aged.includes(t.task_id)) };
}

export function applyQueuePolicy(tasks = [], policy = "priority_first") {
  const sorted = [...tasks];
  if (policy === "fifo") {
    sorted.sort((a, b) =>
      String(a.created || "").localeCompare(String(b.created || "")),
    );
  } else if (policy === "round_robin") {
    const assignees = [...new Set(sorted.map((t) => t.assignee || ""))].filter(
      Boolean,
    );
    if (assignees.length > 1) {
      const buckets = new Map();
      for (const t of sorted) {
        const key = t.assignee || "__unassigned__";
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(t);
      }
      const result = [];
      let hasMore = true;
      let idx = 0;
      while (hasMore) {
        hasMore = false;
        for (const [, bucket] of buckets) {
          if (idx < bucket.length) {
            result.push(bucket[idx]);
            hasMore = true;
          }
        }
        idx += 1;
      }
      return result;
    }
  } else {
    // priority_first (default)
    sorted.sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority || "normal");
      const pb = PRIORITY_ORDER.indexOf(b.priority || "normal");
      if (pb !== pa) return pb - pa;
      return String(a.created || "").localeCompare(String(b.created || ""));
    });
  }
  return sorted;
}

// --- C5: Auto-rebalance triggers ---
export function shouldAutoRebalance(teamSnapshot = {}, config = {}) {
  if (!config.enabled)
    return {
      trigger: false,
      reason: "auto-rebalance disabled",
      conditions_met: [],
    };
  const conditions = [];
  const members = teamSnapshot.members || [];
  const queue = teamSnapshot.task_queue || [];
  const triggers = config.triggers || {};

  // Stale with in-progress task
  if (triggers.stale_with_task !== false) {
    const staleWithTask = members.filter(
      (m) => m.presence === "stale" && m.current_task_ref,
    );
    if (staleWithTask.length > 0)
      conditions.push(
        `stale_with_task: ${staleWithTask.map((m) => m.name).join(", ")}`,
      );
  }

  // Queue overflow
  const overflowThreshold = triggers.queue_overflow ?? 3;
  const unassigned = queue.filter(
    (t) => !t.assignee && t.status !== "completed",
  );
  if (unassigned.length > overflowThreshold)
    conditions.push(
      `queue_overflow: ${unassigned.length} unassigned > ${overflowThreshold}`,
    );

  // Load imbalance
  const imbalanceThreshold = triggers.load_imbalance ?? 40;
  const activeMembers = members.filter(
    (m) => m.presence === "active" || m.presence === "idle",
  );
  if (activeMembers.length >= 2) {
    const loads = activeMembers.map((m) => m.load_score || 0);
    const diff = Math.max(...loads) - Math.min(...loads);
    if (diff > imbalanceThreshold)
      conditions.push(`load_imbalance: diff=${diff} > ${imbalanceThreshold}`);
  }

  return {
    trigger: conditions.length > 0,
    reason:
      conditions.length > 0
        ? conditions.join("; ")
        : "no trigger conditions met",
    conditions_met: conditions,
  };
}
