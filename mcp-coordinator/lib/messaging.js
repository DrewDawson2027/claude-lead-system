/**
 * Messaging: check session inboxes.
 * @module messaging
 */

import { randomUUID } from "crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import {
  sanitizeShortSessionId,
  writeFileSecure,
  appendJSONLineSecure,
  assertMessageBudget,
  enforceMessageRateLimit,
} from "./security.js";
import { readJSON, readJSONLLimited, text } from "./helpers.js";
import { getAllSessions, getSessionStatus } from "./sessions.js";
import { handleWakeSession } from "./platform/wake.js";
import { readTeamConfig } from "./teams.js";
import { tmuxSendKeys, isInsideTmux } from "./platform/common.js";

/**
 * Check if a team is configured for native or hybrid execution path.
 * @param {string|null} teamName - Team name to check
 * @returns {boolean} True if native delivery should be attempted
 */
function isNativeDeliveryAvailable(teamName) {
  if (!teamName) return false;
  const team = readTeamConfig(teamName);
  return team?.execution_path === "native" || team?.execution_path === "hybrid";
}

/**
 * Queue an action for the native bridge to pick up.
 * The lead session translates these into native SendMessage calls on its next tool call.
 * Enforces 5-minute TTL and max queue depth of 50 to prevent stale action buildup.
 * @param {object} action - Action descriptor to queue
 */
function queueNativeAction(action) {
  const actionsDir = join(
    cfg().CLAUDE_DIR,
    "lead-sidecar",
    "runtime",
    "actions",
    "pending",
  );
  mkdirSync(actionsDir, { recursive: true });

  const TTL_MS = 5 * 60 * 1000; // 5 minutes
  const MAX_QUEUE_DEPTH = 50;
  let files = [];
  try {
    files = readdirSync(actionsDir).filter((f) => f.endsWith(".json"));
    const now = Date.now();
    for (const f of files) {
      try {
        const mtime = statSync(join(actionsDir, f)).mtimeMs;
        if (now - mtime > TTL_MS) unlinkSync(join(actionsDir, f));
      } catch {}
    }
    files = readdirSync(actionsDir).filter((f) => f.endsWith(".json"));
  } catch {}

  if (files.length >= MAX_QUEUE_DEPTH) {
    process.stderr.write(
      `coord: native action queue full (${files.length}/${MAX_QUEUE_DEPTH}), dropping: ${action.action}\n`,
    );
    return;
  }

  writeFileSecure(
    join(actionsDir, `msg-${Date.now()}.json`),
    JSON.stringify(action, null, 2),
  );
}

/**
 * Handle coord_check_inbox tool call.
 * @param {object} args - { session_id }
 * @returns {object} MCP text response
 */
