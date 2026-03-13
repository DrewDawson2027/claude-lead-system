/**
 * Shared type definitions for the sidecar server.
 *
 * These types flow through create-server → middleware → routes
 * and give the full router + route handler chain proper type coverage.
 */

import type http from "http";
import type https from "https";
import type { ChildProcess } from "child_process";
import type { SecurityAuditLog, RequestAuditLog } from "./http/audit.js";

// ---------------------------------------------------------------------------
// CLI / bootstrap args
// ---------------------------------------------------------------------------

export interface ParsedArgs {
    port: number;
    open: boolean;
    safeMode?: boolean;
    rotateCsrf?: boolean;
    unixSocket?: string;
    tlsCertFile?: string;
    tlsKeyFile?: string;
    tlsCaFile?: string;
    mtls?: boolean;
}

// ---------------------------------------------------------------------------
// TLS config resolved from args + env
// ---------------------------------------------------------------------------

export interface TlsConfig {
    enabled: boolean;
    keyFile: string;
    certFile: string;
    caFile: string;
    mtlsRequired: boolean;
}

// ---------------------------------------------------------------------------
// Rate-limiter / replay-protector return shapes
// ---------------------------------------------------------------------------

export interface RateLimitResult {
    ok: boolean;
    remaining?: number;
    retry_after_ms?: number;
}

export interface RateLimiter {
    check(key: string): RateLimitResult;
    gc(): void;
}

export interface ReplayCheckResult {
    ok: boolean;
    error?: string;
}

export interface ReplayProtector {
    check(req: http.IncomingMessage, pathname: string): ReplayCheckResult;
    gc(): void;
}

// ---------------------------------------------------------------------------
// Bound response helpers (baseHeaders already captured)
// ---------------------------------------------------------------------------

export type SendJsonFn = (
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    req?: http.IncomingMessage | null,
) => void;

export type SendTextFn = (
    res: http.ServerResponse,
    status: number,
    body: string,
    req?: http.IncomingMessage | null,
) => void;

export type SendHtmlFn = SendTextFn;
export type SendJsFn = SendTextFn;

export type SendErrorFn = (
    res: http.ServerResponse,
    status: number,
    errorCode: string,
    message: string,
    req?: http.IncomingMessage | null,
    details?: unknown,
) => void;

export type ReadBodyFn = (
    req: http.IncomingMessage,
    opts?: { limitBytes?: number },
) => Promise<Record<string, unknown>>;

export type ValidateBodyFn = (
    pathname: string,
    body: Record<string, unknown>,
) => { ok: true; value?: unknown } | { ok: false; status: number; error: string; error_code?: string };

export type BaseHeadersFn = (
    req?: http.IncomingMessage | null,
) => Record<string, string>;

// ---------------------------------------------------------------------------
// Bound security helpers
// ---------------------------------------------------------------------------

export type RequireAuthFn = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
) => boolean;

// ---------------------------------------------------------------------------
// Route context: the bag of deps + state every route handler receives
// ---------------------------------------------------------------------------

export interface RouteContext {
    // Core HTTP
    req: http.IncomingMessage;
    res: http.ServerResponse;
    url: URL;
    routeMeta: Record<string, unknown>;
    snapshot: Record<string, unknown>;

    // Server & SSE
    server: http.Server | https.Server;
    clients: Set<http.ServerResponse>;

    // Infrastructure
    paths: Record<string, string>;
    store: unknown; // SidecarStateStore (JS class, untyped)
    metrics: unknown;
    actionQueue: unknown;
    coordinatorAdapter: unknown;
    nativeAdapter: unknown;
    router: unknown; // ActionRouter (JS class, untyped)

    // Flags
    SAFE_MODE: boolean;
    apiToken: string | null;
    csrfToken: string;
    DASHBOARD_HTML: string;
    DASHBOARD_JS: string;
    processInfo: { pid: number };

    // Audit logs
    securityAuditLog: SecurityAuditLog;
    requestAuditLog: RequestAuditLog;

