/**
 * Cross-platform utilities: terminal detection, process management, launch commands.
 * @module platform/common
 */

import {
  existsSync,
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
} from "fs";
import { spawn, spawnSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { cfg } from "../constants.js";
import { shellQuote } from "../helpers.js";

const AUTOCLAIM_SCRIPT = fileURLToPath(
  new URL("../../scripts/claim-next-task.mjs", import.meta.url),
);
const AUTOCLAIM_NODE = process.execPath || "node";

function buildAutoClaimPayload(opts = {}) {
  const teamName = String(opts.teamName || "").trim();
  const assignee = String(opts.workerName || "").trim();
  if (!teamName || !assignee) return null;
  const payload = {
    team_name: teamName,
    assignee,
    completed_worker_task_id: opts.taskId,
    directory: opts.defaultDirectory || opts.workDir,
    mode: opts.mode,
    runtime: opts.runtime,
    layout: opts.layout,
    notify_session_id: opts.leadSessionId,
    model: opts.model,
    agent: opts.agent,
    role: opts.role,
    permission_mode: opts.permissionMode,
    context_level: opts.contextLevel,
    budget_policy: opts.budgetPolicy,
    budget_tokens: opts.budgetTokens,
    global_budget_policy: opts.globalBudgetPolicy,
    global_budget_tokens: opts.globalBudgetTokens,
    max_active_workers: opts.maxActiveWorkers,
    require_plan: opts.requirePlan,
    max_turns: opts.maxTurns,
    context_summary: opts.contextSummary,
  };
  if (typeof opts.isolate === "boolean") payload.isolate = opts.isolate;
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string") return value.trim() !== "";
      return true;
    }),
  );
}

function buildAutoClaimEnvExports(opts = {}) {
  const payload = buildAutoClaimPayload(opts);
  if (!payload) return [];
  return [
    `export CLAUDE_AUTOCLAIM_NODE=${shellQuote(AUTOCLAIM_NODE)}`,
    `export CLAUDE_AUTOCLAIM_SCRIPT=${shellQuote(AUTOCLAIM_SCRIPT)}`,
    `export CLAUDE_AUTOCLAIM_ARGS_B64=${shellQuote(Buffer.from(JSON.stringify(payload), "utf8").toString("base64"))}`,
  ];
}

function autoClaimShellCommand() {
  return '([ -n "${CLAUDE_AUTOCLAIM_ARGS_B64:-}" ] && "$CLAUDE_AUTOCLAIM_NODE" "$CLAUDE_AUTOCLAIM_SCRIPT" >/dev/null 2>&1) || true';
}

/**
 * Detect if we're running inside a tmux session.
 * @returns {boolean}
 */
export function isInsideTmux() {
  return Boolean(process.env.TMUX);
}

/**
 * Get the current tmux pane ID.
 * @returns {string|null} e.g. "%5"
 */
