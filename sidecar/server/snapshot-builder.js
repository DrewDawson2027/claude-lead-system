import { readdirSync } from "fs";
import { join } from "path";
import { sidecarPaths } from "../core/paths.js";
import { readJSONL } from "../core/fs-utils.js";
import { buildTeamOperationalSnapshot } from "../../mcp-coordinator/lib/team-tasking.js";
import { readIdentityMap } from "../../mcp-coordinator/lib/identity-map.js";
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

function matchIdentity(identityRecords, member, teamName) {
  const teamScoped = identityRecords.filter(
    (r) => !r.team_name || r.team_name === teamName,
  );
  const byTask = member.task_id
    ? teamScoped.find((r) => r.task_id === member.task_id)
    : null;
  if (byTask) return byTask;
  const sid = member.session_id ? String(member.session_id).slice(0, 8) : null;
  const bySession = sid
    ? teamScoped.find((r) => r.session_id === sid)
    : null;
  if (bySession) return bySession;
  return teamScoped.find(
    (r) =>
      r.agent_id &&
      String(r.agent_id).toLowerCase() ===
      String(member.name || "").toLowerCase(),
  ) || null;
}

function normalizeTeammates(teamSnap, identityRecords = []) {
  return (teamSnap.members || []).map((m) => {
    const identity = matchIdentity(identityRecords, m, teamSnap.team_name);
    const sessionId = m.session_id || identity?.session_id || null;
    const taskId = m.task_id || identity?.task_id || null;
    const paneId = m.tmux_pane_id || identity?.pane_id || null;
    return {
      id: `${teamSnap.team_name}:${m.name}`,
      source: teamSnap.execution_path === "native" ? "hybrid" : "coordinator",
      display_name: m.name,
      team_name: teamSnap.team_name,
      session_id: sessionId,
      worker_task_id: taskId,
      native_agent_id: identity?.agent_id || m.agentId || null,
      role: m.role || "worker",
      presence: m.presence || m.session_status || "offline",
      tmux_pane_id: paneId,
      claude_session_id: identity?.claude_session_id || null,
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
    };
  });
}

function normalizeTasks(teamSnap) {
  return (teamSnap.task_board || teamSnap.task_queue || []).map((t) =>
    normalizeTeamTask({ ...t, team_name: teamSnap.team_name }),
  );
}

export function buildSidecarSnapshot() {
  const paths = sidecarPaths();
  const identityMap = readIdentityMap();
  const identityRecords = Array.isArray(identityMap.records)
    ? identityMap.records
    : [];
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
      teammates.push(...normalizeTeammates(snap, identityRecords));
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
    identity_map: {
      updated_at: identityMap.updated_at || null,
      records: identityRecords.length,
    },
  };
}
