/**
 * Task board: create, update, list, get tasks with dependency tracking.
 * File-based storage — zero API token cost for coordination.
 * @module tasks
 */

import { existsSync, readdirSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import { sanitizeId, sanitizeName, writeFileSecure, ensureSecureDirectory } from "./security.js";
import { readJSON, text } from "./helpers.js";

// ── C2: Audit Trail ──

function auditFile(taskId) {
  return join(cfg().RESULTS_DIR, `${sanitizeId(taskId, "task_id")}.audit.jsonl`);
}

export function appendAuditEntry(taskId, event, from, to, details = {}) {
  const entry = { ts: new Date().toISOString(), event, from: from || null, to: to || null, details };
  try {
    appendFileSync(auditFile(taskId), JSON.stringify(entry) + "\n", "utf-8");
  } catch {}
}

export function readAuditTrail(taskId) {
  try {
    return readFileSync(auditFile(taskId), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

export function handleGetTaskAudit(args) {
  const taskId = sanitizeId(args.task_id, "task_id");
  const trail = readAuditTrail(taskId);
  if (trail.length === 0) return text(`No audit trail for task ${taskId}.`);
  let out = `## Audit Trail: ${taskId} (${trail.length} events)\n\n`;
  for (const e of trail) {
    out += `- **${e.ts}** ${e.event}`;
    if (e.from) out += ` from=${e.from}`;
    if (e.to) out += ` to=${e.to}`;
    if (e.details && Object.keys(e.details).length) out += ` | ${JSON.stringify(e.details)}`;
    out += `\n`;
  }
  return text(out);
}

// ── C3: Quality Gates ──

export function handleCheckQualityGates(args) {
  const taskId = sanitizeId(args.task_id, "task_id");
  const task = readJSON(join(tasksDir(), `${taskId}.json`));
  if (!task) return text(`Task ${taskId} not found.`);
  const gates = Array.isArray(task.metadata?.quality_gates) ? task.metadata.quality_gates : [];
  const criteria = Array.isArray(task.metadata?.acceptance_criteria) ? task.metadata.acceptance_criteria : [];
  if (gates.length === 0 && criteria.length === 0) return text(`Task ${taskId} has no quality gates or acceptance criteria.`);

  const results = [];
  for (const gate of gates) {
    const passed = task.metadata?.gate_results?.[gate] === true;
    results.push({ gate, passed, type: "quality_gate" });
  }
  for (const criterion of criteria) {
    const passed = (task.metadata?.criteria_results || []).includes(criterion);
    results.push({ gate: criterion, passed, type: "acceptance_criterion" });
  }
  const allPassed = results.every(r => r.passed);
  let out = `## Quality Gates: ${taskId}\n\n`;
  out += `- Overall: ${allPassed ? "PASS" : "FAIL"}\n\n`;
  for (const r of results) {
    out += `- ${r.passed ? "[x]" : "[ ]"} (${r.type}) ${r.gate}\n`;
  }
  return text(out);
}

// ── C1: Reassignment ──

export function handleReassignTask(args) {
  const taskId = sanitizeId(args.task_id, "task_id");
  const dir = tasksDir();
  const taskFile = join(dir, `${taskId}.json`);
  const task = readJSON(taskFile);
  if (!task) return text(`Task ${taskId} not found.`);
  if (task.status !== "in_progress") return text(`Task ${taskId} is not in_progress (current: ${task.status}). Only in-progress tasks can be reassigned.`);

  const newAssignee = args.new_assignee ? sanitizeName(args.new_assignee, "new_assignee") : null;
  if (!newAssignee) return text("new_assignee is required.");
  const oldAssignee = task.assignee || null;
  if (oldAssignee === newAssignee) return text(`Task ${taskId} is already assigned to ${newAssignee}.`);

  // Build handoff snapshot
  const handoff = {
    task_id: taskId,
    subject: task.subject,
    from: oldAssignee,
    to: newAssignee,
    reason: args.reason || "manual reassignment",
    handoff_at: new Date().toISOString(),
    task_description: task.description || "",
    files: task.files || [],
    metadata_snapshot: task.metadata || {},
    progress_context: args.progress_context || null,
  };
  const handoffFile = join(cfg().RESULTS_DIR, `${taskId}.handoff.json`);
  writeFileSecure(handoffFile, JSON.stringify(handoff, null, 2));

  // Update task
  task.assignee = newAssignee;
  task.updated = new Date().toISOString();
  if (!task.metadata) task.metadata = {};
  task.metadata.last_reassignment = {
    from: oldAssignee,
    to: newAssignee,
    at: handoff.handoff_at,
    reason: handoff.reason,
  };
  writeFileSecure(taskFile, JSON.stringify(task, null, 2));

  // Audit trail
  appendAuditEntry(taskId, "reassigned", oldAssignee, newAssignee, { reason: handoff.reason });

  return text(
    `## Task Reassigned: ${taskId}\n\n` +
    `- Subject: ${task.subject}\n` +
    `- From: ${oldAssignee || "unassigned"}\n` +
    `- To: ${newAssignee}\n` +
    `- Reason: ${handoff.reason}\n` +
    `- Handoff snapshot: ${handoffFile}\n`
  );
}

/**
 * Get the tasks directory path, ensuring it exists.
 * @returns {string} Tasks directory path
 */
function tasksDir() {
  const dir = join(cfg().TERMINALS_DIR, "tasks");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try { ensureSecureDirectory(dir); } catch {}
  }
  return dir;
}

/**
 * Read all task files from disk.
 * @returns {object[]} Array of task objects
 */
function getAllTasks() {
  const dir = tasksDir();
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => readJSON(join(dir, f)))
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Handle coord_create_task tool call.
 * @param {object} args - { subject, description, assignee, priority, files, blocked_by }
 * @returns {object} MCP text response
 */
export function handleCreateTask(args) {
  const subject = String(args.subject || "").trim();
  if (!subject) return text("Subject is required.");

  const taskId = args.task_id
    ? sanitizeId(args.task_id, "task_id")
    : `T${Date.now()}`;
  const dir = tasksDir();
  const taskFile = join(dir, `${taskId}.json`);
  if (existsSync(taskFile)) return text(`Task ${taskId} already exists.`);

  const task = {
    task_id: taskId,
    subject,
    description: String(args.description || "").trim(),
    status: "pending",
    team_name: args.team_name ? sanitizeName(args.team_name, "team_name") : null,
    assignee: args.assignee ? sanitizeName(args.assignee, "assignee") : null,
    priority: args.priority === "high" ? "high" : args.priority === "low" ? "low" : "normal",
    files: (args.files || []).map(f => String(f).trim()).filter(Boolean),
    blocked_by: (args.blocked_by || []).map(id => sanitizeId(id, "blocked_by")),
    blocks: [],
    metadata: (args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)) ? args.metadata : {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  // Update reverse references: for each blocked_by, add this task to their blocks
  for (const depId of task.blocked_by) {
    const depFile = join(dir, `${depId}.json`);
    const dep = readJSON(depFile);
    if (dep) {
      if (!dep.blocks) dep.blocks = [];
      if (!dep.blocks.includes(taskId)) dep.blocks.push(taskId);
      dep.updated = new Date().toISOString();
      writeFileSecure(depFile, JSON.stringify(dep, null, 2));
    }
  }

  writeFileSecure(taskFile, JSON.stringify(task, null, 2));
  appendAuditEntry(taskId, "created", null, task.assignee, { subject, priority: task.priority, team: task.team_name });
  if (task.assignee) appendAuditEntry(taskId, "assigned", null, task.assignee, {});
  return text(
    `Task created: **${taskId}**\n` +
    `- Subject: ${subject}\n` +
    `- Priority: ${task.priority}\n` +
    `- Team: ${task.team_name || "none"}\n` +
    `- Assignee: ${task.assignee || "unassigned"}\n` +
    `- Blocked by: ${task.blocked_by.length ? task.blocked_by.join(", ") : "none"}`
  );
}

/**
 * Handle coord_update_task tool call.
 * @param {object} args - { task_id, status, assignee, add_blocked_by, add_blocks }
 * @returns {object} MCP text response
 */
export function handleUpdateTask(args) {
  const taskId = sanitizeId(args.task_id, "task_id");
  const dir = tasksDir();
  const taskFile = join(dir, `${taskId}.json`);
  const task = readJSON(taskFile);
  if (!task) return text(`Task ${taskId} not found.`);

  const changes = [];

  if (args.status) {
    const valid = ["pending", "in_progress", "completed", "cancelled"];
    if (!valid.includes(args.status)) return text(`Invalid status. Use: ${valid.join(", ")}`);
    task.status = args.status;
    changes.push(`status → ${args.status}`);
  }
  if (args.assignee !== undefined) {
    task.assignee = args.assignee ? sanitizeName(args.assignee, "assignee") : null;
    changes.push(`assignee → ${task.assignee || "unassigned"}`);
  }
  if (args.team_name !== undefined) {
    task.team_name = args.team_name ? sanitizeName(args.team_name, "team_name") : null;
    changes.push(`team → ${task.team_name || "none"}`);
  }
  if (args.subject) {
    task.subject = String(args.subject).trim();
    changes.push(`subject updated`);
  }
  if (args.description !== undefined) {
    task.description = String(args.description).trim();
    changes.push(`description updated`);
  }
  if (args.priority) {
    task.priority = args.priority === "high" ? "high" : args.priority === "low" ? "low" : "normal";
    changes.push(`priority → ${task.priority}`);
  }

  // Add blocked_by dependencies
  if (args.add_blocked_by?.length) {
    if (!task.blocked_by) task.blocked_by = [];
    for (const depId of args.add_blocked_by) {
      const id = sanitizeId(depId, "blocked_by");
      if (!task.blocked_by.includes(id)) {
        task.blocked_by.push(id);
        // Update reverse ref
        const depFile = join(dir, `${id}.json`);
        const dep = readJSON(depFile);
        if (dep) {
          if (!dep.blocks) dep.blocks = [];
          if (!dep.blocks.includes(taskId)) dep.blocks.push(taskId);
          dep.updated = new Date().toISOString();
          writeFileSecure(depFile, JSON.stringify(dep, null, 2));
        }
      }
    }
    changes.push(`blocked_by += ${args.add_blocked_by.join(", ")}`);
  }

  // Add blocks references
  if (args.add_blocks?.length) {
    if (!task.blocks) task.blocks = [];
    for (const targetId of args.add_blocks) {
      const id = sanitizeId(targetId, "blocks");
      if (!task.blocks.includes(id)) {
        task.blocks.push(id);
        // Update reverse ref
        const targetFile = join(dir, `${id}.json`);
        const target = readJSON(targetFile);
        if (target) {
          if (!target.blocked_by) target.blocked_by = [];
          if (!target.blocked_by.includes(taskId)) target.blocked_by.push(taskId);
          target.updated = new Date().toISOString();
          writeFileSecure(targetFile, JSON.stringify(target, null, 2));
        }
      }
    }
    changes.push(`blocks += ${args.add_blocks.join(", ")}`);
  }

  // Merge metadata (null values delete keys)
  if (args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)) {
    if (!task.metadata) task.metadata = {};
    for (const [k, v] of Object.entries(args.metadata)) {
      if (v === null) {
        delete task.metadata[k];
      } else {
        task.metadata[k] = v;
      }
    }
    changes.push(`metadata updated`);
  }

  if (changes.length === 0) return text("No changes specified.");

  task.updated = new Date().toISOString();
  writeFileSecure(taskFile, JSON.stringify(task, null, 2));
  // C2: Audit trail for updates
  for (const change of changes) {
    if (change.startsWith("status")) appendAuditEntry(taskId, `status_${args.status}`, null, null, { change });
    else if (change.startsWith("assignee")) appendAuditEntry(taskId, "assigned", null, task.assignee, { change });
    else appendAuditEntry(taskId, "updated", null, null, { change });
  }
  return text(`Task ${taskId} updated:\n${changes.map(c => `- ${c}`).join("\n")}`);
}

/**
 * Handle coord_list_tasks tool call.
 * @param {object} args - { status, assignee }
 * @returns {object} MCP text response
 */
export function handleListTasks(args = {}) {
  let tasks = getAllTasks();
  if (args.status) tasks = tasks.filter(t => t.status === args.status);
  if (args.assignee) tasks = tasks.filter(t => t.assignee === args.assignee);
  if (args.team_name) {
    const tn = sanitizeName(args.team_name, "team_name");
    tasks = tasks.filter(t => t.team_name === tn || t.metadata?.team_name === tn);
  }

  if (tasks.length === 0) return text("No tasks found.");

  // Sort: in_progress first, then pending, then completed
  const order = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 };
  tasks.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));

  // Check which blocked_by tasks are actually done
  const statusMap = new Map(tasks.map(t => [t.task_id, t.status]));

  const rows = tasks.map(t => {
    const openBlockers = (t.blocked_by || []).filter(id => {
      const s = statusMap.get(id);
      return s && s !== "completed" && s !== "cancelled";
    });
    const blocked = openBlockers.length > 0 ? `BLOCKED(${openBlockers.join(",")})` : "";
    return `| ${t.task_id} | ${t.team_name || "-"} | ${t.subject.slice(0, 40)} | ${t.status} | ${t.priority} | ${t.assignee || "-"} | ${blocked} |`;
  });

  const table = `| ID | Team | Subject | Status | Priority | Assignee | Blocked |\n|-----|------|---------|--------|----------|----------|---------|` + "\n" + rows.join("\n");
  return text(`## Tasks (${tasks.length})\n\n${table}`);
}

