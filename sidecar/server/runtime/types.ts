/**
 * Type definitions for runtime module dependency-injection bags.
 *
 * Each runtime module receives its deps as a single object.
 * These interfaces type those bags so we can remove @ts-nocheck
 * without widening everything to `any`.
 */

import type http from "http";
import type https from "https";
import type { ParsedArgs } from "../types.js";

// ---------------------------------------------------------------------------
// Filesystem / IO function signatures
// ---------------------------------------------------------------------------

export type ReadFileSyncFn = (path: string | URL, encoding?: string) => string;
export type ReaddirSyncFn = (path: string) => string[];
export type WriteJSONFn = (path: string, data: unknown) => void;
export type ReadJSONFn = (path: string) => unknown;
export type FileExistsFn = (path: string) => boolean;
export type MkdirSyncFn = (
  path: string,
  opts?: { recursive?: boolean },
) => void;
export type UnlinkSyncFn = (path: string) => void;
export type AppendJSONLFn = (path: string, data: unknown) => void;

// ---------------------------------------------------------------------------
// Paths shape (subset of sidecarPaths() return)
// ---------------------------------------------------------------------------

export interface SidecarPaths {
  root: string;
  runtimeDir: string;
  stateDir: string;
  logsDir: string;
  diagnosticsDir: string;
  apiTokenFile: string;
  csrfTokenFile: string;
  lockFile: string;
  portFile: string;
  hooksDir: string;
  logFile: string;
  metricsHistoryDir: string;
  snapshotHistoryDir: string;
  nativeBridgeRequestDir: string;
  nativeBridgeResponseDir: string;
  nativeBridgeStatusFile: string;
  nativeBridgeHeartbeatFile: string;
  nativeBridgeValidationFile: string;
  nativeCapabilitiesFile: string;
  [key: string]: string; // allow additional path keys
}

// ---------------------------------------------------------------------------
// Store interface (SidecarStateStore)
// ---------------------------------------------------------------------------

