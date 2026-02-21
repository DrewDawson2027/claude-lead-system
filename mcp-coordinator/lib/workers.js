/**
 * Worker lifecycle: spawn, get result, kill.
 * @module workers
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, chmodSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { execFileSync } from "child_process";
import { cfg } from "./constants.js";
import {
  sanitizeId, sanitizeShortSessionId, sanitizeName,
  sanitizeModel, sanitizeAgent, requireDirectoryPath,
  normalizeFilePath, writeFileSecure,
} from "./security.js";
import { readJSON, shellQuote, text } from "./helpers.js";
import { isProcessAlive, killProcess, buildWorkerScript, buildInteractiveWorkerScript, openTerminalWithCommand } from "./platform/common.js";

/**
 * Handle coord_spawn_worker tool call.
 * @param {object} args - Worker arguments
 * @returns {object} MCP text response
 */
export function handleSpawnWorker(args) {
  const { RESULTS_DIR, SESSION_CACHE_DIR, SETTINGS_FILE, PLATFORM, CLAUDE_BIN } = cfg();
  const directory = requireDirectoryPath(args.directory);
  const prompt = String(args.prompt || "").trim();
  const model = sanitizeModel(args.model);
  const agent = sanitizeAgent(args.agent);
  const task_id = args.task_id;
  const notifySessionRaw = args.notify_session_id ?? args.session_id ?? null;
  const notify_session_id = notifySessionRaw ? sanitizeShortSessionId(notifySessionRaw) : null;
  const files = (args.files || []).map(f => String(f).trim()).filter(Boolean);
  const layout = args.layout === "split" ? "split" : "tab";
  const mode = args.mode === "interactive" ? "interactive" : "pipe";
  if (!prompt) return text("Prompt is required.");
  if (!existsSync(directory)) return text(`Directory not found: ${directory}`);

  // Conflict check against running workers
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

  // Worktree isolation: create a git worktree so worker operates on an isolated copy
  const isolate = Boolean(args.isolate);
  let workerDir = directory;
  let worktreeBranch = null;
  if (isolate) {
    try {
      const worktreeBase = join(directory, ".claude", "worktrees");
      mkdirSync(worktreeBase, { recursive: true });
      const worktreePath = join(worktreeBase, taskId);
      worktreeBranch = `worker/${taskId}`;
      execFileSync("git", ["worktree", "add", worktreePath, "-b", worktreeBranch], {
        cwd: directory, stdio: "pipe", timeout: 15000,
      });
      workerDir = worktreePath;
    } catch (err) {
      return text(`Worktree creation failed: ${err.message}\nFalling back to non-isolated mode is not safe. Fix the git state or omit isolate.`);
    }
  }

  const meta = {
    task_id: taskId, directory: workerDir, original_directory: directory,
    prompt: prompt.slice(0, 500),
    model, agent: agent || null,
    notify_session_id, isolated: isolate, worktree_branch: worktreeBranch,
    mode, files, spawned: new Date().toISOString(), status: "running",
  };
  writeFileSecure(metaFile, JSON.stringify(meta, null, 2));

  try {
    const cacheFile = join(SESSION_CACHE_DIR, "coder-context.md");
    let contextPreamble = "";
    if (existsSync(cacheFile)) {
      contextPreamble = `## Prior Context\n${readFileSync(cacheFile, "utf-8").slice(0, 3000)}\n\n---\n\n`;
    }
    const contextSuffix = "\n\nWhen done, write key findings to ~/.claude/session-cache/coder-context.md.";
    const promptFile = join(RESULTS_DIR, `${taskId}.prompt`);
    let fullPrompt = contextPreamble + prompt + contextSuffix;
    if (mode === "interactive") {
      const instructionHeader = [
        `## Worker Instructions (from lead)`,
        `You are an autonomous worker spawned by the project lead. Your task ID is ${taskId}.`,
        ``,
        `IMPORTANT: You may receive messages from the project lead during execution.`,
        `- Messages appear as "--- INCOMING MESSAGES FROM COORDINATOR ---" before your tool calls`,
        `- If you receive instructions from the lead, prioritize them immediately`,
        `- If told to stop, pivot, or change direction — do so without question`,
        `- The lead can redirect you at any time. Follow their instructions.`,
        ``,
        `When your task is complete, write key findings to ~/.claude/session-cache/coder-context.md`,
        ``,
        `---`,
        ``,
        `## Your Task`,
        ``,
      ].join("\n");
      fullPrompt = instructionHeader + contextPreamble + prompt;
    }
    writeFileSecure(promptFile, fullPrompt);

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

    const workerScript = mode === "interactive"
      ? buildInteractiveWorkerScript({
          taskId, workDir: workerDir, resultFile, pidFile, metaFile,
          model, agent, promptFile, platformName: PLATFORM,
        })
      : buildWorkerScript({
          taskId, workDir: workerDir, resultFile, pidFile, metaFile,
          model, agent, promptFile, workerPs1File, platformName: PLATFORM,
        });
    const usedApp = openTerminalWithCommand(workerScript, layout);

    return text(
      `Worker spawned: **${taskId}**\n` +
      `- Directory: ${workerDir}\n- Model: ${model}\n- Agent: ${agent || "default"}\n` +
      `- Notify Session: ${notify_session_id || "none"}\n` +
      `- Mode: ${mode}${mode === "interactive" ? " (lead can message mid-execution)" : " (fire-and-forget)"}\n` +
      `- Layout: ${layout} via ${usedApp}\n- Platform: ${PLATFORM}\n` +
      `- Isolated: ${isolate ? `yes (branch: ${worktreeBranch})` : "no"}\n` +
      `- Files: ${files.join(", ") || "none"}\n- Results: ${resultFile}\n\n` +
      `Check: \`coord_get_result task_id="${taskId}"\``
    );
  } catch (err) {
    meta.status = "failed"; meta.error = err.message;
    writeFileSecure(metaFile, JSON.stringify(meta, null, 2));
    return text(`Failed to spawn worker: ${err.message}`);
  }
}

