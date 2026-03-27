import { join } from "path";
import type { BootRuntimeDeps, RuntimeLifecycleDeps } from "./types.js";

export async function bootRuntime({
  rebuild,
  maintenanceSweep,
  SAFE_MODE,
  store,
}: BootRuntimeDeps): Promise<void> {
  await rebuild("boot");
  maintenanceSweep({ source: "startup" });
  if (SAFE_MODE)
    store.emitTimeline({
      type: "startup.safe_mode",
      timestamp: new Date().toISOString(),
    });
}

export function startRuntimeLifecycle({
  HookStreamAdapter,
  paths,
  store,
  rebuild,
  maintenanceSweep,
  clients,
  sseBroadcast,
  outputStream,
}: RuntimeLifecycleDeps) {
  const hookStream = new HookStreamAdapter(paths, (evt) => {
    store.emitTimeline({ type: "filesystem.change", ...evt });
    rebuild(String(evt.source || "fs")).catch(() => {});
  });
  hookStream.start();

  const maintenanceTimer = setInterval(
    () => {
      try {
        maintenanceSweep({ source: "interval" });
      } catch {}
    },
    Number(process.env.LEAD_SIDECAR_MAINTENANCE_MS || 60_000),
  );
  if (typeof maintenanceTimer.unref === "function") maintenanceTimer.unref();

  // Wire OutputStreamManager: broadcast worker output deltas via SSE
  if (outputStream) {
    outputStream.onOutput((data) =>
      sseBroadcast(clients, "worker.output", data),
    );
  }

  // Track which task IDs the output stream is watching
  const watchedTaskIds = new Set<string>();

  store.on("snapshot", (snap: any) => {
    sseBroadcast(clients, "team.updated", {
      teams: snap.teams || [],
      generated_at: snap.generated_at,
    });
    sseBroadcast(clients, "teammate.updated", {
      teammates: snap.teammates || [],
      generated_at: snap.generated_at,
    });
    sseBroadcast(clients, "task.updated", {
      tasks: snap.tasks || [],
      generated_at: snap.generated_at,
    });
    sseBroadcast(clients, "timeline.event", {
      latest: (snap.timeline || []).slice(-10),
      generated_at: snap.generated_at,
    });

    // Diff active tasks and update output stream watchers
    if (outputStream) {
      const teammates: any[] = snap.teammates || [];
      const activeTaskIds = new Set<string>();
      for (const t of teammates) {
        const taskId = t.current_task_ref || t.worker_task_id;
        if (taskId) activeTaskIds.add(taskId);
      }

      // Start watching new tasks
      for (const taskId of activeTaskIds) {
        if (!watchedTaskIds.has(taskId)) {
          const pathsData = paths as unknown as Record<string, unknown>;
          const resultsDir =
            (pathsData.resultsDir as string | undefined) ||
            join(
              String(pathsData.root as string | undefined || ""),
              "..",
              "terminals",
              "results",
            );
          const filePath = join(resultsDir, `${taskId}.txt`);
          const teammate = teammates.find(
            (t: any) => (t.current_task_ref || t.worker_task_id) === taskId,
          );
          const workerName = teammate?.name || teammate?.worker_name || taskId;
          outputStream.startWatching(taskId, filePath, workerName);
          watchedTaskIds.add(taskId);
        }
      }

      // Stop watching completed tasks
      for (const taskId of watchedTaskIds) {
        if (!activeTaskIds.has(taskId)) {
          outputStream.stopWatching(taskId);
          watchedTaskIds.delete(taskId);
        }
      }
    }
  });
  for (const evt of [
    "adapter.health",
    "policy.alert",
    "timeline.event",
    "native.capabilities.updated",
    "native.bridge.status",
    "action.queued",
    "action.started",
    "action.completed",
    "action.failed",
    "alert.raised",
    "metrics.updated",
  ]) {
    store.on(evt, (payload) => sseBroadcast(clients, evt, payload));
  }

  return {
    hookStream,
    maintenanceTimer,
    stop() {
      hookStream.stop();
      if (outputStream) outputStream.stopAll();
      try {
        clearInterval(maintenanceTimer);
      } catch {}
    },
  };
}
