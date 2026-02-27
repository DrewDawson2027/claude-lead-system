export type SecurityEventType = 'auth_failure' | 'origin_reject' | 'csrf_failure' | 'rate_limit';

export interface SecurityEvent {
  type: SecurityEventType;
  ip: string;
  path: string;
  origin?: string;
  request_id?: string;
  ts: string;
}

export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  request_id: string;
  ip: string;
  duration_ms: number;
  ts: string;
}

export class RequestAuditLog {
  private buffer: RequestLogEntry[];
  private maxEntries: number;
  private auditAll: boolean;
  private mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  constructor({ maxEntries = 1000, auditAll = false } = {}) {
    this.buffer = [];
    this.maxEntries = maxEntries;
    this.auditAll = auditAll;
  }

  log(entry: Omit<RequestLogEntry, 'ts'>): void {
    if (!this.auditAll && !this.mutationMethods.has(entry.method)) return;
    const full: RequestLogEntry = { ...entry, ts: new Date().toISOString() };
    this.buffer.push(full);
    if (this.buffer.length > this.maxEntries) {
      this.buffer = this.buffer.slice(-this.maxEntries);
    }
  }

  entries(limit = 100): RequestLogEntry[] {
    return this.buffer.slice(-limit);
  }

  snapshot(): { total: number; recent: RequestLogEntry[]; by_method: Record<string, number>; by_status: Record<string, number> } {
    const byMethod: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const e of this.buffer) {
      byMethod[e.method] = (byMethod[e.method] || 0) + 1;
      const bucket = `${Math.floor(e.status / 100)}xx`;
      byStatus[bucket] = (byStatus[bucket] || 0) + 1;
    }
    return { total: this.buffer.length, recent: this.buffer.slice(-20), by_method: byMethod, by_status: byStatus };
  }
}

export class SecurityAuditLog {
  private buffer: SecurityEvent[];
  private maxEntries: number;
  private maxPerSec: number;
  private recentCount: number;
  private recentWindowStart: number;

  constructor({ maxEntries = 500, maxPerSec = 10 } = {}) {
    this.buffer = [];
    this.maxEntries = maxEntries;
    this.maxPerSec = maxPerSec;
    this.recentCount = 0;
    this.recentWindowStart = Date.now();
  }

  log(event: Omit<SecurityEvent, 'ts'>): void {
    const now = Date.now();
    if (now - this.recentWindowStart > 1000) {
      this.recentCount = 0;
      this.recentWindowStart = now;
    }
    if (this.recentCount >= this.maxPerSec) return;
    this.recentCount += 1;
    const entry: SecurityEvent = { ...event, ts: new Date(now).toISOString() };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer = this.buffer.slice(-this.maxEntries);
    }
  }

  entries(limit = 100): SecurityEvent[] {
    return this.buffer.slice(-limit);
  }

  snapshot(): { total: number; recent: SecurityEvent[]; by_type: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.buffer) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { total: this.buffer.length, recent: this.buffer.slice(-20), by_type: byType };
  }
}
