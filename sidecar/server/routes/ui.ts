export function registerUiRoutes(registry: any): void {
  registry.add('ui:bootstrap', (ctx: any) => {
    const { req, res, url, csrfToken, apiToken } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/ui/bootstrap.json')) return false;
    ctx.sendJson(res, 200, {
      ok: true,
      csrf_token: csrfToken,
      token_required: process.env.LEAD_SIDECAR_REQUIRE_TOKEN === '1',
      api_token: process.env.LEAD_SIDECAR_REQUIRE_TOKEN === '1' ? apiToken : null,
      generated_at: new Date().toISOString(),
    }, req);
    return true;
  });

  registry.add('ui:preferences-get', (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/ui/preferences')) return false;
    const prefs = ctx.readJSON(paths.uiPrefsFile) || {};
    ctx.sendJson(res, 200, { ok: true, preferences: prefs }, req);
    return true;
  });

  registry.add('ui:preferences-put', async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === 'PUT' && url.pathname === '/ui/preferences')) return false;
    const body = await ctx.readBody(req);
    if (body.__parse_error) { ctx.sendJson(res, 400, { error: body.__parse_error }, req); return true; }
    ctx.writeJSON(paths.uiPrefsFile, body);
    ctx.sendJson(res, 200, { ok: true, saved: true }, req);
    return true;
  });

  registry.add('ui:index', (ctx: any) => {
    const { req, res, url, DASHBOARD_HTML } = ctx;
    if (!(req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))) return false;
    ctx.sendHtml(res, 200, DASHBOARD_HTML, req);
    return true;
  });

  registry.add('ui:app-js', (ctx: any) => {
    const { req, res, url, DASHBOARD_JS } = ctx;
    if (!(req.method === 'GET' && url.pathname === '/ui/app.js')) return false;
    ctx.sendJs(res, 200, DASHBOARD_JS, req);
    return true;
  });

  registry.add('ui:open-dashboard', async (ctx: any) => {
    const { req, res, url, paths, server } = ctx;
    if (!(req.method === 'POST' && url.pathname === '/open-dashboard')) return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) { ctx.sendJson(res, v.status, { error: v.error }, req); return true; }
    try {
      const port = ctx.readJSON(paths.portFile)?.port;
      const target = `http://127.0.0.1:${port || server.address().port}/`;
      if (process.platform === 'darwin') ctx.spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
      ctx.sendJson(res, 200, { ok: true, target }, req);
    } catch (err: any) {
      ctx.sendJson(res, 500, { ok: false, error: err.message }, req);
    }
    return true;
  });
}