export interface RuntimeStore {
  getSnapshot(): Record<string, unknown>;
  setSnapshot(snap: Record<string, unknown>): void;
  setNativeCapabilities(caps: Record<string, unknown>): void;
  setActionsRecent(actions: unknown[]): void;
  setMetrics(m: Record<string, unknown>): void;
  emitTimeline(evt: Record<string, unknown>): void;
  emitBridgeStatus(status: unknown): void;
  emitActionQueued(data: Record<string, unknown>): void;
  emitActionStarted(data: Record<string, unknown>): void;
  emitActionCompleted(data: Record<string, unknown>): void;
  emitActionFailed(data: Record<string, unknown>): void;
  raiseAlert(alert: Record<string, unknown>): void;
  on(event: string, handler: (payload: unknown) => void): void;
  snapshot: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ActionQueue interface
// ---------------------------------------------------------------------------

export interface RuntimeActionQueue {
  create(opts: Record<string, unknown>): {
    action_id: string;
    team_name?: string | null;
    [k: string]: unknown;
  };
  get(id: string): Record<string, unknown> | null;
  markStarted(id: string, meta: Record<string, unknown>): void;
  markCompleted(id: string, meta: Record<string, unknown>): void;
  markFailed(id: string, meta: Record<string, unknown>): void;
  recoverStaleInflight(thresholdMs: number): unknown[];
  sweep(opts: Record<string, number>): {
    pending: number;
    done: number;
    failed: number;
    requests?: number;
    responses?: number;
  };
  list(limit: number): unknown[];
  counts(): Record<string, number>;
}

// ---------------------------------------------------------------------------
// Metrics interface
// ---------------------------------------------------------------------------

export interface RuntimeMetrics {
  snapshot(): Record<string, unknown>;
  observeAction(data: {
    latency_ms: number;
    path_key: string;
    ok: boolean;
    fallback_used: boolean;
  }): void;
  persistSnapshot(dir: string): void;
}

// ---------------------------------------------------------------------------
// Adapter interfaces
// ---------------------------------------------------------------------------

export interface RuntimeCoordinatorAdapter {
  execute(action: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface RuntimeNativeAdapter {
  getStatus(): Promise<Record<string, unknown>>;
  execute(
    action: string | null,
    payload: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// ActionRouter interface
// ---------------------------------------------------------------------------

export interface RuntimeActionRouter {
  route(
    team: Record<string, unknown>,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// RateLimiter interface
// ---------------------------------------------------------------------------

export interface RuntimeRateLimiter {
  check(key: string): {
    ok: boolean;
    remaining?: number;
    retry_after_ms?: number;
  };
  gc(): void;
}

// ---------------------------------------------------------------------------
// LockMetrics interface
// ---------------------------------------------------------------------------

export interface RuntimeLockMetrics {
  snapshot(): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// bootstrap.ts deps
// ---------------------------------------------------------------------------

export interface ParseArgsResult extends ParsedArgs {}

export interface TokenFileData {
  token?: string;
  created_at?: string;
  rotated_at?: string;
  previous_rotated_at?: string;
}

export interface PermissionIssue {
  file: string;
  expected?: string;
  actual?: string;
  expected_uid?: number;
  actual_uid?: number;
  action: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// maintenance.ts deps
// ---------------------------------------------------------------------------

export interface MaintenanceSweepDeps {
  actionQueue: RuntimeActionQueue;
  paths: SidecarPaths;
  findStuckBridgeRequests: (
    paths: SidecarPaths,
    thresholdMs: number,
  ) => Array<any>;
  sweepBridgeQueues: (
    paths: SidecarPaths,
    opts: { requestMaxAgeMs: number; responseMaxAgeMs: number },
  ) => { requests: number; responses: number };
  store: RuntimeStore;
  rateLimiter: RuntimeRateLimiter;
  getAllTasksSnapshot: () => any;
  applyPriorityAging: (
    tasks: any[],
    opts: Record<string, unknown>,
  ) => {
    aged: string[];
    tasks: Array<{ task_id: string; priority: string; metadata: unknown }>;
  };
  getTeamsSnapshot: (fresh?: boolean) => any;
  shouldAutoRebalance: (
    teamSnap: any,
    config: any,
  ) => {
    trigger: boolean;
    reason?: string;
    conditions_met?: unknown;
    [k: string]: any;
  };
  coordinatorAdapter: RuntimeCoordinatorAdapter;
  metrics: RuntimeMetrics;
  createCheckpoint: (paths: SidecarPaths, label: string) => void;
  rotateCheckpoints: (paths: SidecarPaths) => void;
  checkTerminalHealth: (paths: SidecarPaths) => {
    summary: string;
    zombies: any[];
    stale: any[];
    dead_shells: any[];
    [k: string]: any;
  };
  suggestRecovery: (health: any) => any[];
  validateHooks: (hooksDir: string) => {
    all_valid: boolean;
    hooks: Array<{ name: string; issues: any[] }>;
  };
}

export interface MaintenanceSweepResult {
  source: string;
  recovered_inflight: number;
  action_gc: { pending: number; done: number; failed: number };
  bridge_gc: { requests: number; responses: number };
  stuck_bridge_requests: number;
  recovered: unknown[];
  aged_tasks: number;
  auto_rebalanced: boolean;
  checkpointed: boolean;
  terminal_health: string | null;
}

export interface DiagnosticsBundleDeps {
  store: RuntimeStore;
  paths: SidecarPaths;
  readJSON: ReadJSONFn;
  fileExists: FileExistsFn;
  actionQueue: RuntimeActionQueue;
  metrics: RuntimeMetrics;
  lockMetrics: RuntimeLockMetrics;
  checkTerminalHealth: (paths: SidecarPaths) => Record<string, unknown>;
  CURRENT_SCHEMA_VERSION: number;
  writeJSON: WriteJSONFn;
  trimLongStrings: (obj: unknown, maxLen: number) => unknown;
  appendJSONL: AppendJSONLFn;
}

export interface DiagnosticsResult {
  ok: boolean;
  file: string;
  generated_at: string;
  counts: Record<string, number>;
  checksum: string;
}

// ---------------------------------------------------------------------------
// rebuild.ts deps
// ---------------------------------------------------------------------------

export interface RebuildOpsDeps {
  store: RuntimeStore;
  nativeAdapter: RuntimeNativeAdapter;
  actionQueue: RuntimeActionQueue;
  metrics: RuntimeMetrics;
  buildSidecarSnapshot: () => Record<string, unknown>;
  paths: SidecarPaths;
  readdirSync: ReaddirSyncFn;
  mkdirSync: MkdirSyncFn;
  unlinkSync: UnlinkSyncFn;
  writeJSON: WriteJSONFn;
}

// ---------------------------------------------------------------------------
// actions.ts deps
// ---------------------------------------------------------------------------

export interface TrackedActionRunnerDeps {
  actionQueue: RuntimeActionQueue;
  store: RuntimeStore;
  metrics: RuntimeMetrics;
  nativeAdapter: RuntimeNativeAdapter;
  router: RuntimeActionRouter;
}

export interface TrackedActionInput {
  team: Record<string, unknown> | null;
  action: string;
  payload: Record<string, unknown>;
  routeMode?: string;
  nativeHttpAction?: string | null;
  trackedActionId?: string | null;
}

export interface BatchTriageDeps {
  store: RuntimeStore;
  findTeam: (snapshot: unknown, teamName: string) => Record<string, unknown>;
  buildTeamInterrupts: (opts: {
    snapshot: unknown;
    teamName: string;
    teamPolicy?: unknown;
  }) => Array<Record<string, unknown>>;
  runTrackedAction: (
    input: TrackedActionInput,
  ) => Promise<Record<string, unknown>>;
}

export interface BatchTriageInput {
  teamName: string;
  op: string;
  confirm?: boolean;
  message?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// lifecycle.ts deps
// ---------------------------------------------------------------------------

export interface BootRuntimeDeps {
  rebuild: (source: string) => Promise<void>;
  maintenanceSweep: (opts: { source: string }) => MaintenanceSweepResult;
  SAFE_MODE: boolean;
  store: RuntimeStore;
}

export interface HookStreamAdapterLike {
  new (
    paths: SidecarPaths,
    onChange: (evt: Record<string, unknown>) => void,
  ): {
    start(): void;
    stop(): void;
  };
}

export interface OutputStreamLike {
  startWatching(taskId: string, filePath: string, workerName?: string): void;
  stopWatching(taskId: string): void;
  getBuffer(taskId: string): string[];
  onOutput(callback: (data: OutputStreamEvent) => void): void;
  stopAll(): void;
  workers: Map<string, unknown>;
}

export interface OutputStreamEvent {
  task_id: string;
  worker_name: string;
  lines: string[];
  total_lines: number;
  timestamp: string;
}

export interface RuntimeLifecycleDeps {
  HookStreamAdapter: HookStreamAdapterLike;
  paths: SidecarPaths;
  store: RuntimeStore;
  rebuild: (source: string) => Promise<void>;
  maintenanceSweep: (opts: { source: string }) => MaintenanceSweepResult;
  clients: Set<http.ServerResponse>;
  sseBroadcast: (
    clients: Set<http.ServerResponse>,
    event: string,
    data: unknown,
  ) => void;
  outputStream?: OutputStreamLike;
}

// ---------------------------------------------------------------------------
// team-utils.ts — interrupt shape
// ---------------------------------------------------------------------------

export interface TeamInterrupt {
  id: string;
  kind: string;
  severity: string;
  code: string;
  teammate_id?: string;
  teammate_name?: string;
  task_id?: string | null;
  session_id?: string | null;
  title: string;
  message: string;
  suggested_actions: string[];
  safe_auto: boolean;
  created_at: string | null;
  action_id?: string | null;
  request_id?: string | null;
  priority_score?: number;
  rank?: number;
  [key: string]: unknown;
}
