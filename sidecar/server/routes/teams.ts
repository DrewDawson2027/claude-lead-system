import {
  pathParts,
  teamNameFromPath,
  taskIdFromTeamTaskPath,
} from "./shared.js";
import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const CANONICAL_STREAM_FALLBACK_ORDER = [
  "native live",
  "sidecar live",
  "tmux mirror",
];
const CANONICAL_ROUTE_MODE_PREFERENCE = [
  "native-live",
  "sidecar-live",
  "tmux-mirror",
];

function normalizeActionSnapshot(actions: any) {
  const recent = Array.isArray(actions?.recent) ? actions.recent : [];
  return {
    ...(actions || {}),
    recent: recent.map((record: any) => ({
      ...record,
      route_mode:
        record?.route_mode || record?.path_mode || record?.adapter || "unknown",
      route_reason:
        record?.route_reason || record?.reason || "route metadata unavailable",
      reason:
        record?.route_reason || record?.reason || "route metadata unavailable",
    })),
  };
}

function normalizeFocusedTeammateLive(record: any) {
  const sourceTruth =
    typeof record?.source_truth === "string" && record.source_truth.trim()
      ? record.source_truth
      : "focused teammate view mirrors adapter/runtime/terminal sources";
  return {
    ...(record || {}),
    stale_after_ms: Number(record?.stale_after_ms) || 6000,
    stream_fallback_order: [...CANONICAL_STREAM_FALLBACK_ORDER],
    route_mode_preference: [...CANONICAL_ROUTE_MODE_PREFERENCE],
    source_truth: sourceTruth,
    parity_note:
      record?.parity_note ||
      "in-process native teammate rendering is unavailable; sidecar mirrors live state",
  };
}

