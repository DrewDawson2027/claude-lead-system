export function derivePresenceFromMember(member = {}, allTasks = []) {
  const sessionStatus = member.session_status || 'offline';
  const taskId = member.current_task_ref || member.task_id || null;
  const task = taskId ? allTasks.find((t) => t.task_id === taskId) : null;
  const risks = Array.isArray(member.risk_flags) ? [...new Set(member.risk_flags)] : [];

  if (!member.session_id && !member.session) {
    return { presence: 'offline', risk_flags: risks };
  }
  if (sessionStatus === 'stale') return { presence: 'stale', risk_flags: risks };
  if (sessionStatus === 'idle') return { presence: 'idle', risk_flags: risks };
  if (task?.blocked_by?.length) return { presence: 'blocked_by_dependency', risk_flags: risks };
  return { presence: 'active', risk_flags: risks };
}

export function deriveLoadScore(member = {}) {
  const load = Number(member.load_score ?? 0);
  return Math.max(0, Math.min(100, Number.isFinite(load) ? load : 0));
}

export function deriveInterruptibility(member = {}) {
  const score = Number(member.interruptibility_score ?? 0);
  return Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
}

export function deriveDispatchReadiness(member = {}) {
  const score = Number(member.dispatch_readiness ?? 0);
  return Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
}
