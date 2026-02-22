export interface NativeCapabilityState {
  available: boolean;
  mode?: 'bridge' | 'ephemeral' | 'unavailable' | string;
  tools?: {
    TeamCreate?: boolean;
    TeamStatus?: boolean;
    SendMessage?: boolean;
    Task?: boolean;
  };
  last_probe_at?: string | null;
  last_probe_error?: string | null;
  confidence?: 'high' | 'medium' | 'low' | string;
  bridge_status?: 'healthy' | 'starting' | 'stale' | 'degraded' | 'down' | string;
}

export interface NativeBridgeValidationReport {
  ok: boolean;
  simulated?: boolean;
  diagnostics?: Record<string, unknown>;
  latency_ms?: number;
}
