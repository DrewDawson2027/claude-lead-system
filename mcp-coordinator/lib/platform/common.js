/**
 * Cross-platform utilities: terminal detection, process management, launch commands.
 * @module platform/common
 */

import { existsSync } from "fs";
import { spawn, spawnSync, execFileSync } from "child_process";
import { cfg } from "../constants.js";
import { shellQuote } from "../helpers.js";

/**
 * Detect which terminal emulator is running.
 * @returns {string} Terminal app name or "none"/"background"
 */
export function getTerminalApp() {
  const { PLATFORM } = cfg();
  if (PLATFORM === "darwin") {
    if (spawnSync("pgrep", ["-x", "iTerm2"], { stdio: "ignore" }).status === 0) return "iTerm2";
    if (spawnSync("pgrep", ["-x", "Terminal"], { stdio: "ignore" }).status === 0) return "Terminal";
    return "none";
  } else if (PLATFORM === "win32") {
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
    for (const app of ["gnome-terminal", "konsole", "alacritty", "kitty", "xterm"]) {
      if (spawnSync("pgrep", ["-x", app], { stdio: "ignore" }).status === 0) return app;
    }
    return "none";
  }
}

/**
 * Build a platform-specific terminal launch command.
 * @param {string} platformName - OS platform
 * @param {string} termApp - Detected terminal app
 * @param {string} command - Shell command to run
 * @param {string} layout - "tab" or "split"
 * @returns {{ command: string, args: string[], app: string, detached?: boolean }}
 */
export function buildPlatformLaunchCommand(platformName, termApp, command, layout = "tab") {
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
    return { command: "bash", args: ["-lc", command], detached: true, app: "background" };
  }

  if (platformName === "win32") {
    if (termApp === "WindowsTerminal") {
      const base = layout === "split" ? ["-w", "0", "sp", "-V", "cmd", "/c", command] : ["-w", "0", "nt", "cmd", "/c", command];
      return { command: "wt", args: base, app: "WindowsTerminal" };
    }
    return { command: "cmd", args: ["/c", "start", "", "cmd", "/c", command], app: "cmd" };
  }

  // Linux
  if (termApp === "gnome-terminal") return { command: "gnome-terminal", args: ["--", "bash", "-c", command], app: "gnome-terminal" };
  if (termApp === "konsole") return { command: "konsole", args: ["-e", "bash", "-c", command], app: "konsole" };
  if (termApp === "alacritty") return { command: "alacritty", args: ["-e", "bash", "-c", command], app: "alacritty" };
  if (termApp === "kitty") {
    return {
      command: "kitty",
      args: layout === "split"
        ? ["@", "launch", "--type=window", "bash", "-c", command]
        : ["@", "launch", "--type=tab", "bash", "-c", command],
      app: "kitty",
    };
  }
  return { command: "bash", args: ["-lc", command], detached: true, app: "background" };
}

/**
 * Open a new terminal pane/tab with a command.
 * Falls back to headless background process if no terminal is detected.
 * @param {string} command - Shell command
 * @param {string} layout - "tab" or "split"
 * @returns {string} App name used
 */
export function openTerminalWithCommand(command, layout = "tab") {
  const { TEST_MODE, PLATFORM } = cfg();
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
    if (res.status !== 0) {
      // Headless fallback: if terminal launch fails, run as background process
      const child = spawn("bash", ["-lc", command], { detached: true, stdio: "ignore" });
      child.unref();
      return "headless-background";
    }
  }
  return launch.app;
}

/**
 * Check if a process is alive. Cross-platform.
 * @param {string|number} pid - Process ID
 * @returns {boolean} Whether the process is running
 */
