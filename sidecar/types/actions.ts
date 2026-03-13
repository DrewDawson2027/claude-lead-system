export interface ActionAuditRecord {
  action_id: string;
  action: string;
  team_name?: string | null;
  route_mode?: string;
  route_reason?: string;
  state?: "pending" | "inflight" | "done" | "failed" | string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  retry_count?: number;
  fallback_history?: string[];
  payload_preview?: Record<string, unknown>;
}

export interface RoutedActionResult {
  ok: boolean;
  adapter: "native" | "coordinator";
  path_mode?: "bridge" | "native-direct" | "local-module" | string;
  route_mode?: string;
  route_reason?: string;
  reason?: string;
  fallback_plan?: string[];
  fallback_used?: boolean;
  fallback_from?: string | null;
  cost_estimate_class?: "low" | "medium" | "high" | string;
  latency_ms?: number;
  action_id?: string;
  result?: unknown;
  error?: unknown;
}
