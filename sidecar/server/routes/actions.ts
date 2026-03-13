import { actionIdFromPath } from "./shared.js";

function withRouteSnapshot(record: any): any {
  if (!record || typeof record !== "object") return record;
  const routeMode =
    record.route_mode || record.path_mode || record.adapter || "unknown";
  const routeReason =
    record.route_reason ||
    record.reason ||
    "route metadata unavailable";
  return {
    ...record,
    route_mode: routeMode,
    route_reason: routeReason,
    reason: routeReason,
  };
}

export function registerActionRoutes(registry: any): void {
  registry.add("actions:route-simulate", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === "POST" && url.pathname === "/route/simulate"))
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
    if (!body.team_name || !body.action) {
      ctx.sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "team_name and action are required",
        req,
      );
      return true;
    }
    const team = ctx.findTeam(snapshot, body.team_name);
    const sim = await ctx.router.simulate(
      team,
      String(body.action),
      body.payload || {},
    );
    ctx.sendJson(res, 200, sim, req);
    return true;
  });

  registry.add("actions:list", (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && url.pathname === "/actions")) return false;
    const actions = (ctx.actionQueue.list(200) || []).map(withRouteSnapshot);
    ctx.sendJson(res, 200, { actions }, req);
    return true;
  });

  registry.add("actions:get", (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && /^\/actions\/[^/]+$/.test(url.pathname)))
      return false;
    const actionId = actionIdFromPath(url.pathname);
    const record = ctx.actionQueue.get(actionId);
    if (!record) {
      ctx.sendError(res, 404, "NOT_FOUND", "Action not found", req);
      return true;
    }
    ctx.sendJson(res, 200, withRouteSnapshot(record), req);
    return true;
  });

  registry.add("actions:retry", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (
      !(req.method === "POST" && /^\/actions\/[^/]+\/retry$/.test(url.pathname))
    )
      return false;
    const actionId = actionIdFromPath(url.pathname);
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
    const record = ctx.actionQueue.get(actionId);
    if (!record) {
      ctx.sendError(res, 404, "NOT_FOUND", "Action not found", req);
      return true;
    }
    ctx.actionQueue.retry(actionId, {
      retry_requested_at: new Date().toISOString(),
    });
    const team = record.team_name
      ? ctx.findTeam(snapshot, record.team_name)
      : { team_name: null, execution_path: "hybrid", policy: {} };
    const result = await ctx.runTrackedAction({
      team,
      action: record.action,
      payload: record.payload_preview || {},
      routeMode:
        record.route_mode === "native-direct" ? "native-direct" : "router",
      nativeHttpAction: record.action,
      trackedActionId: actionId,
    });
    await ctx.rebuild("action-retry");
    ctx.sendJson(res, result.ok ? 200 : 400, result, req);
    return true;
  });

  registry.add("actions:fallback", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (
      !(
        req.method === "POST" &&
        /^\/actions\/[^/]+\/fallback$/.test(url.pathname)
      )
    )
      return false;
    const actionId = actionIdFromPath(url.pathname);
    const record = ctx.actionQueue.get(actionId);
    if (!record) {
      ctx.sendError(res, 404, "NOT_FOUND", "Action not found", req);
      return true;
    }
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
    const force_path = body.force_path === "native" ? "native" : "coordinator";
    ctx.actionQueue.retry(actionId, {
      forced_fallback_at: new Date().toISOString(),
      force_path,
    });
    const team = record.team_name
      ? ctx.findTeam(snapshot, record.team_name)
      : { team_name: null, execution_path: "hybrid", policy: {} };
    const result = await ctx.runTrackedAction({
      team,
      action: record.action,
      payload: { ...(record.payload_preview || {}), force_path },
      routeMode: "router",
      trackedActionId: actionId,
    });
    await ctx.rebuild("action-fallback");
    ctx.sendJson(res, result.ok ? 200 : 400, result, req);
    return true;
  });

  registry.add("actions:dispatch", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === "POST" && url.pathname === "/dispatch")) return false;
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
    if (!body.team_name) {
      ctx.sendError(res, 400, "VALIDATION_ERROR", "team_name is required", req);
      return true;
    }
    const team = ctx.findTeam(snapshot, body.team_name);
    const routed = await ctx.runTrackedAction({
      team,
      action: "dispatch",
      payload: body,
      routeMode: "router",
    });
    if (!routed.ok) {
      ctx.sendError(
        res,
        400,
        "ACTION_FAILED",
        routed.error || "Action routing failed",
        req,
        routed.details,
      );
      return true;
    }
    await ctx.rebuild("dispatch");
    ctx.sendJson(res, 200, routed, req);
    return true;
  });
}
