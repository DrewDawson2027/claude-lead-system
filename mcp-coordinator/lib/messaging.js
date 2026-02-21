/**
 * Messaging: check session inboxes.
 * @module messaging
 */

import { existsSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import {
  sanitizeShortSessionId, writeFileSecure,
} from "./security.js";
import { readJSON, readJSONLLimited, text } from "./helpers.js";

/**
 * Handle coord_check_inbox tool call.
 * @param {object} args - { session_id }
 * @returns {object} MCP text response
 */
export function handleCheckInbox(args) {
  const { TERMINALS_DIR, INBOX_DIR } = cfg();
  const sid = sanitizeShortSessionId(args.session_id);
  const inboxFile = join(INBOX_DIR, `${sid}.jsonl`);
  const drainFile = join(INBOX_DIR, `${sid}.drain.${Date.now()}.${process.pid}.jsonl`);
  let messages = [];
  let truncated = false;
  try {
    if (existsSync(inboxFile)) renameSync(inboxFile, drainFile);
  } catch (e) { process.stderr.write(`coord: inbox rename failed: ${e.message}\n`); }
  if (existsSync(drainFile)) {
    const read = readJSONLLimited(drainFile);
    messages = read.items;
    truncated = read.truncated;
  } else {
    const read = readJSONLLimited(inboxFile);
    messages = read.items;
    truncated = read.truncated;
  }
  if (messages.length === 0) {
    try { if (existsSync(drainFile)) unlinkSync(drainFile); } catch {}
    if (!existsSync(inboxFile)) writeFileSecure(inboxFile, "");
    return text("No pending messages.");
  }

  try { if (existsSync(drainFile)) unlinkSync(drainFile); } catch {}
  if (!existsSync(inboxFile)) writeFileSecure(inboxFile, "");
  const sessionFile = join(TERMINALS_DIR, `session-${sid}.json`);
  if (existsSync(sessionFile)) {
    try { const s = readJSON(sessionFile); if (s) { s.has_messages = false; writeFileSecure(sessionFile, JSON.stringify(s, null, 2)); } } catch {}
  }

  let output = `## ${messages.length} Message(s)\n\n`;
  if (truncated) {
    output += `_Inbox output truncated to safety limits._\n\n`;
  }
  messages.forEach((m, i) => {
    output += `### Message ${i + 1}${m.priority === "urgent" ? " **[URGENT]**" : ""}\n`;
    output += `- **From:** ${m.from}\n- **Time:** ${m.ts}\n- **Content:** ${m.content}\n\n`;
  });
  return text(output);
}
