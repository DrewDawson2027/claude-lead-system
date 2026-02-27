#!/usr/bin/env node
// @ts-nocheck
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';
import { spawn } from 'child_process';
import { unlinkSync, readFileSync, readdirSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { resolve as pathResolve } from 'path';

import { sidecarPaths } from '../core/paths.js';
import { ensureDirs, writeJSON, readJSON, readJSONL, fileExists, writeJSON as writeJsonFile, appendJSONL } from '../core/fs-utils.js';
import { SidecarStateStore } from '../core/state-store.js';
import { HookStreamAdapter } from '../adapters/hook-stream-adapter.js';
import { CoordinatorAdapter } from '../adapters/coordinator-adapter.js';
import { NativeTeamAdapter } from '../adapters/native-team-adapter.js';
import { ActionRouter } from '../core/action-router.js';
import { buildSidecarSnapshot } from './snapshot-builder.js';
import { ActionQueue } from '../native/action-queue.js';
import { MetricsTracker } from '../native/metrics.js';
import { findStuckBridgeRequests, sweepBridgeQueues } from '../native/bridge-protocol.js';
import { applyPriorityAging, shouldAutoRebalance } from '../core/policy-engine.js';
import { buildComparisonReport } from './report-builder.js';
import { CURRENT_SCHEMA_VERSION, migrateBundle, validateSchemaVersion, dryRunMigration, migrations } from '../core/schema.js';
import { diffSnapshots as snapshotDiff, replayTimeline, buildTimelineReport, loadSnapshotHistory } from '../core/snapshot-diff.js';
import { createCheckpoint, listCheckpoints, restoreCheckpoint, rotateCheckpoints } from '../core/checkpoint.js';
import { rebuildFromTimeline, consistencyCheck } from '../core/event-replay.js';
import { repairJSON, repairJSONL, scanForCorruption } from '../core/repair.js';
import { listBackups, restoreFromBackup } from '../core/pre-op-backup.js';
import { lockMetrics } from '../core/lock-metrics.js';
import { checkTerminalHealth, suggestRecovery } from '../core/terminal-health.js';
import { validateHooks, runHookSelftest } from '../core/hook-watchdog.js';

import { attachRouteMeta, currentApiVersion, legacyDeprecationHeaders, normalizeApiPath } from './http/versioning.js';
import { createBaseHeaders, sendJson as sendJsonRaw, sendText as sendTextRaw, sendHtml as sendHtmlRaw, sendJs as sendJsRaw, sendError as sendErrorRaw, sseBroadcast } from './http/response.js';
import { readBody as readBodyRaw, bodyLimitForRoute } from './http/body.js';
import { requireApiAuth as requireApiAuthRaw, requireSameOrigin as requireSameOriginRaw, requireCsrf as requireCsrfRaw, createRateLimiter as createRateLimiterRaw, createReplayProtector as createReplayProtectorRaw } from './http/security.js';
import { validateBody as validateBodyRaw } from './http/validation.js';
import { SecurityAuditLog, RequestAuditLog } from './http/audit.js';
import { createLogger } from './http/logger.js';
import { buildServerRouter } from './routes/index.js';

import { readFileSafe, parseArgs, ensureApiToken, ensureCsrfToken, rotateApiToken, checkFilePermissions, writeRuntimeFiles } from './runtime/bootstrap.js';
import { trimLongStrings, latestJsonFileName, findTeam, buildActionPayload, buildTeamInterrupts, mapNativeHttpAction } from './runtime/team-utils.js';
import { createRebuildOps } from './runtime/rebuild.js';
import { createMaintenanceSweep, createDiagnosticsBundle } from './runtime/maintenance.js';
import { createTrackedActionRunner, createBatchTriageRunner } from './runtime/actions.js';
import { bootRuntime, startRuntimeLifecycle } from './runtime/lifecycle.js';

const DASHBOARD_HTML = readFileSafe(readFileSync, new URL('../ui-web/index.html', import.meta.url));
const DASHBOARD_JS = readFileSafe(readFileSync, new URL('../ui-web/app.js', import.meta.url));

export async function startSidecarServer(options = {}) {
  const args = { ...parseArgs(process.argv.slice(2)), ...options };
  const paths = sidecarPaths();
  ensureDirs([
    paths.root, paths.runtimeDir, paths.nativeRuntimeDir, paths.nativeBridgeRequestDir, paths.nativeBridgeResponseDir,
    paths.actionsRootDir, paths.actionsPendingDir, paths.actionsInflightDir, paths.actionsDoneDir, paths.actionsFailedDir,
    paths.stateDir, paths.logsDir, paths.diagnosticsDir,
  ]);

  const apiToken = ensureApiToken(paths, fileExists, readJSON, writeJsonFile);
  let currentApiToken = apiToken;
  const csrfToken = ensureCsrfToken(paths, fileExists, readJSON, writeJsonFile, { rotateCsrf: Boolean(args.rotateCsrf) });
  const SAFE_MODE = Boolean(args.safeMode);
  const log = createLogger({ format: (process.env.LOG_FORMAT || 'text') as any });
  const securityAuditLog = new SecurityAuditLog();
  const requestAuditLog = new RequestAuditLog({ auditAll: Boolean(process.env.LEAD_SIDECAR_AUDIT_ALL) });
  const originAllowlist = (process.env.LEAD_SIDECAR_ORIGIN_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);
  const permCheck = checkFilePermissions(paths, fileExists);
  if (!permCheck.ok) {
    for (const issue of permCheck.issues) {
      log.warn(`file permission issue: ${issue.file} — ${issue.action}`);
    }
  }

  const store = new SidecarStateStore(paths);
  const actionQueue = new ActionQueue(paths);
  const metrics = new MetricsTracker();
  const coordinatorAdapter = new CoordinatorAdapter();
  const nativeAdapter = new NativeTeamAdapter({ paths, coordinatorAdapter, store });
  const router = new ActionRouter({ coordinatorAdapter, nativeAdapter, store });
  const clients = new Set();
  const rateLimitMax = Number(process.env.LEAD_SIDECAR_RATE_LIMIT || 180);
  const rateLimiter = createRateLimiterRaw({
    windowMs: Number(process.env.LEAD_SIDECAR_RATE_WINDOW_MS || 60_000),
    max: rateLimitMax,
  });
  const replayProtector = createReplayProtectorRaw();
  let allowedBrowserOrigin: string | null = null;
  const unixSocketPath = String(args.unixSocket || process.env.LEAD_SIDECAR_UNIX_SOCKET || '').trim() || null;
  const tlsKeyFile = String(args.tlsKeyFile || process.env.LEAD_SIDECAR_TLS_KEY_FILE || '').trim();
  const tlsCertFile = String(args.tlsCertFile || process.env.LEAD_SIDECAR_TLS_CERT_FILE || '').trim();
  const tlsCaFile = String(args.tlsCaFile || process.env.LEAD_SIDECAR_TLS_CA_FILE || '').trim();
  const mtlsRequired = Boolean(args.mtls || process.env.LEAD_SIDECAR_MTLS_REQUIRE_CLIENT_CERT === '1');
  const tlsEnabled = Boolean(tlsKeyFile && tlsCertFile);
  const isMutatingMethod = (method: string | undefined) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());

  const baseHeaders = (req = null) => createBaseHeaders(req, allowedBrowserOrigin, originAllowlist);
  const sendJson = (res, status, payload, req = null) => sendJsonRaw(baseHeaders, res, status, payload, req);
  const sendText = (res, status, body, req = null) => sendTextRaw(baseHeaders, res, status, body, req);
  const sendHtml = (res, status, body, req = null) => sendHtmlRaw(baseHeaders, res, status, body, req);
  const sendJs = (res, status, body, req = null) => sendJsRaw(baseHeaders, res, status, body, req);
  const sendError = (res, status, errorCode, message, req = null, details?) => sendErrorRaw(baseHeaders, res, status, errorCode, message, req, details);
  const readBody = (req, opts: any = {}) => {
    if (!opts.limitBytes) {
      const pathname = req._routeMeta?.routePath || new URL(req.url || '/', 'http://127.0.0.1').pathname;
      opts = { ...opts, limitBytes: bodyLimitForRoute(pathname) };
    }
    return readBodyRaw(req, opts);
  };
  const validateBody = (pathname, body) => validateBodyRaw(pathname, body);
  const requireApiAuth = (req, res) => requireApiAuthRaw(sendJson, req, res, currentApiToken, allowedBrowserOrigin, originAllowlist, securityAuditLog);
  const requireSameOrigin = (req, res) => requireSameOriginRaw(sendJson, req, res, allowedBrowserOrigin, originAllowlist, securityAuditLog);
  const requireCsrf = (req, res) => requireCsrfRaw(sendJson, req, res, csrfToken, securityAuditLog);

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
    getAllTasksSnapshot: () => store.getSnapshot().tasks || [],
    applyPriorityAging,
    getTeamsSnapshot: (fresh = false) => (fresh ? (buildSidecarSnapshot().teams || []) : (store.getSnapshot().teams || [])),
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

  const runTrackedAction = createTrackedActionRunner({ actionQueue, store, metrics, nativeAdapter, router });
  const runBatchTriage = createBatchTriageRunner({ store, findTeam, buildTeamInterrupts, runTrackedAction });

  await bootRuntime({ rebuild, maintenanceSweep, SAFE_MODE, store });
  const lifecycle = startRuntimeLifecycle({ HookStreamAdapter, paths, store, rebuild, maintenanceSweep, clients, sseBroadcast });

  const routeRegistry = buildServerRouter();

  const requestHandler = async (req, res) => {
    (req as any).__requestId = crypto.randomUUID();
    const __startMs = Date.now();
    const origEnd = res.end.bind(res);
    res.end = function (...args: any[]) {
      log.request(req, res.statusCode, __startMs);
      requestAuditLog.log({
        method: String(req.method || 'GET'),
        path: String(req.url || '/'),
        status: res.statusCode,
        request_id: String((req as any).__requestId || '-'),
        ip: String(req.socket?.remoteAddress || 'unknown'),
        duration_ms: Date.now() - __startMs,
      });
      return origEnd(...args);
    };
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const routeMeta = normalizeApiPath(url.pathname);
    attachRouteMeta(req, routeMeta);
    url.pathname = routeMeta.routePath;
    const snapshot = store.getSnapshot();

    if (req.method === 'OPTIONS') {
      if (!requireSameOrigin(req, res)) return;
      res.writeHead(204, baseHeaders(req));
      res.end();
      return;
    }
    if (!requireSameOrigin(req, res)) return;

    if (isMutatingMethod(req.method)) {
      const rlKey = `${req.socket?.remoteAddress || 'local'}:${url.pathname}`;
      const rl = rateLimiter.check(rlKey);
      if (!rl.ok) {
        securityAuditLog.log({ type: 'rate_limit', ip: req.socket?.remoteAddress || 'unknown', path: req.url || '' });
        res.setHeader('Retry-After', String(Math.ceil((rl.retry_after_ms || 0) / 1000)));
        return sendError(res, 429, 'RATE_LIMITED', 'Rate limit exceeded', req, { retry_after_ms: rl.retry_after_ms });
      }
      res.setHeader('X-RateLimit-Limit', String(rateLimitMax));
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining ?? 0));
      if (!requireApiAuth(req, res)) return;
      if (!requireCsrf(req, res)) return;
      const replayCheck = replayProtector.check(req, url.pathname);
      if (!replayCheck.ok) return sendError(res, 409, 'REPLAY_DETECTED', replayCheck.error || 'Nonce already used', req);
      if (SAFE_MODE) {
        const safeModeBlocked = [
          /^\/dispatch$/, /^\/teams\/[^/]+\/actions\//, /^\/teams\/[^/]+\/batch-triage$/,
          /^\/teams\/[^/]+\/rebalance$/, /^\/native\/actions\//, /^\/native\/bridge\/ensure$/,
          /^\/native\/probe$/, /^\/maintenance\/run$/,
        ];
        const isBlockedPost = String(req.method).toUpperCase() === 'POST' && safeModeBlocked.some((rx) => rx.test(url.pathname));
        const isBlockedMutation = String(req.method).toUpperCase() !== 'POST';
        if (isBlockedPost || isBlockedMutation) {
          return sendError(res, 503, 'SAFE_MODE_ACTIVE', 'Server is in safe mode — mutation endpoints disabled', req);
        }
      }
    }

    const handled = await routeRegistry.handle({
      req, res, url, routeMeta, snapshot, server, clients, paths,
      store, metrics, actionQueue, coordinatorAdapter, nativeAdapter, router,
      SAFE_MODE, apiToken: currentApiToken, csrfToken, DASHBOARD_HTML, DASHBOARD_JS,
      processInfo: { pid: process.pid },
      securityAuditLog, requestAuditLog, rotateApiToken: () => { const r = rotateApiToken(paths, writeJsonFile); currentApiToken = r.new_token; return r; },
      filePermissions: permCheck, bodyLimitForRoute,
      baseHeaders, sendJson, sendText, sendHtml, sendJs, sendError,
      readBody, validateBody,
      findTeam, buildActionPayload, buildTeamInterrupts, mapNativeHttpAction,
      maintenanceSweep, diagnosticsBundle, rebuild, runTrackedAction, runBatchTriage,
      latestJsonFileName: (dir) => latestJsonFileName(dir, readdirSync),
      pathResolve, spawn, writeFileSync, writeJSON, writeJsonFile,
      readJSON, readJSONL, readFileSync, readdirSync,
      MetricsTracker,
      CURRENT_SCHEMA_VERSION, migrateBundle, validateSchemaVersion, currentApiVersion, legacyDeprecationHeaders,
      buildComparisonReport, loadSnapshotHistory, snapshotDiff, replayTimeline, buildTimelineReport,
      createCheckpoint, listCheckpoints, restoreCheckpoint,
      rebuildFromTimeline, consistencyCheck,
      scanForCorruption, repairJSON, repairJSONL,
      dryRunMigration, migrations,
      lockMetrics, checkTerminalHealth, suggestRecovery, validateHooks, runHookSelftest,
      listBackups, restoreFromBackup,
    });
    if (handled) return;
    return sendError(res, 404, 'NOT_FOUND', `No route for ${req.method} ${url.pathname}`, req);
  };

  let server;
  if (tlsEnabled) {
    const tlsOptions: any = {
      key: readFileSafe(readFileSync, tlsKeyFile as any),
      cert: readFileSafe(readFileSync, tlsCertFile as any),
      requestCert: mtlsRequired,
      rejectUnauthorized: mtlsRequired,
    };
    if (tlsCaFile) tlsOptions.ca = readFileSafe(readFileSync, tlsCaFile as any);
    server = https.createServer(tlsOptions, requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  if (unixSocketPath) {
    try { unlinkSync(unixSocketPath); } catch {}
    await new Promise((resolve) => server.listen(unixSocketPath, resolve));
    try { chmodSync(unixSocketPath, 0o600); } catch {}
  } else {
    await new Promise((resolve) => server.listen(args.port || 0, '127.0.0.1', resolve));
  }
  const port = writeRuntimeFiles(paths, server, writeJSON);
  allowedBrowserOrigin = unixSocketPath ? null : `${tlsEnabled ? 'https' : 'http'}://127.0.0.1:${port}`;

  if (args.open && process.platform === 'darwin') {
    try { spawn('open', [`${tlsEnabled ? 'https' : 'http'}://127.0.0.1:${port}/`], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }

  const cleanup = (exitAfter = false) => {
    lifecycle.stop();
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    try { unlinkSync(paths.lockFile); } catch {}
    try { unlinkSync(paths.portFile); } catch {}
    if (unixSocketPath) {
      try { unlinkSync(unixSocketPath); } catch {}
    }
    for (const clientRes of clients) { try { clientRes.end(); } catch {} }
    server.close(() => { if (exitAfter) process.exit(0); });
    if (exitAfter) setTimeout(() => process.exit(0), 1000).unref();
  };
  const shutdown = () => cleanup(true);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (unixSocketPath) {
    log.info(`listening on unix socket ${unixSocketPath}`, { socket: unixSocketPath, tls: tlsEnabled, mtls_required: mtlsRequired });
  } else {
    log.info(`listening on ${tlsEnabled ? 'https' : 'http'}://127.0.0.1:${port}`, { port, tls: tlsEnabled, mtls_required: mtlsRequired });
  }
  return {
    server,
    port,
    get apiToken() { return currentApiToken; },
    store,
    router,
    nativeAdapter,
    actionQueue,
    metrics,
    close: () => cleanup(false),
    maintenanceSweep,
    diagnosticsBundle,
  };
}
