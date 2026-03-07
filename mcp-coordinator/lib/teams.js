/**
 * Team composition persistence: create and query teams.
 * File-based storage — survives session restarts.
 * @module teams
 */

import { existsSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import {
  sanitizeId,
  sanitizeName,
  writeFileSecure,
  ensureSecureDirectory,
} from "./security.js";
import { readJSON, text } from "./helpers.js";

/**
 * Get the teams directory path, ensuring it exists.
 * @returns {string} Teams directory path
 */
function teamsDir() {
  const dir = join(cfg().TERMINALS_DIR, "teams");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try {
      ensureSecureDirectory(dir);
    } catch {}
  }
  return dir;
}

function teamPreset(preset) {
  switch (preset) {
    case "simple":
      return {
        execution_path: "hybrid",
        policy: {
          permission_mode: "acceptEdits",
          require_plan: false,
          default_mode: "pipe",
          default_runtime: "claude",
          default_context_level: "minimal",
          budget_policy: "warn",
          budget_tokens: 40000,
          global_budget_policy: "warn",
          global_budget_tokens: 120000,
          max_active_workers: 4,
          default_isolate: false,
        },
      };
    case "strict":
      return {
        execution_path: "coordinator",
        policy: {
          permission_mode: "planOnly",
          require_plan: true,
          default_mode: "interactive",
          default_runtime: "claude",
          default_context_level: "standard",
          budget_policy: "enforce",
          budget_tokens: 60000,
          global_budget_policy: "enforce",
          global_budget_tokens: 200000,
          max_active_workers: 6,
          default_isolate: true,
        },
      };
    case "native-first":
      return {
        execution_path: "native",
        policy: {
          permission_mode: "acceptEdits",
          require_plan: false,
          default_mode: "pipe",
          default_runtime: "claude",
          default_context_level: "minimal",
          budget_policy: "warn",
          budget_tokens: 50000,
          global_budget_policy: "warn",
          global_budget_tokens: 160000,
          max_active_workers: 6,
          default_isolate: false,
        },
      };
    default:
      return { execution_path: "hybrid", policy: {} };
  }
}

const INTERRUPT_WEIGHT_KEYS = [
  "approval",
  "bridge",
  "stale",
  "conflict",
  "budget",
  "error",
  "warn",
  "default",
];

