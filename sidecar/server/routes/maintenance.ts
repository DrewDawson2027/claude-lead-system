export function registerMaintenanceRoutes(registry: any): void {
  registry.add('maintenance:run', async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/maintenance/run')) return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    const out = ctx.maintenanceSweep({ source: body?.source || 'manual' });
    await ctx.rebuild('maintenance');
    ctx.sendJson(res, 200, { ok: true, maintenance: out }, req);
    return true;
  });

  registry.add('maintenance:checkpoints-create', async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/checkpoints/create')) return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    try {
      const result = ctx.createCheckpoint(paths, String(body.label || 'manual'));
      ctx.sendJson(res, 200, { ok: true, ...result }, req);
    } catch (err: any) {
      ctx.sendJson(res, 500, { ok: false, error: err.message }, req);
    }
    return true;
  });

  registry.add('maintenance:checkpoints-list', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/checkpoints')) return false;
    ctx.sendJson(res, 200, { ok: true, checkpoints: ctx.listCheckpoints(paths) }, req);
    return true;
  });

  registry.add('maintenance:checkpoints-restore', async (ctx: any) => {
    const { req, res, url, paths, SAFE_MODE } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/checkpoints/restore')) return false;
    if (SAFE_MODE) { ctx.sendJson(res, 503, { error: 'Safe mode: mutation disabled' }, req); return true; }
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    if (!body.file) { ctx.sendJson(res, 400, { error: 'file is required' }, req); return true; }
    const resolved = ctx.pathResolve(String(body.file));
    if (!resolved.startsWith(ctx.pathResolve(paths.checkpointsDir))) {
      ctx.sendJson(res, 400, { error: 'file must be within checkpoints directory' }, req);
      return true;
    }
    try {
      const result = ctx.restoreCheckpoint(paths, resolved);
      await ctx.rebuild('checkpoint-restore');
      ctx.sendJson(res, 200, { ok: true, ...result }, req);
    } catch (err: any) {
      ctx.sendJson(res, 500, { ok: false, error: err.message }, req);
    }
    return true;
  });

  registry.add('maintenance:events-rebuild-check', async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/events/rebuild-check')) return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    const fromTs = body.from_ts ? new Date(body.from_ts).getTime() : null;
    const derived = ctx.rebuildFromTimeline(paths.logFile, fromTs);
    const actual = ctx.store.getSnapshot();
    const check = ctx.consistencyCheck(derived, actual);
    ctx.sendJson(res, 200, { ok: true, ...check, derived_summary: { event_count: derived.event_count, gaps: derived.gaps } }, req);
    return true;
  });

  registry.add('maintenance:events-consistency', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/events/consistency')) return false;
    const derived = ctx.rebuildFromTimeline(paths.logFile);
    const actual = ctx.store.getSnapshot();
    const check = ctx.consistencyCheck(derived, actual);
    ctx.sendJson(res, 200, { ok: true, ...check }, req);
    return true;
  });

  registry.add('maintenance:repair-scan', async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/repair/scan')) return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    const results = ctx.scanForCorruption(paths);
    ctx.sendJson(res, 200, { ok: true, ...results }, req);
    return true;
  });

  registry.add('maintenance:repair-fix', async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/repair/fix')) return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    if (!body.path) { ctx.sendJson(res, 400, { error: 'path is required' }, req); return true; }
    const resolved = ctx.pathResolve(String(body.path));
    if (!resolved.startsWith(ctx.pathResolve(paths.root)) && !resolved.startsWith(ctx.pathResolve(paths.terminalsDir))) {
      ctx.sendJson(res, 400, { error: 'path must be within sidecar or terminals directory' }, req);
      return true;
    }
    if (body.dry_run) {
      try {
        const data = ctx.readJSON(resolved);
        ctx.sendJson(res, 200, { ok: true, dry_run: true, valid: data !== null, path: resolved }, req);
      } catch (err: any) {
        ctx.sendJson(res, 200, { ok: true, dry_run: true, valid: false, error: err.message, path: resolved }, req);
      }
      return true;
    }
    const result = resolved.endsWith('.jsonl') ? ctx.repairJSONL(resolved) : ctx.repairJSON(resolved);
    ctx.sendJson(res, 200, { ok: true, ...result }, req);
    return true;
  });

  registry.add('maintenance:schema-migrations', (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/schema/migrations')) return false;
    const current = ctx.store.getSnapshot();
    const dryRun = ctx.dryRunMigration(current);
    ctx.sendJson(res, 200, { ok: true, current_version: ctx.CURRENT_SCHEMA_VERSION, migrations: ctx.migrations.map((m: any) => ({ from: m.from, to: m.to, description: m.description })), dry_run: dryRun }, req);
    return true;
  });

  registry.add('maintenance:health-locks', (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/health/locks')) return false;
    ctx.sendJson(res, 200, { ok: true, ...ctx.lockMetrics.snapshot() }, req);
    return true;
  });

  registry.add('maintenance:health-terminals', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/health/terminals')) return false;
    const report = ctx.checkTerminalHealth(paths);
    const suggestions = ctx.suggestRecovery(report);
    ctx.sendJson(res, 200, { ok: true, ...report, suggestions }, req);
    return true;
  });

  registry.add('maintenance:health-hooks', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/health/hooks')) return false;
    const report = ctx.validateHooks(paths.hooksDir);
    ctx.sendJson(res, 200, { ok: true, ...report }, req);
    return true;
  });

  registry.add('maintenance:health-hooks-selftest', async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/health/hooks/selftest')) return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    const results = ctx.runHookSelftest(paths.hooksDir);
    ctx.sendJson(res, 200, { ok: true, results }, req);
    return true;
  });

  registry.add('maintenance:backups-list', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/backups')) return false;
    const operation = url.searchParams.get('operation') || null;
    ctx.sendJson(res, 200, { ok: true, backups: ctx.listBackups(paths, operation) }, req);
    return true;
  });

  registry.add('maintenance:backups-restore', async (ctx: any) => {
    const { req, res, url, paths, SAFE_MODE } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/backups/restore')) return false;
    if (SAFE_MODE) { ctx.sendJson(res, 503, { error: 'Safe mode: mutation disabled' }, req); return true; }
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    if (!body.file) { ctx.sendJson(res, 400, { error: 'file is required' }, req); return true; }
    const resolved = ctx.pathResolve(String(body.file));
    if (!resolved.startsWith(ctx.pathResolve(paths.backupsDir))) {
      ctx.sendJson(res, 400, { error: 'file must be within backups directory' }, req);
      return true;
    }
    const result = ctx.restoreFromBackup(paths, resolved);
    if (result.restored) await ctx.rebuild('backup-restore');
    ctx.sendJson(res, result.restored ? 200 : 400, { ok: result.restored, ...result }, req);
    return true;
  });
}
