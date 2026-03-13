import { API_SCHEMA } from "../http/schema.js";
import { isPathWithin } from "./shared.js";

export function registerSystemRoutes(registry: any): void {
  registry.add("system:health", async (ctx: any) => {
    const { req, res, url, snapshot, SAFE_MODE, processInfo } = ctx;
    if (req.method === "GET" && url.pathname === "/health") {
      let lockAgeMs: number | null = null;
      try {
        const lockData = ctx.readJSON?.(ctx.paths?.lockFile);
        if (lockData?.started_at)
          lockAgeMs = Date.now() - new Date(lockData.started_at).getTime();
      } catch {
        /* best effort */
      }

      let checkpointFreshness: {
        newest_age_ms: number;
        newest_label: string;
      } | null = null;
      try {
        const cps = ctx.listCheckpoints?.(ctx.paths);
        if (cps?.length) {
          const newest = cps[cps.length - 1];
          if (newest.created_at) {
            checkpointFreshness = {
              newest_age_ms: Date.now() - new Date(newest.created_at).getTime(),
              newest_label: newest.label || "unknown",
            };
          }
        }
      } catch {
        /* best effort */
      }

      const degraded_reasons: string[] = [];
      let tokenTelemetry: any = null;
      try {
        const t = ctx.readJSON?.(ctx.paths?.apiTokenFile) || null;
        if (t) {
          const pivot = t.rotated_at || t.created_at || null;
          const ageMs = pivot
            ? Math.max(0, Date.now() - new Date(pivot).getTime())
            : null;
          tokenTelemetry = {
            last_rotated_at: t.rotated_at || null,
            created_at: t.created_at || null,
            age_ms: ageMs,
          };
          const maxAgeHours = Number(
            process.env.LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS || 0,
          );
          if (
            maxAgeHours > 0 &&
            ageMs !== null &&
            ageMs > maxAgeHours * 3600_000
          ) {
            degraded_reasons.push("api_token_age_exceeded");
          }
        }
      } catch {
        /* best effort */
      }
      if (lockAgeMs !== null && lockAgeMs > 30_000)
        degraded_reasons.push("stale_lock");
      if (
        checkpointFreshness &&
        checkpointFreshness.newest_age_ms > 10 * 60_000
      )
        degraded_reasons.push("checkpoint_stale");
      if (SAFE_MODE) degraded_reasons.push("safe_mode_active");
      const queueCounts = ctx.actionQueue?.counts();
      if (queueCounts && (queueCounts.pending || 0) > 50)
        degraded_reasons.push("queue_backlog");
      if (ctx.filePermissions && !ctx.filePermissions.ok)
        degraded_reasons.push("file_permissions");
      const status = degraded_reasons.length > 0 ? "degraded" : "healthy";

      return (
        ctx.sendJson(
          res,
          200,
          {
            ok: true,
            status,
            degraded_reasons,
            pid: processInfo.pid,
            generated_at: snapshot.generated_at,
            teams: (snapshot.teams || []).length,
            native: snapshot.native || null,
            safe_mode: SAFE_MODE,
            file_permissions: ctx.filePermissions || null,
            queue_depth: queueCounts || null,
            lock_age_ms: lockAgeMs,
            checkpoint_freshness: checkpointFreshness,
            security_telemetry: {
              api_token: tokenTelemetry,
              log_schema_version: "sidecar-security-audit/v1",
            },
          },
          req,
        ) || true
      );
    }
    return false;
  });

  registry.add("system:metrics-json", (ctx: any) => {
    const { req, res, url, snapshot } = ctx;
    if (req.method === "GET" && url.pathname === "/metrics.json") {
      return (
        ctx.sendJson(
          res,
          200,
          snapshot.metrics || ctx.metrics.snapshot(),
          req,
        ) || true
      );
    }
    return false;
  });

  registry.add("system:metrics-history", (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (req.method === "GET" && url.pathname === "/metrics/history") {
      const limit = Number(url.searchParams.get("limit") || 100);
      const history = ctx.MetricsTracker.loadHistory(
        paths.metricsHistoryDir,
        limit,
      );
      return (
        ctx.sendJson(
          res,
          200,
          { ok: true, count: history.length, snapshots: history },
          req,
        ) || true
      );
    }
    return false;
  });

  registry.add("system:metrics-diff", (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (req.method === "GET" && url.pathname === "/metrics/diff") {
      const history = ctx.MetricsTracker.loadHistory(
        paths.metricsHistoryDir,
        100,
      );
      if (history.length < 2)
        return (
          ctx.sendJson(
            res,
            200,
            { ok: true, diff: null, reason: "need at least 2 snapshots" },
            req,
          ) || true
        );
      const diff = ctx.MetricsTracker.diffSnapshots(
        history[0],
        history[history.length - 1],
      );
      return ctx.sendJson(res, 200, { ok: true, diff }, req) || true;
    }
    return false;
  });

  registry.add("system:reports-comparison", async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (req.method !== "POST" || url.pathname !== "/reports/comparison")
      return false;
    const body = await ctx.readBody(req);
    const bundle = ctx.diagnosticsBundle(String(body.label || "report"));
    let fullBundle = ctx.readJSON(bundle.file) || {};
    if (
      fullBundle.schema_version &&
      fullBundle.schema_version < ctx.CURRENT_SCHEMA_VERSION
    ) {
      fullBundle = ctx.migrateBundle(fullBundle).bundle;
    }
    let baseline = null;
    if (body.baseline_file) {
      const resolved = ctx.pathResolve(String(body.baseline_file));
      if (!isPathWithin(paths.diagnosticsDir, resolved, ctx.pathResolve)) {
        ctx.sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "baseline_file must be within diagnostics directory",
          req,
        );
        return true;
      }
      baseline = ctx.readJSON(resolved);
      if (
        baseline?.schema_version &&
        baseline.schema_version < ctx.CURRENT_SCHEMA_VERSION
      ) {
        baseline = ctx.migrateBundle(baseline).bundle;
      }
    }
    const report = ctx.buildComparisonReport(fullBundle, { baseline });
    const reportFile = `${paths.diagnosticsDir}/report-${Date.now()}.md`;
    try {
      ctx.writeJsonFile(reportFile.replace(".md", ".json"), report.json);
    } catch {}
    try {
      ctx.writeFileSync(reportFile, report.markdown);
    } catch {}
    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        file: reportFile,
        markdown: report.markdown,
        json: report.json,
      },
      req,
    );
    return true;
  });

  registry.add("system:snapshots-diff", async (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (req.method !== "POST" || url.pathname !== "/snapshots/diff")
      return false;
    const body = await ctx.readBody(req);
    const history = ctx.loadSnapshotHistory(paths.snapshotHistoryDir, 50);
    if (history.length < 2) {
      ctx.sendJson(
        res,
        200,
        {
          ok: true,
          diff: null,
          reason: "need at least 2 snapshots in history",
        },
        req,
      );
      return true;
    }
    const beforeIdx = body.before_ts
      ? history.findIndex((h: any) => h.data?.generated_at >= body.before_ts)
      : 0;
    const afterIdx = body.after_ts
      ? history.findLastIndex((h: any) => h.data?.generated_at <= body.after_ts)
      : history.length - 1;
    const before = history[Math.max(0, beforeIdx)]?.data;
    const after = history[Math.min(history.length - 1, afterIdx)]?.data;
    const diff = ctx.snapshotDiff(before, after);
    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        diff,
        before_ts: before?.generated_at,
        after_ts: after?.generated_at,
      },
      req,
    );
    return true;
  });

  registry.add("system:timeline-replay", (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (req.method !== "GET" || url.pathname !== "/timeline/replay")
      return false;
    const fromTs = url.searchParams.get("from")
      ? new Date(url.searchParams.get("from") as string).getTime()
      : null;
    const toTs = url.searchParams.get("to")
      ? new Date(url.searchParams.get("to") as string).getTime()
      : null;
    const typeFilter = url.searchParams.get("type") || null;
    const events = ctx.replayTimeline(paths.logFile, fromTs, toTs, typeFilter);
    const report = ctx.buildTimelineReport(events);
    ctx.sendJson(
      res,
      200,
      { ok: true, events: events.slice(-200), report },
      req,
    );
    return true;
  });

  registry.add("system:schema-version", (ctx: any) => {
    const { req, res, url, routeMeta } = ctx;
    if (req.method !== "GET" || url.pathname !== "/schema/version")
      return false;
    ctx.sendJson(
      res,
      200,
      {
        ok: true,
        version: ctx.CURRENT_SCHEMA_VERSION,
        validate: ctx.validateSchemaVersion(ctx.store.getSnapshot()),
        api_version: ctx.currentApiVersion(),
        server_version: "2.0.0",
        compat_aliases_enabled: true,
        sunset_date: ctx.legacyDeprecationHeaders(routeMeta).Sunset || null,
      },
      req,
    );
    return true;
  });

  registry.add("system:schema-routes", (ctx: any) => {
    const { req, res, url } = ctx;
    if (req.method !== "GET" || url.pathname !== "/schema/routes") return false;
    ctx.sendJson(res, 200, { ok: true, ...API_SCHEMA }, req);
    return true;
  });

  registry.add("system:reports-latest", (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (req.method !== "GET" || url.pathname !== "/reports/latest")
      return false;
    try {
      const files = ctx
        .readdirSync(paths.diagnosticsDir)
        .filter((f: string) => f.startsWith("report-") && f.endsWith(".md"))
        .sort();
      if (files.length === 0)
        return ctx.sendJson(res, 200, { ok: true, report: null }, req) || true;
      const latest = ctx.readFileSync(
        `${paths.diagnosticsDir}/${files[files.length - 1]}`,
        "utf-8",
      );
      return (
        ctx.sendJson(
          res,
          200,
          { ok: true, file: files[files.length - 1], markdown: latest },
          req,
        ) || true
      );
    } catch {
      return ctx.sendJson(res, 200, { ok: true, report: null }, req) || true;
    }
  });

  registry.add("system:events-sse", (ctx: any) => {
    const { req, res, url, clients } = ctx;
    if (req.method !== "GET" || url.pathname !== "/events") return false;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      ...ctx.baseHeaders(req),
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => {
      clients.delete(res);
    });
    return true;
  });

  registry.add("system:diagnostics-export", async (ctx: any) => {
    const { req, res, url } = ctx;
    if (req.method !== "POST" || url.pathname !== "/diagnostics/export")
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
    const out = ctx.diagnosticsBundle(String(body.label || "manual"));
    ctx.sendJson(res, 200, out, req);
    return true;
  });

  registry.add("system:diagnostics-latest", (ctx: any) => {
    const { req, res, url, paths } = ctx;
    if (req.method !== "GET" || url.pathname !== "/diagnostics/latest")
      return false;
    const latestName = ctx.latestJsonFileName(paths.diagnosticsDir);
    const latest = latestName
      ? ctx.readJSON(`${paths.diagnosticsDir}/${latestName}`)
      : null;
    ctx.sendJson(res, 200, { ok: true, latest }, req);
    return true;
  });

  registry.add("system:security-audit-export", (ctx: any) => {
    const { req, res, url } = ctx;
    if (
      req.method !== "GET" ||
      url.pathname !== "/health/security-audit/export"
    )
      return false;
    const limit = Math.max(
      1,
      Math.min(5000, Number(url.searchParams.get("limit") || 500)),
    );
    const payload = {
      ok: true,
      schema_version: "sidecar-security-audit/v1",
      generated_at: new Date().toISOString(),
      events: ctx.securityAuditLog.entries(limit),
      summary: ctx.securityAuditLog.snapshot(),
    };
    ctx.sendJson(res, 200, payload, req);
    return true;
  });
}
