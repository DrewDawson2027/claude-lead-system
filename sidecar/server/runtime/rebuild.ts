import type { RebuildOpsDeps } from "./types.js";

export function createRebuildOps({
  store,
  nativeAdapter,
  actionQueue,
  metrics,
  buildSidecarSnapshot,
  paths,
  readdirSync,
  mkdirSync,
  unlinkSync,
  writeJSON,
}: RebuildOpsDeps) {
  let rebuilding = false;

  async function enrichDynamicState() {
    const nativeStatus: any = await nativeAdapter
      .getStatus()
      .catch((err: any) => ({
        adapter_ok: false,
        mode: "unavailable",
        error: err.message,
      }));
    store.setNativeCapabilities({
      ...(nativeStatus.native || {
        available: false,
        last_probe_error: nativeStatus.error || null,
      }),
      validation: nativeStatus.bridge_validation || null,
    });
    if (nativeStatus.bridge) store.emitBridgeStatus(nativeStatus.bridge);
    store.setActionsRecent(actionQueue.list(50));
    store.setMetrics(metrics.snapshot());
  }

  async function rebuild(source = "manual") {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const rebuiltAt = new Date().toISOString();
      const base = buildSidecarSnapshot();
      await enrichDynamicState();
      const snapshotData = store.getSnapshot() as unknown as Record<string, unknown>;
      const nativeSnapshot = snapshotData.native as unknown as Record<string, unknown>;
      store.setSnapshot({
        ...base,
        native: store.getSnapshot().native,
        actions: store.getSnapshot().actions,
        alerts: store.getSnapshot().alerts,
        metrics: store.getSnapshot().metrics,
        focused_teammate_live: {
          sidecar_live_at: rebuiltAt,
          native_available: Boolean(
            (nativeSnapshot as Record<string, unknown>)?.adapter_ok ?? ((nativeSnapshot as Record<string, unknown>)?.native as Record<string, unknown>)?.available,
          ),
          stream_fallback_order: ["native live", "sidecar live", "tmux mirror"],
          route_mode_preference: ["native-live", "sidecar-live", "tmux-mirror"],
          stale_after_ms: 6000,
          source_truth:
            "focused teammate view mirrors adapter/runtime/terminal sources",
          parity_note:
            "in-process native teammate rendering is unavailable; sidecar mirrors live state",
        },
      });
      store.emitTimeline({
        type: "snapshot.rebuilt",
        source,
        generated_at: base.generated_at,
        sidecar_live_at: rebuiltAt,
      });
      try {
        mkdirSync(paths.snapshotHistoryDir, { recursive: true });
        writeJSON(
          `${paths.snapshotHistoryDir}/snap-${Date.now()}.json`,
          store.getSnapshot(),
        );
        const histFiles = readdirSync(paths.snapshotHistoryDir)
          .filter((f) => f.startsWith("snap-"))
          .sort();
        if (histFiles.length > 50) {
          for (const f of histFiles.slice(0, histFiles.length - 50)) {
            try {
              unlinkSync(`${paths.snapshotHistoryDir}/${f}`);
            } catch {}
          }
        }
      } catch {}
    } finally {
      rebuilding = false;
    }
  }

  return { rebuild, enrichDynamicState };
}