export function registerTeamRoutes(registry: any): void {
  registry.add("teams:list", (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (req.method === "GET" && url.pathname === "/teams") {
      ctx.sendJson(
        res,
        200,
        {
          teams: snapshot.teams || [],
          generated_at: snapshot.generated_at,
          native: snapshot.native || null,
        },
        req,
      );
      return true;
    }
    return false;
  });

  registry.add("teams:get", (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (!(req.method === "GET" && /^\/teams\/[^/]+$/.test(url.pathname)))
      return false;
    const teamName = teamNameFromPath(url.pathname);
    const team = (snapshot.teams || []).find(
      (t: any) => t.team_name === teamName,
    );
    const teammates = (snapshot.teammates || []).filter(
      (t: any) => t.team_name === teamName,
    );
    const tasks = (snapshot.tasks || []).filter(
      (t: any) => t.team_name === teamName,
    );
    const timeline = (snapshot.timeline || [])
      .filter((t: any) => t.team_name === teamName)
      .slice(-50);
    const alerts = (snapshot.alerts || [])
      .filter((a: any) => !a.team_name || a.team_name === teamName)
      .slice(0, 30);
    if (!team) {
      ctx.sendError(res, 404, "NOT_FOUND", `Team ${teamName} not found`, req);
      return true;
    }
    ctx.sendJson(
      res,
      200,
      {
        team,
        teammates,
        tasks,
        timeline,
        alerts,
        native: snapshot.native || null,
        actions: normalizeActionSnapshot(snapshot.actions || { recent: [] }),
        focused_teammate_live: normalizeFocusedTeammateLive(
          snapshot.focused_teammate_live || null,
        ),
        generated_at: snapshot.generated_at,
      },
      req,
    );
    return true;
  });

  registry.add("teams:teammate-mirror", (ctx: any) => {
    const { req, res, url, snapshot, paths } = ctx;
    if (
      !(
        req.method === "GET" &&
        /^\/teams\/[^/]+\/teammates\/[^/]+\/mirror$/.test(url.pathname)
      )
    )
      return false;
    const parts = pathParts(url.pathname);
    const teamName = decodeURIComponent(parts[2] || "");
    const teammateId = decodeURIComponent(parts[4] || "");
    const teammate = (snapshot.teammates || []).find(
      (t: any) => t.team_name === teamName && t.id === teammateId,
    );
    if (!teammate) {
      ctx.sendError(
        res,
        404,
        "NOT_FOUND",
        `Teammate ${teammateId} not found in team ${teamName}`,
        req,
      );
      return true;
    }

    let output = null;
    if (teammate.tmux_pane_id) {
      try {
        output = execFileSync(
          "tmux",
          ["capture-pane", "-t", teammate.tmux_pane_id, "-p", "-S", "-", "-e"],
          { encoding: "utf8", timeout: 1500 },
        );
      } catch {
        output = null;
      }
    }

    const taskId = teammate.current_task_ref || teammate.worker_task_id || null;
    if (!output && taskId) {
      try {
        const transcriptPath = join(paths.resultsDir, `${taskId}.transcript`);
        if (existsSync(transcriptPath))
          output = String(
            ctx.readFileSync(transcriptPath, "utf-8") || "",
          ).slice(-6000);
      } catch {
        output = null;
      }
    }
    if (!output && taskId) {
      try {
        const resultPath = join(paths.resultsDir, `${taskId}.json`);
        if (existsSync(resultPath)) {
          const result = ctx.readJSON(resultPath);
          if (typeof result?.output === "string")
            output = result.output.slice(-4000);
          else if (result)
            output = JSON.stringify(result, null, 2).slice(-4000);
        }
      } catch {
        output = null;
      }
    }

    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        team_name: teamName,
        teammate_id: teammateId,
        route_mode: "tmux-mirror",
        route_label: "tmux mirror",
        route_reason:
          "native live and sidecar live unavailable/stale; terminal mirror fallback",
        freshness: "fallback",
        fallback_reason:
          "native live and sidecar live unavailable/stale; terminal mirror fallback",
        stale_after_ms: 6000,
        route_mode_preference: [...CANONICAL_ROUTE_MODE_PREFERENCE],
        stream_fallback_order: [...CANONICAL_STREAM_FALLBACK_ORDER],
        source_truth:
          "tmux terminal mirror fallback (not native in-process rendering)",
        output: output || null,
        generated_at: new Date().toISOString(),
      },
      req,
    );
    return true;
  });

  registry.add("teams:interrupts", (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (
      !(
        req.method === "GET" &&
        /^\/teams\/[^/]+\/interrupts$/.test(url.pathname)
      )
    )
      return false;
    const teamName = teamNameFromPath(url.pathname);
    const team = ctx.findTeam(snapshot, teamName);
    const interrupts = ctx.buildTeamInterrupts({
      snapshot,
      teamName,
      teamPolicy: team?.policy,
    });
    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        team_name: teamName,
        interrupts,
        generated_at: new Date().toISOString(),
      },
      req,
    );
    return true;
  });

  registry.add("teams:approvals", (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (
      !(
        req.method === "GET" && /^\/teams\/[^/]+\/approvals$/.test(url.pathname)
      )
    )
      return false;
    const teamName = teamNameFromPath(url.pathname);
    const team = ctx.findTeam(snapshot, teamName);
    const interrupts = ctx.buildTeamInterrupts({
      snapshot,
      teamName,
      teamPolicy: team?.policy,
    });
    const approvals = interrupts.filter((i: any) => i.kind === "approval");
    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        team_name: teamName,
        approvals,
        generated_at: new Date().toISOString(),
      },
      req,
    );
    return true;
  });

  registry.add("teams:interrupt-priorities", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (
      !(
        req.method === "PATCH" &&
        /^\/teams\/[^/]+\/interrupt-priorities$/.test(url.pathname)
      )
    )
      return false;
    const teamName = teamNameFromPath(url.pathname);
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
    const weights: Record<string, number> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "number" && v >= 0 && v <= 200) weights[k] = v;
    }

    if (Object.keys(weights).length === 0) {
      ctx.sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "At least one interrupt priority weight is required",
        req,
      );
      return true;
    }

    let resultText: string | null = null;
    try {
      const result = await ctx.coordinatorAdapter.execute(
        "update-team-policy",
        { team_name: teamName, interrupt_weights: weights },
      );
      resultText = result?.text || null;
      await ctx.rebuild("interrupt-priorities");
    } catch (err: any) {
      ctx.sendError(
        res,
        400,
        "ACTION_FAILED",
        err?.message || "Interrupt priority update failed",
        req,
      );
      return true;
    }
    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        team_name: teamName,
        interrupt_weights: weights,
        result: resultText,
      },
      req,
    );
    return true;
  });

  registry.add("teams:task-templates-get", (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === "GET" && url.pathname === "/task-templates"))
      return false;
    const templates = ctx.readJSON(paths.taskTemplatesFile) || [];
    ctx.sendJson(res, 200, { ok: true, templates }, req);
    return true;
  });

  registry.add("teams:task-templates-post", async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (!(req.method === "POST" && url.pathname === "/task-templates"))
      return false;
    const body = await ctx.readBody(req);
    if (body.__parse_error) {
      ctx.sendError(
        res,
        400,
        body.__parse_error === "payload_too_large"
          ? "PAYLOAD_TOO_LARGE"
          : "INVALID_JSON",
        body.__parse_error,
        req,
      );
      return true;
    }
    const templates = ctx.readJSON(paths.taskTemplatesFile) || [];
    const tpl = {
      id: body.id || `tpl-${Date.now()}`,
      name: body.name || "Unnamed Template",
      subject_template: body.subject_template || "",
      prompt_template: body.prompt_template || "",
      role_hint: body.role_hint || "",
      priority: body.priority || "normal",
      quality_gates: Array.isArray(body.quality_gates)
        ? body.quality_gates
        : [],
      acceptance_criteria: Array.isArray(body.acceptance_criteria)
        ? body.acceptance_criteria
        : [],
      created_at: new Date().toISOString(),
    };
    templates.push(tpl);
    ctx.writeJSON(paths.taskTemplatesFile, templates);
    ctx.sendJson(res, 200, { ok: true, template: tpl }, req);
    return true;
  });

  registry.add("teams:task-audit", (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (
      !(
        req.method === "GET" &&
        /^\/teams\/[^/]+\/tasks\/[^/]+\/audit$/.test(url.pathname)
      )
    )
      return false;
    const taskId = taskIdFromTeamTaskPath(url.pathname);
    const auditFile = `${paths.resultsDir}/${taskId}.audit.jsonl`;
    const entries = ctx.readJSONL(auditFile);
    ctx.sendJson(res, 200, { ok: true, task_id: taskId, audit: entries }, req);
    return true;
  });

  registry.add("teams:task-reassign", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (
      !(
        req.method === "POST" &&
        /^\/teams\/[^/]+\/tasks\/[^/]+\/reassign$/.test(url.pathname)
      )
    )
      return false;
    const parts = pathParts(url.pathname);
    const teamName = decodeURIComponent(parts[2] || "");
    const taskId = decodeURIComponent(parts[4] || "");
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
    if (!body.new_assignee) {
      ctx.sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "new_assignee is required",
        req,
      );
      return true;
    }
    try {
      const result = await ctx.coordinatorAdapter.execute("reassign-task", {
        team_name: teamName,
        task_id: taskId,
        new_assignee: body.new_assignee,
        reason: body.reason || "manual reassignment via dashboard",
        progress_context: body.progress_context || null,
      });
      await ctx.rebuild("task-reassign");
      ctx.sendJson(res, 200, { ok: true, result: result?.text || null }, req);
    } catch (err: any) {
      ctx.sendError(
        res,
        400,
        "ACTION_FAILED",
        err?.message || "Task reassignment failed",
        req,
      );
    }
    return true;
  });

  registry.add("teams:task-gate-check", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (
      !(
        req.method === "POST" &&
        /^\/teams\/[^/]+\/tasks\/[^/]+\/gate-check$/.test(url.pathname)
      )
    )
      return false;
    const parts = pathParts(url.pathname);
    const taskId = decodeURIComponent(parts[4] || "");
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
    try {
      const result = await ctx.coordinatorAdapter.execute("gate-check", {
        task_id: taskId,
      });
      ctx.sendJson(res, 200, { ok: true, result: result?.text || null }, req);
    } catch (err: any) {
      ctx.sendError(
        res,
        400,
        "ACTION_FAILED",
        err?.message || "Gate check failed",
        req,
      );
    }
    return true;
  });

  registry.add("teams:rebalance-post", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (
      !(
        req.method === "POST" &&
        /^\/teams\/[^/]+\/rebalance$/.test(url.pathname)
      )
    )
      return false;
    const teamName = teamNameFromPath(url.pathname);
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
    const team = ctx.findTeam(snapshot, teamName);
    const routed = await ctx.runTrackedAction({
      team,
      action: "rebalance",
      payload: { team_name: teamName, ...body },
      routeMode: "router",
    });
    if (!routed.ok) {
      ctx.sendError(
        res,
        400,
        "ACTION_FAILED",
        routed.error || "Rebalance failed",
        req,
        routed.details,
      );
      return true;
    }
    await ctx.rebuild("rebalance");
    ctx.sendJson(res, 200, routed, req);
    return true;
  });

  registry.add("teams:rebalance-explain-get", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (
      !(
        req.method === "GET" &&
        /^\/teams\/[^/]+\/rebalance-explain$/.test(url.pathname)
      )
    )
      return false;
    const teamName = teamNameFromPath(url.pathname);
    const limit = Number(url.searchParams.get("limit") || 10);
    const out = await ctx.coordinatorAdapter.execute("rebalance-explain", {
      team_name: teamName,
      limit,
    });
    ctx.sendJson(res, 200, out, req);
    return true;
  });

  registry.add("teams:rebalance-explain-post", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (
      !(
        req.method === "POST" &&
        /^\/teams\/[^/]+\/rebalance-explain$/.test(url.pathname)
      )
    )
      return false;
    const teamName = teamNameFromPath(url.pathname);
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
    const out = await ctx.coordinatorAdapter.execute("rebalance-explain", {
      team_name: teamName,
      ...body,
    });
    ctx.sendJson(res, 200, out, req);
    return true;
  });

  registry.add("teams:action-post", async (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (
      !(
        req.method === "POST" &&
        /^\/teams\/[^/]+\/actions\/[^/]+$/.test(url.pathname)
      )
    )
      return false;
    const [, , rawTeam, , rawAction] = pathParts(url.pathname);
    const teamName = decodeURIComponent(rawTeam || "");
    const action = decodeURIComponent(rawAction || "");
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
    const payload = ctx.buildActionPayload(teamName, action, body);
    const team = ctx.findTeam(snapshot, teamName);
    const routed = await ctx.runTrackedAction({
      team,
      action,
      payload,
      routeMode: "router",
    });
    if (!routed.ok) {
      ctx.sendError(
        res,
        400,
        "ACTION_FAILED",
        routed.error || "Action failed",
        req,
        routed.details,
      );
      return true;
    }
    await ctx.rebuild(`action:${action}`);
    ctx.sendJson(res, 200, routed, req);
    return true;
  });

  registry.add("teams:batch-triage", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (
      !(
        req.method === "POST" &&
        /^\/teams\/[^/]+\/batch-triage$/.test(url.pathname)
      )
    )
      return false;
    const teamName = teamNameFromPath(url.pathname);
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
    const out = await ctx.runBatchTriage({
      teamName,
      op: String(body.op || ""),
      confirm: body.confirm === true,
      message: String(body.message || ""),
      limit: body.limit,
    });
    await ctx.rebuild("batch-triage");
    ctx.sendJson(res, out.ok ? 200 : 400, out, req);
    return true;
  });
}
