/**
 * Garbage collection: auto-clean old results, sessions, and pipeline artifacts.
 * @module gc
 */

import { readdirSync, readFileSync, statSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";

/**
 * Remove stale/closed sessions, completed worker results, and finished pipelines
 * older than GC_MAX_AGE_MS (default 24h).
 * @returns {{ sessions: number, results: number, pipelines: number }} Counts of removed items
 */
export function runGC() {
  const { TERMINALS_DIR, RESULTS_DIR, GC_MAX_AGE_MS } = cfg();
  const cutoff = Date.now() - GC_MAX_AGE_MS;
  let sessions = 0, results = 0, pipelines = 0;

  // Clean old session files (stale/closed only)
  try {
    for (const f of readdirSync(TERMINALS_DIR)) {
      if (!f.startsWith("session-") || !f.endsWith(".json")) continue;
      const fp = join(TERMINALS_DIR, f);
      try {
        const mtime = statSync(fp).mtimeMs;
        if (mtime > cutoff) continue;
        const data = JSON.parse(readFileSync(fp, "utf-8"));
        if (data.status === "stale" || data.status === "closed") {
          unlinkSync(fp);
          sessions++;
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* TERMINALS_DIR may not exist yet */ }

  // Clean old worker results (completed only)
  try {
    for (const f of readdirSync(RESULTS_DIR)) {
      const fp = join(RESULTS_DIR, f);
      try {
        const st = statSync(fp);
        if (st.mtimeMs > cutoff) continue;

        // For directories (pipelines), check for pipeline.done
        if (st.isDirectory()) {
          const donePath = join(fp, "pipeline.done");
          try {
            statSync(donePath);
            rmSync(fp, { recursive: true, force: true });
            pipelines++;
          } catch { /* pipeline not done, skip */ }
          continue;
        }

        // For files, only remove completed workers (those with .meta.json.done)
        if (f.endsWith(".meta.json.done")) {
          const taskId = f.replace(".meta.json.done", "");
          for (const ext of [".txt", ".meta.json", ".meta.json.done", ".prompt", ".pid", ".worker.ps1"]) {
            try { unlinkSync(join(RESULTS_DIR, taskId + ext)); } catch { /* may not exist */ }
          }
          results++;
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* RESULTS_DIR may not exist yet */ }

  return { sessions, results, pipelines };
}
