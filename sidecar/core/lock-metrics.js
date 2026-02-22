/**
 * Lock contention metrics — tracks lock acquisition attempts, wait times, collisions.
 */

export class LockMetrics {
  constructor(maxSamples = 200) {
    this.maxSamples = maxSamples;
    this.locks = {};
  }

  /**
   * Record a lock acquisition attempt.
   * @param {string} lockName - lock identifier (usually basename of lock file)
   * @param {number} waitMs - time spent waiting for lock
   * @param {boolean} acquired - whether lock was successfully acquired
   */
  recordAttempt(lockName, waitMs, acquired) {
    if (!this.locks[lockName]) {
      this.locks[lockName] = { attempts: 0, acquisitions: 0, failures: 0, wait_times: [] };
    }
    const entry = this.locks[lockName];
    entry.attempts++;
    if (acquired) entry.acquisitions++;
    else entry.failures++;
    if (Number.isFinite(waitMs) && waitMs >= 0) {
      entry.wait_times.push(waitMs);
      if (entry.wait_times.length > this.maxSamples) {
        entry.wait_times.splice(0, entry.wait_times.length - this.maxSamples);
      }
    }
  }

  /**
   * Compute percentile from sorted array.
   */
  _percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  /**
   * Get lock metrics snapshot.
   * @returns {{ locks: object, hot_paths: Array<{ name: string, avg_wait_ms: number }> }}
   */
  snapshot() {
    const lockStats = {};
    const summaries = [];

    for (const [name, entry] of Object.entries(this.locks)) {
      const sorted = [...entry.wait_times].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
      const stats = {
        attempts: entry.attempts,
        acquisitions: entry.acquisitions,
        failures: entry.failures,
        collisions: entry.failures,
        avg_wait_ms: +avg.toFixed(2),
        max_wait_ms: sorted.length ? sorted[sorted.length - 1] : 0,
        p95_wait_ms: this._percentile(sorted, 95),
        sample_count: sorted.length,
      };
      lockStats[name] = stats;
      summaries.push({ name, avg_wait_ms: stats.avg_wait_ms, max_wait_ms: stats.max_wait_ms });
    }

    // Top 3 by max wait time
    summaries.sort((a, b) => b.max_wait_ms - a.max_wait_ms);
    const hot_paths = summaries.slice(0, 3);

    return { locks: lockStats, hot_paths };
  }

  reset() {
    this.locks = {};
  }
}

// Singleton instance shared across the process
export const lockMetrics = new LockMetrics();
