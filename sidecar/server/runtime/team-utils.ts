// @ts-nocheck
import { getInterruptWeights, interruptPriorityScored } from '../../core/policy-engine.js';

export function trimLongStrings(obj, maxLen = 512) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.length > maxLen ? `${obj.slice(0, maxLen)}…` : obj;
  if (Array.isArray(obj)) return obj.map((x) => trimLongStrings(x, maxLen));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = trimLongStrings(v, maxLen);
    return out;
  }
  return obj;
}

export function latestJsonFileName(dir, readdirSync) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().pop() || null;
  } catch {
    return null;
  }
}

export function findTeam(snapshot, teamName) {
  return (snapshot.teams || []).find((t) => t.team_name === teamName) || { team_name: teamName, execution_path: 'hybrid', policy: {} };
}

export function buildActionPayload(teamName, action, body) {
  if (action === 'dispatch') return { team_name: teamName, ...body };
  if (action === 'queue-task') return { team_name: teamName, ...body };
  if (action === 'assign-next') return { team_name: teamName, ...body };
  if (action === 'rebalance') return { team_name: teamName, ...body };
  if (action === 'message') return { from: body.from || 'sidecar', target_name: body.target_name, to: body.to, content: body.content, priority: body.priority, team_name: teamName };
  if (action === 'directive') return { from: body.from || 'sidecar', to: body.to, content: body.content, priority: body.priority, team_name: teamName };
  if (action === 'approve-plan') return { task_id: body.task_id, message: body.message, team_name: teamName };
  if (action === 'reject-plan') return { task_id: body.task_id, feedback: body.feedback, team_name: teamName };
  if (action === 'wake') return { session_id: body.session_id, message: body.message || 'Lead sidecar wake request', team_name: teamName };
  return { team_name: teamName, ...body };
}

function interruptPriority(code = '', severity = 'info', weights = null) {
  if (weights) return interruptPriorityScored(code, severity, weights);
  const c = String(code || '');
  if (c.includes('waiting_for_plan_approval') || c.includes('approval')) return 100;
  if (c.includes('bridge_') || c.includes('native')) return 90;
  if (c.includes('stale')) return 80;
  if (c.includes('conflict')) return 70;
  if (c.includes('budget')) return 60;
  if (severity === 'error') return 50;
  if (severity === 'warn') return 40;
  return 10;
}

export function buildTeamInterrupts({ snapshot, teamName, teamPolicy = null }) {
  const teammates = (snapshot.teammates || []).filter((t) => t.team_name === teamName);
  const alerts = (snapshot.alerts || []).filter((a) => !a.team_name || a.team_name === teamName);
  const weights = getInterruptWeights(teamPolicy || {});
  const interrupts = [];

  for (const m of teammates) {
    if (m.presence === 'waiting_for_plan_approval') {
      interrupts.push({
        id: `approval:${m.id}`,
        kind: 'approval', severity: 'warn', code: 'waiting_for_plan_approval',
        teammate_id: m.id, teammate_name: m.display_name,
        task_id: m.worker_task_id || m.current_task_ref || null,
        title: `${m.display_name} waiting for plan approval`,
        message: `Approve or reject plan for ${m.display_name}`,
        suggested_actions: ['approve-plan', 'reject-plan'],
        safe_auto: !(m.risk_flags || []).includes('conflict_risk') && !(m.risk_flags || []).includes('over_budget_risk'),
        created_at: m.last_active || null,
      });
    }
    if (m.presence === 'stale') {
      interrupts.push({
        id: `stale:${m.id}`,
        kind: 'stale', severity: 'warn', code: 'stale_worker',
        teammate_id: m.id, teammate_name: m.display_name, session_id: m.session_id || null,
        title: `${m.display_name} is stale`, message: `Wake ${m.display_name} or send directive`,
        suggested_actions: ['wake', 'directive'], safe_auto: Boolean(m.session_id), created_at: m.last_active || null,
      });
    }
    for (const rf of (m.risk_flags || [])) {
      if (!['conflict_risk', 'over_budget_risk'].includes(rf)) continue;
      interrupts.push({
        id: `${rf}:${m.id}`,
        kind: 'risk', severity: 'warn', code: rf,
        teammate_id: m.id, teammate_name: m.display_name,
        title: `${m.display_name} ${rf.replaceAll('_', ' ')}`,
        message: `${m.display_name} has ${rf.replaceAll('_', ' ')}`,
        suggested_actions: ['view-detail', 'directive'], safe_auto: false, created_at: m.last_active || null,
      });
    }
  }

  for (const a of alerts) {
    interrupts.push({
      id: `alert:${a.action_id || a.request_id || a.ts || Math.random().toString(36).slice(2)}`,
      kind: 'alert', severity: a.level || 'info', code: a.code || 'alert',
      title: a.code || 'alert', message: a.message || '', action_id: a.action_id || null, request_id: a.request_id || null,
      suggested_actions: a.code === 'bridge_stuck_request' ? ['bridge-validate', 'bridge-ensure'] : ['view-action'],
      safe_auto: false, created_at: a.ts || null,
    });
  }

  interrupts.sort((a, b) => {
    const pa = interruptPriority(a.code, a.severity, weights);
    const pb = interruptPriority(b.code, b.severity, weights);
    if (pb !== pa) return pb - pa;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return interrupts.map((i, idx) => ({ ...i, priority_score: interruptPriority(i.code, i.severity, weights), rank: idx + 1 }));
}

export function mapNativeHttpAction(httpAction) {
  const a = String(httpAction || '');
  if (a === 'team-create') return 'team-create';
  if (a === 'team-status') return 'team-status';
  if (a === 'send-message') return 'native-send-message';
  if (a === 'task') return 'native-task';
  return null;
}
