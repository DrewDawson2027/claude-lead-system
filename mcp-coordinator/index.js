#!/usr/bin/env node

/**
 * MCP Coordinator Server — thin routing layer.
 * All logic lives in lib/ modules. This file wires up the MCP server,
 * defines tool schemas, and dispatches calls.
 * @module index
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "url";
import { join } from "path";

import { cfg } from "./lib/constants.js";
import {
  sanitizeId, sanitizeShortSessionId, sanitizeName,
  sanitizeModel, sanitizeAgent, requireDirectoryPath, normalizeFilePath,
  ensureSecureDirectory, sleepMs, acquireExclusiveFileLock, enforceMessageRateLimit,
} from "./lib/security.js";
import { readJSONLLimited, batQuote, text } from "./lib/helpers.js";
import { handleListSessions, handleGetSession, getSessionStatus } from "./lib/sessions.js";
import { handleCheckInbox, handleSendMessage, handleBroadcast, handleSendDirective } from "./lib/messaging.js";
import { handleDetectConflicts } from "./lib/conflicts.js";
import {
  handleSpawnWorker, handleGetResult, handleKillWorker,
  handleSpawnTerminal,
} from "./lib/workers.js";
import { handleRunPipeline, handleGetPipeline } from "./lib/pipelines.js";
import { handleCreateTask, handleUpdateTask, handleListTasks, handleGetTask } from "./lib/tasks.js";
import { handleCreateTeam, handleGetTeam, handleListTeams } from "./lib/teams.js";
import { runGC } from "./lib/gc.js";
import { handleWakeSession } from "./lib/platform/wake.js";
import { selectWakeText } from "./lib/platform/wake.js";
import {
  buildPlatformLaunchCommand, isProcessAlive, killProcess,
  isSafeTTYPath, buildWorkerScript, buildInteractiveWorkerScript,
} from "./lib/platform/common.js";

// ─────────────────────────────────────────────────────────
// SERVER SETUP
// ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "coordinator", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// ─────────────────────────────────────────────────────────
// TOOL DEFINITIONS (declarative schemas — no logic to test)
// ─────────────────────────────────────────────────────────

/* c8 ignore start — tool schemas are declarative data, tested via dispatch */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "coord_list_sessions",
      description: "List all Claude Code sessions. Shows enriched data: tool_counts, files_touched, recent_ops. Cross-platform.",
      inputSchema: {
        type: "object",
        properties: {
          include_closed: { type: "boolean", description: "Include closed sessions (default: false)" },
          project: { type: "string", description: "Filter by project name" },
        },
      },
    },
    {
      name: "coord_get_session",
      description: "Get detailed info about a session including enriched metadata, plan file, and recent prompts.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "First 8 chars of the session ID" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "coord_check_inbox",
      description: "Check and retrieve pending messages for a session.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID (first 8 chars)" },
        },
        required: ["session_id"],
      },
    },
    {
      name: "coord_detect_conflicts",
      description: "Detect file conflicts across sessions using both current_files and files_touched from enriched session data.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Your session ID" },
          files: { type: "array", items: { type: "string" }, description: "File paths to check" },
        },
        required: ["session_id", "files"],
      },
    },
    {
      name: "coord_spawn_terminal",
      description: "Open a new interactive Claude Code terminal. Cross-platform: macOS (iTerm2/Terminal.app), Windows (Windows Terminal/cmd), Linux (gnome-terminal/konsole/kitty/etc).",
      inputSchema: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Directory to open in" },
          initial_prompt: { type: "string", description: "Optional initial prompt for the new terminal" },
          layout: { type: "string", enum: ["tab", "split"], description: "'tab' (default) or 'split' (side-by-side where supported: iTerm2, Windows Terminal, kitty)" },
        },
        required: ["directory"],
      },
    },
    {
      name: "coord_spawn_worker",
      description: "Spawn a worker in pipe mode (fire-and-forget) or interactive mode (lead can message mid-execution). Returns task_id.",
      inputSchema: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Working directory" },
          prompt: { type: "string", description: "Full task instructions (worker has no prior context)" },
          model: { type: "string", description: "Model (default: sonnet)" },
          agent: { type: "string", description: "Agent name (optional)" },
          task_id: { type: "string", description: "Custom task ID (auto-generated if not provided)" },
          mode: { type: "string", enum: ["pipe", "interactive"], description: "pipe (fire-and-forget, cheapest) or interactive (lead can message mid-execution via inbox hooks, 3-5x more tokens). Default: pipe" },
          notify_session_id: { type: "string", description: "Session ID (first 8 chars) to receive worker completion inbox notifications." },
          session_id: { type: "string", description: "Alias for notify_session_id (first 8 chars)." },
          files: { type: "array", items: { type: "string" }, description: "Files to edit (checked for conflicts)" },
          layout: { type: "string", enum: ["tab", "split"], description: "'tab' or 'split'" },
          isolate: { type: "boolean", description: "Create git worktree for isolated execution (default: false)" },
        },
        required: ["directory", "prompt"],
      },
    },
    {
      name: "coord_get_result",
      description: "Check worker output and completion status.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID from coord_spawn_worker" },
          tail_lines: { type: "number", description: "Lines from end to return (default: 100)" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "coord_wake_session",
      description: "Wake an idle session. macOS: AppleScript by tty/title. Linux: direct safe TTY write when available. Windows: AppActivate+SendKeys best effort. All platforms fallback to urgent inbox message.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID (first 8 chars)" },
          message: { type: "string", description: "Text to send to the session (delivered via inbox; terminal gets Enter keystroke only)" },
        },
        required: ["session_id", "message"],
      },
    },
    {
      name: "coord_kill_worker",
      description: "Kill a running worker. Cross-platform (kill on Unix, taskkill on Windows).",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID of the worker to kill" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "coord_run_pipeline",
      description: "Run a sequence of tasks as a pipeline. Each step runs after the previous completes.",
      inputSchema: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Working directory" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                prompt: { type: "string" },
                model: { type: "string" },
                agent: { type: "string" },
              },
              required: ["name", "prompt"],
            },
          },
          pipeline_id: { type: "string" },
        },
        required: ["directory", "tasks"],
      },
    },
    {
      name: "coord_get_pipeline",
      description: "Check pipeline status and read step outputs.",
      inputSchema: {
        type: "object",
        properties: {
          pipeline_id: { type: "string", description: "Pipeline ID" },
        },
        required: ["pipeline_id"],
      },
    },
    // ── Task Board ──
    {
      name: "coord_create_task",
      description: "Create a task on the shared task board with subject, description, assignee, and dependency tracking.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Task title (required)" },
          description: { type: "string", description: "Detailed task description" },
          task_id: { type: "string", description: "Custom task ID (auto-generated if omitted)" },
          assignee: { type: "string", description: "Worker/session name to assign to" },
          priority: { type: "string", enum: ["low", "normal", "high"], description: "Priority (default: normal)" },
          files: { type: "array", items: { type: "string" }, description: "Files this task will touch" },
          blocked_by: { type: "array", items: { type: "string" }, description: "Task IDs that must complete first" },
        },
        required: ["subject"],
      },
    },
    {
      name: "coord_update_task",
      description: "Update a task: change status, assignee, add dependencies.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID to update" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"], description: "New status" },
          assignee: { type: "string", description: "New assignee (empty string to unassign)" },
          subject: { type: "string", description: "New subject" },
          description: { type: "string", description: "New description" },
          priority: { type: "string", enum: ["low", "normal", "high"], description: "New priority" },
          add_blocked_by: { type: "array", items: { type: "string" }, description: "Add dependency on these task IDs" },
          add_blocks: { type: "array", items: { type: "string" }, description: "This task blocks these task IDs" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "coord_list_tasks",
      description: "List all tasks on the task board, with dependency and blocker info.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status" },
          assignee: { type: "string", description: "Filter by assignee" },
        },
      },
    },
    {
      name: "coord_get_task",
      description: "Get full details of a task including description, files, and dependencies.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID" },
        },
        required: ["task_id"],
      },
    },
    // ── Teams ──
    {
      name: "coord_create_team",
      description: "Create or update a team with members, roles, and project info. Persists across sessions.",
      inputSchema: {
        type: "object",
        properties: {
          team_name: { type: "string", description: "Team name (required)" },
          project: { type: "string", description: "Project name" },
          description: { type: "string", description: "Team purpose" },
          members: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                role: { type: "string" },
                session_id: { type: "string" },
                task_id: { type: "string" },
              },
              required: ["name"],
            },
            description: "Team members to add/update",
          },
        },
        required: ["team_name"],
      },
    },
    {
      name: "coord_get_team",
      description: "Get team composition, members, and their assigned work.",
      inputSchema: {
        type: "object",
        properties: {
          team_name: { type: "string", description: "Team name" },
        },
        required: ["team_name"],
      },
    },
    {
      name: "coord_list_teams",
      description: "List all teams.",
      inputSchema: { type: "object", properties: {} },
    },
    // ── Broadcast ──
    {
      name: "coord_broadcast",
      description: "Send a message to ALL active sessions via their inboxes. Zero API tokens — file writes only.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Sender identifier" },
          content: { type: "string", description: "Message content" },
          priority: { type: "string", enum: ["normal", "urgent"], description: "Priority (default: normal)" },
        },
        required: ["from", "content"],
      },
    },
    // ── Send Directive (send + auto-wake) ──
    {
      name: "coord_send_directive",
      description: "Send an instruction to a worker/session mid-execution. Writes to inbox AND auto-wakes if session is idle. The lead's primary control tool for interactive workers.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Sender identifier" },
          to: { type: "string", description: "Target session ID (first 8 chars)" },
          content: { type: "string", description: "Instruction/directive content" },
          priority: { type: "string", enum: ["normal", "urgent"], description: "Priority (default: normal)" },
        },
        required: ["from", "to", "content"],
      },
    },
    // ── Send Message (MCP tool version) ──
    {
      name: "coord_send_message",
      description: "Send a message to a specific session's inbox. Zero API tokens — file write only. Target reads it on next tool call.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Sender identifier" },
          to: { type: "string", description: "Target session ID (first 8 chars)" },
          content: { type: "string", description: "Message content" },
          priority: { type: "string", enum: ["normal", "urgent"], description: "Priority (default: normal)" },
        },
        required: ["from", "to", "content"],
      },
    },
  ],
}));
/* c8 ignore stop */

