// @ts-nocheck
export function createTrackedActionRunner({ actionQueue, store, metrics, nativeAdapter, router }) {
  return async function runTrackedAction({ team, action, payload, routeMode = 'router', nativeHttpAction = null, trackedActionId = null }) {
    const teamName = team?.team_name || payload?.team_name || null;
    const record = trackedActionId
      ? { ...(actionQueue.get(trackedActionId) || {}), action_id: trackedActionId, team_name: teamName, action, route_mode: routeMode, payload_preview: payload }
      : actionQueue.create({ team_name: teamName, action, route_mode: routeMode, payload_preview: payload });
    if (trackedActionId && !record?.action_id) throw new Error(`Action ${trackedActionId} not found`);
    store.emitActionQueued({ action_id: record.action_id, action, team_name: record.team_name, route_mode: routeMode });
    actionQueue.markStarted(record.action_id, { team_name: record.team_name, action, route_mode: routeMode, payload_preview: payload });
    store.emitActionStarted({ action_id: record.action_id, action, team_name: record.team_name, route_mode: routeMode });
    const start = Date.now();
    try {
      const routed = routeMode === 'native-direct'
        ? await nativeAdapter.execute(nativeHttpAction, { ...payload, correlation_id: record.action_id }, { team, force_path_mode: payload?.force_path_mode || null })
        : await router.route(team, action, { ...payload, correlation_id: record.action_id });
      const latency_ms = Date.now() - start;
      const wrapper = routeMode === 'native-direct'
        ? {
          ok: routed?.ok !== false,
          adapter: 'native',
          path_mode: routed.path_mode || 'ephemeral',
          reason: 'native direct action endpoint',
          fallback_plan: ['native-bridge', 'native-ephemeral', 'coordinator'],
          fallback_used: false,
          cost_estimate_class: routed.path_mode === 'bridge' ? 'medium' : 'high',
          latency_ms,
          result: routed,
        }
        : { ...routed, latency_ms: routed.latency_ms ?? latency_ms };

      const ok = wrapper.ok !== false;
      metrics.observeAction({ latency_ms: wrapper.latency_ms, path_key: `${wrapper.adapter}:${wrapper.path_mode || 'unknown'}`, ok, fallback_used: Boolean(wrapper.fallback_used) });

      if (ok) {
        actionQueue.markCompleted(record.action_id, {
          adapter: wrapper.adapter,
          path_mode: wrapper.path_mode,
          latency_ms: wrapper.latency_ms,
          result_summary: wrapper.result?.text ? String(wrapper.result.text).slice(0, 1000) : wrapper.result,
          fallback_used: Boolean(wrapper.fallback_used),
          fallback_history: wrapper.fallback_used ? [wrapper.fallback_from || null].filter(Boolean) : [],
        });
        store.emitActionCompleted({ action_id: record.action_id, action, adapter: wrapper.adapter, path_mode: wrapper.path_mode, latency_ms: wrapper.latency_ms, fallback_used: wrapper.fallback_used });
      } else {
        actionQueue.markFailed(record.action_id, { adapter: wrapper.adapter, path_mode: wrapper.path_mode, latency_ms: wrapper.latency_ms, error: wrapper.error || wrapper.result?.error || null });
        store.emitActionFailed({ action_id: record.action_id, action, adapter: wrapper.adapter, path_mode: wrapper.path_mode, latency_ms: wrapper.latency_ms, error: wrapper.error || wrapper.result?.error || null });
        store.raiseAlert({ level: 'warn', code: 'action_failed', message: `${action} failed`, action_id: record.action_id });
      }

      store.setActionsRecent(actionQueue.list(50));
      store.setMetrics(metrics.snapshot());
      return { ...wrapper, action_id: record.action_id };
    } catch (err) {
      const latency_ms = Date.now() - start;
      metrics.observeAction({ latency_ms, path_key: 'error', ok: false, fallback_used: false });
      actionQueue.markFailed(record.action_id, { latency_ms, error: { message: err.message } });
      store.emitActionFailed({ action_id: record.action_id, action, error: { message: err.message }, latency_ms });
      store.raiseAlert({ level: 'error', code: 'action_exception', message: `${action} exception: ${err.message}`, action_id: record.action_id });
      store.setActionsRecent(actionQueue.list(50));
      store.setMetrics(metrics.snapshot());
      throw err;
    }
  };
}

