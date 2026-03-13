import { existsSync, watch } from "fs";

export class HookStreamAdapter {
  constructor(paths, onChange) {
    this.paths = paths;
    this.onChange = onChange;
    this.watchers = [];
    this.interval = null;
    this.lastTick = 0;
  }

  start() {
    const dirs = [
      this.paths.terminalsDir,
      this.paths.teamsDir,
      this.paths.tasksDir,
      this.paths.resultsDir,
    ].filter(Boolean);
    let watcherCount = 0;
    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) continue;
        const w = watch(dir, { persistent: false }, () =>
          this.bump("fs.watch"),
        );
        this.watchers.push(w);
        watcherCount += 1;
      } catch {
        // Fall back to polling only.
      }
    }
    const pollMs = Number(
      process.env[
      watcherCount > 0
        ? "LEAD_SIDECAR_HOOK_POLL_MS"
        : "LEAD_SIDECAR_HOOK_POLL_FALLBACK_MS"
      ] || (watcherCount > 0 ? 30_000 : 1_000),
    );
    this.interval = setInterval(() => this.bump("poll"), pollMs);
    try {
      this.interval.unref();
    } catch { }
  }

  bump(source) {
    const now = Date.now();
    if (now - this.lastTick < 200) return;
    this.lastTick = now;
    this.onChange?.({ source, ts: new Date().toISOString() });
  }

  stop() {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch { }
    }
    this.watchers = [];
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
