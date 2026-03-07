export interface TeamSummary {
  team_name: string;
  execution_path?: "native" | "coordinator" | "hybrid" | string;
  low_overhead_mode?: "simple" | "advanced" | string;
  policy?: Record<string, unknown>;
}

export interface TeammateSummary {
  id?: string;
  display_name?: string;
  team_name?: string;
  role?: string;
  presence?: string;
  load_score?: number;
}

export interface TeamTaskSummary {
  task_id?: string;
  team_name?: string;
  status?: string;
  dispatch_status?: string;
  assignee?: string | null;
}

export interface SidecarSnapshotShape {
  schema_version?: number;
  generated_at: string | null;
  teams: TeamSummary[];
  teammates: TeammateSummary[];
  tasks: TeamTaskSummary[];
  timeline: Array<Record<string, unknown>>;
  adapters: Record<string, unknown>;
  policy_alerts: Array<Record<string, unknown>>;
  native: Record<string, unknown> | null;
  actions: { recent: Array<Record<string, unknown>> };
  alerts: Array<Record<string, unknown>>;
  metrics: Record<string, unknown> | null;
  ui: Record<string, unknown>;
}