    // Token rotation
    rotateApiToken: () => { new_token: string; rotated_at: string };
    filePermissions: { ok: boolean; issues: Array<Record<string, unknown>> };

    // Response helpers (bound)
    baseHeaders: BaseHeadersFn;
    sendJson: SendJsonFn;
    sendText: SendTextFn;
    sendHtml: SendHtmlFn;
    sendJs: SendJsFn;
    sendError: SendErrorFn;
    readBody: ReadBodyFn;
    validateBody: ValidateBodyFn;
    bodyLimitForRoute: (pathname: string) => number;

    // Team/action helpers
    findTeam: (snapshot: unknown, teamName: string) => Record<string, unknown>;
    buildActionPayload: (
        teamName: string,
        action: string,
        body: Record<string, unknown>,
    ) => Record<string, unknown>;
    buildTeamInterrupts: (opts: {
        snapshot: unknown;
        teamName: string;
        teamPolicy?: unknown | null;
    }) => unknown[];
    mapNativeHttpAction: (httpAction: string) => string | null;

    // Operations
    maintenanceSweep: (opts: { source: string }) => unknown;
    diagnosticsBundle: unknown;
    rebuild: (source?: string) => Promise<void>;
    runTrackedAction: unknown;
    runBatchTriage: unknown;

    // FS / utilities passed through
    latestJsonFileName: (dir: string) => string | null;
    pathResolve: (...segments: string[]) => string;
    spawn: (
        cmd: string,
        args: string[],
        opts?: Record<string, unknown>,
    ) => ChildProcess;
    writeFileSync: (path: string, data: string | Buffer) => void;
    writeJSON: (path: string, data: unknown) => void;
    writeJsonFile: (path: string, data: unknown) => void;
    readJSON: (path: string) => unknown;
    readJSONL: (path: string) => unknown[];
    readFileSync: (path: string | URL, encoding?: string) => string;
    readdirSync: (path: string) => string[];
    MetricsTracker: unknown;

    // Schema / migration
    CURRENT_SCHEMA_VERSION: number;
    migrateBundle: (...args: any[]) => any;
    validateSchemaVersion: (...args: any[]) => any;
    currentApiVersion: () => string;
    legacyDeprecationHeaders: (routeMeta: unknown) => Record<string, string | undefined>;
    buildComparisonReport: (...args: any[]) => any;

    // Snapshots
    loadSnapshotHistory: (...args: any[]) => any;
    snapshotDiff: (...args: any[]) => any;
    replayTimeline: (...args: any[]) => any;
    buildTimelineReport: (...args: any[]) => any;

    // Checkpoints
    createCheckpoint: (...args: any[]) => any;
    listCheckpoints: (...args: any[]) => any;
    restoreCheckpoint: (...args: any[]) => any;

    // Event replay
    rebuildFromTimeline: (...args: any[]) => any;
    consistencyCheck: (...args: any[]) => any;

    // Repair
    scanForCorruption: (...args: any[]) => any;
    repairJSON: (...args: any[]) => any;
    repairJSONL: (...args: any[]) => any;
    dryRunMigration: (...args: any[]) => any;
    migrations: unknown;

    // Misc
    lockMetrics: unknown;
    checkTerminalHealth: (...args: any[]) => any;
    suggestRecovery: (...args: any[]) => any;
    validateHooks: (...args: any[]) => any;
    runHookSelftest: (...args: any[]) => any;
    listBackups: (...args: any[]) => any;
    restoreFromBackup: (...args: any[]) => any;
}

// ---------------------------------------------------------------------------
// Server return value
// ---------------------------------------------------------------------------

export interface SidecarServerInstance {
    server: http.Server | https.Server;
    port: number | null;
    readonly apiToken: string | null;
    store: unknown;
    router: unknown;
    nativeAdapter: unknown;
    actionQueue: unknown;
    metrics: unknown;
    close: () => void;
    maintenanceSweep: (opts: { source: string }) => unknown;
    diagnosticsBundle: unknown;
}

// ---------------------------------------------------------------------------
// Middleware result
// ---------------------------------------------------------------------------

export type MiddlewareVerdict = "continue" | "handled";