export function getCurrentTmuxPane() {
  if (!isInsideTmux()) return null;
  try {
    const result = spawnSync("tmux", ["display-message", "-p", "#{pane_id}"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    const paneId = (result.stdout || "").trim();
    if (result.status === 0 && paneId.startsWith("%")) return paneId;
  } catch {
    // Fall back to env var if tmux command is unavailable.
  }
  const envPane = String(process.env.TMUX_PANE || "").trim();
  return envPane.startsWith("%") ? envPane : null;
}

/**
 * Spawn a worker in a new tmux pane (split from current window).
 * Returns the new pane's ID for message injection via send-keys.
 * @param {string} script - Shell command to run in the pane
 * @returns {{ paneId: string, app: string }} Pane ID and app name
 */
export function spawnTmuxPaneWorker(script) {
  // split-window prints the new pane's ID via -P/-F
  const result = spawnSync(
    "tmux",
    [
      "split-window",
      "-d", // don't switch focus to new pane
      "-P",
      "-F",
      "#{pane_id}", // print new pane ID
      script,
    ],
    { encoding: "utf-8", timeout: 10000 },
  );

  if (result.status !== 0) {
    throw new Error(
      `tmux split-window failed: ${(result.stderr || "").trim()}`,
    );
  }

  const paneId = (result.stdout || "").trim();
  if (!paneId.startsWith("%")) {
    throw new Error(`tmux split-window returned unexpected pane ID: ${paneId}`);
  }

  // Auto-tile after creating pane for balanced layout
  spawnSync("tmux", ["select-layout", "tiled"], {
    stdio: "ignore",
    timeout: 3000,
  });

  return { paneId, app: "tmux" };
}

/**
 * Send keys to a tmux pane — push-delivers a message as user input.
 * This is how native Agent Teams delivers messages: injecting text into the
 * teammate's terminal so Claude sees it as a new conversation turn.
 * @param {string} paneId - tmux pane ID (e.g. "%5")
 * @param {string} text - Text to inject
 * @returns {boolean} Whether send succeeded
 */
export function tmuxSendKeys(paneId, text) {
  if (!paneId || !isInsideTmux()) return false;
  try {
    const payload = String(text || "")
      .replace(/[\r\n]+/g, " ")
      .trim();
    if (!payload) return false;
    const result = spawnSync(
      "tmux",
      ["send-keys", "-t", paneId, payload, "Enter"],
      { stdio: "ignore", timeout: 5000 },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux pane still exists.
 * @param {string} paneId - tmux pane ID
 * @returns {boolean}
 */
export function isTmuxPaneAlive(paneId) {
  if (!paneId || !isInsideTmux()) return false;
  try {
    const result = spawnSync("tmux", ["list-panes", "-F", "#{pane_id}"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    return (result.stdout || "").includes(paneId);
  } catch {
    return false;
  }
}

/**
 * Detect which terminal emulator is running.
 * @returns {string} Terminal app name or "none"/"background"
 */
export function getTerminalApp() {
  const { PLATFORM } = cfg();
  if (PLATFORM === "darwin") {
    if (spawnSync("pgrep", ["-x", "iTerm2"], { stdio: "ignore" }).status === 0)
      return "iTerm2";
    if (
      spawnSync("pgrep", ["-x", "Terminal"], { stdio: "ignore" }).status === 0
    )
      return "Terminal";
    return "none";
  } else if (PLATFORM === "win32") {
    try {
      const wt = execFileSync(
        "tasklist",
        ["/FI", "IMAGENAME eq WindowsTerminal.exe", "/NH"],
        { encoding: "utf-8" },
      );
      if (wt.toLowerCase().includes("windowsterminal"))
        return "WindowsTerminal";
    } catch {}
    try {
      const ps = execFileSync(
        "tasklist",
        ["/FI", "IMAGENAME eq powershell.exe", "/NH"],
        { encoding: "utf-8" },
      );
      if (ps.toLowerCase().includes("powershell")) return "PowerShell";
    } catch {}
    return "cmd";
  } else {
    for (const app of [
      "gnome-terminal",
      "konsole",
      "alacritty",
      "kitty",
      "xterm",
    ]) {
      if (spawnSync("pgrep", ["-x", app], { stdio: "ignore" }).status === 0)
        return app;
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
export function buildPlatformLaunchCommand(
  platformName,
  termApp,
  command,
  layout = "tab",
) {
  if (platformName === "darwin") {
    if (termApp === "iTerm2") {
      const splitScript =
        'tell application "iTerm2" to tell current session of current window to split vertically with default profile';
      const tabScript =
        'tell application "iTerm2" to tell current window to create tab with default profile';
      const writeScript = `tell application "iTerm2" to tell current session of current window to write text ${JSON.stringify(command)}`;
      return {
        command: "osascript",
        args:
          layout === "split"
            ? ["-e", splitScript, "-e", writeScript]
            : ["-e", tabScript, "-e", writeScript],
        app: "iTerm2",
      };
    }
    if (termApp === "Terminal") {
      return {
        command: "osascript",
        args: [
          "-e",
          `tell application "Terminal" to do script ${JSON.stringify(command)}`,
        ],
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
      const base =
        layout === "split"
          ? ["-w", "0", "sp", "-V", "cmd", "/c", command]
          : ["-w", "0", "nt", "cmd", "/c", command];
      return { command: "wt", args: base, app: "WindowsTerminal" };
    }
    return {
      command: "cmd",
      args: ["/c", "start", "", "cmd", "/c", command],
      app: "cmd",
    };
  }

  // Linux
  if (termApp === "gnome-terminal")
    return {
      command: "gnome-terminal",
      args: ["--", "bash", "-c", command],
      app: "gnome-terminal",
    };
  if (termApp === "konsole")
    return {
      command: "konsole",
      args: ["-e", "bash", "-c", command],
      app: "konsole",
    };
  if (termApp === "alacritty")
    return {
      command: "alacritty",
      args: ["-e", "bash", "-c", command],
      app: "alacritty",
    };
  if (termApp === "kitty") {
    return {
      command: "kitty",
      args:
        layout === "split"
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
    const child = spawn("bash", ["-lc", command], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return "test-background";
  }

  const termApp = getTerminalApp();
  const launch = buildPlatformLaunchCommand(PLATFORM, termApp, command, layout);
  if (launch.detached) {
    const child = spawn(launch.command, launch.args || [], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else {
    const res = spawnSync(launch.command, launch.args || [], {
      stdio: "ignore",
      timeout: 5000,
    });
    if (res.status !== 0) {
      // Headless fallback: if terminal launch fails, run as background process
      const child = spawn("bash", ["-lc", command], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return "headless-background";
    }
  }
  return launch.app;
}

/**
 * Spawn a worker as a background process (no terminal).
 * Fastest spawn mode — eliminates all terminal overhead.
 * @param {string} script - Shell script to execute
 * @param {string} resultFile - Path for stdout/stderr capture
 * @param {string} pidFile - Path to write child PID
 */
export function spawnBackgroundWorker(script, resultFile, pidFile) {
  const { PLATFORM } = cfg();
  const out = openSync(resultFile, "a");
  const child =
    PLATFORM === "win32"
      ? spawn("cmd", ["/c", script], {
          detached: true,
          stdio: ["ignore", out, out],
        })
      : spawn("sh", ["-c", script], {
          detached: true,
          stdio: ["ignore", out, out],
        });
  writeFileSync(pidFile, String(child.pid));
  child.unref();
  closeSync(out);
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
      const output = execFileSync(
        "tasklist",
        ["/FI", `PID eq ${pidNum}`, "/NH"],
        { encoding: "utf-8" },
      );
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
    execFileSync("taskkill", ["/PID", String(pidNum), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-pidNum, "SIGTERM");
    } catch {
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

export function buildInteractiveWorkerScript(opts) {
  const { PLATFORM, SETTINGS_FILE, CLAUDE_BIN } = cfg();
  const { taskId, workDir, pidFile, metaFile, model, agent, promptFile } = opts;
  const workerName = opts.workerName || "";
  const maxTurns = opts.maxTurns || "";
  const permissionMode = opts.permissionMode || "acceptEdits";
  const platformName = opts.platformName ?? PLATFORM;
  const teamName = opts.teamName || "";
  const mode = opts.mode || "interactive";
  const runtime = opts.runtime || "claude";
  const layout = opts.layout || "background";
  const defaultDirectory = opts.defaultDirectory || workDir;
  const role = opts.role || "";
  const contextLevel = opts.contextLevel || "";
  const budgetPolicy = opts.budgetPolicy || "";
  const budgetTokens = opts.budgetTokens;
  const globalBudgetPolicy = opts.globalBudgetPolicy || "";
  const globalBudgetTokens = opts.globalBudgetTokens;
  const maxActiveWorkers = opts.maxActiveWorkers;
  const requirePlan = opts.requirePlan;
  const contextSummary = opts.contextSummary || "";
  const sessionId = opts.sessionId || "";
  const leadSessionId = opts.leadSessionId || "";
  const leadPaneId = opts.leadPaneId || "";

  if (platformName === "win32") {
    return buildWorkerScript(opts);
  }

  const qDir = shellQuote(workDir);
  const qPid = shellQuote(pidFile);
  const qPrompt = shellQuote(promptFile);
  const qMetaDone = shellQuote(`${metaFile}.done`);
  const qModel = shellQuote(model);
  const qClaudeBin = shellQuote(CLAUDE_BIN);
  const agentArgs = agent ? `--agent ${shellQuote(agent)}` : "";
  const settingsArgs = existsSync(SETTINGS_FILE)
    ? `--settings ${shellQuote(SETTINGS_FILE)}`
    : "";

  const envExports = [
    ...buildAutoClaimEnvExports({
      taskId,
      workDir,
      defaultDirectory,
      teamName,
      workerName: workerName || taskId,
      mode,
      runtime,
      layout,
      leadSessionId,
      model,
      agent,
      role,
      permissionMode,
      contextLevel,
      budgetPolicy,
      budgetTokens,
      globalBudgetPolicy,
      globalBudgetTokens,
      maxActiveWorkers,
      requirePlan,
      maxTurns,
      contextSummary,
      isolate: opts.isolate,
    }),
    `export CLAUDE_WORKER_TASK_ID=${shellQuote(taskId)}`,
    workerName ? `export CLAUDE_WORKER_NAME=${shellQuote(workerName)}` : "",
    maxTurns
      ? `export CLAUDE_WORKER_MAX_TURNS=${shellQuote(String(maxTurns))}`
      : "",
    permissionMode && permissionMode !== "acceptEdits"
      ? `export CLAUDE_WORKER_PERMISSION_MODE=${shellQuote(permissionMode)}`
      : "",
    leadSessionId
      ? `export CLAUDE_LEAD_SESSION_ID=${shellQuote(leadSessionId)}`
      : "",
    leadPaneId ? `export CLAUDE_LEAD_PANE_ID=${shellQuote(leadPaneId)}` : "",
  ]
    .filter(Boolean)
    .join(" && ");

  const transcriptFile = opts.resultFile.replace(/\.txt$/, ".transcript");
  const qTranscript = shellQuote(transcriptFile);
  const isLinux = platformName === "linux";
  const qPermMode = shellQuote(permissionMode);
  const sessionIdArg = sessionId ? `--session-id ${shellQuote(sessionId)}` : "";
  const claudeCmd = `${qClaudeBin} --prompt "$WORKER_PROMPT" --permission-mode ${qPermMode} --model ${qModel} ${sessionIdArg} ${agentArgs} ${settingsArgs}`;
  const scriptWrapped = isLinux
    ? `script -q ${qTranscript} -c "${claudeCmd.replace(/"/g, '\\"')}"`
    : `script -q ${qTranscript} ${claudeCmd}`;

  const workerDisplay = workerName || taskId;
  // Completion commands run inside the loop body after each claude invocation exits.
  const completionCmds = [
    `printf '{"status":"completed","finished":"%s","task_id":"${taskId}"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${qMetaDone}`,
    `rm -f ${qPid}`,
  ];
  // NOTE: tmux send-keys "[COMPLETED]" removed — it injects raw text as user input
  // into the lead's terminal, causing Claude to treat it as a user message and respond.
  // Inbox-only delivery (below) is the correct mechanism: controlled, session-scoped,
  // and surfaced by check-inbox.sh on the next tool call.
  if (leadSessionId) {
    completionCmds.push(
      `printf '{"ts":"%s","from":"coordinator","priority":"normal","content":"[COMPLETED] ${workerDisplay}"}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HOME/.claude/terminals/inbox/$CLAUDE_LEAD_SESSION_ID.jsonl" 2>/dev/null || true`,
    );
  }

  // Claim-next block: runs at end of each loop iteration.
  // Uses --claim-only to get JSON task data without spawning a new process.
  // Empty output signals no more tasks -- breaks the loop.
  const claimNextCmds = [
    '[ -n "${CLAUDE_AUTOCLAIM_ARGS_B64:-}" ] || break',
    '_CLAIM=$("$CLAUDE_AUTOCLAIM_NODE" "$CLAUDE_AUTOCLAIM_SCRIPT" --claim-only 2>/dev/null) || true',
    '[ -z "$_CLAIM" ] && break',
    `_TID=$("$CLAUDE_AUTOCLAIM_NODE" --input-type=commonjs -e "try{process.stdout.write(JSON.parse(process.argv[1]).task_id||'')}catch{}" "$_CLAIM" 2>/dev/null)`,
    '[ -z "$_TID" ] && break',
    `_NP=$("$CLAUDE_AUTOCLAIM_NODE" --input-type=commonjs -e "try{process.stdout.write(JSON.parse(process.argv[1]).prompt||'')}catch{}" "$_CLAIM" 2>/dev/null)`,
    `printf '%s' "$_NP" > ${qPrompt}`,
    'CLAUDE_WORKER_TASK_ID="$_TID" && export CLAUDE_WORKER_TASK_ID',
    `echo $$ > ${qPid}`,
  ].join('; ');

  const loopBody = [
    `WORKER_PROMPT=$(cat ${qPrompt})`,
    `unset CLAUDECODE && ${scriptWrapped}`,
    ...completionCmds,
    claimNextCmds,
  ].join('; ');

  const persistentLoop = `while true; do ${loopBody}; done`;

  // EXIT trap is now cleanup-only -- completion and claim-next run inside the loop body
  const exitTrapCmd = `trap '[ -n "\${_IDLE_PID:-}" ] && kill "$_IDLE_PID" 2>/dev/null || true' EXIT`;

  let idleDetectorCmd = null;
  if (leadPaneId && sessionId) {
    const sid8 = sessionId.slice(0, 8);
    idleDetectorCmd = [
      `(IDLE_SENT=false`,
      `while kill -0 $$ 2>/dev/null`,
      `do sleep 1`,
      `SF="$HOME/.claude/terminals/session-${sid8}.json"`,
      `[ ! -f "$SF" ] && continue`,
      `AGE=$(( $(date +%s) - $(stat -f %m "$SF" 2>/dev/null || stat -c %Y "$SF" 2>/dev/null || echo $(date +%s)) ))`,
      `if [ "$AGE" -gt 5 ] && [ "$IDLE_SENT" = false ]`,
      `then printf '{"ts":"%s","from":"idle-detector","priority":"normal","content":"[IDLE] ${workerDisplay} — no activity for '\\''\${AGE}'\\'s"}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HOME/.claude/terminals/inbox/$CLAUDE_LEAD_SESSION_ID.jsonl" 2>/dev/null || true`,
      `IDLE_SENT=true`,
      `elif [ "$AGE" -le 5 ]`,
      `then IDLE_SENT=false`,
      `fi`,
      `done) & _IDLE_PID=$!`,
    ].join("; ");
  }

  return [
    `cd ${qDir}`,
    `echo $$ > ${qPid}`,
    envExports,
    exitTrapCmd,
    idleDetectorCmd,
    persistentLoop,
  ]
    .filter(Boolean)
    .join(" && ");
}

/**
 * Build a resume script that continues a prior session using --resume.
 * @param {object} opts - Resume options
 * @param {string} opts.sessionId - Claude session ID to resume
 * @param {string} opts.workDir - Working directory
 * @param {string} opts.pidFile - PID file path
 * @param {string} opts.metaFile - Meta file path
 * @param {string} opts.taskId - Task ID
 * @param {string} [opts.leadSessionId] - Lead session ID for notifications
 * @param {string} [opts.leadPaneId] - Lead tmux pane ID for push notifications
 * @returns {string} Shell script string
 */
export function buildResumeWorkerScript(opts) {
  const { CLAUDE_BIN, SETTINGS_FILE } = cfg();
  const { sessionId, workDir, pidFile, metaFile, taskId } = opts;
  const leadSessionId = opts.leadSessionId || "";
  const leadPaneId = opts.leadPaneId || "";
  const workerName = opts.workerName || taskId;
  const teamName = opts.teamName || "";
  const defaultDirectory = opts.defaultDirectory || workDir;

  const qDir = shellQuote(workDir);
  const qPid = shellQuote(pidFile);
  const qMetaDone = shellQuote(`${metaFile}.done`);
  const qClaudeBin = shellQuote(CLAUDE_BIN);
  const qSessionId = shellQuote(sessionId);
  const settingsArgs = existsSync(SETTINGS_FILE)
    ? `--settings ${shellQuote(SETTINGS_FILE)}`
    : "";

  const envExports = [
    ...buildAutoClaimEnvExports({
      taskId,
      workDir,
      defaultDirectory,
      teamName,
      workerName,
      mode: opts.mode || "interactive",
      runtime: opts.runtime || "claude",
      layout: opts.layout || "background",
      leadSessionId,
      model: opts.model,
      agent: opts.agent,
      role: opts.role,
      permissionMode: opts.permissionMode,
      contextLevel: opts.contextLevel,
      budgetPolicy: opts.budgetPolicy,
      budgetTokens: opts.budgetTokens,
      globalBudgetPolicy: opts.globalBudgetPolicy,
      globalBudgetTokens: opts.globalBudgetTokens,
      maxActiveWorkers: opts.maxActiveWorkers,
      requirePlan: opts.requirePlan,
      maxTurns: opts.maxTurns,
      contextSummary: opts.contextSummary,
      isolate: opts.isolate,
    }),
    `export CLAUDE_WORKER_TASK_ID=${shellQuote(taskId)}`,
    workerName ? `export CLAUDE_WORKER_NAME=${shellQuote(workerName)}` : "",
    leadSessionId
      ? `export CLAUDE_LEAD_SESSION_ID=${shellQuote(leadSessionId)}`
      : "",
    leadPaneId ? `export CLAUDE_LEAD_PANE_ID=${shellQuote(leadPaneId)}` : "",
  ]
    .filter(Boolean)
    .join(" && ");

  const trapParts = [
    `printf '{"status":"completed","finished":"%s","task_id":"${taskId}"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${qMetaDone}`,
    `rm -f ${qPid}`,
  ];
  // NOTE: tmux send-keys "[COMPLETED]" removed from resume script — same fix as
  // buildInteractiveWorkerScript. It injects raw text as user input into the lead's
  // terminal, causing Claude to treat it as a user message. Inbox-only delivery below.
  if (leadSessionId) {
    trapParts.push(
      `printf '{"ts":"%s","from":"coordinator","priority":"normal","content":"[COMPLETED] ${workerName} (resumed)"}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HOME/.claude/terminals/inbox/$CLAUDE_LEAD_SESSION_ID.jsonl" 2>/dev/null || true`,
    );
  }
  trapParts.push(autoClaimShellCommand());
  trapParts.push(
    '[ -n "${_IDLE_PID:-}" ] && kill "$_IDLE_PID" 2>/dev/null || true',
  );
  const exitTrapCmd = `trap '${trapParts.join("; ")}' EXIT`;

  // Idle detector for resumed workers (same as interactive workers)
  let idleDetectorCmd = null;
  if (leadSessionId && sessionId) {
    const sid8 = sessionId.slice(0, 8);
    idleDetectorCmd = [
      `(IDLE_SENT=false`,
      `while kill -0 $$ 2>/dev/null`,
      `do sleep 1`,
      `SF="$HOME/.claude/terminals/session-${sid8}.json"`,
      `[ ! -f "$SF" ] && continue`,
      `AGE=$(( $(date +%s) - $(stat -f %m "$SF" 2>/dev/null || stat -c %Y "$SF" 2>/dev/null || echo $(date +%s)) ))`,
      `if [ "$AGE" -gt 5 ] && [ "$IDLE_SENT" = false ]`,
      `then printf '{"ts":"%s","from":"idle-detector","priority":"normal","content":"[IDLE] ${workerName} (resumed) — no activity for '\\''\${AGE}'\\'s"}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HOME/.claude/terminals/inbox/$CLAUDE_LEAD_SESSION_ID.jsonl" 2>/dev/null || true`,
      `IDLE_SENT=true`,
      `elif [ "$AGE" -le 5 ]`,
      `then IDLE_SENT=false`,
      `fi`,
      `done) & _IDLE_PID=$!`,
    ].join("; ");
  }

  return [
    `cd ${qDir}`,
    `echo $$ > ${qPid}`,
    envExports,
    exitTrapCmd,
    idleDetectorCmd,
    `unset CLAUDECODE && ${qClaudeBin} --resume ${qSessionId} ${settingsArgs}`,
  ]
    .filter(Boolean)
    .join(" && ");
}

/**
 * Build a Codex CLI worker script (pipe mode).
 * Uses `codex exec` for non-interactive execution with stdout captured to result file.
 * @param {object} opts - Worker options
 * @returns {string} Shell script string
 */
export function buildCodexWorkerScript(opts) {
  const { taskId, workDir, resultFile, pidFile, metaFile, model, promptFile } =
    opts;
  const platformName = opts.platformName ?? cfg().PLATFORM;

  if (platformName === "win32") {
    return `echo "Codex workers not supported on Windows yet" && exit 1`;
  }

  const qDir = shellQuote(workDir);
  const qResult = shellQuote(resultFile);
  const qPid = shellQuote(pidFile);
  const qPrompt = shellQuote(promptFile);
  const qMetaDone = shellQuote(`${metaFile}.done`);
  const qTaskId = shellQuote(taskId);
  const autoClaimEnv = buildAutoClaimEnvExports({
    taskId,
    workDir,
    defaultDirectory: opts.defaultDirectory || workDir,
    teamName: opts.teamName,
    workerName: opts.workerName || taskId,
    mode: opts.mode || "pipe",
    runtime: opts.runtime || "codex",
    layout: opts.layout || "background",
    leadSessionId: opts.leadSessionId,
    model,
    agent: opts.agent,
    role: opts.role,
    permissionMode: opts.permissionMode,
    contextLevel: opts.contextLevel,
    budgetPolicy: opts.budgetPolicy,
    budgetTokens: opts.budgetTokens,
    globalBudgetPolicy: opts.globalBudgetPolicy,
    globalBudgetTokens: opts.globalBudgetTokens,
    maxActiveWorkers: opts.maxActiveWorkers,
    requirePlan: opts.requirePlan,
    maxTurns: opts.maxTurns,
    contextSummary: opts.contextSummary,
    isolate: opts.isolate,
  }).join(" && ");
  const modelArgs =
    model && model !== "sonnet" ? `-m ${shellQuote(model)}` : "";

  return [
    `cd ${qDir}`,
    `echo "Codex Worker ${qTaskId} starting at $(date)" > ${qResult}`,
    `echo $$ > ${qPid}`,
    autoClaimEnv,
    `WORKER_PROMPT=$(cat ${qPrompt})`,
    `codex exec "$WORKER_PROMPT" --full-auto -C ${qDir} ${modelArgs} >> ${qResult} 2>&1` +
      `; printf '{"status":"completed","finished":"%s","task_id":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${qTaskId} > ${qMetaDone}` +
      `; rm -f ${qPid}` +
      `; ${autoClaimShellCommand()}`,
  ]
    .filter(Boolean)
    .join(" && ");
}

/**
 * Build a Codex CLI interactive worker script.
 * Uses `codex` TUI mode with --full-auto for autonomous execution with live terminal.
 * @param {object} opts - Worker options
 * @returns {string} Shell script string
 */
export function buildCodexInteractiveWorkerScript(opts) {
  const { taskId, workDir, resultFile, pidFile, metaFile, model, promptFile } =
    opts;
  const platformName = opts.platformName ?? cfg().PLATFORM;

  if (platformName === "win32") {
    return `echo "Codex workers not supported on Windows yet" && exit 1`;
  }

  const qDir = shellQuote(workDir);
  const qPid = shellQuote(pidFile);
  const qPrompt = shellQuote(promptFile);
  const qMetaDone = shellQuote(`${metaFile}.done`);
  const qTaskId = shellQuote(taskId);
  const autoClaimEnv = buildAutoClaimEnvExports({
    taskId,
    workDir,
    defaultDirectory: opts.defaultDirectory || workDir,
    teamName: opts.teamName,
    workerName: opts.workerName || taskId,
    mode: opts.mode || "interactive",
    runtime: opts.runtime || "codex",
    layout: opts.layout || "background",
    leadSessionId: opts.leadSessionId,
    model,
    agent: opts.agent,
    role: opts.role,
    permissionMode: opts.permissionMode,
    contextLevel: opts.contextLevel,
    budgetPolicy: opts.budgetPolicy,
    budgetTokens: opts.budgetTokens,
    globalBudgetPolicy: opts.globalBudgetPolicy,
    globalBudgetTokens: opts.globalBudgetTokens,
    maxActiveWorkers: opts.maxActiveWorkers,
    requirePlan: opts.requirePlan,
    maxTurns: opts.maxTurns,
    contextSummary: opts.contextSummary,
    isolate: opts.isolate,
  })
    .filter(Boolean)
    .join(" && ");
  const modelArgs =
    model && model !== "sonnet" ? `-m ${shellQuote(model)}` : "";

  return [
    `cd ${qDir}`,
    `echo $$ > ${qPid}`,
    autoClaimEnv,
    `WORKER_PROMPT=$(cat ${qPrompt})`,
    `codex "$WORKER_PROMPT" --full-auto -C ${qDir} ${modelArgs}` +
      `; printf '{"status":"completed","finished":"%s","task_id":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${qTaskId} > ${qMetaDone}` +
      `; rm -f ${qPid}` +
      `; ${autoClaimShellCommand()}`,
  ]
    .filter(Boolean)
    .join(" && ");
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
    taskId,
    workDir,
    resultFile,
    pidFile,
    metaFile,
    model,
    agent,
    promptFile,
    workerPs1File = "",
  } = opts;
  const platformName = opts.platformName ?? PLATFORM;

  if (platformName === "win32") {
    const q = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const winSettings = existsSync(SETTINGS_FILE) ? SETTINGS_FILE : "";
    return [
      `cd /d "${workDir}"`,
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${q(workerPs1File)} -WorkingDir ${q(workDir)} -ClaudeBin ${q(CLAUDE_BIN)} -PromptFile ${q(promptFile)} -ResultFile ${q(resultFile)} -PidFile ${q(pidFile)} -MetaDoneFile ${q(`${metaFile}.done`)} -Model ${q(model)} -Agent ${q(agent || "")} -SettingsFile ${q(winSettings)}`,
    ]
      .filter(Boolean)
      .join(" && ");
  } else {
    const qDir = shellQuote(workDir);
    const qResult = shellQuote(resultFile);
    const qPid = shellQuote(pidFile);
    const qPrompt = shellQuote(promptFile);
    const qMetaDone = shellQuote(`${metaFile}.done`);
    const qModel = shellQuote(model);
    const qClaudeBin = shellQuote(CLAUDE_BIN);
    const agentArgs = agent ? `--agent ${shellQuote(agent)}` : "";
    const settingsArgs = existsSync(SETTINGS_FILE)
      ? `--settings ${shellQuote(SETTINGS_FILE)}`
      : "";
    const qTaskId = shellQuote(taskId);
    const autoClaimEnv = buildAutoClaimEnvExports({
      taskId,
      workDir,
      defaultDirectory: opts.defaultDirectory || workDir,
      teamName: opts.teamName,
      workerName: opts.workerName || taskId,
      mode: opts.mode || "pipe",
      runtime: opts.runtime || "claude",
      layout: opts.layout || "background",
      leadSessionId: opts.leadSessionId,
      model,
      agent,
      role: opts.role,
      permissionMode: opts.permissionMode,
      contextLevel: opts.contextLevel,
      budgetPolicy: opts.budgetPolicy,
      budgetTokens: opts.budgetTokens,
      globalBudgetPolicy: opts.globalBudgetPolicy,
      globalBudgetTokens: opts.globalBudgetTokens,
      maxActiveWorkers: opts.maxActiveWorkers,
      requirePlan: opts.requirePlan,
      maxTurns: opts.maxTurns,
      contextSummary: opts.contextSummary,
      isolate: opts.isolate,
    })
      .filter(Boolean)
      .join(" && ");
    return [
      `cd ${qDir}`,
      `echo "Worker ${qTaskId} starting at $(date)" > ${qResult}`,
      `echo $$ > ${qPid}`,
      autoClaimEnv,
      // unset CLAUDECODE: prevent child claude process from inheriting parent's session env
      `unset CLAUDECODE && ${qClaudeBin} -p --model ${qModel} ${agentArgs} ${settingsArgs} < ${qPrompt} >> ${qResult} 2>&1`,
      `printf '{"status":"completed","finished":"%s","task_id":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${qTaskId} > ${qMetaDone}`,
      `rm -f ${qPid}`,
      autoClaimShellCommand(),
    ]
      .filter(Boolean)
      .join(" && ");
  }
}