/**
 * Handle coord_get_task tool call.
 * @param {object} args - { task_id }
 * @returns {object} MCP text response
 */
export function handleGetTask(args) {
  const taskId = sanitizeId(args.task_id, "task_id");
  const task = readJSON(join(tasksDir(), `${taskId}.json`));
  if (!task) return text(`Task ${taskId} not found.`);

  let output = `## Task ${taskId}\n\n`;
  output += `- **Subject:** ${task.subject}\n`;
  output += `- **Status:** ${task.status}\n`;
  output += `- **Priority:** ${task.priority}\n`;
  output += `- **Team:** ${task.team_name || "none"}\n`;
  output += `- **Assignee:** ${task.assignee || "unassigned"}\n`;
  output += `- **Created:** ${task.created}\n`;
  output += `- **Updated:** ${task.updated}\n`;
  if (task.description) output += `\n### Description\n${task.description}\n`;
  if (task.files?.length) output += `\n### Files\n${task.files.map(f => `- ${f}`).join("\n")}\n`;
  if (task.blocked_by?.length) output += `\n### Blocked By\n${task.blocked_by.map(id => `- ${id}`).join("\n")}\n`;
  if (task.blocks?.length) output += `\n### Blocks\n${task.blocks.map(id => `- ${id}`).join("\n")}\n`;
  if (task.metadata && Object.keys(task.metadata).length > 0) {
    output += `\n### Metadata\n${Object.entries(task.metadata).map(([k, v]) => `- **${k}:** ${JSON.stringify(v)}`).join("\n")}\n`;
  }

  return text(output);
}