export function createBatchTriageRunner({ store, findTeam, buildTeamInterrupts, runTrackedAction }) {
  return async function runBatchTriage({ teamName, op, confirm = false, message = '', limit = 20 }) {
    if (!confirm) return { ok: false, error: 'confirm=true required', results: [], summary: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 } };
    const max = Math.max(1, Math.min(100, Number(limit || 20)));
    const team = findTeam(store.getSnapshot(), teamName);
    const interrupts = buildTeamInterrupts({ snapshot: store.getSnapshot(), teamName, teamPolicy: team?.policy });
    const results = [];
    let selected = [];

    if (op === 'approve_all_safe') {
      selected = interrupts.filter((i) => i.kind === 'approval' && i.safe_auto).slice(0, max);
      for (const it of selected) {
        if (!it.task_id) { results.push({ interrupt_id: it.id, ok: false, skipped: true, reason: 'missing task_id' }); continue; }
        try {
          const t = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({ team: t, action: 'approve-plan', payload: { team_name: teamName, task_id: it.task_id, message: message || 'Batch triage auto-approve' }, routeMode: 'router' });
          results.push({ interrupt_id: it.id, ok: out.ok !== false, action_id: out.action_id || null, adapter: out.adapter, path_mode: out.path_mode, reason: out.reason || null });
        } catch (err) { results.push({ interrupt_id: it.id, ok: false, error: err.message }); }
      }
    } else if (op === 'wake_all_stale') {
      selected = interrupts.filter((i) => i.kind === 'stale' && i.safe_auto && i.session_id).slice(0, max);
      for (const it of selected) {
        try {
          const t = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({ team: t, action: 'wake', payload: { team_name: teamName, session_id: it.session_id, message: message || 'Batch triage wake (stale worker)' }, routeMode: 'router' });
          results.push({ interrupt_id: it.id, ok: out.ok !== false, action_id: out.action_id || null, adapter: out.adapter, path_mode: out.path_mode, reason: out.reason || null });
        } catch (err) { results.push({ interrupt_id: it.id, ok: false, error: err.message }); }
      }
    } else if (op === 'reject_all_risky') {
      selected = interrupts.filter((i) => i.kind === 'approval' && !i.safe_auto).slice(0, max);
      for (const it of selected) {
        if (!it.task_id) { results.push({ interrupt_id: it.id, ok: false, skipped: true, reason: 'missing task_id' }); continue; }
        try {
          const t = findTeam(store.getSnapshot(), teamName);
          const out = await runTrackedAction({ team: t, action: 'reject-plan', payload: { team_name: teamName, task_id: it.task_id, feedback: message || 'Batch triage: rejected due to risk flags' }, routeMode: 'router' });
          results.push({ interrupt_id: it.id, ok: out.ok !== false, action_id: out.action_id || null, adapter: out.adapter, path_mode: out.path_mode, reason: out.reason || null });
        } catch (err) { results.push({ interrupt_id: it.id, ok: false, error: err.message }); }
      }
    } else if (op === 'dismiss_resolved') {
      const currentInterrupts = buildTeamInterrupts({ snapshot: store.getSnapshot(), teamName, teamPolicy: findTeam(store.getSnapshot(), teamName)?.policy });
      const currentIds = new Set(currentInterrupts.map((i) => i.id));
      let dismissed = 0;
      const freshAlerts = (store.getSnapshot().alerts || []).filter((a) => {
        if (a.team_name && a.team_name !== teamName) return true;
        const matchId = `alert:${a.action_id || a.request_id || ''}`;
        if (!currentIds.has(matchId)) { dismissed += 1; return false; }
        return true;
      });
      store.snapshot.alerts = freshAlerts;
      results.push({ ok: true, dismissed });
    } else {
      return { ok: false, error: `unsupported op: ${op}`, results: [], summary: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 } };
    }

    const summary = {
      attempted: results.length,
      selected_interrupts: selected.length,
      succeeded: results.filter((r) => r.ok && !r.skipped).length,
      failed: results.filter((r) => r.ok === false && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    };
    return { ok: summary.failed === 0, team_name: teamName, op, results, summary };
  };
}
