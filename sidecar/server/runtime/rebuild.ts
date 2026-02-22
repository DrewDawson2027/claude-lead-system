// @ts-nocheck
export function createRebuildOps({ store, nativeAdapter, actionQueue, metrics, buildSidecarSnapshot, paths, readdirSync, mkdirSync, unlinkSync, writeJSON }) {
  let rebuilding = false;

  async function enrichDynamicState() {
    const nativeStatus = await nativeAdapter.getStatus().catch((err) => ({ adapter_ok: false, mode: 'unavailable', error: err.message }));
    store.setNativeCapabilities({
      ...(nativeStatus.native || { available: false, last_probe_error: nativeStatus.error || null }),
      validation: nativeStatus.bridge_validation || null,
    });
    if (nativeStatus.bridge) store.emitBridgeStatus(nativeStatus.bridge);
    store.setActionsRecent(actionQueue.list(50));
    store.setMetrics(metrics.snapshot());
  }

  async function rebuild(source = 'manual') {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const base = buildSidecarSnapshot();
      await enrichDynamicState();
      store.setSnapshot({
        ...base,
        native: store.getSnapshot().native,
        actions: store.getSnapshot().actions,
        alerts: store.getSnapshot().alerts,
        metrics: store.getSnapshot().metrics,
      });
      store.emitTimeline({ type: 'snapshot.rebuilt', source, generated_at: base.generated_at });
      try {
        mkdirSync(paths.snapshotHistoryDir, { recursive: true });
        writeJSON(`${paths.snapshotHistoryDir}/snap-${Date.now()}.json`, store.getSnapshot());
        const histFiles = readdirSync(paths.snapshotHistoryDir).filter((f) => f.startsWith('snap-')).sort();
        if (histFiles.length > 50) {
          for (const f of histFiles.slice(0, histFiles.length - 50)) {
            try { unlinkSync(`${paths.snapshotHistoryDir}/${f}`); } catch {}
          }
        }
      } catch {}
    } finally {
      rebuilding = false;
    }
  }

  return { rebuild, enrichDynamicState };
}
