/**
 * Team composition persistence: create and query teams.
 * File-based storage — survives session restarts.
 * @module teams
 */

import { existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import { sanitizeName, writeFileSecure, ensureSecureDirectory } from "./security.js";
import { readJSON, text } from "./helpers.js";

/**
 * Get the teams directory path, ensuring it exists.
 * @returns {string} Teams directory path
 */
function teamsDir() {
  const dir = join(cfg().TERMINALS_DIR, "teams");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try { ensureSecureDirectory(dir); } catch {}
  }
  return dir;
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

  if (args.project) team.project = String(args.project).trim();
  if (args.description) team.description = String(args.description).trim();

  // Merge members — add new ones, update existing
  if (args.members?.length) {
    for (const m of args.members) {
      const name = sanitizeName(m.name || m, "member name");
      const role = m.role ? String(m.role).trim() : "worker";
      const session_id = m.session_id || null;
      const task_id = m.task_id || null;

      const idx = team.members.findIndex(x => x.name === name);
      if (idx >= 0) {
        // Update existing member
        if (role) team.members[idx].role = role;
        if (session_id) team.members[idx].session_id = session_id;
        if (task_id) team.members[idx].task_id = task_id;
        team.members[idx].updated = new Date().toISOString();
      } else {
        team.members.push({
          name, role, session_id, task_id,
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
    `- Members: ${team.members.length}\n` +
    team.members.map(m => `  - ${m.name} (${m.role})${m.task_id ? ` → ${m.task_id}` : ""}`).join("\n")
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

  let output = `## Team: ${teamName}\n\n`;
  output += `- **Project:** ${team.project || "unset"}\n`;
  if (team.description) output += `- **Description:** ${team.description}\n`;
  output += `- **Created:** ${team.created}\n`;
  output += `- **Updated:** ${team.updated}\n`;
  output += `\n### Members (${team.members.length})\n`;
  for (const m of team.members) {
    output += `- **${m.name}** — ${m.role}`;
    if (m.session_id) output += ` | session: ${m.session_id}`;
    if (m.task_id) output += ` | task: ${m.task_id}`;
    output += `\n`;
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
    const files = readdirSync(dir).filter(f => f.endsWith(".json"));
    if (files.length === 0) return text("No teams found.");

    const teams = files.map(f => readJSON(join(dir, f))).filter(Boolean);
    const rows = teams.map(t =>
      `| ${t.team_name} | ${t.project || "-"} | ${t.members?.length || 0} | ${t.updated || "-"} |`
    );
    const table = `| Team | Project | Members | Updated |\n|------|---------|---------|---------|` + "\n" + rows.join("\n");
    return text(`## Teams (${teams.length})\n\n${table}`);
  } catch { return text("No teams found."); }
}