/**
 * Handle coord_get_result tool call.
 * @param {object} args - { task_id, tail_lines }
 * @returns {object} MCP text response
 */
export function handleGetResult(args) {
  const { RESULTS_DIR } = cfg();
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

/**
 * Handle coord_kill_worker tool call.
 * @param {object} args - { task_id }
 * @returns {object} MCP text response
 */
export function handleKillWorker(args) {
  const { RESULTS_DIR } = cfg();
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

/**
 * Handle coord_spawn_terminal tool call.
 * @param {object} args - { directory, initial_prompt, layout }
 * @returns {object} MCP text response
 */
export function handleSpawnTerminal(args) {
  const { PLATFORM, CLAUDE_BIN } = cfg();
  const directory = requireDirectoryPath(args.directory);
  const initial_prompt = args.initial_prompt ? String(args.initial_prompt) : "";
  const layout = args.layout === "split" ? "split" : "tab";
  if (!existsSync(directory)) return text(`Directory not found: ${directory}`);

  try {
    const dir = PLATFORM === "win32" ? directory : shellQuote(directory);
    const claudeCmd = initial_prompt
      ? `${CLAUDE_BIN} --prompt ${PLATFORM === "win32" ? `"${initial_prompt.replace(/"/g, '""')}"` : `'${initial_prompt.replace(/'/g, "'\\''")}'`}`
      : CLAUDE_BIN;
    const fullCmd = PLATFORM === "win32"
      ? `cd /d "${dir}" && ${claudeCmd}`
      : `cd ${dir} && ${claudeCmd}`;

    const usedApp = openTerminalWithCommand(fullCmd, layout);
    return text(`Terminal spawned in ${directory} via ${usedApp}${layout === "split" ? " (split)" : ""}.\nWill auto-register via hooks.`);
  } catch (err) {
    return text(`Failed to spawn terminal: ${err.message}`);
  }
}
