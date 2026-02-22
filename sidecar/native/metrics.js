import { writeFileSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class MetricsTracker {
  constructor(maxSamples = 500) {
    this.maxSamples = maxSamples;
    this._lastPersistTs = 0;
    this.samples = {
      action_latency_ms: [],
      by_path: {},
      counts: { success: 0, failure: 0, fallback: 0 },
    };
  }

  _push(arr, value) {
    arr.push(value);
    if (arr.length > this.maxSamples) arr.splice(0, arr.length - this.maxSamples);
  }

  observeAction({ latency_ms, path_key, ok = true, fallback_used = false }) {
    if (Number.isFinite(latency_ms) && latency_ms >= 0) {
      this._push(this.samples.action_latency_ms, latency_ms);
      const bucket = this.samples.by_path[path_key || 'unknown'] || (this.samples.by_path[path_key || 'unknown'] = []);
      this._push(bucket, latency_ms);
    }
    if (ok) this.samples.counts.success += 1;
    else this.samples.counts.failure += 1;
    if (fallback_used) this.samples.counts.fallback += 1;
  }

  _percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  snapshot() {
    const out = {
      counts: { ...this.samples.counts },
      action_latency_ms: {
        p50: this._percentile(this.samples.action_latency_ms, 50),
        p95: this._percentile(this.samples.action_latency_ms, 95),
        sample_size: this.samples.action_latency_ms.length,
      },
      by_path: {},
      generated_at: new Date().toISOString(),
    };
    for (const [k, vals] of Object.entries(this.samples.by_path)) {
      out.by_path[k] = {
        p50: this._percentile(vals, 50),
        p95: this._percentile(vals, 95),
        sample_size: vals.length,
      };
    }
    return out;
  }

  persistSnapshot(dir, throttleMs = 60000) {
    const now = Date.now();
    if (now - this._lastPersistTs < throttleMs) return null;
    this._lastPersistTs = now;
    try {
      mkdirSync(dir, { recursive: true });
      const snap = this.snapshot();
      const file = join(dir, `metrics-${now}.json`);
      writeFileSync(file, JSON.stringify(snap));
      return file;
    } catch { return null; }
  }

  static loadHistory(dir, maxEntries = 100) {
    try {
      const files = readdirSync(dir)
        .filter(f => f.startsWith('metrics-') && f.endsWith('.json'))
        .sort()
        .slice(-maxEntries);
      return files.map(f => {
        try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')); } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  static diffSnapshots(a, b) {
    if (!a || !b) return null;
    const delta = (x, y) => y != null && x != null ? +(y - x).toFixed(4) : null;
    return {
      counts: {
        success: delta(a.counts?.success, b.counts?.success),
        failure: delta(a.counts?.failure, b.counts?.failure),
        fallback: delta(a.counts?.fallback, b.counts?.fallback),
      },
      action_latency_ms: {
        p50_delta: delta(a.action_latency_ms?.p50, b.action_latency_ms?.p50),
        p95_delta: delta(a.action_latency_ms?.p95, b.action_latency_ms?.p95),
      },
      from: a.generated_at,
      to: b.generated_at,
    };
  }
}
