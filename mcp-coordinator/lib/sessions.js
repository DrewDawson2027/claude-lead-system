/**
 * Session management: list, get, status detection.
 * @module sessions
 */

import { readdirSync, existsSync, readFileSync } from "fs";
import { join, basename } from "path";
import { cfg } from "./constants.js";
import { sanitizeShortSessionId } from "./security.js";
import { readJSON, readJSONLLimited, text, timeAgo } from "./helpers.js";

/**
 * Get all sessions from disk.
 * @returns {object[]} Session objects
 */
export function getAllSessions() {
  const { TERMINALS_DIR } = cfg();
  try {
    return readdirSync(TERMINALS_DIR)
      .filter(f => f.startsWith("session-") && f.endsWith(".json"))
      .map(f => readJSON(join(TERMINALS_DIR, f)))
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Determine the effective status of a session.
 * @param {object} session - Session data
 * @returns {string} "active" | "idle" | "stale" | "closed" | "unknown"
 */
export function getSessionStatus(session) {
  if (session.status === "closed") return "closed";
  if (session.status === "stale") return "stale";
  if (!session.last_active) return "unknown";
  const age = (Date.now() - new Date(session.last_active).getTime()) / 1000;
  if (age < 180) return "active";
  if (age < 600) return "idle";
  return "stale";
}

/**
 * Handle coord_list_sessions tool call.
 * @param {object} args - Tool arguments
 * @returns {object} MCP text response
 */
export function handleListSessions(args = {}) {
  const sessions = getAllSessions();
  const includeClosed = args?.include_closed ?? false;
  const projectFilter = args?.project;

  let filtered = sessions;
  if (!includeClosed) filtered = filtered.filter(s => s.status !== "closed");
  if (projectFilter) filtered = filtered.filter(s => s.project?.toLowerCase().includes(projectFilter.toLowerCase()));

  if (filtered.length === 0) return text("No active sessions found.");

  const rows = filtered.map(s => {
    const status = getSessionStatus(s);
    const lastActive = timeAgo(s.last_active);
    const tc = s.tool_counts || {};
    const tools = `${tc.Write || 0}/${tc.Edit || 0}/${tc.Bash || 0}/${tc.Read || 0}`;
    const recentFiles = (s.files_touched || []).slice(-3).map(f => basename(f)).join(", ") || "\u2014";
    const lastOp = s.recent_ops?.length ? `${s.recent_ops[s.recent_ops.length - 1].tool} ${basename(s.recent_ops[s.recent_ops.length - 1].file || "")}` : "\u2014";
    return `| ${s.session} | ${s.tty || "?"} | ${s.project || "?"} | ${status} | ${lastActive} | ${tools} | ${recentFiles} | ${lastOp} |`;
  });

  const table = `| Session | TTY | Project | Status | Last Active | W/E/B/R | Recent Files | Last Op |\n|---------|-----|---------|--------|-------------|---------|--------------|---------|` + "\n" + rows.join("\n");
  return text(`## Sessions (${filtered.length}) \u2014 Platform: ${cfg().PLATFORM}\n\n${table}`);
}

/**
 * Handle coord_get_session tool call.
 * @param {object} args - Tool arguments
 * @returns {object} MCP text response
 */
export function handleGetSession(args) {
  const sid = sanitizeShortSessionId(args.session_id);
  const { TERMINALS_DIR, INBOX_DIR } = cfg();
  const session = readJSON(join(TERMINALS_DIR, `session-${sid}.json`));
  if (!session) return text(`Session ${sid} not found.`);

  let output = `## Session ${sid}\n\n`;
  output += `- **Project:** ${session.project}\n`;
  output += `- **Branch:** ${session.branch}\n- **CWD:** ${session.cwd}\n`;
  output += `- **Status:** ${getSessionStatus(session)}\n`;
  output += `- **TTY:** ${session.tty || "unknown"}\n`;
  output += `- **Started:** ${session.started}\n- **Last Active:** ${timeAgo(session.last_active)}\n`;
  output += `- **Task:** ${session.current_task || "not declared"}\n`;

  if (session.tool_counts) {
    const tc = session.tool_counts;
    output += `\n### Tool Usage\nWrite: ${tc.Write || 0} | Edit: ${tc.Edit || 0} | Bash: ${tc.Bash || 0} | Read: ${tc.Read || 0}\n`;
  }
  if (session.files_touched?.length) {
    output += `\n### Files Touched (${session.files_touched.length})\n`;
    session.files_touched.forEach(f => { output += `- ${f}\n`; });
  }
  if (session.recent_ops?.length) {
    output += `\n### Recent Operations\n`;
    session.recent_ops.forEach(op => { output += `- ${op.t} ${op.tool} ${op.file || ""}\n`; });
  }

  if (session.plan_file && existsSync(session.plan_file)) {
    try {
      const first20 = readFileSync(session.plan_file, "utf-8").split("\n").slice(0, 20).join("\n");
      output += `\n### Active Plan\n\`\`\`\n${first20}\n\`\`\`\n`;
    } catch (e) { process.stderr.write(`coord: plan read failed: ${e.message}\n`); }
  }

  const inboxView = readJSONLLimited(join(INBOX_DIR, `${sid}.jsonl`));
  output += `\n### Inbox: ${inboxView.items.length} pending message(s)\n`;
  if (inboxView.truncated) output += `_Inbox count limited by safety caps._\n`;

  return text(output);
}
