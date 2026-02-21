/**
 * Messaging: check session inboxes.
 * @module messaging
 */

import { existsSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import {
  sanitizeShortSessionId, writeFileSecure, appendJSONLineSecure, assertMessageBudget,
} from "./security.js";
import { readJSON, readJSONLLimited, text } from "./helpers.js";
import { getAllSessions, getSessionStatus } from "./sessions.js";
import { handleWakeSession } from "./platform/wake.js";

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

/**
 * Handle coord_send_message tool call.
 * Writes message to target session's inbox file — zero API tokens.
 * @param {object} args - { from, to, content, priority }
 * @returns {object} MCP text response
 */
export function handleSendMessage(args) {
  const { INBOX_DIR, TERMINALS_DIR } = cfg();
  const from = String(args.from || "lead").trim();
  const to = sanitizeShortSessionId(args.to);
  const content = String(args.content || "").trim();
  const priority = args.priority === "urgent" ? "urgent" : "normal";
  if (!content) return text("Message content is required.");
  assertMessageBudget(content);

  const inboxFile = join(INBOX_DIR, `${to}.jsonl`);
  appendJSONLineSecure(inboxFile, {
    ts: new Date().toISOString(),
    from,
    priority,
    content,
  });

  // Mark session as having messages
  const sessionFile = join(TERMINALS_DIR, `session-${to}.json`);
  if (existsSync(sessionFile)) {
    try {
      const s = readJSON(sessionFile);
      if (s) { s.has_messages = true; writeFileSecure(sessionFile, JSON.stringify(s, null, 2)); }
    } catch {}
  }

  return text(`Message sent to ${to}\n- From: ${from}\n- Priority: ${priority}\n- Content: "${content.slice(0, 200)}"\n- 0 API tokens used.`);
}

/**
 * Handle coord_broadcast tool call.
 * Sends message to ALL active sessions via inbox files — zero API tokens.
 * @param {object} args - { from, content, priority }
 * @returns {object} MCP text response
 */
export function handleBroadcast(args) {
  const { INBOX_DIR } = cfg();
  const from = String(args.from || "lead").trim();
  const content = String(args.content || "").trim();
  const priority = args.priority === "urgent" ? "urgent" : "normal";
  if (!content) return text("Message content is required.");
  assertMessageBudget(content);

  const sessions = getAllSessions().filter(s => getSessionStatus(s) !== "closed");
  if (sessions.length === 0) return text("No active sessions to broadcast to.");

  const msg = {
    ts: new Date().toISOString(),
    from,
    priority,
    content: `[BROADCAST] ${content}`,
  };

  let sent = 0;
  for (const s of sessions) {
    const sid = s.session;
    if (!sid) continue;
    const inboxFile = join(INBOX_DIR, `${sid}.jsonl`);
    try {
      appendJSONLineSecure(inboxFile, msg);
      sent++;
    } catch {}
  }

  return text(`Broadcast sent to ${sent} session(s)\n- From: ${from}\n- Priority: ${priority}\n- Content: "${content.slice(0, 200)}"\n- 0 API tokens used.`);
}

/**
 * Handle coord_send_directive tool call.
 * Sends instruction to a worker/session + auto-wakes if idle.
 * Combined "send + verify delivery" — the lead's primary mid-execution control tool.
 * @param {object} args - { from, to, content, priority }
 * @returns {object} MCP text response
 */
export function handleSendDirective(args) {
  const { INBOX_DIR, TERMINALS_DIR } = cfg();
  const from = String(args.from || "lead").trim();
  const to = sanitizeShortSessionId(args.to);
  const content = String(args.content || "").trim();
  const priority = args.priority === "urgent" ? "urgent" : "normal";
  if (!content) return text("Directive content is required.");
  assertMessageBudget(content);

  // Write to inbox
  const inboxFile = join(INBOX_DIR, `${to}.jsonl`);
  appendJSONLineSecure(inboxFile, {
    ts: new Date().toISOString(),
    from,
    priority,
    content: `[DIRECTIVE] ${content}`,
  });

  // Check session status and mark as having messages
  const sessionFile = join(TERMINALS_DIR, `session-${to}.json`);
  let sessionStatus = "unknown";
  let lastActive = null;
  if (!existsSync(sessionFile)) {
    return text(`Session ${to} not found. Message written to inbox but no active session.\nUse coord_spawn_worker with mode="interactive" to create a controllable worker.`);
  }

  try {
    const s = readJSON(sessionFile);
    if (s) {
      s.has_messages = true;
      writeFileSecure(sessionFile, JSON.stringify(s, null, 2));
      sessionStatus = s.status || "unknown";
      lastActive = s.last_active || null;
    }
  } catch {}

  // Determine if session needs waking
  const lastActiveMs = lastActive ? Date.now() - new Date(lastActive).getTime() : Infinity;
  const isActive = sessionStatus === "active" && lastActiveMs < 60000;
  const needsWake = sessionStatus === "stale" || sessionStatus === "idle" || lastActiveMs > 120000;

  let result = `Directive sent to ${to}\n`;
  result += `- From: ${from}\n- Priority: ${priority}\n`;
  result += `- Content: "${content.slice(0, 200)}"\n`;
  result += `- Session status: ${sessionStatus}\n`;

  if (isActive) {
    result += `- Delivery: Session is active — will receive on next tool call.\n`;
  } else if (needsWake) {
    // Auto-wake the session
    try {
      handleWakeSession({ session_id: to, message: content });
      result += `- Delivery: Session was ${sessionStatus} — auto-wake triggered.\n`;
    } catch (err) {
      result += `- Delivery: Session was ${sessionStatus} — auto-wake failed: ${err.message}. Message is in inbox.\n`;
    }
  } else {
    result += `- Delivery: Will receive on next tool call.\n`;
  }

  result += `- 0 API tokens used.`;
  return text(result);
}
