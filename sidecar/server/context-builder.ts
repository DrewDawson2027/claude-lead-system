/**
 * Builds the typed RouteContext object that is passed to every route handler.
 *
 * This was previously a 65-key inline object literal inside requestHandler.
 * Now it's a factory function that captures server-scoped deps at boot time
 * and adds per-request fields at dispatch time.
 */

import type http from "http";
import type https from "https";
import type { RouteContext } from "./types.js";
import type { SecurityAuditLog, RequestAuditLog } from "./http/audit.js";

// ---------------------------------------------------------------------------
// Server-scoped dependencies (captured once at boot)
// ---------------------------------------------------------------------------

export interface ServerScopedDeps {
  // Infrastructure
  paths: Record<string, string>;
  store: unknown;
  metrics: unknown;
  actionQueue: unknown;
  coordinatorAdapter: unknown;
  nativeAdapter: unknown;
  router: unknown;

  // Flags & tokens
  SAFE_MODE: boolean;
  getApiToken: () => string | null;
  csrfToken: string;
  DASHBOARD_HTML: string;
  DASHBOARD_JS: string;

  // Audit
  securityAuditLog: SecurityAuditLog;
  requestAuditLog: RequestAuditLog;

  // Token rotation
  rotateApiToken: () => { new_token: string; rotated_at: string };
  filePermissions: { ok: boolean; issues: Array<Record<string, unknown>> };

  // Response helpers (bound to baseHeaders)
  baseHeaders: RouteContext["baseHeaders"];
  bodyLimitForRoute: RouteContext["bodyLimitForRoute"];
  sendJson: RouteContext["sendJson"];
  sendText: RouteContext["sendText"];
  sendHtml: RouteContext["sendHtml"];
  sendJs: RouteContext["sendJs"];
  sendError: RouteContext["sendError"];
  readBody: RouteContext["readBody"];
  validateBody: RouteContext["validateBody"];

  // Team/action helpers
  findTeam: RouteContext["findTeam"];
  buildActionPayload: RouteContext["buildActionPayload"];
  buildTeamInterrupts: RouteContext["buildTeamInterrupts"];
  mapNativeHttpAction: RouteContext["mapNativeHttpAction"];

  // Operations
  maintenanceSweep: RouteContext["maintenanceSweep"];
  diagnosticsBundle: unknown;
  rebuild: RouteContext["rebuild"];
  runTrackedAction: unknown;
  runBatchTriage: unknown;

  // FS utilities
  latestJsonFileName: RouteContext["latestJsonFileName"];
  pathResolve: RouteContext["pathResolve"];
  spawn: RouteContext["spawn"];
  writeFileSync: RouteContext["writeFileSync"];
  writeJSON: RouteContext["writeJSON"];
  writeJsonFile: RouteContext["writeJsonFile"];
  readJSON: RouteContext["readJSON"];
  readJSONL: RouteContext["readJSONL"];
  readFileSync: RouteContext["readFileSync"];
  readdirSync: RouteContext["readdirSync"];
  MetricsTracker: unknown;

  // Schema / migration
  CURRENT_SCHEMA_VERSION: number;
  migrateBundle: RouteContext["migrateBundle"];
  validateSchemaVersion: RouteContext["validateSchemaVersion"];
  currentApiVersion: RouteContext["currentApiVersion"];
  legacyDeprecationHeaders: RouteContext["legacyDeprecationHeaders"];
  buildComparisonReport: RouteContext["buildComparisonReport"];

  // Snapshots
  loadSnapshotHistory: RouteContext["loadSnapshotHistory"];
  snapshotDiff: RouteContext["snapshotDiff"];
  replayTimeline: RouteContext["replayTimeline"];
  buildTimelineReport: RouteContext["buildTimelineReport"];

  // Checkpoints
  createCheckpoint: RouteContext["createCheckpoint"];
  listCheckpoints: RouteContext["listCheckpoints"];
  restoreCheckpoint: RouteContext["restoreCheckpoint"];

  // Event replay
  rebuildFromTimeline: RouteContext["rebuildFromTimeline"];
  consistencyCheck: RouteContext["consistencyCheck"];

  // Repair
  scanForCorruption: RouteContext["scanForCorruption"];
  repairJSON: RouteContext["repairJSON"];
  repairJSONL: RouteContext["repairJSONL"];
  dryRunMigration: RouteContext["dryRunMigration"];
  migrations: unknown;

  // Misc
  lockMetrics: unknown;
  checkTerminalHealth: RouteContext["checkTerminalHealth"];
  suggestRecovery: RouteContext["suggestRecovery"];
  validateHooks: RouteContext["validateHooks"];
  runHookSelftest: RouteContext["runHookSelftest"];
  listBackups: RouteContext["listBackups"];
  restoreFromBackup: RouteContext["restoreFromBackup"];