function normalizeInterruptWeights(weights = {}) {
  if (!weights || typeof weights !== "object" || Array.isArray(weights))
    return null;
  const out = {};
  for (const key of INTERRUPT_WEIGHT_KEYS) {
    const n = Number(weights[key]);
    if (Number.isFinite(n) && n >= 0 && n <= 200) out[key] = Math.round(n);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function mergeTeamPolicy(currentPolicy = {}, patchPolicy = {}) {
  const merged = { ...(currentPolicy || {}), ...(patchPolicy || {}) };
  if (
    patchPolicy?.interrupt_weights &&
    typeof patchPolicy.interrupt_weights === "object" &&
    !Array.isArray(patchPolicy.interrupt_weights)
  ) {
    const prevWeights =
      currentPolicy?.interrupt_weights &&
      typeof currentPolicy.interrupt_weights === "object" &&
      !Array.isArray(currentPolicy.interrupt_weights)
        ? currentPolicy.interrupt_weights
        : {};
    merged.interrupt_weights = {
      ...prevWeights,
      ...patchPolicy.interrupt_weights,
    };
  }
  return merged;
}

function normalizeTeamPolicy(policy = {}) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return {};
  const out = {};
  const strEnum = (k, vals) => {
    if (vals.includes(policy[k])) out[k] = policy[k];
  };
  const posInt = (k) => {
    const n = Number(policy[k]);
    if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  };
  const bool = (k) => {
    if (typeof policy[k] === "boolean") out[k] = policy[k];
  };
  strEnum("permission_mode", [
    "acceptEdits",
    "auto",
    "planOnly",
    "readOnly",
    "editOnly",
  ]);
  bool("require_plan");
  strEnum("default_mode", ["pipe", "interactive"]);
  strEnum("default_runtime", ["claude", "codex"]);
  strEnum("default_context_level", ["minimal", "standard", "full"]);
  strEnum("budget_policy", ["off", "warn", "enforce"]);
  posInt("budget_tokens");
  strEnum("global_budget_policy", ["off", "warn", "enforce"]);
  posInt("global_budget_tokens");
  posInt("max_active_workers");
  bool("default_isolate");
  const interruptWeights = normalizeInterruptWeights(policy.interrupt_weights);
  if (interruptWeights) out.interrupt_weights = interruptWeights;
  return out;
}

function readAllTasks() {
  const dir = join(cfg().TERMINALS_DIR, "tasks");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJSON(join(dir, f)))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readSessionById(sessionId) {
  if (!sessionId) return null;
  return readJSON(
    join(cfg().TERMINALS_DIR, `session-${String(sessionId).slice(0, 8)}.json`),
  );
}

export function readTeamConfig(teamNameRaw) {
  const teamName = sanitizeName(teamNameRaw, "team_name");
  return readJSON(join(teamsDir(), `${teamName}.json`));
}

/**
 * Handle coord_create_team tool call.
 * Creates or updates a team config with members, roles, and project info.
 * @param {object} args - { team_name, project, description, members }
 * @returns {object} MCP text response
 */
export function handleCreateTeam(args) {
  const teamName = sanitizeName(args.team_name, "team_name");
  const dir = teamsDir();
  const teamFile = join(dir, `${teamName}.json`);
  const existing = readJSON(teamFile);

  const team = existing || {
    team_name: teamName,
    created: new Date().toISOString(),
    members: [],
  };

  const presetName = typeof args.preset === "string" ? args.preset.trim() : "";
  if (presetName) {
    const preset = teamPreset(presetName);
    team.preset = presetName;
    team.execution_path = preset.execution_path;
    team.policy = mergeTeamPolicy(team.policy || {}, preset.policy || {});
  }

  if (args.project) team.project = String(args.project).trim();
  if (args.description) team.description = String(args.description).trim();
  if (
    args.execution_path &&
    ["native", "coordinator", "hybrid"].includes(args.execution_path)
  ) {
    team.execution_path = args.execution_path;
  }
  if (
    args.low_overhead_mode &&
    ["simple", "advanced"].includes(args.low_overhead_mode)
  ) {
    team.low_overhead_mode = args.low_overhead_mode;
  }
  if (args.policy !== undefined) {
    team.policy = mergeTeamPolicy(
      team.policy || {},
      normalizeTeamPolicy(args.policy),
    );
  }
  if (!team.execution_path) team.execution_path = "hybrid";
  if (!team.low_overhead_mode) team.low_overhead_mode = "advanced";
  if (!team.policy) team.policy = {};

  // Merge members — add new ones, update existing
  if (args.members?.length) {
    for (const m of args.members) {
      const name = sanitizeName(m.name || m, "member name");
      const hasRole =
        typeof m === "object" &&
        m !== null &&
        Object.prototype.hasOwnProperty.call(m, "role");
      const role = hasRole
        ? m.role
          ? String(m.role).trim()
          : "worker"
        : undefined;
      const session_id = m.session_id ? String(m.session_id).slice(0, 8) : null;
      const hasTaskId =
        typeof m === "object" &&
        m !== null &&
        Object.prototype.hasOwnProperty.call(m, "task_id");
      const task_id = hasTaskId
        ? m.task_id
          ? sanitizeId(m.task_id, "task_id")
          : null
        : undefined;

      const agentId = m.agentId || null;

      const idx = team.members.findIndex((x) => x.name === name);
      if (idx >= 0) {
        // Update existing member
        if (hasRole && role) team.members[idx].role = role;
        if (session_id) team.members[idx].session_id = session_id;
        if (hasTaskId) team.members[idx].task_id = task_id;
        if (agentId) team.members[idx].agentId = agentId;
        team.members[idx].updated = new Date().toISOString();
      } else {
        team.members.push({
          name,
          role: role || "worker",
          session_id,
          task_id: task_id ?? null,
          agentId,
          joined: new Date().toISOString(),
          updated: new Date().toISOString(),
        });
      }
    }
  }

  team.updated = new Date().toISOString();
  writeFileSecure(teamFile, JSON.stringify(team, null, 2));

  return text(
    `Team ${existing ? "updated" : "created"}: **${teamName}**\n` +
      `- Project: ${team.project || "unset"}\n` +
      `- Execution Path: ${team.execution_path}\n` +
      `- Overhead Mode: ${team.low_overhead_mode}\n` +
      `- Team Permission Mode: ${team.policy?.permission_mode || "unset"}\n` +
      `- Team Plan Mode: ${team.policy?.require_plan === true ? "required" : team.policy?.require_plan === false ? "optional" : "unset"}\n` +
      `- Members: ${team.members.length}\n` +
      team.members
        .map(
          (m) =>
            `  - ${m.name} (${m.role})${m.task_id ? ` → ${m.task_id}` : ""}`,
        )
        .join("\n"),
  );
}

/**
 * Handle coord_update_team_policy tool call.
 * Updates policy fields for an existing team without mutating members.
 * @param {object} args - { team_name, policy?, interrupt_weights? }
 * @returns {object} MCP text response
 */
export function handleUpdateTeamPolicy(args) {
  const teamName = sanitizeName(args.team_name, "team_name");
  const teamFile = join(teamsDir(), `${teamName}.json`);
  const team = readJSON(teamFile);
  if (!team) return text(`Team ${teamName} not found.`);

  const incomingPolicy =
    args.policy &&
    typeof args.policy === "object" &&
    !Array.isArray(args.policy)
      ? { ...args.policy }
      : {};
  if (
    args.interrupt_weights &&
    typeof args.interrupt_weights === "object" &&
    !Array.isArray(args.interrupt_weights)
  ) {
    incomingPolicy.interrupt_weights = args.interrupt_weights;
  }

  const normalized = normalizeTeamPolicy(incomingPolicy);
  if (Object.keys(normalized).length === 0) {
    return text(`No valid policy updates provided for team ${teamName}.`);
  }

  team.policy = mergeTeamPolicy(team.policy || {}, normalized);
  team.updated = new Date().toISOString();
  writeFileSecure(teamFile, JSON.stringify(team, null, 2));

  const updatedKeys = Object.keys(normalized).sort();
  return text(
    `Team policy updated: **${teamName}**\n` +
      `- Updated keys: ${updatedKeys.join(", ")}\n` +
      (team.policy?.interrupt_weights
        ? `- Interrupt weights: ${JSON.stringify(team.policy.interrupt_weights)}\n`
        : ""),
  );
}

/**
 * Handle coord_get_team tool call.
 * @param {object} args - { team_name }
 * @returns {object} MCP text response
 */
export function handleGetTeam(args) {
  const teamName = sanitizeName(args.team_name, "team_name");
  const team = readJSON(join(teamsDir(), `${teamName}.json`));
  if (!team) return text(`Team ${teamName} not found.`);
  const tasks = readAllTasks().filter(
    (t) => t.team_name === teamName || t.metadata?.team_name === teamName,
  );

  let output = `## Team: ${teamName}\n\n`;
  output += `- **Project:** ${team.project || "unset"}\n`;
  if (team.description) output += `- **Description:** ${team.description}\n`;
  output += `- **Execution Path:** ${team.execution_path || "hybrid"}\n`;
  output += `- **Overhead Mode:** ${team.low_overhead_mode || "advanced"}\n`;
  if (team.preset) output += `- **Preset:** ${team.preset}\n`;
  output += `- **Created:** ${team.created}\n`;
  output += `- **Updated:** ${team.updated}\n`;
  if (team.policy && Object.keys(team.policy).length > 0) {
    output += `\n### Team Policy\n`;
    for (const [k, v] of Object.entries(team.policy))
      output += `- **${k}:** ${JSON.stringify(v)}\n`;
  }
  output += `\n### Members (${team.members.length})\n`;
  for (const m of team.members) {
    const session = readSessionById(m.session_id);
    output += `- **${m.name}** — ${m.role}`;
    if (m.session_id) output += ` | session: ${m.session_id}`;
    if (m.task_id) output += ` | task: ${m.task_id}`;
    if (session) {
      output += ` | status: ${session.status || "unknown"}`;
      if (session.current_task) output += ` | current: ${session.current_task}`;
      if (session.last_active)
        output += ` | last_active: ${session.last_active}`;
    }
    output += `\n`;
  }
  const byStatus = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  output += `\n### Team Tasks (${tasks.length})\n`;
  output += `- Pending: ${byStatus.pending || 0}\n`;
  output += `- In Progress: ${byStatus.in_progress || 0}\n`;
  output += `- Completed: ${byStatus.completed || 0}\n`;
  output += `- Cancelled: ${byStatus.cancelled || 0}\n`;
  for (const t of tasks
    .filter((t) => t.status !== "completed" && t.status !== "cancelled")
    .slice(0, 12)) {
    output += `- ${t.task_id} | ${t.status} | ${t.assignee || "unassigned"} | ${t.subject}\n`;
  }
  return text(output);
}

/**
 * Handle coord_list_teams tool call.
 * @returns {object} MCP text response
 */
export function handleListTeams() {
  const dir = teamsDir();
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return text("No teams found.");

    const teams = files.map((f) => readJSON(join(dir, f))).filter(Boolean);
    const rows = teams.map(
      (t) =>
        `| ${t.team_name} | ${t.project || "-"} | ${t.execution_path || "hybrid"} | ${t.members?.length || 0} | ${t.updated || "-"} |`,
    );
    const table =
      `| Team | Project | Path | Members | Updated |\n|------|---------|------|---------|---------|` +
      "\n" +
      rows.join("\n");
    return text(`## Teams (${teams.length})\n\n${table}`);
  } catch {
    return text("No teams found.");
  }
}

