#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  unlinkSync,
  renameSync,
  realpathSync,
  statSync,
  lstatSync,
  chmodSync,
} from "fs";
import { join, basename, resolve, isAbsolute } from "path";
import { homedir, platform } from "os";
import { execFileSync, spawnSync, spawn } from "child_process";
import { fileURLToPath } from "url";

const TERMINALS_DIR = join(homedir(), ".claude", "terminals");
const INBOX_DIR = join(TERMINALS_DIR, "inbox");
const RESULTS_DIR = join(TERMINALS_DIR, "results");
const ACTIVITY_FILE = join(TERMINALS_DIR, "activity.jsonl");
const QUEUE_FILE = join(TERMINALS_DIR, "queue.jsonl");
const SESSION_CACHE_DIR = join(homedir(), ".claude", "session-cache");
const SETTINGS_FILE = join(homedir(), ".claude", "settings.local.json");
const PLATFORM = process.env.COORDINATOR_PLATFORM || platform(); // 'darwin', 'win32', 'linux'
const TEST_MODE = process.env.COORDINATOR_TEST_MODE === "1";
const CLAUDE_BIN = process.env.COORDINATOR_CLAUDE_BIN || "claude";
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_MODEL_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SAFE_AGENT_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_MESSAGE_BYTES = Number(process.env.COORDINATOR_MAX_MESSAGE_BYTES || 8192);
const MAX_INBOX_LINES = Number(process.env.COORDINATOR_MAX_INBOX_LINES || 500);
const MAX_INBOX_BYTES = Number(process.env.COORDINATOR_MAX_INBOX_BYTES || 256 * 1024);
const MAX_MESSAGES_PER_MINUTE = Number(process.env.COORDINATOR_MAX_MESSAGES_PER_MINUTE || 120);

function ensureSecureDirectory(pathValue) {
  mkdirSync(pathValue, { recursive: true, mode: 0o700 });
  try {
    const lst = lstatSync(pathValue);
    if (lst.isSymbolicLink()) throw new Error(`${pathValue} must not be a symlink.`);
    if (typeof process.getuid === "function") {
      const uid = process.getuid();
      if (Number.isInteger(uid) && lst.uid !== uid) throw new Error(`${pathValue} is not owned by current user.`);
    }
    if (PLATFORM !== "win32") chmodSync(pathValue, 0o700);
    else enforceWindowsAcl(pathValue, true);
  } catch (err) {
    if (!TEST_MODE) throw err;
  }
}

function writeFileSecure(pathValue, data) {
  writeFileSync(pathValue, data, { mode: 0o600 });
  if (PLATFORM !== "win32") {
    try { chmodSync(pathValue, 0o600); } catch {}
  } else {
    enforceWindowsAcl(pathValue, false);
  }
}

