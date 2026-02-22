// @ts-nocheck
export async function bootRuntime({ rebuild, maintenanceSweep, SAFE_MODE, store }) {
  await rebuild('boot');
  maintenanceSweep({ source: 'startup' });
  if (SAFE_MODE) store.emitTimeline({ type: 'startup.safe_mode', timestamp: new Date().toISOString() });
}

export function startRuntimeLifecycle({ HookStreamAdapter, paths, store, rebuild, maintenanceSweep, clients, sseBroadcast }) {
  const hookStream = new HookStreamAdapter(paths, (evt) => {
    store.emitTimeline({ type: 'filesystem.change', ...evt });
    rebuild(evt.source).catch(() => {});
  });
  hookStream.start();

  const maintenanceTimer = setInterval(() => {
    try { maintenanceSweep({ source: 'interval' }); } catch {}
  }, Number(process.env.LEAD_SIDECAR_MAINTENANCE_MS || 15_000));
  if (typeof maintenanceTimer.unref === 'function') maintenanceTimer.unref();

  store.on('snapshot', (snap) => {
    sseBroadcast(clients, 'team.updated', { teams: snap.teams || [], generated_at: snap.generated_at });
    sseBroadcast(clients, 'teammate.updated', { teammates: snap.teammates || [], generated_at: snap.generated_at });
    sseBroadcast(clients, 'task.updated', { tasks: snap.tasks || [], generated_at: snap.generated_at });
    sseBroadcast(clients, 'timeline.event', { latest: (snap.timeline || []).slice(-10), generated_at: snap.generated_at });
  });
  for (const evt of ['adapter.health', 'policy.alert', 'timeline.event', 'native.capabilities.updated', 'native.bridge.status', 'action.queued', 'action.started', 'action.completed', 'action.failed', 'alert.raised', 'metrics.updated']) {
    store.on(evt, (payload) => sseBroadcast(clients, evt, payload));
  }

  return {
    hookStream,
    maintenanceTimer,
    stop() {
      hookStream.stop();
      try { clearInterval(maintenanceTimer); } catch {}
    },
  };
}
