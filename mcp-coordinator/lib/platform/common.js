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
 * Interactive workers run as full Claude sessions with hooks (inbox checking, heartbeat).
 * The lead can send mid-execution messages that the worker receives on every tool call.
 * @param {object} opts - Worker options (same as buildWorkerScript)
 * @returns {string} Shell script string
 */
export function buildInteractiveWorkerScript(opts) {
  const { PLATFORM, SETTINGS_FILE, CLAUDE_BIN } = cfg();
  const {
    taskId,
    workDir,
    pidFile,
    metaFile,
    model,
    agent,
    promptFile,
  } = opts;
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
  const trapParts = [
    `printf '{"status":"completed","finished":"%s","task_id":"${taskId}"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${qMetaDone}`,
    `rm -f ${qPid}`,
  ];
  if (leadPaneId) {
    trapParts.push(
      `tmux send-keys -t "$CLAUDE_LEAD_PANE_ID" "[COMPLETED] ${workerDisplay}" Enter 2>/dev/null || true`,
    );
  }
  if (leadSessionId) {
    trapParts.push(
      `printf '{"ts":"%s","from":"coordinator","priority":"normal","content":"[COMPLETED] ${workerDisplay}"}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HOME/.claude/terminals/inbox/$CLAUDE_LEAD_SESSION_ID.jsonl" 2>/dev/null || true`,
    );
  }
  trapParts.push(autoClaimShellCommand());
  trapParts.push(
    '[ -n "${_IDLE_PID:-}" ] && kill "$_IDLE_PID" 2>/dev/null || true',
  );
  const exitTrapCmd = `trap '${trapParts.join("; ")}' EXIT`;

  let idleDetectorCmd = null;
  if (leadPaneId && sessionId) {
    const sid8 = sessionId.slice(0, 8);
    idleDetectorCmd = [
      `(IDLE_SENT=false`,
      `while kill -0 $$ 2>/dev/null`,
      `do sleep 3`,
      `SF="$HOME/.claude/terminals/session-${sid8}.json"`,
      `[ ! -f "$SF" ] && continue`,
      `AGE=$(( $(date +%s) - $(stat -f %m "$SF" 2>/dev/null || stat -c %Y "$SF" 2>/dev/null || echo $(date +%s)) ))`,
      `if [ "$AGE" -gt 5 ] && [ "$IDLE_SENT" = false ]`,
      `then tmux send-keys -t "$CLAUDE_LEAD_PANE_ID" "[IDLE] ${workerDisplay} — no activity for \${AGE}s" Enter 2>/dev/null || true`,
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
    `WORKER_PROMPT=$(cat ${qPrompt})`,
    exitTrapCmd,
    idleDetectorCmd,
    `unset CLAUDECODE && ${scriptWrapped}`,
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
  if (leadPaneId) {
    trapParts.push(
      `tmux send-keys -t "$CLAUDE_LEAD_PANE_ID" "[COMPLETED] ${workerName} (resumed)" Enter 2>/dev/null || true`,
    );
  }
  if (leadSessionId) {
    trapParts.push(
      `printf '{"ts":"%s","from":"coordinator","priority":"normal","content":"[COMPLETED] ${workerName} (resumed)"}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HOME/.claude/terminals/inbox/$CLAUDE_LEAD_SESSION_ID.jsonl" 2>/dev/null || true`,
    );
  }
  trapParts.push(autoClaimShellCommand());
  const exitTrapCmd = `trap '${trapParts.join("; ")}' EXIT`;

  return [
    `cd ${qDir}`,
    `echo $$ > ${qPid}`,
    envExports,
    exitTrapCmd,
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