// ─────────────────────────────────────────────────────────
// TOOL DISPATCH
// ─────────────────────────────────────────────────────────

/**
 * Route a tool call to the appropriate handler module.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {object} MCP text response
 */
const _initializedDirs = new Set();
let _gcRan = false;
function ensureDirsOnce() {
  const { TERMINALS_DIR, INBOX_DIR, RESULTS_DIR, SESSION_CACHE_DIR } = cfg();
  const TASKS_DIR = join(TERMINALS_DIR, "tasks");
  const TEAMS_DIR = join(TERMINALS_DIR, "teams");
  for (const dir of [TERMINALS_DIR, INBOX_DIR, RESULTS_DIR, SESSION_CACHE_DIR, TASKS_DIR, TEAMS_DIR]) {
    if (!_initializedDirs.has(dir)) {
      ensureSecureDirectory(dir);
      _initializedDirs.add(dir);
    }
  }
  // Auto-GC once per server boot
  if (!_gcRan) {
    _gcRan = true;
    try { runGC(); } catch { /* GC is best-effort */ }
  }
}

function handleToolCall(name, args = {}) {
  ensureDirsOnce();

  try {
    switch (name) {
    case "coord_list_sessions":    return handleListSessions(args);
    case "coord_get_session":      return handleGetSession(args);
    case "coord_check_inbox":      return handleCheckInbox(args);
    case "coord_detect_conflicts": return handleDetectConflicts(args);
    case "coord_spawn_terminal":   return handleSpawnTerminal(args);
    case "coord_spawn_worker":     return handleSpawnWorker(args);
    case "coord_get_result":       return handleGetResult(args);
    case "coord_wake_session":     return handleWakeSession(args);
    case "coord_kill_worker":      return handleKillWorker(args);
    case "coord_run_pipeline":     return handleRunPipeline(args);
    case "coord_get_pipeline":     return handleGetPipeline(args);
    case "coord_create_task":      return handleCreateTask(args);
    case "coord_update_task":      return handleUpdateTask(args);
    case "coord_list_tasks":       return handleListTasks(args);
    case "coord_get_task":         return handleGetTask(args);
    case "coord_create_team":      return handleCreateTeam(args);
    case "coord_get_team":         return handleGetTeam(args);
    case "coord_list_teams":       return handleListTeams(args);
    case "coord_broadcast":        return handleBroadcast(args);
    case "coord_send_message":     return handleSendMessage(args);
    case "coord_send_directive":   return handleSendDirective(args);
    default:                       return text(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return text(`Invalid arguments for ${name}: ${err.message}`);
  }
}

/* c8 ignore start — MCP server wiring, tested via __test__.handleToolCall */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args);
});