function appendJSONLineSecure(pathValue, value) {
  appendFileSync(pathValue, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  if (PLATFORM !== "win32") {
    try { chmodSync(pathValue, 0o600); } catch {}
  } else {
    enforceWindowsAcl(pathValue, false);
  }
}

function enforceWindowsAcl(pathValue, isDirectory = false) {
  if (PLATFORM !== "win32") return;
  let username = String(process.env.USERNAME || "").trim();
  if (!username) {
    try {
      const who = execFileSync("whoami", { encoding: "utf-8" }).trim();
      username = who.split("\\").pop() || who;
    } catch {}
  }
  if (!username) throw new Error("USERNAME is required for Windows ACL hardening.");
  const grant = isDirectory ? `${username}:(OI)(CI)F` : `${username}:F`;
  execFileSync("icacls", [pathValue, "/inheritance:r", "/remove:g", "Everyone", "/remove:g", "Users", "/remove:g", "Authenticated Users", "/grant:r", grant], { stdio: "ignore" });
  const aclOutput = execFileSync("icacls", [pathValue], { encoding: "utf-8" });
  const lower = aclOutput.toLowerCase();
  if (!lower.includes(`${username.toLowerCase()}:`)) throw new Error(`ACL hardening failed for ${pathValue}: missing user ACE.`);
  if (/\(I\)/.test(aclOutput)) throw new Error(`ACL hardening failed for ${pathValue}: inherited ACE detected.`);
  if (/\\everyone:/i.test(aclOutput) || /\\users:/i.test(aclOutput) || /authenticated users:/i.test(aclOutput)) {
    throw new Error(`ACL hardening failed for ${pathValue}: broad principals still present.`);
  }
}

function readJSONLLimited(pathValue, maxLines = MAX_INBOX_LINES, maxBytes = MAX_INBOX_BYTES) {
  try {
    if (!existsSync(pathValue)) return { items: [], truncated: false, totalLines: 0 };
    let raw = readFileSync(pathValue, "utf-8");
    let truncated = false;
    if (Buffer.byteLength(raw, "utf-8") > maxBytes) {
      raw = raw.slice(0, maxBytes);
      truncated = true;
    }
    const allLines = raw.split("\n").filter(Boolean);
    const lines = allLines.slice(0, maxLines);
    if (allLines.length > maxLines) truncated = true;
    const items = lines
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    return { items, truncated, totalLines: allLines.length };
  } catch {
    return { items: [], truncated: false, totalLines: 0 };
  }
}

function assertMessageBudget(content) {
  const size = Buffer.byteLength(content, "utf-8");
  if (size > MAX_MESSAGE_BYTES) throw new Error(`Message exceeds ${MAX_MESSAGE_BYTES} bytes.`);
}

function enforceMessageRateLimit(sessionId) {
  const rateFile = join(TERMINALS_DIR, `rate-${sessionId}.json`);
  const now = Date.now();
  const cutoff = now - 60_000;
  let events = [];
  try {
    if (existsSync(rateFile)) {
      const parsed = JSON.parse(readFileSync(rateFile, "utf-8"));
      events = Array.isArray(parsed.events) ? parsed.events.filter(ts => Number(ts) >= cutoff) : [];
    }
  } catch {}
  if (events.length >= MAX_MESSAGES_PER_MINUTE) {
    throw new Error(`Rate limit exceeded for ${sessionId} (${MAX_MESSAGES_PER_MINUTE}/minute).`);
  }
  events.push(now);
  writeFileSecure(rateFile, JSON.stringify({ events }));
}

// Ensure directories exist with owner-only permissions.
ensureSecureDirectory(join(homedir(), ".claude"));
ensureSecureDirectory(TERMINALS_DIR);
ensureSecureDirectory(INBOX_DIR);
ensureSecureDirectory(RESULTS_DIR);
ensureSecureDirectory(SESSION_CACHE_DIR);

// ─────────────────────────────────────────────────────────
// CROSS-PLATFORM: Terminal detection & command execution
// ─────────────────────────────────────────────────────────

function getTerminalApp() {
  if (PLATFORM === "darwin") {
    if (spawnSync("pgrep", ["-x", "iTerm2"], { stdio: "ignore" }).status === 0) return "iTerm2";
    if (spawnSync("pgrep", ["-x", "Terminal"], { stdio: "ignore" }).status === 0) return "Terminal";
    return "none";
  } else if (PLATFORM === "win32") {
    // Windows Terminal > PowerShell > cmd
    try {
      const wt = execFileSync("tasklist", ["/FI", "IMAGENAME eq WindowsTerminal.exe", "/NH"], { encoding: "utf-8" });
      if (wt.toLowerCase().includes("windowsterminal")) return "WindowsTerminal";
    } catch {}
    try {
      const ps = execFileSync("tasklist", ["/FI", "IMAGENAME eq powershell.exe", "/NH"], { encoding: "utf-8" });
      if (ps.toLowerCase().includes("powershell")) return "PowerShell";
    } catch {}
    return "cmd";
  } else {
    // Linux: check common terminal emulators
    for (const app of ["gnome-terminal", "konsole", "alacritty", "kitty", "xterm"]) {
      if (spawnSync("pgrep", ["-x", app], { stdio: "ignore" }).status === 0) return app;
    }
    return "none";
  }
}

function buildPlatformLaunchCommand(platformName, termApp, command, layout = "tab") {
  if (platformName === "darwin") {
    if (termApp === "iTerm2") {
      const splitScript = 'tell application "iTerm2" to tell current session of current window to split vertically with default profile';
      const tabScript = 'tell application "iTerm2" to tell current window to create tab with default profile';
      const writeScript = `tell application "iTerm2" to tell current session of current window to write text ${JSON.stringify(command)}`;
      return {
        command: "osascript",
        args: layout === "split" ? ["-e", splitScript, "-e", writeScript] : ["-e", tabScript, "-e", writeScript],
        app: "iTerm2",
      };
    }
    if (termApp === "Terminal") {
      return {
        command: "osascript",
        args: ["-e", `tell application "Terminal" to do script ${JSON.stringify(command)}`],
        app: "Terminal",
      };
    }
    return {
      command: "bash",
      args: ["-lc", command],
      detached: true,
      app: "background",
    };
  }

  if (platformName === "win32") {
    if (termApp === "WindowsTerminal") {
      const base = layout === "split" ? ["-w", "0", "sp", "-V", "cmd", "/c", command] : ["-w", "0", "nt", "cmd", "/c", command];
      return {
        command: "wt",
        args: base,
        app: "WindowsTerminal",
      };
    }
    return {
      command: "cmd",
      args: ["/c", "start", "", "cmd", "/c", command],
      app: "cmd",
    };
  }

  if (termApp === "gnome-terminal") {
    return { command: "gnome-terminal", args: ["--", "bash", "-c", command], app: "gnome-terminal" };
  }
  if (termApp === "konsole") {
    return { command: "konsole", args: ["-e", "bash", "-c", command], app: "konsole" };
  }
  if (termApp === "alacritty") {
    return { command: "alacritty", args: ["-e", "bash", "-c", command], app: "alacritty" };
  }
  if (termApp === "kitty") {
    return {
      command: "kitty",
      args: layout === "split"
        ? ["@", "launch", "--type=window", "bash", "-c", command]
        : ["@", "launch", "--type=tab", "bash", "-c", command],
      app: "kitty",
    };
  }
  return {
    command: "bash",
    args: ["-lc", command],
    detached: true,
    app: "background",
  };
}

// Open a new terminal pane/tab with a command. Cross-platform.
// layout: "tab" (default) or "split" (vertical split where supported)
function openTerminalWithCommand(command, layout = "tab") {
  if (TEST_MODE) {
    if (PLATFORM === "win32") return "test-background-win32";
    const child = spawn("bash", ["-lc", command], { detached: true, stdio: "ignore" });
    child.unref();
    return "test-background";
  }

  const termApp = getTerminalApp();
  const launch = buildPlatformLaunchCommand(PLATFORM, termApp, command, layout);
  if (launch.detached) {
    const child = spawn(launch.command, launch.args || [], { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    const res = spawnSync(launch.command, launch.args || [], { stdio: "ignore", timeout: 5000 });
    if (res.status !== 0) throw new Error(`Launch failed (${launch.command})`);
  }
  return launch.app;
}

// Cross-platform process check
function isProcessAlive(pid) {
  const pidNum = Number(pid);
  if (!Number.isInteger(pidNum) || pidNum <= 0) return false;
  try {
    if (PLATFORM === "win32") {
      const output = execFileSync("tasklist", ["/FI", `PID eq ${pidNum}`, "/NH"], { encoding: "utf-8" });
      if (!output.includes(String(pidNum))) return false;
    } else {
      process.kill(pidNum, 0);
    }
    return true;
  } catch {
    return false;
  }
}

// Cross-platform process kill
function killProcess(pid) {
  const pidNum = Number(pid);
  if (!Number.isInteger(pidNum) || pidNum <= 0) throw new Error("Invalid PID.");
  if (PLATFORM === "win32") {
    execFileSync("taskkill", ["/PID", String(pidNum), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-pidNum, "SIGTERM"); } catch {
      process.kill(pidNum, "SIGTERM");
    }
  }
}

function isSafeTTYPath(pathValue) {
  const tty = String(pathValue || "").trim();
  return /^\/dev\/(?:ttys?\d+|pts\/\d+)$/.test(tty);
}

function wakeViaTTY(ttyPath, message) {
  if (!isSafeTTYPath(ttyPath)) return false;
  try {
    const st = statSync(ttyPath);
    if (!st.isCharacterDevice()) return false;
    writeFileSync(ttyPath, `${message}\n`, { flag: "a" });
    return true;
  } catch {
    return false;
  }
}

function selectWakeText(message, allowUnsafeTerminalMessage) {
  return allowUnsafeTerminalMessage ? message : "";
}

function wakeViaWindowsAppActivate(sessionId, message) {
  if (PLATFORM !== "win32") return false;
  const scriptPath = join(RESULTS_DIR, `wake-${sessionId}-${Date.now()}.ps1`);
  const ps1 = `
param(
  [Parameter(Mandatory=$true)][string]$WindowHint,
  [Parameter(Mandatory=$true)][string]$Message
)
$ErrorActionPreference = 'Stop'
$wshell = New-Object -ComObject WScript.Shell
if (-not $wshell.AppActivate($WindowHint)) { exit 1 }
Start-Sleep -Milliseconds 200
$escaped = $Message -replace '([+^%~(){}\\[\\]])', '{$1}'
$escaped = $escaped -replace '\\{', '{{}'
$escaped = $escaped -replace '\\}', '{}}'
$wshell.SendKeys($escaped)
$wshell.SendKeys('{ENTER}')
exit 0
`.trim();
  try {
    writeFileSecure(scriptPath, ps1);
    const result = spawnSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-WindowHint",
      `claude-${sessionId}`,
      "-Message",
      message,
    ], { stdio: "ignore", timeout: 8000 });
    return result.status === 0;
  } catch {
    return false;
  } finally {
    try { if (existsSync(scriptPath)) unlinkSync(scriptPath); } catch {}
  }
}

// Build worker script (cross-platform)
function buildWorkerScript(taskId, escapedDir, resultFile, pidFile, metaFile, modelFlag, agentFlag, settingsFlag, promptFile, workerPs1File = "", platformName = PLATFORM) {
  if (platformName === "win32") {
    const q = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const winSettings = existsSync(SETTINGS_FILE) ? SETTINGS_FILE : "";
    return [
      `cd /d "${escapedDir}"`,
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${q(workerPs1File)} -WorkingDir ${q(escapedDir)} -ClaudeBin ${q(CLAUDE_BIN)} -PromptFile ${q(promptFile)} -ResultFile ${q(resultFile)} -PidFile ${q(pidFile)} -MetaDoneFile ${q(`${metaFile}.done`)} -Model ${q(modelFlag.replace("--model ", ""))} -Agent ${q((agentFlag || "").replace("--agent ", ""))} -SettingsFile ${q(winSettings)}`,
    ].join(" && ");
  } else {
    return [
      `cd '${escapedDir}'`,
      `echo "Worker ${taskId} starting at $(date)" > '${resultFile}'`,
      `echo $$ > '${pidFile}'`,
      `env -u CLAUDECODE ${CLAUDE_BIN} -p ${modelFlag} ${agentFlag} ${settingsFlag} < '${promptFile}' >> '${resultFile}' 2>&1`,
      `echo '{"status":"completed","finished":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","task_id":"${taskId}"}' > '${metaFile}.done'`,
      `rm -f '${pidFile}'`,
    ].join(" && ");
  }
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

function readJSONL(path) {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function getAllSessions() {
  try {
    return readdirSync(TERMINALS_DIR)
      .filter(f => f.startsWith("session-") && f.endsWith(".json"))
      .map(f => readJSON(join(TERMINALS_DIR, f)))
      .filter(Boolean);
  } catch { return []; }
}

function getSessionStatus(session) {
  if (session.status === "closed") return "closed";
  if (session.status === "stale") return "stale";
  if (!session.last_active) return "unknown";
  const age = (Date.now() - new Date(session.last_active).getTime()) / 1000;
  if (age < 180) return "active";
  if (age < 600) return "idle";
  return "stale";
}

function timeAgo(ts) {
  if (!ts) return "unknown";
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function text(content) {
  return { content: [{ type: "text", text: content }] };
}

function sanitizeId(input, label = "id") {
  const value = String(input ?? "").trim();
  if (!SAFE_ID_RE.test(value)) throw new Error(`Invalid ${label}. Use letters, numbers, _, - only.`);
  return value;
}

function sanitizeShortSessionId(input) {
  const value = sanitizeId(input, "session_id");
  return value.slice(0, 8);
}

function sanitizeName(input, label = "name") {
  const value = String(input ?? "").trim();
  if (!value) throw new Error(`Invalid ${label}.`);
  const normalized = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    .slice(0, 64)
    .replace(/[-.]+$/, "");
  if (!normalized || !SAFE_NAME_RE.test(normalized)) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function sanitizeModel(input) {
  const model = String(input ?? "sonnet").trim();
  if (!SAFE_MODEL_RE.test(model)) throw new Error("Invalid model name.");
  return model;
}

function sanitizeAgent(input) {
  if (input === undefined || input === null || input === "") return "";
  const agent = String(input).trim();
  if (!SAFE_AGENT_RE.test(agent)) throw new Error("Invalid agent name.");
  return agent;
}

function requireDirectoryPath(pathValue) {
  const directory = String(pathValue ?? "").trim();
  if (!directory) throw new Error("Directory is required.");
  if (directory.includes("\n") || directory.includes("\r")) throw new Error("Invalid directory path.");
  if (directory.includes("\0")) throw new Error("Invalid directory path.");
  if (directory.includes('"')) throw new Error("Directory path cannot contain double quotes.");
  return directory;
}

function normalizeFilePath(filePath, cwd = "") {
  const raw = String(filePath ?? "").trim();
  if (!raw) return null;
  let candidate = isAbsolute(raw) ? raw : resolve(cwd || process.cwd(), raw);
  try {
    if (existsSync(candidate)) {
      candidate = realpathSync(candidate);
    }
  } catch {}
  let normalized = candidate.replace(/\\/g, "/");
  if (PLATFORM === "win32") normalized = normalized.toLowerCase();
  return normalized;
}

// ─────────────────────────────────────────────────────────
// MCP SERVER
// ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "coordinator", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// Tool definitions
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
      name: "coord_send_message",
      description: "Send a message to another session via inbox hook. Works on any platform.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Sender ID or label like 'lead'" },
          to: { type: "string", description: "Target session ID (first 8 chars)" },
          content: { type: "string", description: "Message content" },
          priority: { type: "string", enum: ["normal", "urgent"], description: "Priority (default: normal)" },
          allow_offline: { type: "boolean", description: "Queue message even if session is not currently registered (default: false)" },
        },
        required: ["from", "to", "content"],
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
      name: "coord_register_work",
      description: "Declare what task and files this session is working on.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Your session ID (first 8 chars)" },
          task: { type: "string", description: "Task description" },
          files: { type: "array", items: { type: "string" }, description: "Files being modified" },
        },
        required: ["session_id", "task"],
      },
    },
    {
      name: "coord_assign_task",
      description: "Add a task to the shared queue.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description" },
          project: { type: "string", description: "Project directory path" },
          priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
          scope: { type: "array", items: { type: "string" }, description: "Relevant file paths" },
          brief: { type: "string", description: "Detailed context" },
        },
        required: ["task", "project"],
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
      description: "Spawn an autonomous worker (claude -p). Cross-platform. Returns task_id for coord_get_result.",
      inputSchema: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Working directory" },
          prompt: { type: "string", description: "Full task instructions (worker has no prior context)" },
          model: { type: "string", description: "Model (default: sonnet)" },
          agent: { type: "string", description: "Agent name (optional)" },
          task_id: { type: "string", description: "Custom task ID (auto-generated if not provided)" },
          files: { type: "array", items: { type: "string" }, description: "Files to edit (checked for conflicts)" },
          layout: { type: "string", enum: ["tab", "split"], description: "'tab' or 'split'" },
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
          message: { type: "string", description: "Text to send to the session" },
          allow_unsafe_terminal_message: { type: "boolean", description: "If true, direct terminal wake will type message content. Default false sends only Enter for safety." },
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
  ],
}));

// ─────────────────────────────────────────────────────────
// TOOL EXECUTION
// ─────────────────────────────────────────────────────────

async function handleToolCall(name, args = {}) {
  try {
    switch (name) {

    // ─── LIST SESSIONS (enriched) ───
    case "coord_list_sessions": {
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
        const recentFiles = (s.files_touched || []).slice(-3).map(f => basename(f)).join(", ") || "—";
        const lastOp = s.recent_ops?.length ? `${s.recent_ops[s.recent_ops.length - 1].tool} ${basename(s.recent_ops[s.recent_ops.length - 1].file || "")}` : "—";
        return `| ${s.session} | ${s.tty || "?"} | ${s.project || "?"} | ${status} | ${lastActive} | ${tools} | ${recentFiles} | ${lastOp} |`;
      });

      const table = `| Session | TTY | Project | Status | Last Active | W/E/B/R | Recent Files | Last Op |\n|---------|-----|---------|--------|-------------|---------|--------------|---------|` + "\n" + rows.join("\n");
      return text(`## Sessions (${filtered.length}) — Platform: ${PLATFORM}\n\n${table}`);
    }

    // ─── GET SESSION DETAIL (enriched) ───
    case "coord_get_session": {
      const sid = sanitizeShortSessionId(args.session_id);
      const session = readJSON(join(TERMINALS_DIR, `session-${sid}.json`));
      if (!session) return text(`Session ${sid} not found.`);

      let output = `## Session ${sid}\n\n`;
      output += `- **Project:** ${session.project}\n`;
      output += `- **Branch:** ${session.branch}\n- **CWD:** ${session.cwd}\n`;
      output += `- **Status:** ${getSessionStatus(session)}\n`;
      output += `- **TTY:** ${session.tty || "unknown"}\n`;
      output += `- **Started:** ${session.started}\n- **Last Active:** ${timeAgo(session.last_active)}\n`;
      output += `- **Task:** ${session.current_task || "not declared"}\n`;

      // Enriched data
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

      // Plan file
      if (session.plan_file && existsSync(session.plan_file)) {
        try {
          const first20 = readFileSync(session.plan_file, "utf-8").split("\n").slice(0, 20).join("\n");
          output += `\n### Active Plan\n\`\`\`\n${first20}\n\`\`\`\n`;
        } catch {}
      }

      // Inbox
      const inboxView = readJSONLLimited(join(INBOX_DIR, `${sid}.jsonl`), MAX_INBOX_LINES, MAX_INBOX_BYTES);
      output += `\n### Inbox: ${inboxView.items.length} pending message(s)\n`;
      if (inboxView.truncated) output += `_Inbox count limited by safety caps._\n`;

      return text(output);
    }

    // ─── SEND MESSAGE ───
    case "coord_send_message": {
      const from = String(args?.from || "unknown").slice(0, 120);
      const to = sanitizeShortSessionId(args?.to);
      const content = String(args?.content || "").trim();
      if (!content) return text("Message content cannot be empty.");
      assertMessageBudget(content);
      enforceMessageRateLimit(to);
      const priority = args?.priority === "urgent" ? "urgent" : "normal";
      const allowOffline = args?.allow_offline === true;
      const sessionFile = join(TERMINALS_DIR, `session-${to}.json`);
      if (!existsSync(sessionFile) && !allowOffline) {
        return text(`Session ${to} not found. Message not delivered.\nIf intentional, resend with allow_offline=true.`);
      }
      const inboxFile = join(INBOX_DIR, `${to}.jsonl`);
      appendJSONLineSecure(inboxFile, {
        ts: new Date().toISOString(), from,
        priority, content,
      });

      if (existsSync(sessionFile)) {
        try {
          const s = readJSON(sessionFile);
          if (s) { s.has_messages = true; writeFileSecure(sessionFile, JSON.stringify(s, null, 2)); }
        } catch {}
      }

      return text(
        `Message sent to ${to}${existsSync(sessionFile) ? "" : " (offline queue)"}.` +
        `\nContent: "${content}"\nPriority: ${priority}`
      );
    }

    // ─── CHECK INBOX ───
    case "coord_check_inbox": {
      const sid = sanitizeShortSessionId(args.session_id);
      const inboxFile = join(INBOX_DIR, `${sid}.jsonl`);
      const drainFile = join(INBOX_DIR, `${sid}.drain.${Date.now()}.${process.pid}.jsonl`);
      let messages = [];
      let truncated = false;
      try {
        if (existsSync(inboxFile)) renameSync(inboxFile, drainFile);
      } catch {
        // Fallback: read only; avoid truncating on failure.
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
        output += `_Inbox output truncated to safety limits (${MAX_INBOX_LINES} lines / ${MAX_INBOX_BYTES} bytes)._` + "\n\n";
      }
      messages.forEach((m, i) => {
        output += `### Message ${i + 1}${m.priority === "urgent" ? " **[URGENT]**" : ""}\n`;
        output += `- **From:** ${m.from}\n- **Time:** ${m.ts}\n- **Content:** ${m.content}\n\n`;
      });
      return text(output);
    }

    // ─── DETECT CONFLICTS (uses enriched files_touched + current_files) ───
    case "coord_detect_conflicts": {
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
        // Check both current_files (registered) and files_touched (from heartbeat), using canonical paths.
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

      // Also check recent activity
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
        conflicts.forEach(c => { output += `- **${c.session}** (${c.project}): ${c.overlapping_files.join(", ")} — "${c.task}"\n`; });
      }
      if (recentEdits.length > 0) {
        output += "\n### Recent Edits (last 5 min)\n";
        recentEdits.forEach(e => { output += `- ${e.ts} ${e.session}: ${e.tool} ${e.file}\n`; });
      }
      output += "\n**Recommendation:** Coordinate before editing these files.";

      appendJSONLineSecure(join(TERMINALS_DIR, "conflicts.jsonl"), {
        ts: new Date().toISOString(),
        detector: session_id,
        files,
        conflicts: conflicts.map(c => c.session),
      });
      return text(output);
    }

    // ─── REGISTER WORK ───
    case "coord_register_work": {
      const session_id = sanitizeShortSessionId(args.session_id);
      const task = String(args.task || "").trim();
      const files = (args.files || []).map(f => String(f).trim()).filter(Boolean);
      if (!task) return text("Task is required.");
      const sessionFile = join(TERMINALS_DIR, `session-${session_id}.json`);
      if (!existsSync(sessionFile)) return text(`Session ${session_id} not found.`);
      const session = readJSON(sessionFile);
      if (!session) return text(`Could not read session ${session_id}.`);

      session.current_task = task;
      if (files) session.current_files = files;
      session.work_registered = new Date().toISOString();
      writeFileSecure(sessionFile, JSON.stringify(session, null, 2));
      return text(`Work registered: "${task}"\nFiles: ${files?.join(", ") || "none"}`);
    }

    // ─── ASSIGN TASK ───
    case "coord_assign_task": {
      const task = String(args.task || "").trim();
      const project = requireDirectoryPath(args.project);
      const priority = ["low", "normal", "high", "critical"].includes(args.priority) ? args.priority : "normal";
      const scope = (args.scope || []).map(s => String(s).trim()).filter(Boolean);
      const brief = String(args.brief || "");
      if (!task) return text("Task is required.");
      const entry = {
        id: `T${Date.now()}`, ts: new Date().toISOString(), task, project,
        priority, scope, brief,
        status: "pending", assigned_to: null,
      };
      appendJSONLineSecure(QUEUE_FILE, entry);

      const sessions = getAllSessions().filter(s =>
        getSessionStatus(s) === "active" && s.project?.toLowerCase() === basename(project).toLowerCase()
      );
      for (const s of sessions) {
        appendJSONLineSecure(join(INBOX_DIR, `${s.session}.jsonl`), {
          ts: new Date().toISOString(), from: "coordinator", priority: priority === "critical" ? "urgent" : "normal",
          content: `New task: "${task}" (${priority || "normal"}).`,
        });
      }
      return text(`Task queued: "${task}" (${entry.id})\nNotified ${sessions.length} session(s).`);
    }

    // ─── SPAWN TERMINAL (cross-platform) ───
    case "coord_spawn_terminal": {
      const directory = requireDirectoryPath(args.directory);
      const initial_prompt = args.initial_prompt ? String(args.initial_prompt) : "";
      const layout = args.layout === "split" ? "split" : "tab";
      if (!existsSync(directory)) return text(`Directory not found: ${directory}`);

      try {
        const dir = PLATFORM === "win32" ? directory : directory.replace(/'/g, "'\\''");
        const claudeCmd = initial_prompt
          ? `${CLAUDE_BIN} --prompt ${PLATFORM === "win32" ? `"${initial_prompt.replace(/"/g, '""')}"` : `'${initial_prompt.replace(/'/g, "'\\''")}'`}`
          : CLAUDE_BIN;
        const fullCmd = PLATFORM === "win32"
          ? `cd /d "${dir}" && ${claudeCmd}`
          : `cd '${dir}' && ${claudeCmd}`;

        const usedApp = openTerminalWithCommand(fullCmd, layout);
        return text(`Terminal spawned in ${directory} via ${usedApp}${layout === "split" ? " (split)" : ""}.\nWill auto-register via hooks.`);
      } catch (err) {
        return text(`Failed to spawn terminal: ${err.message}`);
      }
    }

    // ─── SPAWN WORKER (cross-platform) ───
    case "coord_spawn_worker": {
      const directory = requireDirectoryPath(args.directory);
      const prompt = String(args.prompt || "").trim();
      const model = sanitizeModel(args.model);
      const agent = sanitizeAgent(args.agent);
      const task_id = args.task_id;
      const files = (args.files || []).map(f => String(f).trim()).filter(Boolean);
      const layout = args.layout === "split" ? "split" : "tab";
      if (!prompt) return text("Prompt is required.");
      if (!existsSync(directory)) return text(`Directory not found: ${directory}`);

      // Conflict check
      if (files?.length) {
        const normalizedRequested = new Map(files.map(f => [f, normalizeFilePath(f, directory)]));
        const running = readdirSync(RESULTS_DIR)
          .filter(f => f.endsWith(".meta.json") && !f.includes(".done"))
          .map(f => readJSON(join(RESULTS_DIR, f)))
          .filter(m => m?.status === "running" && m.files?.length);
        for (const w of running) {
          const pidFile = join(RESULTS_DIR, `${w.task_id}.pid`);
          if (!existsSync(pidFile)) continue;
          const pid = readFileSync(pidFile, "utf-8").trim();
          if (!isProcessAlive(pid)) continue;
          const normalizedWorker = new Set(w.files.map(f => normalizeFilePath(f, w.directory)).filter(Boolean));
          const overlap = files.filter(f => {
            const normalized = normalizedRequested.get(f);
            return normalized && normalizedWorker.has(normalized);
          });
          if (overlap.length > 0) return text(`CONFLICT: Worker ${w.task_id} editing: ${overlap.join(", ")}. Kill it first or wait.`);
        }
      }

      const taskId = task_id ? sanitizeId(task_id, "task_id") : `W${Date.now()}`;
      const resultFile = join(RESULTS_DIR, `${taskId}.txt`);
      const pidFile = join(RESULTS_DIR, `${taskId}.pid`);
      const metaFile = join(RESULTS_DIR, `${taskId}.meta.json`);
      if (existsSync(metaFile) || existsSync(resultFile)) {
        return text(`Task ID ${taskId} already exists. Use a new task_id or omit it for auto-generation.`);
      }

      const meta = {
        task_id: taskId, directory, prompt: prompt.slice(0, 500),
        model, agent: agent || null,
        files, spawned: new Date().toISOString(), status: "running",
      };
      writeFileSecure(metaFile, JSON.stringify(meta, null, 2));

      try {
        const escapedDir = PLATFORM === "win32" ? directory : directory.replace(/'/g, "'\\''");

        // Context preamble
        const cacheFile = join(SESSION_CACHE_DIR, "coder-context.md");
        let contextPreamble = "";
        if (existsSync(cacheFile)) {
          contextPreamble = `## Prior Context\n${readFileSync(cacheFile, "utf-8").slice(0, 3000)}\n\n---\n\n`;
        }
        const contextSuffix = "\n\nWhen done, write key findings to ~/.claude/session-cache/coder-context.md.";
        const promptFile = join(RESULTS_DIR, `${taskId}.prompt`);
        writeFileSecure(promptFile, contextPreamble + prompt + contextSuffix);

        const modelFlag = `--model ${model}`;
        const agentFlag = agent ? `--agent ${agent}` : "";
        const settingsFlag = existsSync(SETTINGS_FILE) ? (PLATFORM === "win32" ? `--settings "${SETTINGS_FILE}"` : `--settings '${SETTINGS_FILE}'`) : "";
        const workerPs1File = join(RESULTS_DIR, `${taskId}.worker.ps1`);
        if (PLATFORM === "win32") {
          const ps1 = `
param(
  [Parameter(Mandatory=$true)][string]$WorkingDir,
  [Parameter(Mandatory=$true)][string]$ClaudeBin,
  [Parameter(Mandatory=$true)][string]$PromptFile,
  [Parameter(Mandatory=$true)][string]$ResultFile,
  [Parameter(Mandatory=$true)][string]$PidFile,
  [Parameter(Mandatory=$true)][string]$MetaDoneFile,
  [Parameter(Mandatory=$true)][string]$Model,
  [string]$Agent = "",
  [string]$SettingsFile = ""
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $WorkingDir
[System.IO.File]::WriteAllText($PidFile, [string]$PID)
[System.IO.File]::WriteAllText($ResultFile, "Worker ${taskId} starting at $((Get-Date).ToString('o'))" + [Environment]::NewLine)
$claudeArgs = @('-p', '--model', $Model)
if ($Agent) { $claudeArgs += @('--agent', $Agent) }
if ($SettingsFile) { $claudeArgs += @('--settings', $SettingsFile) }
Get-Content -Path $PromptFile | & $ClaudeBin @claudeArgs *>> $ResultFile
$done = @{ status = 'completed'; finished = (Get-Date).ToUniversalTime().ToString('o'); task_id = '${taskId}' } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($MetaDoneFile, $done)
Remove-Item -Path $PidFile -ErrorAction SilentlyContinue
`.trim();
          writeFileSecure(workerPs1File, ps1);
        }

        const workerScript = buildWorkerScript(taskId, escapedDir, resultFile, pidFile, metaFile, modelFlag, agentFlag, settingsFlag, promptFile, workerPs1File, PLATFORM);
        const usedApp = openTerminalWithCommand(workerScript, layout);

        return text(
          `Worker spawned: **${taskId}**\n` +
          `- Directory: ${directory}\n- Model: ${model}\n- Agent: ${agent || "default"}\n` +
          `- Layout: ${layout} via ${usedApp}\n- Platform: ${PLATFORM}\n` +
          `- Files: ${files.join(", ") || "none"}\n- Results: ${resultFile}\n\n` +
          `Check: \`coord_get_result task_id="${taskId}"\``
        );
      } catch (err) {
        meta.status = "failed"; meta.error = err.message;
        writeFileSecure(metaFile, JSON.stringify(meta, null, 2));
        return text(`Failed to spawn worker: ${err.message}`);
      }
    }

    // ─── GET RESULT ───
    case "coord_get_result": {
      const task_id = sanitizeId(args.task_id, "task_id");
      const tail_lines = Number(args.tail_lines);
      const resultFile = join(RESULTS_DIR, `${task_id}.txt`);
      const pidFile = join(RESULTS_DIR, `${task_id}.pid`);
      const metaFile = join(RESULTS_DIR, `${task_id}.meta.json`);
      const doneFile = `${metaFile}.done`;

      const meta = readJSON(metaFile);
      if (!meta) return text(`Task ${task_id} not found.`);

      const isDone = existsSync(doneFile);
      let isRunning = false;
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, "utf-8").trim();
        isRunning = isProcessAlive(pid);
      }

      let output = "";
      if (existsSync(resultFile)) {
        const full = readFileSync(resultFile, "utf-8");
        const lines = full.split("\n");
        const limit = Number.isFinite(tail_lines) && tail_lines > 0 ? Math.min(Math.floor(tail_lines), 500) : 100;
        output = lines.length > limit
          ? `[...truncated ${lines.length - limit} lines...]\n` + lines.slice(-limit).join("\n")
          : full;
      }

      let result = `## Worker ${task_id}\n\n`;
      result += `- **Status:** ${isDone ? "completed" : isRunning ? "running" : "unknown"}\n`;
      result += `- **Directory:** ${meta.directory}\n- **Model:** ${meta.model}\n- **Spawned:** ${meta.spawned}\n`;
      if (isDone) { const d = readJSON(doneFile); result += `- **Finished:** ${d?.finished || "unknown"}\n`; }
      result += `\n### Output\n\`\`\`\n${output || "(no output yet)"}\n\`\`\`\n`;
      return text(result);
    }

    // ─── WAKE SESSION (cross-platform) ───
    case "coord_wake_session": {
      const session_id = sanitizeShortSessionId(args.session_id);
      const message = String(args.message || "").trim();
      if (!message) return text("Message is required.");
      const allowUnsafeTerminalMessage = args?.allow_unsafe_terminal_message === true;
      const wakeText = selectWakeText(message, allowUnsafeTerminalMessage);
      const wakeModeNote = allowUnsafeTerminalMessage ? "" : " (safe mode: sent Enter only)";
      assertMessageBudget(message);
      enforceMessageRateLimit(session_id);
      const sessionFile = join(TERMINALS_DIR, `session-${session_id}.json`);
      if (!existsSync(sessionFile)) return text(`Session ${session_id} not found.`);
      const sessionData = readJSON(sessionFile);
      const targetTTY = sessionData?.tty;

      if (PLATFORM === "linux" && targetTTY && wakeViaTTY(targetTTY, wakeText)) {
        return text(`Woke ${session_id} via TTY write (${targetTTY})${wakeModeNote}.\nMessage: "${message}"`);
      }
      if (PLATFORM === "win32" && wakeViaWindowsAppActivate(session_id, wakeText)) {
        return text(`Woke ${session_id} via Windows AppActivate${wakeModeNote}.\nMessage: "${message}"`);
      }

      // Non-macOS fallback: inbox messaging
      if (PLATFORM !== "darwin") {
        const inboxFile = join(INBOX_DIR, `${session_id}.jsonl`);
        appendJSONLineSecure(inboxFile, {
          ts: new Date().toISOString(), from: "lead", priority: "urgent",
          content: `[WAKE] ${message}`,
        });
        return text(
          `Platform: ${PLATFORM} — AppleScript not available.\n` +
          `Sent URGENT inbox message instead. Session will receive it on next tool call.\n` +
          `Message: "${message}"\n\n` +
          `If the session is idle (not making tool calls), use coord_spawn_worker to dispatch autonomous work instead.`
        );
      }

      // macOS: AppleScript injection
      try {
        const escapedMessage = wakeText.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        const termApp = getTerminalApp();
        let appleScript;

        if (termApp === "iTerm2" && targetTTY) {
          appleScript = `
tell application "iTerm2"
  set found to false
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${targetTTY}" then
          select t
          tell s to write text "${escapedMessage}" newline NO
          delay 0.3
          tell s to write text ""
          set found to true
          exit repeat
        end if
      end repeat
      if found then exit repeat
    end repeat
    if found then exit repeat
  end repeat
  return found
end tell`.trim();
        } else if (termApp === "iTerm2") {
          appleScript = `
tell application "iTerm2"
  set found to false
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if name of s contains "claude-${session_id}" then
          select t
          tell s to write text "${escapedMessage}" newline NO
          delay 0.3
          tell s to write text ""
          set found to true
          exit repeat
        end if
      end repeat
      if found then exit repeat
    end repeat
    if found then exit repeat
  end repeat
  return found
end tell`.trim();
        } else {
          appleScript = `
tell application "Terminal"
  set found to false
  repeat with w in windows
    repeat with t in tabs of w
      if name of t contains "claude-${session_id}" then
        set selected of t to true
        set frontmost of w to true
        set found to true
        exit repeat
      end if
    end repeat
    if found then exit repeat
  end repeat
end tell
delay 0.5
if found then
  tell application "System Events"
    keystroke "${escapedMessage}"
    keystroke return
  end tell
end if
return found`.trim();
        }

        const result = execFileSync("osascript", ["-e", appleScript], { timeout: 10000, encoding: "utf-8" }).trim();

        if (result === "true") {
          return text(`Woke ${session_id} via ${termApp}${targetTTY ? ` (${targetTTY})` : ""}${wakeModeNote}.\nMessage: "${message}"`);
        }

        // AppleScript couldn't find it — fall back to inbox
        const inboxFile = join(INBOX_DIR, `${session_id}.jsonl`);
        appendJSONLineSecure(inboxFile, {
          ts: new Date().toISOString(), from: "lead", priority: "urgent",
          content: `[WAKE] ${message}`,
        });
        return text(`Could not find session in ${termApp}. Sent inbox message as fallback.\nUse coord_spawn_worker if session is truly dead.`);

      } catch (err) {
        // Error — fall back to inbox
        const inboxFile = join(INBOX_DIR, `${session_id}.jsonl`);
        appendJSONLineSecure(inboxFile, {
          ts: new Date().toISOString(), from: "lead", priority: "urgent",
          content: `[WAKE] ${message}`,
        });
        return text(`AppleScript failed: ${err.message}\nSent inbox message as fallback.`);
      }
    }

    // ─── KILL WORKER (cross-platform) ───
    case "coord_kill_worker": {
      const task_id = sanitizeId(args.task_id, "task_id");
      const pidFile = join(RESULTS_DIR, `${task_id}.pid`);
      const metaFile = join(RESULTS_DIR, `${task_id}.meta.json`);

      if (!existsSync(pidFile)) {
        if (existsSync(`${metaFile}.done`)) return text(`Worker ${task_id} already completed.`);
        return text(`Worker ${task_id} has no PID file.`);
      }

      const pid = readFileSync(pidFile, "utf-8").trim();
      try {
        killProcess(pid);
        writeFileSecure(`${metaFile}.done`, JSON.stringify({ status: "cancelled", finished: new Date().toISOString(), task_id }));
        const existingMeta = readJSON(metaFile) || {};
        existingMeta.status = "cancelled";
        existingMeta.cancelled = new Date().toISOString();
        writeFileSecure(metaFile, JSON.stringify(existingMeta, null, 2));
        try { unlinkSync(pidFile); } catch {}
        return text(`Worker ${task_id} (PID ${pid}) killed.`);
      } catch (err) {
        return text(`Could not kill ${task_id} (PID ${pid}): ${err.message}`);
      }
    }

    // ─── RUN PIPELINE ───
    case "coord_run_pipeline": {
      const directory = requireDirectoryPath(args.directory);
      const tasks = Array.isArray(args.tasks) ? args.tasks : [];
      const pipeline_id = args.pipeline_id;
      if (!existsSync(directory)) return text(`Directory not found: ${directory}`);
      if (!tasks?.length) return text("No tasks provided.");

      const pipelineId = pipeline_id ? sanitizeId(pipeline_id, "pipeline_id") : `P${Date.now()}`;
      const pipelineDir = join(RESULTS_DIR, pipelineId);
      if (existsSync(pipelineDir)) return text(`Pipeline ID ${pipelineId} already exists. Use a new pipeline_id.`);
      mkdirSync(pipelineDir, { recursive: true });

      const escapedDir = PLATFORM === "win32" ? directory : directory.replace(/'/g, "'\\''");
      const settingsFlag = existsSync(SETTINGS_FILE) ? (PLATFORM === "win32" ? `--settings "${SETTINGS_FILE}"` : `--settings '${SETTINGS_FILE}'`) : "";

      // Context
      const cacheFile = join(SESSION_CACHE_DIR, "coder-context.md");
      let preamble = "";
      if (existsSync(cacheFile)) preamble = `## Prior Context\n${readFileSync(cacheFile, "utf-8").slice(0, 3000)}\n\n---\n\n`;
      const suffix = "\n\nWhen done, write key findings to ~/.claude/session-cache/coder-context.md.";

      const normalizedTasks = tasks.map((task, i) => {
        const name = sanitizeName(task?.name || `step-${i}`, "task name");
        const prompt = String(task?.prompt || "").trim();
        if (!prompt) throw new Error(`Task ${i} prompt is required.`);
        return {
          name,
          prompt,
          model: sanitizeModel(task?.model),
          agent: sanitizeAgent(task?.agent),
        };
      });

      normalizedTasks.forEach((task, i) => {
        writeFileSecure(join(pipelineDir, `${i}-${task.name}.prompt`), preamble + task.prompt + suffix);
      });

      // Build runner script (cross-platform)
      let script;
      if (PLATFORM === "win32") {
        script = `@echo off\ncd /d "${escapedDir}"\n`;
        normalizedTasks.forEach((task, i) => {
          const pf = join(pipelineDir, `${i}-${task.name}.prompt`);
          const rf = join(pipelineDir, `${i}-${task.name}.txt`);
          script += `echo Step ${i}: ${task.name}\n`;
          script += `${CLAUDE_BIN} -p --model ${task.model} ${task.agent ? `--agent ${task.agent}` : ""} ${settingsFlag} < "${pf}" > "${rf}" 2>&1\n`;
        });
        script += `echo {"status":"completed"} > "${join(pipelineDir, "pipeline.done")}"\n`;
        const runnerFile = join(pipelineDir, "run.bat");
        writeFileSecure(runnerFile, script);
      } else {
        script = `#!/bin/bash\nset -e\ncd '${escapedDir}'\n`;
        normalizedTasks.forEach((task, i) => {
          const pf = join(pipelineDir, `${i}-${task.name}.prompt`);
          const rf = join(pipelineDir, `${i}-${task.name}.txt`);
          script += `echo "=== Step ${i}: ${task.name} ===" | tee -a '${join(pipelineDir, "pipeline.log")}'\n`;
          script += `echo '{"step":${i},"name":"${task.name}","status":"running","started":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> '${join(pipelineDir, "pipeline.log")}'\n`;
          script += `env -u CLAUDECODE ${CLAUDE_BIN} -p --model ${task.model} ${task.agent ? `--agent ${task.agent}` : ""} ${settingsFlag} < '${pf}' > '${rf}' 2>&1\n`;
          script += `echo '{"step":${i},"name":"${task.name}","status":"completed","finished":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> '${join(pipelineDir, "pipeline.log")}'\n`;
        });
        script += `echo '{"status":"completed","finished":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > '${join(pipelineDir, "pipeline.done")}'\n`;
        const runnerFile = join(pipelineDir, "run.sh");
        writeFileSecure(runnerFile, script);
        try { chmodSync(runnerFile, 0o700); } catch {}
      }

      try {
        const runnerFile = join(pipelineDir, PLATFORM === "win32" ? "run.bat" : "run.sh");
        openTerminalWithCommand(PLATFORM === "win32" ? `"${runnerFile}"` : `'${runnerFile}'`, "tab");

        writeFileSecure(join(pipelineDir, "pipeline.meta.json"), JSON.stringify({
          pipeline_id: pipelineId, directory, total_steps: normalizedTasks.length,
          tasks: normalizedTasks.map((t, i) => ({ step: i, name: t.name, model: t.model })),
          started: new Date().toISOString(), status: "running",
        }, null, 2));

        return text(
          `Pipeline: **${pipelineId}**\n- Steps: ${normalizedTasks.length}\n` +
          normalizedTasks.map((t, i) => `  ${i}. ${t.name} (${t.model})`).join("\n") +
          `\n\nCheck: \`coord_get_pipeline pipeline_id="${pipelineId}"\``
        );
      } catch (err) {
        return text(`Failed to launch pipeline: ${err.message}`);
      }
    }

    // ─── GET PIPELINE ───
    case "coord_get_pipeline": {
      const pipeline_id = sanitizeId(args.pipeline_id, "pipeline_id");
      const pipelineDir = join(RESULTS_DIR, pipeline_id);
      if (!existsSync(pipelineDir)) return text(`Pipeline ${pipeline_id} not found.`);

      const meta = readJSON(join(pipelineDir, "pipeline.meta.json"));
      const isDone = existsSync(join(pipelineDir, "pipeline.done"));
      const doneData = isDone ? readJSON(join(pipelineDir, "pipeline.done")) : null;

      const logFile = join(pipelineDir, "pipeline.log");
      let logEntries = [];
      if (existsSync(logFile)) {
        logEntries = readFileSync(logFile, "utf-8").trim().split("\n")
          .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      }

      const completed = logEntries.filter(e => e.status === "completed");
      const current = logEntries.filter(e => e.status === "running").pop();

      let output = `## Pipeline ${pipeline_id}\n\n`;
      output += `- **Status:** ${isDone ? "completed" : current ? "running" : "starting"}\n`;
      output += `- **Steps:** ${completed.length}/${meta?.total_steps || "?"}\n`;
      if (meta?.started) output += `- **Started:** ${meta.started}\n`;
      if (doneData?.finished) output += `- **Finished:** ${doneData.finished}\n`;

      output += "\n### Steps\n";
      (meta?.tasks || []).forEach((task, i) => {
        const done = completed.find(e => e.step === i);
        const running = current?.step === i;
        output += `- [${done ? "done" : running ? "RUNNING" : "pending"}] ${i}: ${task.name}\n`;
      });

      const show = current || completed[completed.length - 1];
      if (show) {
        const sf = join(pipelineDir, `${show.step}-${show.name}.txt`);
        if (existsSync(sf)) {
          output += `\n### Output (Step ${show.step})\n\`\`\`\n${readFileSync(sf, "utf-8").split("\n").slice(-15).join("\n")}\n\`\`\`\n`;
        }
      }
      return text(output);
    }

    default:
      return text(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return text(`Invalid arguments for ${name}: ${err.message}`);
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch(err => { console.error("Coordinator error:", err); process.exit(1); });
}

export const __test__ = {
  PLATFORM,
  CLAUDE_BIN,
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
  isSafeTTYPath,
  selectWakeText,
};