export function handleCheckInbox(args) {
  const { TERMINALS_DIR, INBOX_DIR } = cfg();
  const sid = sanitizeShortSessionId(args.session_id);
  const inboxFile = join(INBOX_DIR, `${sid}.jsonl`);
  const drainFile = join(
    INBOX_DIR,
    `${sid}.drain.${Date.now()}.${process.pid}.jsonl`,
  );
  let messages = [];
  let truncated = false;
  try {
    if (existsSync(inboxFile)) renameSync(inboxFile, drainFile);
  } catch (e) {
    process.stderr.write(`coord: inbox rename failed: ${e.message}\n`);
  }
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
    try {
      if (existsSync(drainFile)) unlinkSync(drainFile);
    } catch {}
    if (!existsSync(inboxFile)) writeFileSecure(inboxFile, "");
    return text("No pending messages.");
  }

  try {
    if (existsSync(drainFile)) unlinkSync(drainFile);
  } catch {}
  if (!existsSync(inboxFile)) writeFileSecure(inboxFile, "");
  const sessionFile = join(TERMINALS_DIR, `session-${sid}.json`);
  if (existsSync(sessionFile)) {
    try {
      const s = readJSON(sessionFile);
      if (s) {
        s.has_messages = false;
        writeFileSecure(sessionFile, JSON.stringify(s, null, 2));
      }
    } catch {}
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
 * Resolve a worker name to a session ID by scanning session files.
 * Checks active sessions first, then falls back to meta files.
 * @param {string} targetName - Worker name to resolve
 * @returns {string|null} Session ID (8-char) or null
 */
export function resolveWorkerName(targetName) {
  // Check session files for worker_name field (set by heartbeat from CLAUDE_WORKER_NAME env var)
  const sessions = getAllSessions();
  for (const s of sessions) {
    if (s.worker_name === targetName && getSessionStatus(s) !== "closed") {
      return s.session;
    }
  }
  // Fallback: check meta files for worker_name matching task_id pattern
  const { RESULTS_DIR } = cfg();
  try {
    const files = readdirSync(RESULTS_DIR).filter(
      (f) => f.endsWith(".meta.json") && !f.includes(".done"),
    );
    for (const f of files) {
      const meta = readJSON(join(RESULTS_DIR, f));
      if (meta?.worker_name === targetName && meta.notify_session_id) {
        // Find the worker's session by checking its notify relationship
        const workerSessions = sessions.filter(
          (s) => s.current_task === meta.task_id,
        );
        if (workerSessions.length > 0) return workerSessions[0].session;
      }
    }
  } catch {}
  return null;
}

/**
 * Resolve a target (session ID or worker name) to a tmux pane ID.
 * Scans meta files for tmux_pane_id matching the target.
 * @param {string} sessionId - Target session ID
 * @param {string|null} targetName - Target worker name
 * @returns {string|null} Tmux pane ID or null
 */
function resolveTargetPaneId(sessionId, targetName) {
  const { RESULTS_DIR } = cfg();
  try {
    const files = readdirSync(RESULTS_DIR).filter(
      (f) => f.endsWith(".meta.json") && !f.includes(".done"),
    );
    for (const f of files) {
      const meta = readJSON(join(RESULTS_DIR, f));
      if (!meta?.tmux_pane_id) continue;
      // Match by worker name or by session ID (first 8 chars of claude_session_id)
      if (targetName && meta.worker_name === targetName)
        return meta.tmux_pane_id;
      if (
        meta.claude_session_id &&
        meta.claude_session_id.slice(0, 8) === sessionId
      )
        return meta.tmux_pane_id;
      if (meta.notify_session_id === sessionId) continue; // That's the lead, not the worker
    }
  } catch {}
  // Also check session files for tmux_pane_id
  const sessions = getAllSessions();
  for (const s of sessions) {
    if (s.session === sessionId && s.tmux_pane_id) return s.tmux_pane_id;
  }
  return null;
}

/**
 * Handle coord_send_message tool call.
 * Writes message to target session's inbox file — zero API tokens.
 * Supports name-based targeting via target_name parameter.
 * @param {object} args - { from, to, target_name, content, priority }
 * @returns {object} MCP text response
 */
export function handleSendMessage(args) {
  const { INBOX_DIR, TERMINALS_DIR, RESULTS_DIR } = cfg();
  const from = String(args.from || "lead").trim();
  const content = String(args.content || "").trim();
  const summary = args.summary ? String(args.summary).trim().slice(0, 50) : "";
  const priority = args.priority === "urgent" ? "urgent" : "normal";
  if (!content) return text("Message content is required.");
  assertMessageBudget(content);

  // Name-based resolution: resolve target_name → session ID
  let to;
  const targetName = args.target_name ? String(args.target_name).trim() : null;
  if (targetName) {
    const resolved = resolveWorkerName(targetName);
    if (!resolved)
      return text(
        `Worker name "${targetName}" not found. Use coord_list_sessions to find active workers.`,
      );
    to = resolved;
  } else if (args.to) {
    to = sanitizeShortSessionId(args.to);
  } else {
    return text(
      "Either 'to' (session ID) or 'target_name' (worker name) is required.",
    );
  }

  const inboxFile = join(INBOX_DIR, `${to}.jsonl`);
  enforceMessageRateLimit(to);
  const msg = {
    ts: new Date().toISOString(),
    from,
    priority,
    content,
  };
  if (summary) msg.summary = summary;
  appendJSONLineSecure(inboxFile, msg);

  // Mark session as having messages
  const sessionFile = join(TERMINALS_DIR, `session-${to}.json`);
  let sessionStatus = "unknown";
  let lastActive = null;
  if (existsSync(sessionFile)) {
    try {
      const s = readJSON(sessionFile);
      if (s) {
        s.has_messages = true;
        writeFileSecure(sessionFile, JSON.stringify(s, null, 2));
        sessionStatus = s.status || "unknown";
        lastActive = s.last_active || null;
      }
    } catch {}
  }

  // Tmux push delivery: inject message into target's tmux pane (Gap 1)
  let tmuxPushed = false;
  if (isInsideTmux()) {
    const targetPaneId = resolveTargetPaneId(to, targetName);
    if (targetPaneId) {
      const pushText = summary
        ? `[MSG from ${from}] ${summary}: ${content.slice(0, 500)}`
        : `[MSG from ${from}] ${content.slice(0, 500)}`;
      tmuxPushed = tmuxSendKeys(targetPaneId, pushText);
    }
  }

  // Auto-wake if session is idle/stale (merged from handleSendDirective)
  let wakeStatus = "";
  const lastActiveMs = lastActive
    ? Date.now() - new Date(lastActive).getTime()
    : Infinity;
  const needsWake =
    sessionStatus === "stale" ||
    sessionStatus === "idle" ||
    lastActiveMs > 120000;
  if (needsWake && !tmuxPushed) {
    try {
      handleWakeSession({ session_id: to, message: content });
      wakeStatus = ` Auto-wake triggered.`;
    } catch {
      /* wake is best-effort */
    }
  }

  // If team uses native/hybrid execution, also queue for native push delivery
  const teamName = args.team_name ? String(args.team_name).trim() : null;
  let nativePush = false;
  if (isNativeDeliveryAvailable(teamName)) {
    queueNativeAction({
      ts: new Date().toISOString(),
      action: "native_send_message",
      recipient: targetName || to,
      content,
      priority,
      delivery: "native_push",
    });
    nativePush = true;
  }

  return text(
    `Message sent to ${to}\n- From: ${from}\n- Priority: ${priority}\n- Content: "${content.slice(0, 200)}"` +
      (summary ? `\n- Summary: "${summary}"` : "") +
      (tmuxPushed ? `\n- Tmux push: delivered to pane.` : "") +
      (nativePush ? `\n- Native push: queued for delivery.` : "") +
      wakeStatus +
      `\n- 0 API tokens used.`,
  );
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

  const sessions = getAllSessions().filter(
    (s) => getSessionStatus(s) !== "closed",
  );
  if (sessions.length === 0) return text("No active sessions to broadcast to.");

  const msg = {
    ts: new Date().toISOString(),
    from,
    priority,
    content: `[BROADCAST] ${content}`,
  };

  let sent = 0;
  let tmuxPushCount = 0;
  let skippedRateLimit = 0;
  for (const s of sessions) {
    const sid = s.session;
    if (!sid) continue;
    const inboxFile = join(INBOX_DIR, `${sid}.jsonl`);
    try {
      enforceMessageRateLimit(sid);
      appendJSONLineSecure(inboxFile, msg);
      sent++;
      // Tmux push delivery to each pane (Gap 1)
      if (isInsideTmux()) {
        const paneId = resolveTargetPaneId(sid, null);
        if (
          paneId &&
          tmuxSendKeys(
            paneId,
            `[BROADCAST from ${from}] ${content.slice(0, 300)}`,
          )
        ) {
          tmuxPushCount++;
        }
      }
    } catch (err) {
      if (/Rate limit exceeded/i.test(String(err?.message || ""))) {
        skippedRateLimit++;
      }
    }
  }

  let response = `Broadcast sent to ${sent} session(s)\n- From: ${from}\n- Priority: ${priority}\n- Content: "${content.slice(0, 200)}"`;
  if (tmuxPushCount > 0) {
    response += `\n- Tmux push: delivered to ${tmuxPushCount} pane(s).`;
  }
  if (skippedRateLimit > 0) {
    response += `\n- Skipped (rate-limited): ${skippedRateLimit}`;
  }
  response += "\n- 0 API tokens used.";
  return text(response);
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
  enforceMessageRateLimit(to);
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
    return text(
      `Session ${to} not found. Message written to inbox but no active session.\nUse coord_spawn_worker with mode="interactive" to create a controllable worker.`,
    );
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
  const lastActiveMs = lastActive
    ? Date.now() - new Date(lastActive).getTime()
    : Infinity;
  const isActive = sessionStatus === "active" && lastActiveMs < 60000;
  const needsWake =
    sessionStatus === "stale" ||
    sessionStatus === "idle" ||
    lastActiveMs > 120000;

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

/**
 * Handle coord_send_protocol tool call.
 * Sends structured protocol messages (shutdown_request, shutdown_response, plan_approval_response).
 * Matches native SendMessage's 5-type protocol. (Gap 3)
 * @param {object} args - { type, recipient, request_id, approve, content }
 * @returns {object} MCP text response
 */
export function handleSendProtocol(args) {
  const { INBOX_DIR, RESULTS_DIR } = cfg();
  const type = String(args.type || "").trim();
  const validTypes = [
    "shutdown_request",
    "shutdown_response",
    "plan_approval_response",
  ];
  if (!validTypes.includes(type)) {
    return text(
      `Invalid protocol type "${type}". Valid: ${validTypes.join(", ")}`,
    );
  }

  const from = String(args.from || "lead").trim();
  const requestId = args.request_id || randomUUID().slice(0, 8);

  // Resolve recipient — by name or session ID
  let to;
  const recipient = args.recipient ? String(args.recipient).trim() : null;
  if (recipient) {
    const resolved = resolveWorkerName(recipient);
    to = resolved || sanitizeShortSessionId(recipient);
  } else if (args.to) {
    to = sanitizeShortSessionId(args.to);
  } else {
    return text(
      "Either 'recipient' (worker name) or 'to' (session ID) is required.",
    );
  }

  let protocolContent;
  if (type === "shutdown_request") {
    protocolContent = `[SHUTDOWN_REQUEST] request_id=${requestId} from=${from}. Please save your work and respond with coord_send_protocol type=shutdown_response request_id=${requestId} approve=true/false`;
  } else if (type === "shutdown_response") {
    const approve = args.approve !== false && args.approve !== "false";
    protocolContent = `[SHUTDOWN_RESPONSE] request_id=${requestId} approved=${approve}`;
  } else if (type === "plan_approval_response") {
    const approve = args.approve !== false && args.approve !== "false";
    const feedback = args.content ? String(args.content).trim() : "";
    protocolContent = approve
      ? `[APPROVED] request_id=${requestId}${feedback ? ` — ${feedback}` : ""}`
      : `[REVISION] request_id=${requestId}${feedback ? ` — ${feedback}` : ""}`;
  }

  const inboxFile = join(INBOX_DIR, `${to}.jsonl`);
  enforceMessageRateLimit(to);
  appendJSONLineSecure(inboxFile, {
    ts: new Date().toISOString(),
    from,
    priority: "urgent",
    content: protocolContent,
    protocol_type: type,
    request_id: requestId,
  });

  // Tmux push delivery
  let tmuxPushed = false;
  if (isInsideTmux()) {
    const paneId = resolveTargetPaneId(to, recipient);
    if (paneId) {
      tmuxPushed = tmuxSendKeys(paneId, protocolContent);
    }
  }

  return text(
    `Protocol message sent to ${to}\n` +
      `- Type: ${type}\n- Request ID: ${requestId}\n- From: ${from}\n` +
      `- Content: "${protocolContent.slice(0, 200)}"` +
      (tmuxPushed ? `\n- Tmux push: delivered to pane.` : "") +
      `\n- 0 API tokens used.`,
  );
}

/**
 * Handle coord_drain_native_queue tool call.
 * Processes pending native actions from the action queue, delivering each via
 * the coordinator inbox path. Moves processed files to done/ subdirectory.
 * Call this from the lead session to flush the native bridge outbox.
 * @param {object} _args - (no arguments)
 * @returns {object} MCP text response
 */
export function handleDrainNativeQueue(_args) {
  const actionsDir = join(
    cfg().CLAUDE_DIR,
    "lead-sidecar",
    "runtime",
    "actions",
    "pending",
  );
  const doneDir = join(actionsDir, "..", "done");
  mkdirSync(doneDir, { recursive: true });

  let files = [];
  try {
    files = readdirSync(actionsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return text("Native action queue is empty or not initialized.");
  }
  if (files.length === 0) return text("Native action queue is empty.");

  const TTL_MS = 5 * 60 * 1000;
  const now = Date.now();
  let processed = 0;
  let skipped = 0;
  let expired = 0;
  const results = [];

  for (const f of files) {
    const filePath = join(actionsDir, f);
    try {
      const mtime = statSync(filePath).mtimeMs;
      if (now - mtime > TTL_MS) {
        unlinkSync(filePath);
        expired++;
        continue;
      }
      const action = JSON.parse(readFileSync(filePath, "utf8"));
      if (
        action.action === "native_send_message" &&
        action.recipient &&
        action.content
      ) {
        // Route: 8-char hex = session ID (use `to`), otherwise worker name (use target_name)
        const isSessionId = /^[0-9a-f]{8}$/i.test(action.recipient);
        handleSendMessage({
          from: "native-bridge",
          ...(isSessionId
            ? { to: action.recipient }
            : { target_name: action.recipient }),
          content: action.content,
          priority: action.priority || "normal",
        });
        results.push(`✓ ${action.action} → ${action.recipient}`);
        processed++;
      } else {
        results.push(`? unknown action type: ${action.action}`);
        skipped++;
      }
      // Move to done/
      renameSync(filePath, join(doneDir, f));
    } catch {
      skipped++;
    }
  }

  return text(
    `Native queue drained: ${processed} processed, ${skipped} skipped, ${expired} expired\n` +
      (results.length ? results.map((r) => `- ${r}`).join("\n") : ""),
  );
}