  // Output streaming
  outputStream?: unknown;
}

// ---------------------------------------------------------------------------
// Factory: create a per-request RouteContext from server deps + request data
// ---------------------------------------------------------------------------

export function createRouteContextFactory(deps: ServerScopedDeps) {
  /**
   * Build a complete RouteContext for a single request.
   */
  return function buildRouteContext(per: {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    url: URL;
    routeMeta: Record<string, unknown>;
    snapshot: Record<string, unknown>;
    server: http.Server | https.Server;
    clients: Set<http.ServerResponse>;
  }): RouteContext {
    return {
      // Per-request fields
      req: per.req,
      res: per.res,
      url: per.url,
      routeMeta: per.routeMeta,
      snapshot: per.snapshot,
      server: per.server,
      clients: per.clients,

      // Process info (constant)
      processInfo: { pid: process.pid },

      // Server-scoped deps (spread)
      paths: deps.paths,
      store: deps.store,
      metrics: deps.metrics,
      actionQueue: deps.actionQueue,
      coordinatorAdapter: deps.coordinatorAdapter,
      nativeAdapter: deps.nativeAdapter,
      router: deps.router,
      SAFE_MODE: deps.SAFE_MODE,
      apiToken: deps.getApiToken(),
      csrfToken: deps.csrfToken,
      DASHBOARD_HTML: deps.DASHBOARD_HTML,
      DASHBOARD_JS: deps.DASHBOARD_JS,
      securityAuditLog: deps.securityAuditLog,
      requestAuditLog: deps.requestAuditLog,
      rotateApiToken: deps.rotateApiToken,
      filePermissions: deps.filePermissions,
      baseHeaders: deps.baseHeaders,
      bodyLimitForRoute: deps.bodyLimitForRoute,
      sendJson: deps.sendJson,
      sendText: deps.sendText,
      sendHtml: deps.sendHtml,
      sendJs: deps.sendJs,
      sendError: deps.sendError,
      readBody: deps.readBody,
      validateBody: deps.validateBody,
      findTeam: deps.findTeam,
      buildActionPayload: deps.buildActionPayload,
      buildTeamInterrupts: deps.buildTeamInterrupts,
      mapNativeHttpAction: deps.mapNativeHttpAction,
      maintenanceSweep: deps.maintenanceSweep,
      diagnosticsBundle: deps.diagnosticsBundle,
      rebuild: deps.rebuild,
      runTrackedAction: deps.runTrackedAction,
      runBatchTriage: deps.runBatchTriage,
      latestJsonFileName: deps.latestJsonFileName,
      pathResolve: deps.pathResolve,
      spawn: deps.spawn,
      writeFileSync: deps.writeFileSync,
      writeJSON: deps.writeJSON,
      writeJsonFile: deps.writeJsonFile,
      readJSON: deps.readJSON,
      readJSONL: deps.readJSONL,
      readFileSync: deps.readFileSync,
      readdirSync: deps.readdirSync,
      MetricsTracker: deps.MetricsTracker,
      CURRENT_SCHEMA_VERSION: deps.CURRENT_SCHEMA_VERSION,
      migrateBundle: deps.migrateBundle,
      validateSchemaVersion: deps.validateSchemaVersion,
      currentApiVersion: deps.currentApiVersion,
      legacyDeprecationHeaders: deps.legacyDeprecationHeaders,
      buildComparisonReport: deps.buildComparisonReport,
      loadSnapshotHistory: deps.loadSnapshotHistory,
      snapshotDiff: deps.snapshotDiff,
      replayTimeline: deps.replayTimeline,
      buildTimelineReport: deps.buildTimelineReport,
      createCheckpoint: deps.createCheckpoint,
      listCheckpoints: deps.listCheckpoints,
      restoreCheckpoint: deps.restoreCheckpoint,
      rebuildFromTimeline: deps.rebuildFromTimeline,
      consistencyCheck: deps.consistencyCheck,
      scanForCorruption: deps.scanForCorruption,
      repairJSON: deps.repairJSON,
      repairJSONL: deps.repairJSONL,
      dryRunMigration: deps.dryRunMigration,
      migrations: deps.migrations,
      lockMetrics: deps.lockMetrics,
      checkTerminalHealth: deps.checkTerminalHealth,
      suggestRecovery: deps.suggestRecovery,
      validateHooks: deps.validateHooks,
      runHookSelftest: deps.runHookSelftest,
      listBackups: deps.listBackups,
      restoreFromBackup: deps.restoreFromBackup,
      outputStream: deps.outputStream || null,
    };
  };
}
