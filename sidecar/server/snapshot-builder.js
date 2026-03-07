import { readdirSync } from "fs";
import { join } from "path";
import { sidecarPaths } from "../core/paths.js";
import { readJSONL } from "../core/fs-utils.js";
import { buildTeamOperationalSnapshot } from "../../mcp-coordinator/lib/team-tasking.js";
import {
  deriveLoadScore,
  deriveInterruptibility,
  deriveDispatchReadiness,
} from "../core/presence-engine.js";
import { normalizeTeamTask } from "../core/tasking-engine.js";

function listTeamNames(paths) {
  try {
    return readdirSync(paths.teamsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

function normalizeTeammates(teamSnap) {
  return (teamSnap.members || []).map((m) => ({
    id: `${teamSnap.team_name}:${m.name}`,
    source: teamSnap.execution_path === "native" ? "hybrid" : "coordinator",
    display_name: m.name,
    team_name: teamSnap.team_name,
    session_id: m.session_id || null,
    worker_task_id: m.task_id || null,
    native_agent_id: null,
    role: m.role || "worker",
    presence: m.presence || m.session_status || "offline",
    tmux_pane_id: m.tmux_pane_id || null,
    last_active: m.last_active || null,
    current_task_ref: m.current_task_ref || null,
    policy_state: m.policy_state || {},
    load_score: deriveLoadScore(m),
    interruptibility_score: deriveInterruptibility(m),
    dispatch_readiness: deriveDispatchReadiness(m),
    risk_flags: Array.isArray(m.risk_flags) ? m.risk_flags : [],
    last_tool: m.last_tool || null,
    recent_ops: Array.isArray(m.recent_ops) ? m.recent_ops : [],
    files_touched: Array.isArray(m.files_touched) ? m.files_touched : [],
  }));
}

function normalizeTasks(teamSnap) {
  return (teamSnap.task_board || teamSnap.task_queue || []).map((t) =>
    normalizeTeamTask({ ...t, team_name: teamSnap.team_name }),
  );
}

export function buildSidecarSnapshot() {
  const paths = sidecarPaths();
  const teamNames = listTeamNames(paths);
  const teams = [];
  const teammates = [];
  const tasks = [];
  const timeline = [];

  for (const name of teamNames) {
    try {
      const snap = buildTeamOperationalSnapshot(name);
      teams.push({
        team_name: snap.team_name,
        execution_path: snap.execution_path,
        low_overhead_mode: snap.low_overhead_mode,
        policy: snap.policy || {},
        members: (snap.members || []).map((m) => m.name),
        task_queue: (snap.task_queue || []).map((t) => t.task_id),
        summary: snap.summary || {},
        raw: {
          workers: snap.workers || [],
        },
      });
      teammates.push(...normalizeTeammates(snap));
      tasks.push(...normalizeTasks(snap));
      timeline.push(
        ...(snap.timeline || []).map((e) => ({
          ...e,
          team_name: snap.team_name,
        })),
      );
    } catch (err) {
      teams.push({
        team_name: name,
        execution_path: "unknown",
        low_overhead_mode: "unknown",
        policy: {},
        members: [],
        task_queue: [],
        summary: { error: err.message },
      });
    }
  }

  const activity = readJSONL(paths.activityFile)
    .slice(-200)
    .map((e) => ({ ...e, source: "hooks" }));
  timeline.push(...activity);
  timeline.sort((a, b) =>
    String(a.ts || a.t || "").localeCompare(String(b.ts || b.t || "")),
  );

  return {
    generated_at: new Date().toISOString(),
    teams,
    teammates,
    tasks,
    timeline: timeline.slice(-200),
    adapters: {
      native: { ok: process.env.LEAD_SIDECAR_NATIVE_ENABLE === "1" },
      coordinator: { ok: true },
    },
  };
}
