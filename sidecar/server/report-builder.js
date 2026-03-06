/**
 * Comparison report generator.
 * Takes a diagnostics bundle and optional baseline to produce a markdown report.
 */

export function buildComparisonReport(bundle, opts = {}) {
  const baseline = opts.baseline || null;
  const ts = bundle.generated_at || new Date().toISOString();
  const snap = bundle.snapshot || {};
  const met = bundle.metrics || {};
  const native = bundle.native || {};

  const lines = [];
  const h = (level, text) => lines.push(`${"#".repeat(level)} ${text}`);
  const ln = (text) => lines.push(text);
  const blank = () => lines.push("");

  h(1, `System Comparison Report — ${ts}`);
  blank();

  // System Info
  h(2, "System Info");
  ln(`- **Schema Version**: ${bundle.schema_version ?? "unknown"}`);
  ln(`- **Generated**: ${ts}`);
  ln(`- **Label**: ${bundle.label || "manual"}`);
  ln(`- **PID**: ${bundle.process?.pid ?? "—"}`);
  blank();

  // Performance Summary
  h(2, "Performance Summary");
  const latP50 = met.action_latency_ms?.p50;
  const latP95 = met.action_latency_ms?.p95;
  const sampleSize = met.action_latency_ms?.sample_size ?? 0;
  const counts = met.counts || {};
  const total = (counts.success || 0) + (counts.failure || 0);
  const successRate =
    total > 0 ? (((counts.success || 0) / total) * 100).toFixed(1) : "—";
  const fallbackRate =
    total > 0 ? (((counts.fallback || 0) / total) * 100).toFixed(1) : "—";
  ln(`| Metric | Value |`);
  ln(`|--------|-------|`);
  ln(`| Latency p50 | ${latP50 != null ? `${latP50.toFixed(2)}ms` : "—"} |`);
  ln(`| Latency p95 | ${latP95 != null ? `${latP95.toFixed(2)}ms` : "—"} |`);
  ln(`| Success rate | ${successRate}% |`);
  ln(`| Fallback rate | ${fallbackRate}% |`);
  ln(`| Total actions | ${total} |`);
  ln(`| Sample size | ${sampleSize} |`);
  blank();

  // Team Capacity
  h(2, "Team Capacity");
  const teams = snap.teams || [];
  const teammates = snap.teammates || [];
  const tasks = snap.tasks || [];
  const staleCount = teammates.filter(
    (t) => t.presence === "stale" || t.presence === "offline",
  ).length;
  ln(`- **Teams**: ${teams.length}`);
  ln(`- **Members**: ${teammates.length} (${staleCount} stale/offline)`);
  ln(
    `- **Tasks**: ${tasks.length} (${tasks.filter((t) => t.status === "pending").length} pending, ${tasks.filter((t) => t.status === "in_progress").length} in-progress)`,
  );
  if (teammates.length > 0) {
    const loads = teammates.map((t) => t.load_score ?? 0);
    const avgLoad = (loads.reduce((a, b) => a + b, 0) / loads.length).toFixed(
      1,
    );
    const maxLoad = Math.max(...loads);
    const minLoad = Math.min(...loads);
    ln(
      `- **Load**: avg=${avgLoad}, min=${minLoad}, max=${maxLoad}, spread=${maxLoad - minLoad}`,
    );
  }
  blank();

  // Cost Analysis
  h(2, "Cost Analysis");
  const actionList = bundle.actions || [];
  const byAdapter = {};
  for (const a of actionList) {
    const adapter = a.execution_path || a.path_key || a.adapter || "unknown";
    byAdapter[adapter] = (byAdapter[adapter] || 0) + 1;
  }
  if (Object.keys(byAdapter).length > 0) {
    ln(`| Adapter | Count |`);
    ln(`|---------|-------|`);
    for (const [adapter, count] of Object.entries(byAdapter)) {
      ln(`| ${adapter} | ${count} |`);
    }
  } else {
    ln("No action data available.");
  }
  blank();

  // Bridge Health
  h(2, "Bridge Health");
  const bridgeStatus =
    native.status?.bridge_status || native.status?.status || "—";
  const heartbeat = native.heartbeat;
  const validation = native.validation;
  ln(`- **Status**: ${bridgeStatus}`);
  if (heartbeat?.ts) {
    const ageMs = Date.now() - new Date(heartbeat.ts).getTime();
    ln(`- **Heartbeat age**: ${(ageMs / 1000).toFixed(1)}s`);
  }
  if (validation) {
    ln(
      `- **Validation**: ${validation.valid === true ? "PASS" : validation.valid === false ? "FAIL" : "UNKNOWN"} (${validation.checks_passed ?? "?"}/${validation.checks_total ?? "?"} checks)`,
    );
  }
  blank();

  // Delta from Baseline
  if (baseline) {
    h(2, "Delta from Baseline");
    const baseMetrics = baseline.metrics || {};
    const baseCounts = baseMetrics.counts || {};
    const baseTotal = (baseCounts.success || 0) + (baseCounts.failure || 0);
    const curTotal = total;
    ln(`| Metric | Baseline | Current | Delta |`);
    ln(`|--------|----------|---------|-------|`);
    const delta = (a, b) =>
      b != null && a != null
        ? `${b - a > 0 ? "+" : ""}${(b - a).toFixed(2)}`
        : "—";
    ln(
      `| Latency p50 | ${baseMetrics.action_latency_ms?.p50?.toFixed(2) ?? "—"}ms | ${latP50?.toFixed(2) ?? "—"}ms | ${delta(baseMetrics.action_latency_ms?.p50, latP50)} |`,
    );
    ln(
      `| Latency p95 | ${baseMetrics.action_latency_ms?.p95?.toFixed(2) ?? "—"}ms | ${latP95?.toFixed(2) ?? "—"}ms | ${delta(baseMetrics.action_latency_ms?.p95, latP95)} |`,
    );
    ln(
      `| Actions | ${baseTotal} | ${curTotal} | ${delta(baseTotal, curTotal)} |`,
    );
    ln(
      `| Failures | ${baseCounts.failure || 0} | ${counts.failure || 0} | ${delta(baseCounts.failure || 0, counts.failure || 0)} |`,
    );
    blank();
  }

  const markdown = lines.join("\n");
  const json = {
    generated_at: ts,
    label: bundle.label,
    schema_version: bundle.schema_version,
    performance: {
      latency_p50: latP50,
      latency_p95: latP95,
      success_rate: successRate,
      fallback_rate: fallbackRate,
      total_actions: total,
    },
    capacity: {
      teams: teams.length,
      members: teammates.length,
      stale: staleCount,
      tasks: tasks.length,
    },
    bridge: { status: bridgeStatus },
    has_baseline: !!baseline,
  };

  return { markdown, json };
}
