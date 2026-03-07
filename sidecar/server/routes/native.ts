import { lastPathSegment } from "./shared.js";

export function registerNativeRoutes(registry: any): void {
  registry.add("native:status", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && url.pathname === "/native/status"))
      return false;
    const native = await ctx.nativeAdapter.getStatus().catch((err: any) => ({
      adapter_ok: false,
      error: err.message,
      mode: "unavailable",
    }));
    ctx.store.setNativeCapabilities({
      ...(native.native || {
        available: false,
        last_probe_error: native.error || null,
      }),
      validation: native.bridge_validation || null,
    });
    if (native.bridge) ctx.store.emitBridgeStatus(native.bridge);
    ctx.store.setSnapshot({
      native: ctx.store.getSnapshot().native,
      actions: ctx.store.getSnapshot().actions,
      alerts: ctx.store.getSnapshot().alerts,
      metrics: ctx.store.getSnapshot().metrics,
    });
    ctx.sendJson(res, 200, native, req);
    return true;
  });

  registry.add("native:bridge-status", (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && url.pathname === "/native/bridge/status"))
      return false;
    ctx.sendJson(res, 200, ctx.nativeAdapter.bridge.getHealth(), req);
    return true;
  });

  registry.add("native:bridge-validation", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && url.pathname === "/native/bridge/validation"))
      return false;
    const native = await ctx.nativeAdapter.getStatus().catch((err: any) => ({
      adapter_ok: false,
      error: err.message,
      mode: "unavailable",
    }));
    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        validation: native.bridge_validation || null,
        bridge: native.bridge || null,
      },
      req,
    );
    return true;
  });

  registry.add("native:bridge-ensure", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === "POST" && url.pathname === "/native/bridge/ensure"))
      return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) {
      ctx.sendError(
        res,
        v.status,
        v.error_code || "VALIDATION_ERROR",
        v.error,
        req,
      );
      return true;
    }
    const team = body.team_name
      ? ctx.findTeam(snapshot, body.team_name)
      : {
          team_name: null,
          execution_path: "hybrid",
          policy: { native_bridge_policy: "auto" },
        };
    const ensured = await ctx.nativeAdapter.ensureBridge(team);
    await ctx.rebuild("bridge-ensure");
    ctx.sendJson(res, ensured.ok ? 200 : 400, ensured, req);
    return true;
  });

  registry.add("native:bridge-validate", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === "POST" && url.pathname === "/native/bridge/validate"))
      return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) {
      ctx.sendError(
        res,
        v.status,
        v.error_code || "VALIDATION_ERROR",
        v.error,
        req,
      );
      return true;
    }
    const team = body.team_name
      ? ctx.findTeam(snapshot, body.team_name)
      : {
          team_name: null,
          execution_path: "hybrid",
          policy: { native_bridge_policy: "auto" },
        };
    const report = await ctx.nativeAdapter.validateBridge({
      team,
      team_name: body.team_name || null,
      directory: body.directory || process.cwd(),
      timeoutMs: body.timeout_ms || body.timeoutMs || null,
      simulate: typeof body.simulate === "boolean" ? body.simulate : null,
    });
    await ctx.rebuild("bridge-validate");
    ctx.sendJson(res, report.ok ? 200 : 400, report, req);
    return true;
  });

  registry.add("native:probe", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "POST" && url.pathname === "/native/probe"))
      return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) {
      ctx.sendError(
        res,
        v.status,
        v.error_code || "VALIDATION_ERROR",
        v.error,
        req,
      );
      return true;
    }
    const caps = await ctx.nativeAdapter.probe({ force: true });
    await ctx.rebuild("native-probe");
    ctx.sendJson(res, 200, { ok: true, capabilities: caps }, req);
    return true;
  });

  registry.add("native:action", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (
      !(
        req.method === "POST" && /^\/native\/actions\/[^/]+$/.test(url.pathname)
      )
    )
      return false;
    const body = await ctx.readBody(req);
    const v = ctx.validateBody(url.pathname, body);
    if (!v.ok) {
      ctx.sendError(
        res,
        v.status,
        v.error_code || "VALIDATION_ERROR",
        v.error,
        req,
      );
      return true;
    }
    const action = ctx.mapNativeHttpAction(lastPathSegment(url.pathname));
    if (!action) {
      ctx.sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Unsupported native action",
        req,
      );
      return true;
    }
    const team = body.team_name
      ? ctx.findTeam(snapshot, body.team_name)
      : {
          team_name: body.team_name || null,
          execution_path: "native",
          policy: { preferred_execution_path: "native" },
        };
    const out = await ctx.runTrackedAction({
      team,
      action,
      payload: body,
      routeMode: "native-direct",
      nativeHttpAction: action,
    });
    await ctx.rebuild(`native:${action}`);
    ctx.sendJson(res, out.ok ? 200 : 400, out, req);
    return true;
  });
}