export function isProcessAlive(pid) {
  const { PLATFORM } = cfg();
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

/**
 * Kill a process. Cross-platform.
 * @param {string|number} pid - Process ID
 */
export function killProcess(pid) {
  const { PLATFORM } = cfg();
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

/**
 * Validate a TTY path is safe (no path traversal).
 * @param {string} pathValue - TTY path
 * @returns {boolean} Whether the path is a valid TTY
 */
export function isSafeTTYPath(pathValue) {
  const tty = String(pathValue || "").trim();
  return /^\/dev\/(?:ttys?\d+|pts\/\d+)$/.test(tty);
}

/**
 * Build a cross-platform interactive worker script.
 * Interactive workers run as full Claude sessions with hooks (inbox checking, heartbeat).
 * The lead can send mid-execution messages that the worker receives on every tool call.
 * @param {object} opts - Worker options (same as buildWorkerScript)
 * @returns {string} Shell script string
 */
export function buildInteractiveWorkerScript(opts) {
  const { PLATFORM, SETTINGS_FILE, CLAUDE_BIN } = cfg();
  const {
    taskId, workDir, pidFile, metaFile,
    model, agent, promptFile,
  } = opts;
  const platformName = opts.platformName ?? PLATFORM;

  // Windows: fall back to pipe mode (interactive not yet supported)
  if (platformName === "win32") {
    return buildWorkerScript(opts);
  }

  const qDir = shellQuote(workDir);
  const qPid = shellQuote(pidFile);
  const qPrompt = shellQuote(promptFile);
  const qMetaDone = shellQuote(`${metaFile}.done`);
  const qTaskId = shellQuote(taskId);
  const qModel = shellQuote(model);
  const qClaudeBin = shellQuote(CLAUDE_BIN);
  const agentArgs = agent ? `--agent ${shellQuote(agent)}` : "";
  const settingsArgs = existsSync(SETTINGS_FILE) ? `--settings ${shellQuote(SETTINGS_FILE)}` : "";

  return [
    `cd ${qDir}`,
    `echo $$ > ${qPid}`,
    `WORKER_PROMPT=$(cat ${qPrompt})`,
    `unset CLAUDECODE && ${qClaudeBin} --prompt "$WORKER_PROMPT" --permission-mode acceptEdits --model ${qModel} ${agentArgs} ${settingsArgs}` +
    `; printf '{"status":"completed","finished":"%s","task_id":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${qTaskId} > ${qMetaDone}` +
    `; rm -f ${qPid}`,
  ].join(" && ");
}

/**
 * Build a cross-platform worker script.
 * All dynamic values are shell-quoted to prevent injection.
 * @param {object} opts - Worker options
 * @param {string} opts.taskId - Worker task ID
 * @param {string} opts.workDir - Working directory
 * @param {string} opts.resultFile - Output file path
 * @param {string} opts.pidFile - PID file path
 * @param {string} opts.metaFile - Metadata file path
 * @param {string} opts.model - Model name (validated via sanitizeModel)
 * @param {string} opts.agent - Agent name (validated via sanitizeAgent, may be empty)
 * @param {string} opts.promptFile - Prompt file path
 * @param {string} opts.workerPs1File - Windows PS1 file path
 * @param {string} [opts.platformName] - Platform override
 * @returns {string} Shell script string
 */
/**
 * Build a cross-platform interactive worker script.
 * Interactive workers run as full Claude sessions with hooks (inbox checking, heartbeat).
 * The lead can send mid-execution messages that the worker receives on every tool call.
 * @param {object} opts - Worker options (same as buildWorkerScript)
 * @returns {string} Shell script string
 */
export function buildInteractiveWorkerScript(opts) {
  const { PLATFORM, SETTINGS_FILE, CLAUDE_BIN } = cfg();
  const {
    taskId, workDir, resultFile, pidFile, metaFile,
    model, agent, promptFile,
  } = opts;
  const platformName = opts.platformName ?? PLATFORM;

  // Windows: fall back to pipe mode (interactive not yet supported)
  if (platformName === "win32") {
    return buildWorkerScript(opts);
  }

  const qDir = shellQuote(workDir);
  const qPid = shellQuote(pidFile);
  const qPrompt = shellQuote(promptFile);
  const qMetaDone = shellQuote(`${metaFile}.done`);
  const qTaskId = shellQuote(taskId);
  const qModel = shellQuote(model);
  const qClaudeBin = shellQuote(CLAUDE_BIN);
  const agentArgs = agent ? `--agent ${shellQuote(agent)}` : "";
  const settingsArgs = existsSync(SETTINGS_FILE) ? `--settings ${shellQuote(SETTINGS_FILE)}` : "";

  // Interactive mode: claude runs with --prompt and full hook infrastructure
  // Uses ; instead of && after claude so done file is written even on non-zero exit
  return [
    `cd ${qDir}`,
    `echo $$ > ${qPid}`,
    `WORKER_PROMPT=$(cat ${qPrompt})`,
    // unset CLAUDECODE prevents child inheriting parent session env
    `unset CLAUDECODE && ${qClaudeBin} --prompt "$WORKER_PROMPT" --permission-mode acceptEdits --model ${qModel} ${agentArgs} ${settingsArgs}` +
    `; printf '{"status":"completed","finished":"%s","task_id":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${qTaskId} > ${qMetaDone}` +
    `; rm -f ${qPid}`,
  ].join(" && ");
}

/**
 * Build a cross-platform worker script.
 * All dynamic values are shell-quoted to prevent injection.
 * @param {object} opts - Worker options
 * @param {string} opts.taskId - Worker task ID
 * @param {string} opts.workDir - Working directory
 * @param {string} opts.resultFile - Output file path
 * @param {string} opts.pidFile - PID file path
 * @param {string} opts.metaFile - Metadata file path
 * @param {string} opts.model - Model name (validated via sanitizeModel)
 * @param {string} opts.agent - Agent name (validated via sanitizeAgent, may be empty)
 * @param {string} opts.promptFile - Prompt file path
 * @param {string} opts.workerPs1File - Windows PS1 file path
 * @param {string} [opts.platformName] - Platform override
 * @returns {string} Shell script string
 */
export function buildWorkerScript(opts) {
  const { PLATFORM, SETTINGS_FILE, CLAUDE_BIN } = cfg();
  const {
    taskId, workDir, resultFile, pidFile, metaFile,
    model, agent, promptFile, workerPs1File = "",
  } = opts;
  const platformName = opts.platformName ?? PLATFORM;

  if (platformName === "win32") {
    const q = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const winSettings = existsSync(SETTINGS_FILE) ? SETTINGS_FILE : "";
    return [
      `cd /d "${workDir}"`,
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${q(workerPs1File)} -WorkingDir ${q(workDir)} -ClaudeBin ${q(CLAUDE_BIN)} -PromptFile ${q(promptFile)} -ResultFile ${q(resultFile)} -PidFile ${q(pidFile)} -MetaDoneFile ${q(`${metaFile}.done`)} -Model ${q(model)} -Agent ${q(agent || "")} -SettingsFile ${q(winSettings)}`,
    ].join(" && ");
  } else {
    const qDir = shellQuote(workDir);
    const qResult = shellQuote(resultFile);
    const qPid = shellQuote(pidFile);
    const qPrompt = shellQuote(promptFile);
    const qMetaDone = shellQuote(`${metaFile}.done`);
    const qModel = shellQuote(model);
    const qClaudeBin = shellQuote(CLAUDE_BIN);
    const agentArgs = agent ? `--agent ${shellQuote(agent)}` : "";
    const settingsArgs = existsSync(SETTINGS_FILE) ? `--settings ${shellQuote(SETTINGS_FILE)}` : "";
    const qTaskId = shellQuote(taskId);
    return [
      `cd ${qDir}`,
      `echo "Worker ${qTaskId} starting at $(date)" > ${qResult}`,
      `echo $$ > ${qPid}`,
      // unset CLAUDECODE: prevent child claude process from inheriting parent's session env
      `unset CLAUDECODE && ${qClaudeBin} -p --model ${qModel} ${agentArgs} ${settingsArgs} < ${qPrompt} >> ${qResult} 2>&1`,
      `printf '{"status":"completed","finished":"%s","task_id":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${qTaskId} > ${qMetaDone}`,
      `rm -f ${qPid}`,
    ].join(" && ");
  }
}