// ─────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────

/* c8 ignore start — server startup, not unit-testable */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch(err => { console.error("Coordinator error:", err); process.exit(1); });
}
/* c8 ignore stop */

// ─────────────────────────────────────────────────────────
// TEST INTERFACE (backward-compatible re-exports)
// ─────────────────────────────────────────────────────────

export const __test__ = {
  get PLATFORM() { return cfg().PLATFORM; },
  get CLAUDE_BIN() { return cfg().CLAUDE_BIN; },
  ensureDirsOnce,
  handleToolCall,
  buildWorkerScript,
  buildPlatformLaunchCommand,
  isProcessAlive,
  killProcess,
  sanitizeId,
  sanitizeShortSessionId,
  sanitizeName,
  sanitizeModel,
  sanitizeAgent,
  requireDirectoryPath,
  normalizeFilePath,
  readJSONLLimited,
  batQuote,
  runGC,
  isSafeTTYPath,
  selectWakeText,
  sleepMs,
  getSessionStatus,
  acquireExclusiveFileLock,
  enforceMessageRateLimit,
  handleCreateTask,
  handleUpdateTask,
  handleListTasks,
  handleGetTask,
  handleCreateTeam,
  handleGetTeam,
  handleListTeams,
  handleSendMessage,
  handleBroadcast,
  handleSendDirective,
  buildInteractiveWorkerScript,
};
