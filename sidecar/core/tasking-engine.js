export function normalizeTeamTask(task = {}) {
  return {
    task_id: task.task_id,
    team_name: task.team_name || task.metadata?.team_name || null,
    subject: task.subject || "",
    status: task.status || "pending",
    dispatch_status:
      task.dispatch_status || task.metadata?.dispatch?.status || "queued",
    worker_task_id:
      task.worker_task_id ||
      task.metadata?.dispatch?.worker_task_id ||
      task.metadata?.worker_task_id ||
      null,
    assignee: task.assignee || null,
    priority: task.priority || "normal",
    files: Array.isArray(task.files) ? task.files : [],
    blocked_by: Array.isArray(task.blocked_by) ? task.blocked_by : [],
    metadata: task.metadata || {},
    created: task.created || null,
    updated: task.updated || null,
    quality_gates: Array.isArray(task.quality_gates)
      ? task.quality_gates
      : task.metadata?.quality_gates || [],
    acceptance_criteria: Array.isArray(task.acceptance_criteria)
      ? task.acceptance_criteria
      : task.metadata?.acceptance_criteria || [],
    audit_summary: Array.isArray(task.audit_trail)
      ? task.audit_trail.slice(-5)
      : [],
  };
}

export function summarizeTeam(snapshot = {}) {
  const members = Array.isArray(snapshot.members) ? snapshot.members : [];
  const queue = Array.isArray(snapshot.task_queue) ? snapshot.task_queue : [];
  return {
    active: members.filter((m) =>
      ["active", "running_pipe_worker", "running_interactive_worker"].includes(
        m.presence,
      ),
    ).length,
    idle: members.filter((m) => m.presence === "idle").length,
    stale: members.filter((m) => m.presence === "stale").length,
    blocked: members.filter((m) =>
      [
        "blocked_by_dependency",
        "waiting_for_plan_approval",
        "budget_blocked",
      ].includes(m.presence),
    ).length,
    overloaded: members.filter((m) => (m.load_score || 0) >= 75).length,
    queued_tasks: queue.filter(
      (t) => (t.dispatch_status || "queued") === "queued",
    ).length,
    in_progress_tasks: queue.filter((t) => t.status === "in_progress").length,
  };
}
