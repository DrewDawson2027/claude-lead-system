/**
 * Conflict detection across sessions.
 * @module conflicts
 */

import { join } from "path";
import { cfg } from "./constants.js";
import { sanitizeShortSessionId, normalizeFilePath, appendJSONLineSecure } from "./security.js";
import { readJSONL, text } from "./helpers.js";
import { getAllSessions, getSessionStatus } from "./sessions.js";

/**
 * Handle coord_detect_conflicts tool call.
 * Checks files_touched, current_files, and recent activity for overlaps.
 * @param {object} args - { session_id, files }
 * @returns {object} MCP text response
 */
export function handleDetectConflicts(args) {
  const { ACTIVITY_FILE } = cfg();
  const session_id = sanitizeShortSessionId(args.session_id);
  const files = (args.files || []).map(f => String(f).trim()).filter(Boolean);
  if (!files?.length) return text("No files specified.");
  const allSessions = getAllSessions();
  const sessionById = new Map(allSessions.map(s => [s.session, s]));
  const detectorSession = sessionById.get(session_id);
  if (!detectorSession) return text(`Session ${session_id} not found.`);
  const detectorCwd = detectorSession?.cwd || "";
  const normalizedByInput = new Map(files.map(f => [f, normalizeFilePath(f, detectorCwd)]));
  const normalizedFiles = new Set([...normalizedByInput.values()].filter(Boolean));

  const sessions = allSessions.filter(s => s.session !== session_id && getSessionStatus(s) !== "closed");
  const conflicts = [];

  for (const s of sessions) {
    const theirFiles = [...(s.current_files || []), ...(s.files_touched || [])];
    if (!theirFiles.length) continue;
    const theirNormalized = new Set(theirFiles.map(sf => normalizeFilePath(sf, s.cwd || "")).filter(Boolean));
    const overlap = files.filter(f => {
      const normalized = normalizedByInput.get(f);
      return normalized && theirNormalized.has(normalized);
    });
    if (overlap.length > 0) {
      conflicts.push({ session: s.session, project: s.project, task: s.current_task || "unknown", overlapping_files: overlap });
    }
  }

  const recentActivity = readJSONL(ACTIVITY_FILE).slice(-100);
  const fiveMinAgo = Date.now() - 300000;
  const recentEdits = recentActivity.filter(a =>
    a.session !== session_id && new Date(a.ts).getTime() > fiveMinAgo &&
    (a.tool === "Edit" || a.tool === "Write") &&
    normalizedFiles.has(normalizeFilePath(a.path || "", sessionById.get(a.session)?.cwd || detectorCwd))
  );

  if (conflicts.length === 0 && recentEdits.length === 0) return text("No conflicts detected. Safe to proceed.");

  let output = "## CONFLICTS DETECTED\n\n";
  if (conflicts.length > 0) {
    output += "### Session Overlaps\n";
    conflicts.forEach(c => { output += `- **${c.session}** (${c.project}): ${c.overlapping_files.join(", ")} \u2014 \"${c.task}\"\n`; });
  }
  if (recentEdits.length > 0) {
    output += "\n### Recent Edits (last 5 min)\n";
    recentEdits.forEach(e => { output += `- ${e.ts} ${e.session}: ${e.tool} ${e.file}\n`; });
  }
  output += "\n**Recommendation:** Coordinate before editing these files.";

  appendJSONLineSecure(join(cfg().TERMINALS_DIR, "conflicts.jsonl"), {
    ts: new Date().toISOString(),
    detector: session_id,
    files,
    conflicts: conflicts.map(c => c.session),
  });
  return text(output);
}