/**
 * Handle coord_delete_team tool call.
 * Removes team config and optionally cleans associated tasks.
 * @param {object} args - { team_name, clean_tasks }
 * @returns {object} MCP text response
 */
export function handleDeleteTeam(args) {
  const teamName = sanitizeName(args.team_name, "team_name");
  const dir = teamsDir();
  const teamFile = join(dir, `${teamName}.json`);

  if (!existsSync(teamFile)) return text(`Team ${teamName} not found.`);

  const team = readJSON(teamFile);
  const memberCount = team?.members?.length || 0;

  // Guard: refuse deletion if any teammate is active in the last 5 minutes
  if (!args.force) {
    const now = Date.now();
    const activeMates = (team?.members || [])
      .filter((m) => m.session_id)
      .map((m) => ({
        name: m.name,
        session: readJSON(
          join(
            cfg().TERMINALS_DIR,
            `session-${String(m.session_id).slice(0, 8)}.json`,
          ),
        ),
      }))
      .filter(({ session }) => {
        if (
          !session ||
          session.status === "closed" ||
          session.status === "stale"
        )
          return false;
        const age = session.last_active
          ? (now - new Date(session.last_active).getTime()) / 1000
          : Infinity;
        return age < 300; // active in last 5 minutes
      });

    if (activeMates.length > 0) {
      const names = activeMates.map((m) => m.name).join(", ");
      return text(
        `Cannot delete team **${teamName}** — ${activeMates.length} active teammate(s): ${names}\n` +
          `Use force: true to delete anyway.`,
      );
    }
  }

  try {
    unlinkSync(teamFile);
  } catch (e) {
    return text(`Failed to delete team ${teamName}: ${e.message}`);
  }

  let tasksRemoved = 0;
  if (args.clean_tasks) {
    const tasksDir = join(cfg().TERMINALS_DIR, "tasks");
    try {
      const files = readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const task = readJSON(join(tasksDir, f));
        if (
          task &&
          (task.team_name === teamName || task.metadata?.team_name === teamName)
        ) {
          try {
            unlinkSync(join(tasksDir, f));
            tasksRemoved++;
          } catch {}
        }
      }
    } catch {}
  }

  return text(
    `Team **${teamName}** deleted.\n` +
      `- Members removed: ${memberCount}\n` +
      (args.clean_tasks
        ? `- Tasks cleaned: ${tasksRemoved}\n`
        : "- Tasks preserved (use clean_tasks: true to remove)\n"),
  );
}
