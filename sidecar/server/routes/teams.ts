import { pathParts, teamNameFromPath, taskIdFromTeamTaskPath } from './shared.js';

export function registerTeamRoutes(registry: any): void {
  registry.add('teams:list', (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (req.method === 'GET' && url.pathname === '/teams') {
      ctx.sendJson(res, 200, { teams: snapshot.teams || [], generated_at: snapshot.generated_at, native: snapshot.native || null }, req);
      return true;
    }
    return false;
  });

  registry.add('teams:get', (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === 'GET' && /^\/teams\/[^/]+$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const team = (snapshot.teams || []).find((t: any) => t.team_name === teamName);
    const teammates = (snapshot.teammates || []).filter((t: any) => t.team_name === teamName);
    const tasks = (snapshot.tasks || []).filter((t: any) => t.team_name === teamName);
    const timeline = (snapshot.timeline || []).filter((t: any) => t.team_name === teamName).slice(-50);
    const alerts = (snapshot.alerts || []).filter((a: any) => !a.team_name || a.team_name === teamName).slice(0, 30);
    if (!team) {
      ctx.sendError(res, 404, 'NOT_FOUND', `Team ${teamName} not found`, req);
      return true;
    }
    ctx.sendJson(res, 200, { team, teammates, tasks, timeline, alerts, native: snapshot.native || null, actions: snapshot.actions || { recent: [] }, generated_at: snapshot.generated_at }, req);
    return true;
  });

  registry.add('teams:interrupts', (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === 'GET' && /^\/teams\/[^/]+\/interrupts$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const team = ctx.findTeam(snapshot, teamName);
    const interrupts = ctx.buildTeamInterrupts({ snapshot, teamName, teamPolicy: team?.policy });
    ctx.sendJson(res, 200, { ok: true, team_name: teamName, interrupts, generated_at: new Date().toISOString() }, req);
    return true;
  });

  registry.add('teams:approvals', (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === 'GET' && /^\/teams\/[^/]+\/approvals$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const team = ctx.findTeam(snapshot, teamName);
    const interrupts = ctx.buildTeamInterrupts({ snapshot, teamName, teamPolicy: team?.policy });
    const approvals = interrupts.filter((i: any) => i.kind === 'approval');
    ctx.sendJson(res, 200, { ok: true, team_name: teamName, approvals, generated_at: new Date().toISOString() }, req);
    return true;
  });

  registry.add('teams:interrupt-priorities', async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'PATCH' && /^\/teams\/[^/]+\/interrupt-priorities$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendError(res, v.status, v.error_code || 'VALIDATION_ERROR', v.error, req); return true; }
    const weights: Record<string, number> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'number' && v >= 0 && v <= 200) weights[k] = v;
    }
    try {
      await ctx.coordinatorAdapter.execute('update-team-policy', { team_name: teamName, interrupt_weights: weights });
    } catch {}
    ctx.sendJson(res, 200, { ok: true, team_name: teamName, interrupt_weights: weights }, req);
    return true;
  });

  registry.add('teams:task-templates-get', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/task-templates')) return false;
    const templates = ctx.readJSON(paths.taskTemplatesFile) || [];
    ctx.sendJson(res, 200, { ok: true, templates }, req);
    return true;
  });

  registry.add('teams:task-templates-post', async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/task-templates')) return false;
    const body = await ctx.readBody(req);
    if (body.__parse_error) {
      ctx.sendError(res, 400, body.__parse_error === 'payload_too_large' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', body.__parse_error, req);
      return true;
    }
    const templates = ctx.readJSON(paths.taskTemplatesFile) || [];
    const tpl = {
      id: body.id || `tpl-${Date.now()}`,
      name: body.name || 'Unnamed Template',
      subject_template: body.subject_template || '',
      prompt_template: body.prompt_template || '',
      role_hint: body.role_hint || '',
      priority: body.priority || 'normal',
      quality_gates: Array.isArray(body.quality_gates) ? body.quality_gates : [],
      acceptance_criteria: Array.isArray(body.acceptance_criteria) ? body.acceptance_criteria : [],
      created_at: new Date().toISOString(),
    };
    templates.push(tpl);
    ctx.writeJSON(paths.taskTemplatesFile, templates);
    ctx.sendJson(res, 200, { ok: true, template: tpl }, req);
    return true;
  });

  registry.add('teams:task-audit', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && /^\/teams\/[^/]+\/tasks\/[^/]+\/audit$/.test(url.pathname))) return false;
    const taskId = taskIdFromTeamTaskPath(url.pathname);
    const auditFile = `${paths.resultsDir}/${taskId}.audit.jsonl`;
    const entries = ctx.readJSONL(auditFile);
    ctx.sendJson(res, 200, { ok: true, task_id: taskId, audit: entries }, req);
    return true;
  });

  registry.add('teams:task-reassign', async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'POST' && /^\/teams\/[^/]+\/tasks\/[^/]+\/reassign$/.test(url.pathname))) return false;
    const parts = pathParts(url.pathname);
    const teamName = decodeURIComponent(parts[2] || '');
    const taskId = decodeURIComponent(parts[4] || '');
    const body = await ctx.readBody(req);
    const result = await ctx.router.execute(teamName, 'reassign-task', {
      task_id: taskId,
      new_assignee: body.new_assignee,
      reason: body.reason || 'manual reassignment via dashboard',
      progress_context: body.progress_context || null,
    });
    ctx.sendJson(res, 200, { ok: true, result }, req);
    return true;
  });

  registry.add('teams:task-gate-check', async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'POST' && /^\/teams\/[^/]+\/tasks\/[^/]+\/gate-check$/.test(url.pathname))) return false;
    const parts = pathParts(url.pathname);
    const taskId = decodeURIComponent(parts[4] || '');
    const result = await ctx.router.execute(parts[2], 'gate-check', { task_id: taskId });
    ctx.sendJson(res, 200, { ok: true, result }, req);
    return true;
  });

  registry.add('teams:rebalance-post', async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === 'POST' && /^\/teams\/[^/]+\/rebalance$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendError(res, v.status, v.error_code || 'VALIDATION_ERROR', v.error, req); return true; }
    const team = ctx.findTeam(snapshot, teamName);
    const routed = await ctx.runTrackedAction({ team, action: 'rebalance', payload: { team_name: teamName, ...body }, routeMode: 'router' });
    if (!routed.ok) { ctx.sendError(res, 400, 'ACTION_FAILED', routed.error || 'Rebalance failed', req, routed.details); return true; }
    await ctx.rebuild('rebalance');
    ctx.sendJson(res, 200, routed, req);
    return true;
  });

  registry.add('teams:rebalance-explain-get', async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'GET' && /^\/teams\/[^/]+\/rebalance-explain$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const limit = Number(url.searchParams.get('limit') || 10);
    const out = await ctx.coordinatorAdapter.execute('rebalance-explain', { team_name: teamName, limit });
    ctx.sendJson(res, 200, out, req);
    return true;
  });

  registry.add('teams:rebalance-explain-post', async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'POST' && /^\/teams\/[^/]+\/rebalance-explain$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendError(res, v.status, v.error_code || 'VALIDATION_ERROR', v.error, req); return true; }
    const out = await ctx.coordinatorAdapter.execute('rebalance-explain', { team_name: teamName, ...body });
    ctx.sendJson(res, 200, out, req);
    return true;
  });

  registry.add('teams:action-post', async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === 'POST' && /^\/teams\/[^/]+\/actions\/[^/]+$/.test(url.pathname))) return false;
    const [, , rawTeam, , rawAction] = pathParts(url.pathname);
    const teamName = decodeURIComponent(rawTeam || '');
    const action = decodeURIComponent(rawAction || '');
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendError(res, v.status, v.error_code || 'VALIDATION_ERROR', v.error, req); return true; }
    const payload = ctx.buildActionPayload(teamName, action, body);
    const team = ctx.findTeam(snapshot, teamName);
    const routed = await ctx.runTrackedAction({ team, action, payload, routeMode: 'router' });
    if (!routed.ok) { ctx.sendError(res, 400, 'ACTION_FAILED', routed.error || 'Action failed', req, routed.details); return true; }
    await ctx.rebuild(`action:${action}`);
    ctx.sendJson(res, 200, routed, req);
    return true;
  });

  registry.add('teams:batch-triage', async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'POST' && /^\/teams\/[^/]+\/batch-triage$/.test(url.pathname))) return false;
    const teamName = teamNameFromPath(url.pathname);
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendError(res, v.status, v.error_code || 'VALIDATION_ERROR', v.error, req); return true; }
    const out = await ctx.runBatchTriage({ teamName, op: String(body.op || ''), confirm: body.confirm === true, message: String(body.message || ''), limit: body.limit });
    await ctx.rebuild('batch-triage');
    ctx.sendJson(res, out.ok ? 200 : 400, out, req);
    return true;
  });
}
