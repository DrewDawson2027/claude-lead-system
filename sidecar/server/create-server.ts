#!/usr/bin/env node
import http from "http";
import https from "https";
import crypto from "crypto";
import { URL } from "url";
import { spawn } from "child_process";
import {
  unlinkSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from "fs";
import { resolve as pathResolve } from "path";

import { sidecarPaths } from "../core/paths.js";
import {
  ensureDirs,
  writeJSON,
  readJSON,
  readJSONL,
  fileExists,
  writeJSON as writeJsonFile,
  appendJSONL,
} from "../core/fs-utils.js";
import { SidecarStateStore } from "../core/state-store.js";
import { HookStreamAdapter } from "../adapters/hook-stream-adapter.js";
import { CoordinatorAdapter } from "../adapters/coordinator-adapter.js";
import { NativeTeamAdapter } from "../adapters/native-team-adapter.js";
import { ActionRouter } from "../core/action-router.js";
import { buildSidecarSnapshot } from "./snapshot-builder.js";
import { ActionQueue } from "../native/action-queue.js";
import { MetricsTracker } from "../native/metrics.js";
import {
  findStuckBridgeRequests,
  sweepBridgeQueues,
} from "../native/bridge-protocol.js";
import {
  applyPriorityAging,
  shouldAutoRebalance,
} from "../core/policy-engine.js";
import { buildComparisonReport } from "./report-builder.js";
import {
  CURRENT_SCHEMA_VERSION,
  migrateBundle,
  validateSchemaVersion,
  dryRunMigration,
  migrations,
} from "../core/schema.js";
import {
  diffSnapshots as snapshotDiff,
  replayTimeline,
  buildTimelineReport,
  loadSnapshotHistory,
} from "../core/snapshot-diff.js";
import {
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  rotateCheckpoints,
} from "../core/checkpoint.js";
import { rebuildFromTimeline, consistencyCheck } from "../core/event-replay.js";
import { repairJSON, repairJSONL, scanForCorruption } from "../core/repair.js";
import { listBackups, restoreFromBackup } from "../core/pre-op-backup.js";
import { lockMetrics } from "../core/lock-metrics.js";
import {
  checkTerminalHealth,
  suggestRecovery,
} from "../core/terminal-health.js";
import { validateHooks, runHookSelftest } from "../core/hook-watchdog.js";

import {
  attachRouteMeta,
  currentApiVersion,
  legacyDeprecationHeaders,
  normalizeApiPath,
} from "./http/versioning.js";
import {
  createBaseHeaders,
  sendJson as sendJsonRaw,
  sendText as sendTextRaw,
  sendHtml as sendHtmlRaw,
  sendJs as sendJsRaw,
  sendError as sendErrorRaw,
  sseBroadcast,
} from "./http/response.js";
import { readBody as readBodyRaw, bodyLimitForRoute } from "./http/body.js";
import {
  requireApiAuth as requireApiAuthRaw,
  requireSameOrigin as requireSameOriginRaw,
  requireCsrf as requireCsrfRaw,
  createRateLimiter as createRateLimiterRaw,
  createReplayProtector as createReplayProtectorRaw,
} from "./http/security.js";
import { validateBody as validateBodyRaw } from "./http/validation.js";
import { SecurityAuditLog, RequestAuditLog } from "./http/audit.js";
import { createLogger } from "./http/logger.js";
import { buildServerRouter } from "./routes/index.js";

import {
  readFileSafe,
  parseArgs,
  ensureApiToken,
  ensureCsrfToken,
  rotateApiToken,
  checkFilePermissions,
  writeRuntimeFiles,
} from "./runtime/bootstrap.js";
import {
  trimLongStrings,
  latestJsonFileName,
  findTeam,
  buildActionPayload,
  buildTeamInterrupts,
  mapNativeHttpAction,
} from "./runtime/team-utils.js";
import { createRebuildOps } from "./runtime/rebuild.js";
import {
  createMaintenanceSweep,
  createDiagnosticsBundle,
} from "./runtime/maintenance.js";
import {
  createTrackedActionRunner,
  createBatchTriageRunner,
} from "./runtime/actions.js";
import { bootRuntime, startRuntimeLifecycle } from "./runtime/lifecycle.js";
import { OutputStreamManager } from "../core/output-stream.js";

import type {
  ParsedArgs,
  TlsConfig,
  SidecarServerInstance,
  RouteContext,
} from "./types.js";
import { runRequestMiddleware } from "./middleware.js";
import { createRouteContextFactory } from "./context-builder.js";

// ---------------------------------------------------------------------------
// Static assets (loaded once at module level)
// ---------------------------------------------------------------------------

const DASHBOARD_HTML = readFileSafe(
  readFileSync,
  new URL("../ui-web/index.html", import.meta.url),
);
const DASHBOARD_JS = readFileSafe(
  readFileSync,
  new URL("../ui-web/app.js", import.meta.url),
);

// ---------------------------------------------------------------------------
// Resolve TLS configuration from parsed args + env
// ---------------------------------------------------------------------------

function resolveTlsConfig(args: ParsedArgs): TlsConfig {
  const keyFile = String(
    args.tlsKeyFile || process.env.LEAD_SIDECAR_TLS_KEY_FILE || "",
  ).trim();
  const certFile = String(
    args.tlsCertFile || process.env.LEAD_SIDECAR_TLS_CERT_FILE || "",
  ).trim();
  const caFile = String(
    args.tlsCaFile || process.env.LEAD_SIDECAR_TLS_CA_FILE || "",
  ).trim();
  const mtlsRequired = Boolean(
    args.mtls || process.env.LEAD_SIDECAR_MTLS_REQUIRE_CLIENT_CERT === "1",
  );
  return {
    enabled: Boolean(keyFile && certFile),
    keyFile,
    certFile,
    caFile,
    mtlsRequired,
  };
}

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

function createHttpServer(
  tls: TlsConfig,
  handler: http.RequestListener,
): http.Server | https.Server {
  if (tls.enabled) {
    const tlsOptions: https.ServerOptions = {
      key: readFileSafe(readFileSync, tls.keyFile as unknown as URL),
      cert: readFileSafe(readFileSync, tls.certFile as unknown as URL),
      requestCert: tls.mtlsRequired,
      rejectUnauthorized: tls.mtlsRequired,
    };
    if (tls.caFile) {
      tlsOptions.ca = readFileSafe(readFileSync, tls.caFile as unknown as URL);
    }
    return https.createServer(tlsOptions, handler);
  }
  return http.createServer(handler);
}

async function bindServer(
  server: http.Server | https.Server,
  unixSocketPath: string | null,
  port: number,
): Promise<void> {
  if (unixSocketPath) {
    try {
      unlinkSync(unixSocketPath);
    } catch {
      /* may not exist yet */
    }
    await new Promise<void>((resolve) =>
      server.listen(unixSocketPath, resolve),
    );
    try {
      chmodSync(unixSocketPath, 0o600);
    } catch {
      /* best effort */
    }
  } else {
    await new Promise<void>((resolve) =>
      server.listen(port || 0, "127.0.0.1", resolve),
    );
  }
}

function cleanupFactory(
  server: http.Server | https.Server,
  lifecycle: { stop(): void },
  paths: Record<string, string>,
  clients: Set<http.ServerResponse>,
  unixSocketPath: string | null,
) {
  let shutdown: (() => void) | null = null;

  const cleanup = (exitAfter = false): void => {
    lifecycle.stop();
    if (shutdown) {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    }
    try {
      unlinkSync(paths.lockFile);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(paths.portFile);
    } catch {
      /* ignore */
    }
    if (unixSocketPath) {
      try {
        unlinkSync(unixSocketPath);
      } catch {
        /* ignore */
      }
    }
    for (const clientRes of clients) {
      try {
        clientRes.end();
      } catch {
        /* ignore */
      }
    }
    server.close(() => {
      if (exitAfter) process.exit(0);
    });
    if (exitAfter) setTimeout(() => process.exit(0), 1000).unref();
  };

  shutdown = () => cleanup(true);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return cleanup;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function startSidecarServer(
  options: Partial<ParsedArgs> = {},
): Promise<SidecarServerInstance> {
  // --- Parse CLI + merge options ---
  const args: ParsedArgs = { ...parseArgs(process.argv.slice(2)), ...options };
  const paths = sidecarPaths();
  ensureDirs([
    paths.root,
    paths.runtimeDir,
    paths.nativeRuntimeDir,
    paths.nativeBridgeRequestDir,
    paths.nativeBridgeResponseDir,
    paths.actionsRootDir,
    paths.actionsPendingDir,
    paths.actionsInflightDir,
    paths.actionsDoneDir,
    paths.actionsFailedDir,
    paths.stateDir,
    paths.logsDir,
    paths.diagnosticsDir,
  ]);

  // --- Security setup ---
  const apiToken = ensureApiToken(paths, fileExists, readJSON, writeJsonFile);
  let currentApiToken: string | null = apiToken;
  const csrfToken: string = ensureCsrfToken(
    paths,
    fileExists,
    readJSON,
    writeJsonFile,
    { rotateCsrf: Boolean(args.rotateCsrf) },
  );
  const SAFE_MODE = Boolean(args.safeMode);
  const log = createLogger({
    format: (process.env.LOG_FORMAT || "text") as "text" | "json",
  });
  const securityAuditLog = new SecurityAuditLog();
  const requestAuditLog = new RequestAuditLog({
    auditAll: Boolean(process.env.LEAD_SIDECAR_AUDIT_ALL),
  });
  const originAllowlist: string[] = (
    process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST || ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const permCheck = checkFilePermissions(paths, fileExists);
  if (!permCheck.ok) {
    for (const issue of permCheck.issues) {
      log.warn(`file permission issue: ${issue.file} — ${issue.action}`);
    }
  }

  // --- Core services ---
  const store = new SidecarStateStore(paths);
  const actionQueue = new ActionQueue(paths);
  const metrics = new MetricsTracker();
  const coordinatorAdapter = new CoordinatorAdapter();
  const nativeAdapter = new NativeTeamAdapter({
    paths,
    coordinatorAdapter: coordinatorAdapter as any,
    store: store as any,
  });
  const router = new ActionRouter({
    coordinatorAdapter,
    nativeAdapter,
    store,
  } as any);
  const clients: Set<http.ServerResponse> = new Set();

  // --- Rate limiter & replay protector ---
  const rateLimitMax = Number(process.env.LEAD_SIDECAR_RATE_LIMIT || 180);
  const rateLimiter = createRateLimiterRaw({
    windowMs: Number(process.env.LEAD_SIDECAR_RATE_WINDOW_MS || 60_000),
    max: rateLimitMax,
  });
  const replayProtector = createReplayProtectorRaw();

  // --- Network config ---
  let allowedBrowserOrigin: string | null = null;
  const unixSocketPath: string | null =
    String(
      args.unixSocket || process.env.LEAD_SIDECAR_UNIX_SOCKET || "",
    ).trim() || null;
  const tls = resolveTlsConfig(args);

  // --- Bound response helpers ---
  const baseHeaders = (req: http.IncomingMessage | null = null) =>
    createBaseHeaders(req, allowedBrowserOrigin, originAllowlist);
  const sendJson = (
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    req: http.IncomingMessage | null = null,
  ) => sendJsonRaw(baseHeaders, res, status, payload, req);
  const sendText = (
    res: http.ServerResponse,
    status: number,
    body: string,
    req: http.IncomingMessage | null = null,
  ) => sendTextRaw(baseHeaders, res, status, body, req);
  const sendHtml = (
    res: http.ServerResponse,
    status: number,
    body: string,
    req: http.IncomingMessage | null = null,
  ) => sendHtmlRaw(baseHeaders, res, status, body, req);
  const sendJs = (
    res: http.ServerResponse,
    status: number,
    body: string,
    req: http.IncomingMessage | null = null,
  ) => sendJsRaw(baseHeaders, res, status, body, req);
  const sendError = (
    res: http.ServerResponse,
    status: number,
    errorCode: string,
    message: string,
    req: http.IncomingMessage | null = null,
    details?: unknown,
  ) => sendErrorRaw(baseHeaders, res, status, errorCode, message, req, details);
  const readBody = (
    req: http.IncomingMessage,
    opts: { limitBytes?: number } = {},
  ) => {
    if (!opts.limitBytes) {
      const routeMetaReq = req as unknown as Record<string, unknown>;
      const pathname =
        ((routeMetaReq._routeMeta as Record<string, unknown> | undefined)
          ?.routePath as string | undefined) ||
        new URL(req.url || "/", "http://127.0.0.1").pathname;
      opts = { ...opts, limitBytes: bodyLimitForRoute(pathname) };
    }
    return readBodyRaw(req, opts);
  };
  const validateBody = (pathname: string, body: Record<string, unknown>) =>
    validateBodyRaw(pathname, body);

  // --- Bound security helpers ---
  const requireApiAuth = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): boolean =>
    requireApiAuthRaw(
      sendJson,
      req,
      res,
      currentApiToken!,
      allowedBrowserOrigin,
      originAllowlist,
      securityAuditLog,
    );
  const requireSameOrigin = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): boolean =>
    requireSameOriginRaw(
      sendJson,
      req,
      res,
      allowedBrowserOrigin,
      originAllowlist,
      securityAuditLog,
    );
  const requireCsrf = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): boolean => requireCsrfRaw(sendJson, req, res, csrfToken, securityAuditLog);

  // --- Operations factories ---
  const { rebuild } = createRebuildOps({
    store,
    nativeAdapter,
    actionQueue,
    metrics,
    buildSidecarSnapshot,
    paths,
    readdirSync,
    mkdirSync,
    unlinkSync,
    writeJSON,
  });

  const maintenanceSweep = createMaintenanceSweep({
    actionQueue,
    paths,
    findStuckBridgeRequests,
    sweepBridgeQueues,
    store,
    rateLimiter,
    getAllTasksSnapshot: () =>
      (
        store as unknown as { getSnapshot(): Record<string, unknown> }
      ).getSnapshot().tasks || [],
    applyPriorityAging,
    getTeamsSnapshot: (fresh = false) =>
      fresh
        ? buildSidecarSnapshot().teams || []
        : (
            store as unknown as { getSnapshot(): Record<string, unknown> }
          ).getSnapshot().teams || [],
    shouldAutoRebalance,
    coordinatorAdapter,
    metrics,
    createCheckpoint,
    rotateCheckpoints,
    checkTerminalHealth,
    suggestRecovery,
    validateHooks,
  });

  const diagnosticsBundle = createDiagnosticsBundle({
    store,
    paths,
    readJSON,
    fileExists,
    actionQueue,
    metrics,
    lockMetrics,
    checkTerminalHealth,
    CURRENT_SCHEMA_VERSION,
    writeJSON,
    trimLongStrings,
    appendJSONL,
  });

  const runTrackedAction = createTrackedActionRunner({
    actionQueue,
    store,
    metrics,
    nativeAdapter,
    router,
  });
  const runBatchTriage = createBatchTriageRunner({
    store,
    findTeam,
    buildTeamInterrupts,
    runTrackedAction,
  });

  // --- Output stream manager (event-driven worker output) ---
  const outputStream = new OutputStreamManager();

  // --- Route registry ---
  const routeRegistry = buildServerRouter();

  // --- Build route context factory ---
  const buildRouteContext = createRouteContextFactory({
    paths,
    store,
    metrics,
    actionQueue,
    coordinatorAdapter,
    nativeAdapter,
    router,
    SAFE_MODE,
    getApiToken: () => currentApiToken,
    csrfToken,
    DASHBOARD_HTML,
    DASHBOARD_JS,
    securityAuditLog,
    requestAuditLog,
    rotateApiToken: () => {
      const r = rotateApiToken(paths, writeJsonFile);
      currentApiToken = r.new_token;
      return r;
    },
    filePermissions: permCheck,
    baseHeaders,
    bodyLimitForRoute,
    sendJson,
    sendText,
    sendHtml,
    sendJs,
    sendError,
    readBody,
    validateBody,
    findTeam,
    buildActionPayload,
    buildTeamInterrupts:
      buildTeamInterrupts as RouteContext["buildTeamInterrupts"],
    mapNativeHttpAction,
    maintenanceSweep,
    diagnosticsBundle,
    rebuild,
    runTrackedAction,
    runBatchTriage,
    latestJsonFileName: (dir: string) => latestJsonFileName(dir, readdirSync),
    pathResolve,
    spawn,
    writeFileSync,
    writeJSON,
    writeJsonFile,
    readJSON,
    readJSONL,
    readFileSync: readFileSync as unknown as (
      path: string | URL,
      encoding?: string,
    ) => string,
    readdirSync: readdirSync as unknown as (path: string) => string[],
    MetricsTracker,
    CURRENT_SCHEMA_VERSION,
    migrateBundle,
    validateSchemaVersion,
    currentApiVersion,
    legacyDeprecationHeaders,
    buildComparisonReport,
    loadSnapshotHistory,
    snapshotDiff,
    replayTimeline,
    buildTimelineReport,
    createCheckpoint,
    listCheckpoints,
    restoreCheckpoint,
    rebuildFromTimeline,
    consistencyCheck,
    scanForCorruption,
    repairJSON,
    repairJSONL,
    dryRunMigration,
    migrations,
    lockMetrics,
    checkTerminalHealth,
    suggestRecovery,
    validateHooks,
    runHookSelftest,
    listBackups,
    restoreFromBackup,
    outputStream,
  });

  // --- Middleware config ---
  const middlewareConfig = {
    rateLimitMax,
    safeMode: SAFE_MODE,
    requireSameOrigin,
    requireApiAuth,
    requireCsrf,
    rateLimiter,
    replayProtector,
    securityAuditLog,
    sendError,
  };

  // --- Lifecycle placeholder ---
  let lifecycle = {
    stop() {
      /* no-op until boot completes */
    },
  };

  // --- Request handler ---
  let server: http.Server | https.Server;

  const requestHandler: http.RequestListener = async (req, res) => {
    (req as unknown as Record<string, unknown>).__requestId =
      crypto.randomUUID();
    const __startMs = Date.now();
    const origEnd = res.end.bind(res);
    (res as unknown as Record<string, Function>).end = function (
      ...args: unknown[]
    ) {
      log.request(req, res.statusCode, __startMs);
      requestAuditLog.log({
        method: String(req.method || "GET"),
        path: String(req.url || "/"),
        status: res.statusCode,
        request_id: String(
          (req as unknown as Record<string, unknown>).__requestId || "-",
        ),
        ip: String(req.socket?.remoteAddress || "unknown"),
        duration_ms: Date.now() - __startMs,
      });
      return (origEnd as Function)(...args);
    };
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const routeMeta = normalizeApiPath(url.pathname);
    attachRouteMeta(req, routeMeta);
    url.pathname = routeMeta.routePath;
    const snapshot = (
      store as unknown as { getSnapshot(): Record<string, unknown> }
    ).getSnapshot();

    // OPTIONS fast path
    if (req.method === "OPTIONS") {
      if (!requireSameOrigin(req, res)) return;
      res.writeHead(204, baseHeaders(req));
      res.end();
      return;
    }

    // Run full middleware chain (origin, rate-limit, auth, csrf, replay, safe-mode)
    const verdict = runRequestMiddleware(req, res, url, middlewareConfig);
    if (verdict === "handled") return;

    // Route dispatch
    const ctx = buildRouteContext({
      req,
      res,
      url,
      routeMeta,
      snapshot,
      server,
      clients,
    });
    const handled = await routeRegistry.handle(ctx);
    if (handled) return;

    sendError(
      res,
      404,
      "NOT_FOUND",
      `No route for ${req.method} ${url.pathname}`,
      req,
    );
  };

  // --- Create & bind server ---
  server = createHttpServer(tls, requestHandler);
  await bindServer(server, unixSocketPath, args.port);
  const port = writeRuntimeFiles(paths, server, writeJSON);
  allowedBrowserOrigin = unixSocketPath
    ? null
    : `${tls.enabled ? "https" : "http"}://127.0.0.1:${port}`;

  // --- Boot runtime ---
  try {
    await bootRuntime({ rebuild, maintenanceSweep, SAFE_MODE, store });
    lifecycle = startRuntimeLifecycle({
      HookStreamAdapter,
      paths,
      store,
      rebuild,
      maintenanceSweep,
      clients,
      sseBroadcast,
      outputStream,
    });
  } catch (err) {
    try {
      unlinkSync(paths.lockFile);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(paths.portFile);
    } catch {
      /* ignore */
    }
    try {
      server.close();
    } catch {
      /* ignore */
    }
    throw err;
  }

  // --- Auto-open on macOS ---
  if (args.open && process.platform === "darwin") {
    try {
      spawn(
        "open",
        [`${tls.enabled ? "https" : "http"}://127.0.0.1:${port}/`],
        {
          detached: true,
          stdio: "ignore",
        },
      ).unref();
    } catch {
      /* best effort */
    }
  }

  // --- Cleanup / signal handling ---
  const cleanup = cleanupFactory(
    server,
    lifecycle,
    paths,
    clients,
    unixSocketPath,
  );

  // --- Log startup ---
  if (unixSocketPath) {
    log.info(`listening on unix socket ${unixSocketPath}`, {
      socket: unixSocketPath,
      tls: tls.enabled,
      mtls_required: tls.mtlsRequired,
    });
  } else {
    log.info(
      `listening on ${tls.enabled ? "https" : "http"}://127.0.0.1:${port}`,
      { port, tls: tls.enabled, mtls_required: tls.mtlsRequired },
    );
  }

  // --- Return typed server instance ---
  return {
    server,
    port,
    get apiToken() {
      return currentApiToken;
    },
    store,
    router,
    nativeAdapter,
    actionQueue,
    metrics,
    close: () => cleanup(false),
    maintenanceSweep,
    diagnosticsBundle,
    outputStream,
  };
}
