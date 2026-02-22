#!/usr/bin/env node
// @ts-nocheck
import http from 'http';
import { URL } from 'url';
import { spawn } from 'child_process';
import { unlinkSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
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
import { createBaseHeaders, sendJson as sendJsonRaw, sendText as sendTextRaw, sendHtml as sendHtmlRaw, sendJs as sendJsRaw, sseBroadcast } from './http/response.js';
import { readBody as readBodyRaw } from './http/body.js';
import { requireApiAuth as requireApiAuthRaw, requireSameOrigin as requireSameOriginRaw, requireCsrf as requireCsrfRaw, createRateLimiter as createRateLimiterRaw } from './http/security.js';
import { validateBody as validateBodyRaw } from './http/validation.js';
import { buildServerRouter } from './routes/index.js';

import { readFileSafe, parseArgs, ensureApiToken, ensureCsrfToken, writeRuntimeFiles } from './runtime/bootstrap.js';
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
  const csrfToken = ensureCsrfToken(paths, fileExists, readJSON, writeJsonFile);
  const SAFE_MODE = Boolean(args.safeMode);

  const store = new SidecarStateStore(paths);
  const actionQueue = new ActionQueue(paths);
  const metrics = new MetricsTracker();
  const coordinatorAdapter = new CoordinatorAdapter();
  const nativeAdapter = new NativeTeamAdapter({ paths, coordinatorAdapter, store });
  const router = new ActionRouter({ coordinatorAdapter, nativeAdapter, store });
  const clients = new Set();
  const rateLimiter = createRateLimiterRaw({
    windowMs: Number(process.env.LEAD_SIDECAR_RATE_WINDOW_MS || 60_000),
    max: Number(process.env.LEAD_SIDECAR_RATE_LIMIT || 180),
  });

  const baseHeaders = (req = null) => createBaseHeaders(req);
  const sendJson = (res, status, payload, req = null) => sendJsonRaw(baseHeaders, res, status, payload, req);
  const sendText = (res, status, body, req = null) => sendTextRaw(baseHeaders, res, status, body, req);
  const sendHtml = (res, status, body, req = null) => sendHtmlRaw(baseHeaders, res, status, body, req);
  const sendJs = (res, status, body, req = null) => sendJsRaw(baseHeaders, res, status, body, req);
  const readBody = (req, opts = {}) => readBodyRaw(req, opts);
  const validateBody = (pathname, body) => validateBodyRaw(pathname, body);
  const requireApiAuth = (req, res) => requireApiAuthRaw(sendJson, req, res, apiToken);
  const requireSameOrigin = (req, res) => requireSameOriginRaw(sendJson, req, res);
  const requireCsrf = (req, res) => requireCsrfRaw(sendJson, req, res, csrfToken);

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

  let server;
  server = http.createServer(async (req, res) => {
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

    if (req.method === 'POST') {
      const rlKey = `${req.socket?.remoteAddress || 'local'}:${url.pathname}`;
      const rl = rateLimiter.check(rlKey);
      if (!rl.ok) return sendJson(res, 429, { error: 'Rate limit exceeded', retry_after_ms: rl.retry_after_ms }, req);
      if (!requireApiAuth(req, res)) return;
      if (!requireCsrf(req, res)) return;
      if (SAFE_MODE) {
        const safeModeBlocked = [
          /^\/dispatch$/, /^\/teams\/[^/]+\/actions\//, /^\/teams\/[^/]+\/batch-triage$/,
          /^\/teams\/[^/]+\/rebalance$/, /^\/native\/actions\//, /^\/native\/bridge\/ensure$/,
          /^\/native\/probe$/, /^\/maintenance\/run$/,
        ];
        if (safeModeBlocked.some((rx) => rx.test(url.pathname))) {
          return sendJson(res, 503, { error: 'Server is in safe mode — mutation endpoints disabled' }, req);
        }
      }
    }
    if (SAFE_MODE && req.method === 'PATCH') {
      return sendJson(res, 503, { error: 'Server is in safe mode — mutation endpoints disabled' }, req);
    }

    const handled = await routeRegistry.handle({
      req, res, url, routeMeta, snapshot, server, clients, paths,
      store, metrics, actionQueue, coordinatorAdapter, nativeAdapter, router,
      SAFE_MODE, apiToken, csrfToken, DASHBOARD_HTML, DASHBOARD_JS,
      processInfo: { pid: process.pid },
      baseHeaders, sendJson, sendText, sendHtml, sendJs,
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
    return sendText(res, 404, 'Not found', req);
  });

  await new Promise((resolve) => server.listen(args.port || 0, '127.0.0.1', resolve));
  const port = writeRuntimeFiles(paths, server, writeJSON);

  if (args.open && process.platform === 'darwin') {
    try { spawn('open', [`http://127.0.0.1:${port}/`], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }

  const cleanup = (exitAfter = false) => {
    lifecycle.stop();
    try { unlinkSync(paths.lockFile); } catch {}
    try { unlinkSync(paths.portFile); } catch {}
    for (const clientRes of clients) { try { clientRes.end(); } catch {} }
    server.close(() => { if (exitAfter) process.exit(0); });
    if (exitAfter) setTimeout(() => process.exit(0), 1000).unref();
  };
  const shutdown = () => cleanup(true);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`lead-sidecar listening on http://127.0.0.1:${port}`);
  return {
    server,
    port,
    apiToken,
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
