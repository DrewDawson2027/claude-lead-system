import { lastPathSegment } from "./shared.js";
import { requireExplicitBearerAuth } from "../http/security.js";

function parseBooleanQuery(value: string | null): boolean | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return undefined;
}

function parseCoordinatorResult(raw: any): any {
  const text = String(raw?.text || "");
  if (!text.trim()) return { ok: true };
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

function statusForResult(result: any): number {
  if (!result || result.ok !== false) return 200;
  if (result.error_code === "NOT_FOUND") return 404;
  if (result.error_code === "ALREADY_EXISTS") return 409;
  return 400;
}

function sendCoordinatorResult(ctx: any, res: any, req: any, out: any): void {
  const parsed = parseCoordinatorResult(out);
  ctx.sendJson(res, statusForResult(parsed), parsed, req);
}

function toSafeAgentSummary(result: any): any {
  if (!result || typeof result !== "object") return result;
  if (!result.agent || typeof result.agent !== "object") return result;
  const summary = { ...result, agent: { ...result.agent } };
  delete summary.agent.prompt;
  delete summary.agent.frontmatter;
  return summary;
}

export function registerAgentRoutes(registry: any): void {
  registry.add("agents:sync-manifest", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "POST" && url.pathname === "/agents/sync-manifest"))
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
    const out = await ctx.coordinatorAdapter.execute(
      "agent-sync-manifest",
      body,
    );
    sendCoordinatorResult(ctx, res, req, out);
    return true;
  });

  registry.add("agents:list", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && url.pathname === "/agents")) return false;
    const payload: Record<string, any> = {};
    const scope = url.searchParams.get("scope");
    const projectDir = url.searchParams.get("project_dir");
    const includeInvalid = parseBooleanQuery(
      url.searchParams.get("include_invalid"),
    );
    const includeShadowed = parseBooleanQuery(
      url.searchParams.get("include_shadowed"),
    );
    if (scope) payload.scope = scope;
    if (projectDir) payload.project_dir = projectDir;
    if (includeInvalid !== undefined) payload.include_invalid = includeInvalid;
    if (includeShadowed !== undefined)
      payload.include_shadowed = includeShadowed;
    const out = await ctx.coordinatorAdapter.execute("agent-list", payload);
    sendCoordinatorResult(ctx, res, req, out);
    return true;
  });

  registry.add("agents:get", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && /^\/agents\/[^/]+$/.test(url.pathname)))
      return false;
    const agentName = lastPathSegment(url.pathname);
    if (agentName === "sync-manifest") return false;
    const payload: Record<string, any> = { agent_name: agentName };
    const scope = url.searchParams.get("scope");
    const projectDir = url.searchParams.get("project_dir");
    payload.include_prompt = false;
    payload.include_frontmatter = false;
    if (scope) payload.scope = scope;
    if (projectDir) payload.project_dir = projectDir;
    const out = await ctx.coordinatorAdapter.execute("agent-get", payload);
    const parsed = parseCoordinatorResult(out);
    const summary = toSafeAgentSummary(parsed);
    ctx.sendJson(res, statusForResult(summary), summary, req);
    return true;
  });

  registry.add("agents:get-full", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "GET" && /^\/agents\/[^/]+\/full$/.test(url.pathname)))
      return false;
    const segments = url.pathname.split("/").filter(Boolean);
    const agentName = segments[1] || "";
    if (!agentName || agentName === "sync-manifest") return false;
    if (
      !requireExplicitBearerAuth(
        ctx.sendJson,
        req,
        res,
        ctx.apiToken,
        ctx.securityAuditLog,
        "Full agent content requires bearer authentication",
      )
    ) {
      return true;
    }
    const payload: Record<string, any> = {
      agent_name: agentName,
      include_prompt: true,
      include_frontmatter: true,
    };
    const scope = url.searchParams.get("scope");
    const projectDir = url.searchParams.get("project_dir");
    if (scope) payload.scope = scope;
    if (projectDir) payload.project_dir = projectDir;
    const out = await ctx.coordinatorAdapter.execute("agent-get", payload);
    sendCoordinatorResult(ctx, res, req, out);
    return true;
  });

  registry.add("agents:create", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "POST" && url.pathname === "/agents")) return false;
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
    const out = await ctx.coordinatorAdapter.execute("agent-create", body);
    sendCoordinatorResult(ctx, res, req, out);
    return true;
  });

  registry.add("agents:update", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "PATCH" && /^\/agents\/[^/]+$/.test(url.pathname)))
      return false;
    const agentName = lastPathSegment(url.pathname);
    if (agentName === "sync-manifest") return false;
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
    const out = await ctx.coordinatorAdapter.execute("agent-update", {
      ...body,
      agent_name: agentName,
    });
    sendCoordinatorResult(ctx, res, req, out);
    return true;
  });

  registry.add("agents:delete", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (!(req.method === "DELETE" && /^\/agents\/[^/]+$/.test(url.pathname)))
      return false;
    const agentName = lastPathSegment(url.pathname);
    if (agentName === "sync-manifest") return false;
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
    const payload: Record<string, any> = { ...body, agent_name: agentName };
    if (!payload.scope && url.searchParams.get("scope"))
      payload.scope = url.searchParams.get("scope");
    if (!payload.project_dir && url.searchParams.get("project_dir"))
      payload.project_dir = url.searchParams.get("project_dir");
    if (
      payload.all_scopes === undefined &&
      parseBooleanQuery(url.searchParams.get("all_scopes")) !== undefined
    ) {
      payload.all_scopes = parseBooleanQuery(
        url.searchParams.get("all_scopes"),
      );
    }
    const out = await ctx.coordinatorAdapter.execute("agent-delete", payload);
    sendCoordinatorResult(ctx, res, req, out);
    return true;
  });
}
