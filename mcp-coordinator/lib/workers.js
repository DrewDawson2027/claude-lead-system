/**
 * Worker lifecycle: spawn, get result, kill.
 * @module workers
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
} from "fs";
import { join, basename } from "path";
import { execFileSync } from "child_process";
import { cfg } from "./constants.js";
import {
  sanitizeId,
  sanitizeShortSessionId,
  sanitizeName,
  sanitizeModel,
  sanitizeAgent,
  requireDirectoryPath,
  normalizeFilePath,
  writeFileSecure,
} from "./security.js";
import { readJSON, shellQuote, text } from "./helpers.js";
import { readTeamConfig } from "./teams.js";
import {
  isProcessAlive,
  killProcess,
  buildWorkerScript,
  buildInteractiveWorkerScript,
  buildCodexWorkerScript,
  buildCodexInteractiveWorkerScript,
  openTerminalWithCommand,
  spawnBackgroundWorker,
} from "./platform/common.js";

const ROLE_PRESETS = {
  researcher: {
    model: "sonnet",
    agent: "master-researcher",
    permissionMode: "readOnly",
    contextLevel: "standard",
    isolate: false,
    requirePlan: false,
  },
  implementer: {
    model: "sonnet",
    agent: "master-coder",
    permissionMode: "acceptEdits",
    contextLevel: "standard",
    isolate: true,
    requirePlan: false,
  },
  reviewer: {
    model: "sonnet",
    agent: "master-coder",
    permissionMode: "readOnly",
    contextLevel: "full",
    isolate: true,
    requirePlan: true,
  },
  planner: {
    model: "sonnet",
    agent: "master-workflow",
    permissionMode: "planOnly",
    contextLevel: "standard",
    isolate: false,
    requirePlan: true,
  },
};

function estimateWorkerTokens({ promptText, contextLevel, mode, requirePlan }) {
  const promptTokens = Math.ceil((promptText.length || 0) / 4);
  const contextOverhead =
    { minimal: 1200, standard: 4200, full: 12000 }[contextLevel] || 1200;
  const modeOverhead = mode === "interactive" ? 2500 : 700;
  const planOverhead = requirePlan ? 6000 : 0;
  return promptTokens + contextOverhead + modeOverhead + planOverhead;
}

function positiveIntOrFallback(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function pickPolicy(overrideValue, envValue, fallback = "warn") {
  const valid = ["off", "warn", "enforce"];
  if (valid.includes(overrideValue)) return overrideValue;
  if (valid.includes(envValue)) return envValue;
  return fallback;
}

function getActiveWorkerUsage(resultsDir) {
  let activeWorkers = 0;
  let activeEstimatedTokens = 0;
  try {
    const metas = readdirSync(resultsDir).filter(
      (f) => f.endsWith(".meta.json") && !f.includes(".done"),
    );
    for (const mf of metas) {
      const meta = readJSON(join(resultsDir, mf));
      if (!meta) continue;
      if (meta.status && meta.status !== "running") continue;
      if (existsSync(join(resultsDir, `${meta.task_id}.meta.json.done`)))
        continue;
      const pidFile = join(resultsDir, `${meta.task_id}.pid`);
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, "utf-8").trim();
        if (!isProcessAlive(pid)) continue;
      }
      activeWorkers += 1;
      const est = Number(meta.estimated_tokens);
      if (Number.isFinite(est) && est > 0)
        activeEstimatedTokens += Math.floor(est);
    }
  } catch {
    return { activeWorkers: 0, activeEstimatedTokens: 0 };
  }
  return { activeWorkers, activeEstimatedTokens };
}

/**
 * Handle coord_spawn_worker tool call.
 * @param {object} args - Worker arguments
 * @returns {object} MCP text response
 */
export function handleSpawnWorker(args) {
  const {
    RESULTS_DIR,
    SESSION_CACHE_DIR,
    TERMINALS_DIR,
    SETTINGS_FILE,
    PLATFORM,
    CLAUDE_BIN,
  } = cfg();
  const directory = requireDirectoryPath(args.directory);
  const prompt = String(args.prompt || "").trim();
  const role = ["researcher", "implementer", "reviewer", "planner"].includes(
    args.role,
  )
    ? args.role
    : null;
  const rolePreset = role ? ROLE_PRESETS[role] : null;
  const requestedTeamName = args.team_name
    ? String(args.team_name).trim()
    : null;
  const teamConfig = requestedTeamName
    ? readTeamConfig(requestedTeamName)
    : null;
  const teamPolicy = teamConfig?.policy || {};
  const model = sanitizeModel(args.model ?? rolePreset?.model ?? "sonnet");
  const agent = sanitizeAgent(args.agent ?? rolePreset?.agent ?? "");
  const task_id = args.task_id;
  const notifySessionRaw = args.notify_session_id ?? args.session_id ?? null;
  const notify_session_id = notifySessionRaw
    ? sanitizeShortSessionId(notifySessionRaw)
    : null;
  const files = (args.files || []).map((f) => String(f).trim()).filter(Boolean);
  const layout = ["split", "background", "tab"].includes(args.layout)
    ? args.layout
    : "background";
  const mode =
    args.mode === "interactive"
      ? "interactive"
      : teamPolicy.default_mode === "interactive"
        ? "interactive"
        : "pipe";
  const runtime =
    args.runtime === "codex"
      ? "codex"
      : teamPolicy.default_runtime === "codex"
        ? "codex"
        : "claude";
  const contextLevel = ["minimal", "standard", "full"].includes(
    args.context_level,
  )
    ? args.context_level
    : ["minimal", "standard", "full"].includes(teamPolicy.default_context_level)
      ? teamPolicy.default_context_level
      : rolePreset?.contextLevel || "minimal";
  const teamName = requestedTeamName;
  const workerName = args.worker_name
    ? String(args.worker_name)
        .trim()
        .replace(/[^A-Za-z0-9._-]/g, "")
    : null;
  const maxTurns = args.max_turns
    ? Math.max(1, Math.min(10000, parseInt(args.max_turns, 10) || 0))
    : null;
  const contextSummary = args.context_summary
    ? String(args.context_summary).trim()
    : null;
  const validModes = ["acceptEdits", "planOnly", "readOnly", "editOnly"];
  const permissionMode = validModes.includes(teamPolicy.permission_mode)
    ? teamPolicy.permission_mode
    : validModes.includes(args.permission_mode)
      ? args.permission_mode
      : rolePreset?.permissionMode || "acceptEdits";
  const budgetPolicy = ["off", "warn", "enforce"].includes(
    teamPolicy.budget_policy,
  )
    ? teamPolicy.budget_policy
    : ["off", "warn", "enforce"].includes(args.budget_policy)
      ? args.budget_policy
      : "warn";
  const defaultBudget = positiveIntOrFallback(
    teamPolicy.budget_tokens,
    positiveIntOrFallback(process.env.COORDINATOR_WORKER_BUDGET_TOKENS, 60000),
  );
  const budgetTokens = positiveIntOrFallback(args.budget_tokens, defaultBudget);
  const globalBudgetPolicy = pickPolicy(
    teamPolicy.global_budget_policy || args.global_budget_policy,
    process.env.COORDINATOR_GLOBAL_BUDGET_POLICY,
    "warn",
  );
  const defaultGlobalBudget = positiveIntOrFallback(
    teamPolicy.global_budget_tokens,
    positiveIntOrFallback(process.env.COORDINATOR_GLOBAL_BUDGET_TOKENS, 240000),
  );
  const globalBudgetTokens = positiveIntOrFallback(
    args.global_budget_tokens,
    defaultGlobalBudget,
  );
  const defaultMaxWorkers = positiveIntOrFallback(
    teamPolicy.max_active_workers,
    positiveIntOrFallback(process.env.COORDINATOR_MAX_ACTIVE_WORKERS, 8),
  );
  const maxActiveWorkers = positiveIntOrFallback(
    args.max_active_workers,
    defaultMaxWorkers,
  );
  const requirePlanRequested =
    typeof teamPolicy.require_plan === "boolean"
      ? teamPolicy.require_plan || permissionMode === "planOnly"
      : Boolean(
          args.require_plan ||
          rolePreset?.requirePlan ||
          permissionMode === "planOnly",
        );
  if (!prompt) return text("Prompt is required.");
  if (!existsSync(directory)) return text(`Directory not found: ${directory}`);
  const estimatedTokens = estimateWorkerTokens({
    promptText: prompt + (contextSummary || ""),
    contextLevel,
    mode,
    requirePlan: requirePlanRequested,
  });
  if (budgetPolicy === "enforce" && estimatedTokens > budgetTokens) {
    return text(
      `Budget policy blocked spawn.\n` +
        `- Estimated tokens: ${estimatedTokens}\n` +
        `- Budget tokens: ${budgetTokens}\n` +
        `- Policy: enforce\n` +
        `Reduce context_level, disable plan mode, or increase budget_tokens.`,
    );
  }
  const { activeWorkers, activeEstimatedTokens } =
    getActiveWorkerUsage(RESULTS_DIR);
  const projectedGlobalTokens = activeEstimatedTokens + estimatedTokens;
  const globalWarnings = [];
  if (globalBudgetPolicy !== "off") {
    if (activeWorkers >= maxActiveWorkers) {
      if (globalBudgetPolicy === "enforce") {
        return text(
          `Global concurrency policy blocked spawn.\n` +
            `- Active workers: ${activeWorkers}\n` +
            `- Max active workers: ${maxActiveWorkers}\n` +
            `- Policy: enforce\n` +
            `Wait for workers to finish or increase max_active_workers.`,
        );
      }
      globalWarnings.push(
        `Active worker count ${activeWorkers} is at/above max ${maxActiveWorkers}.`,
      );
    }
    if (projectedGlobalTokens > globalBudgetTokens) {
      if (globalBudgetPolicy === "enforce") {
        return text(
          `Global budget policy blocked spawn.\n` +
            `- Active estimated tokens: ${activeEstimatedTokens}\n` +
            `- New worker estimate: ${estimatedTokens}\n` +
            `- Projected total: ${projectedGlobalTokens}\n` +
            `- Global budget tokens: ${globalBudgetTokens}\n` +
            `- Policy: enforce\n` +
            `Wait for active workers to complete or increase global_budget_tokens.`,
        );
      }
      globalWarnings.push(
        `Projected global token usage ${projectedGlobalTokens} exceeds budget ${globalBudgetTokens}.`,
      );
    }
  }
  const requirePlan = requirePlanRequested;

  // Conflict check against running workers
  if (files?.length) {
    const normalizedRequested = new Map(
      files.map((f) => [f, normalizeFilePath(f, directory)]),
    );
    const running = readdirSync(RESULTS_DIR)
      .filter((f) => f.endsWith(".meta.json") && !f.includes(".done"))
      .map((f) => readJSON(join(RESULTS_DIR, f)))
      .filter((m) => m?.status === "running" && m.files?.length);
    for (const w of running) {
      const pidFile = join(RESULTS_DIR, `${w.task_id}.pid`);
      if (!existsSync(pidFile)) continue;
      const pid = readFileSync(pidFile, "utf-8").trim();
      if (!isProcessAlive(pid)) continue;
      const normalizedWorker = new Set(
        w.files.map((f) => normalizeFilePath(f, w.directory)).filter(Boolean),
      );
      const overlap = files.filter((f) => {
        const normalized = normalizedRequested.get(f);
        return normalized && normalizedWorker.has(normalized);
      });
      if (overlap.length > 0)
        return text(
          `CONFLICT: Worker ${w.task_id} editing: ${overlap.join(", ")}. Kill it first or wait.`,
        );
    }
  }

  const taskId = task_id ? sanitizeId(task_id, "task_id") : `W${Date.now()}`;
  const resultFile = join(RESULTS_DIR, `${taskId}.txt`);
  const pidFile = join(RESULTS_DIR, `${taskId}.pid`);
  const metaFile = join(RESULTS_DIR, `${taskId}.meta.json`);
  if (existsSync(metaFile) || existsSync(resultFile)) {
    return text(
      `Task ID ${taskId} already exists. Use a new task_id or omit it for auto-generation.`,
    );
  }

  // Worktree isolation: create a git worktree so worker operates on an isolated copy
  const isolate =
    args.isolate !== undefined
      ? Boolean(args.isolate)
      : typeof teamPolicy.default_isolate === "boolean"
        ? teamPolicy.default_isolate
        : Boolean(rolePreset?.isolate);
  let workerDir = directory;
  let worktreeBranch = null;
  if (isolate) {
    try {
      const worktreeBase = join(directory, ".claude", "worktrees");
      mkdirSync(worktreeBase, { recursive: true });
      const worktreePath = join(worktreeBase, taskId);
      worktreeBranch = `worker/${taskId}`;
      execFileSync(
        "git",
        ["worktree", "add", worktreePath, "-b", worktreeBranch],
        {
          cwd: directory,
          stdio: "pipe",
          timeout: 15000,
        },
      );
      workerDir = worktreePath;
    } catch (err) {
      return text(
        `Worktree creation failed: ${err.message}\nFalling back to non-isolated mode is not safe. Fix the git state or omit isolate.`,
      );
    }
  }

  const meta = {
    task_id: taskId,
    directory: workerDir,
    original_directory: directory,
    prompt: prompt.slice(0, 500),
    model,
    agent: agent || null,
    notify_session_id,
    isolated: isolate,
    worktree_branch: worktreeBranch,
    mode,
    runtime,
    files,
    role,
    context_level: contextLevel,
    team_name: teamName,
    team_execution_path: teamConfig?.execution_path || null,
    team_low_overhead_mode: teamConfig?.low_overhead_mode || null,
    worker_name: workerName,
    max_turns: maxTurns,
    permission_mode: permissionMode,
    require_plan: requirePlan || permissionMode === "planOnly",
    budget_policy: budgetPolicy,
    budget_tokens: budgetTokens,
    estimated_tokens: estimatedTokens,
    global_budget_policy: globalBudgetPolicy,
    global_budget_tokens: globalBudgetTokens,
    max_active_workers: maxActiveWorkers,
    active_estimated_tokens_at_spawn: activeEstimatedTokens,
    spawned: new Date().toISOString(),
    status: "running",
  };
  writeFileSecure(metaFile, JSON.stringify(meta, null, 2));

  try {
    const cacheFile = join(SESSION_CACHE_DIR, "coder-context.md");
    let contextPreamble = "";
    const contextLimits = { minimal: 3000, standard: 10000, full: 30000 };
    const ctxLimit = contextLimits[contextLevel] || 3000;
    if (existsSync(cacheFile)) {
      contextPreamble = `## Prior Context\n${readFileSync(cacheFile, "utf-8").slice(0, ctxLimit)}\n\n---\n\n`;
    }
    // Lead's conversation context summary (closes context gap with Claude's agent system)
    if (contextSummary) {
      contextPreamble += `## Lead's Conversation Context\n${contextSummary.slice(0, ctxLimit)}\n\n---\n\n`;
    }
    // Enhanced context: include lead's session data at standard/full levels
    if (contextLevel !== "minimal" && notify_session_id) {
      const leadSessionFile = join(
        TERMINALS_DIR,
        `session-${notify_session_id}.json`,
      );
      if (existsSync(leadSessionFile)) {
        try {
          const leadSession = JSON.parse(
            readFileSync(leadSessionFile, "utf-8"),
          );
          const extras = [];
          if (leadSession.files_touched?.length) {
            extras.push(
              `## Lead's Recent Files\n${leadSession.files_touched.join("\n")}`,
            );
          }
          if (leadSession.recent_ops?.length) {
            extras.push(
              `## Lead's Recent Operations\n${leadSession.recent_ops.map((op) => `- ${op.t} ${op.tool} ${op.file || ""}`).join("\n")}`,
            );
          }
          if (
            contextLevel === "full" &&
            leadSession.plan_file &&
            existsSync(leadSession.plan_file)
          ) {
            const planContent = readFileSync(
              leadSession.plan_file,
              "utf-8",
            ).slice(0, 5000);
            extras.push(`## Lead's Active Plan\n${planContent}`);
          }
          if (extras.length) {
            contextPreamble += extras.join("\n\n") + "\n\n---\n\n";
          }
        } catch {
          /* ignore parse errors */
        }
      }
    }
    // Lead's persistent exported context (auto-inject from coord_export_context)
    if (notify_session_id) {
      const leadContextFile = join(
        TERMINALS_DIR,
        "context",
        `lead-context-${notify_session_id}.json`,
      );
      if (existsSync(leadContextFile)) {
        try {
          const leadCtx = JSON.parse(readFileSync(leadContextFile, "utf-8"));
          if (leadCtx.summary) {
            contextPreamble += `## Lead's Exported Context\n${leadCtx.summary.slice(0, ctxLimit)}\n\n---\n\n`;
          }
        } catch {
          /* ignore */
        }
      }
    }
    // Shared context store
    if (teamName) {
      const contextStoreFile = join(
        TERMINALS_DIR,
        "context",
        `${teamName}.json`,
      );
      if (existsSync(contextStoreFile)) {
        try {
          const ctx = JSON.parse(readFileSync(contextStoreFile, "utf-8"));
          if (ctx.entries?.length) {
            const sharedCtx = ctx.entries
              .map((e) => `### ${e.key}\n${e.value}`)
              .join("\n\n");
            contextPreamble += `## Shared Team Context\n${sharedCtx.slice(0, ctxLimit)}\n\n---\n\n`;
          }
        } catch {
          /* ignore */
        }
      }
    }
    const contextSuffix =
      "\n\nWhen done, write key findings to ~/.claude/session-cache/coder-context.md.";
    const promptFile = join(RESULTS_DIR, `${taskId}.prompt`);
    let fullPrompt = contextPreamble + prompt + contextSuffix;
    if (mode === "interactive") {
      const instructionLines = [
        `## Worker Instructions (from lead)`,
        `You are an autonomous worker spawned by the project lead. Your task ID is ${taskId}.` +
          (workerName
            ? ` Your name is "${workerName}" — others can message you by name.`
            : ``),
        ``,
        `### Lead Communication`,
        `- Messages appear as "--- INCOMING MESSAGES FROM COORDINATOR ---" before your tool calls`,
        `- If you receive instructions from the lead, prioritize them immediately`,
        `- If told to stop, pivot, or change direction — do so without question`,
        `- The lead can redirect you at any time. Follow their instructions.`,
        ``,
        `### Task Board Self-Service`,
        `After completing your assigned task:`,
        `1. Mark it completed: \`coord_update_task task_id=${taskId} status=completed\``,
        `2. Check for more work: \`coord_list_tasks status=pending\``,
        `3. Claim unassigned, unblocked tasks: \`coord_update_task task_id=<ID> assignee=${taskId} status=in_progress\``,
        `4. If no tasks available, notify lead and idle.`,
        ``,
        `### Completion Protocol`,
        `When your task is complete:`,
        `1. Update the task board: \`coord_update_task task_id=${taskId} status=completed\``,
        notify_session_id
          ? `2. Notify lead: \`coord_send_message from="${taskId}" to="${notify_session_id}" content="[COMPLETED] ${taskId} — <summary>"\``
          : `2. Write key findings to ~/.claude/session-cache/coder-context.md`,
        ``,
      ];

      // Team context for peer messaging
      if (teamName) {
        instructionLines.push(
          `### Team: ${teamName}`,
          `You are part of a team. Discover teammates: \`coord_get_team team_name=${teamName}\``,
          `Message peers by name: \`coord_send_message from="${workerName || taskId}" target_name="<peer_name>" content="..."\``,
          `Or by session ID: \`coord_send_message from="${workerName || taskId}" to="<peer_session_id>" content="..."\``,
          `Peer messages appear with [PEER] prefix in their inbox.`,
          ``,
        );
      }

      // Plan-first mode
      if (requirePlan) {
        instructionLines.push(
          `### PLAN-FIRST MODE (MANDATORY)`,
          `Before making ANY file edits:`,
          `1. Analyze the codebase and draft a plan`,
          `2. Write your plan to ~/.claude/terminals/results/${taskId}.plan.md`,
          `3. Notify lead: \`coord_send_message from="${taskId}" to="${notify_session_id || "lead"}" content="[PLAN READY] ${taskId}"\``,
          `4. WAIT for lead approval — check inbox for "[APPROVED]" or "[REVISION]"`,
          `5. If revision requested, update plan and re-submit`,
          `6. Only begin editing files AFTER receiving "[APPROVED]"`,
          ``,
        );
      }

      instructionLines.push(`---`, ``, `## Your Task`, ``);

      fullPrompt = instructionLines.join("\n") + contextPreamble + prompt;
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

    const scriptOpts = {
      taskId,
      workDir: workerDir,
      resultFile,
      pidFile,
      metaFile,
      model,
      agent,
      promptFile,
      workerPs1File,
      platformName: PLATFORM,
      workerName,
      maxTurns,
      permissionMode,
    };
    let workerScript;
    if (runtime === "codex") {
      workerScript =
        mode === "interactive"
          ? buildCodexInteractiveWorkerScript(scriptOpts)
          : buildCodexWorkerScript(scriptOpts);
    } else {
      workerScript =
        mode === "interactive"
          ? buildInteractiveWorkerScript(scriptOpts)
          : buildWorkerScript(scriptOpts);
    }
    let usedApp;
    if (layout === "background") {
      // Background spawn: no terminal, fastest possible. Uses child_process.spawn detached.
      spawnBackgroundWorker(workerScript, resultFile, pidFile);
      usedApp = "background";
    } else {
      usedApp = openTerminalWithCommand(workerScript, layout);
    }

    return text(
      `Worker spawned: **${taskId}**\n` +
        `- Directory: ${workerDir}\n- Model: ${model}\n- Agent: ${agent || "default"}\n` +
        `- Notify Session: ${notify_session_id || "none"}\n` +
        `- Runtime: ${runtime}\n` +
        `- Mode: ${mode}${mode === "interactive" ? " (lead can message mid-execution)" : " (fire-and-forget)"}\n` +
        `- Role: ${role || "custom"}\n` +
        `- Team: ${teamName || "none"}${teamName ? ` (path=${teamConfig?.execution_path || "hybrid"}, overhead=${teamConfig?.low_overhead_mode || "advanced"})` : ""}\n` +
        `- Layout: ${layout} via ${usedApp}\n- Platform: ${PLATFORM}\n` +
        `- Isolated: ${isolate ? `yes (branch: ${worktreeBranch})` : "no"}\n` +
        `- Permission Mode: ${permissionMode}\n` +
        `- Plan Mode: ${requirePlan ? "enabled" : "disabled"}\n` +
        `- Files: ${files.join(", ") || "none"}\n- Results: ${resultFile}\n\n` +
        `- Budget: ${budgetPolicy} (${estimatedTokens}/${budgetTokens} est tokens)\n` +
        `- Global Budget: ${globalBudgetPolicy} (${activeEstimatedTokens}+${estimatedTokens}=${projectedGlobalTokens}/${globalBudgetTokens} est tokens)\n` +
        `- Active Workers: ${activeWorkers}/${maxActiveWorkers}\n` +
        (teamPolicy && Object.keys(teamPolicy).length > 0
          ? `- Team Policy Applied: yes\n`
          : "") +
        (budgetPolicy === "warn" && estimatedTokens > budgetTokens
          ? `- WARNING: Estimated token budget exceeded. Consider mode=pipe, context_level=minimal, or higher budget_tokens.\n\n`
          : "") +
        (globalWarnings.length
          ? `${globalWarnings.map((w) => `- WARNING: ${w}`).join("\n")}\n\n`
          : "\n") +
        `Check: \`coord_get_result task_id="${taskId}"\``,
    );
  } catch (err) {
    meta.status = "failed";
    meta.error = err.message;
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
    const limit =
      Number.isFinite(tail_lines) && tail_lines > 0
        ? Math.min(Math.floor(tail_lines), 500)
        : 100;
    output =
      lines.length > limit
        ? `[...truncated ${lines.length - limit} lines...]\n` +
          lines.slice(-limit).join("\n")
        : full;
  }

  let result = `## Worker ${task_id}\n\n`;
  result += `- **Status:** ${isDone ? "completed" : isRunning ? "running" : "unknown"}\n`;
  result += `- **Directory:** ${meta.directory}\n- **Model:** ${meta.model}\n- **Spawned:** ${meta.spawned}\n`;
  if (isDone) {
    const d = readJSON(doneFile);
    result += `- **Finished:** ${d?.finished || "unknown"}\n`;
  }
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
    if (existsSync(`${metaFile}.done`))
      return text(`Worker ${task_id} already completed.`);
    return text(`Worker ${task_id} has no PID file.`);
  }

  const pid = readFileSync(pidFile, "utf-8").trim();
  try {
    killProcess(pid);
    writeFileSecure(
      `${metaFile}.done`,
      JSON.stringify({
        status: "cancelled",
        finished: new Date().toISOString(),
        task_id,
      }),
    );
    const existingMeta = readJSON(metaFile) || {};
    existingMeta.status = "cancelled";
    existingMeta.cancelled = new Date().toISOString();
    writeFileSecure(metaFile, JSON.stringify(existingMeta, null, 2));
    try {
      unlinkSync(pidFile);
    } catch (e) {
      process.stderr.write(
        `[workers] pid file cleanup failed: ${e?.message ?? e}\n`,
      );
    }
    return text(`Worker ${task_id} (PID ${pid}) killed.`);
  } catch (err) {
    return text(`Could not kill ${task_id} (PID ${pid}): ${err.message}`);
  }
}

/**
 * Handle coord_resume_worker tool call.
 * Reads the dead worker's result and original prompt, spawns a new worker with continuation context.
 * @param {object} args - { task_id, mode }
 * @returns {object} MCP text response
 */
export function handleResumeWorker(args) {
  const { RESULTS_DIR } = cfg();
  const task_id = sanitizeId(args.task_id, "task_id");
  const metaFile = join(RESULTS_DIR, `${task_id}.meta.json`);
  const resultFile = join(RESULTS_DIR, `${task_id}.txt`);
  const promptFile = join(RESULTS_DIR, `${task_id}.prompt`);
  const pidFile = join(RESULTS_DIR, `${task_id}.pid`);

  const meta = readJSON(metaFile);
  if (!meta) return text(`Task ${task_id} not found.`);

  // Check if worker is still running
  if (existsSync(pidFile)) {
    const pid = readFileSync(pidFile, "utf-8").trim();
    if (isProcessAlive(pid)) {
      return text(
        `Worker ${task_id} is still running (PID ${pid}). Kill it first or wait for completion.`,
      );
    }
  }

  // Gather prior context — prefer transcript (true resume) over result file
  const transcriptFile = join(RESULTS_DIR, `${task_id}.transcript`);
  let priorOutput = "";
  let resumeSource = "none";
  if (existsSync(transcriptFile)) {
    const full = readFileSync(transcriptFile, "utf-8");
    // Use up to 30KB of transcript for true resume — matches Claude's system
    priorOutput =
      full.length > 30000 ? `[...truncated...]\n${full.slice(-30000)}` : full;
    resumeSource = "transcript";
  } else if (existsSync(resultFile)) {
    const full = readFileSync(resultFile, "utf-8");
    priorOutput =
      full.length > 8000 ? `[...truncated...]\n${full.slice(-8000)}` : full;
    resumeSource = "result-file";
  }

  let originalPrompt = "";
  if (existsSync(promptFile)) {
    originalPrompt = readFileSync(promptFile, "utf-8");
  }

  const resumeCount = (meta.resume_count || 0) + 1;
  const newMode =
    args.mode === "interactive" ? "interactive" : meta.mode || "pipe";

  // Build continuation prompt
  const continuationPrompt = [
    `CONTINUATION: A previous worker (task_id=${task_id}, attempt #${resumeCount}) was working on this task but stopped.`,
    `Resume source: ${resumeSource}${resumeSource === "transcript" ? " (full session transcript — you have complete visibility into what happened)" : ""}`,
    ``,
    `## What it accomplished so far:`,
    priorOutput ? `\`\`\`\n${priorOutput}\n\`\`\`` : "(no output captured)",
    ``,
    meta.files?.length ? `## Files it touched:\n${meta.files.join("\n")}` : "",
    ``,
    `## Original task:`,
    originalPrompt || meta.prompt || "(original prompt not available)",
    ``,
    `Continue from where it left off. Do NOT redo already-completed work.`,
    `Check the state of the files before making changes — some edits may have been persisted.`,
  ]
    .filter(Boolean)
    .join("\n");

  // Spawn the new worker
  return handleSpawnWorker({
    directory: meta.original_directory || meta.directory,
    prompt: continuationPrompt,
    model: meta.model,
    agent: meta.agent || undefined,
    mode: newMode,
    runtime: meta.runtime || "claude",
    notify_session_id: meta.notify_session_id,
    files: meta.files,
    role: meta.role,
    permission_mode: meta.permission_mode,
    require_plan: meta.require_plan,
    budget_policy: meta.budget_policy || "warn",
    budget_tokens: meta.budget_tokens,
    global_budget_policy: meta.global_budget_policy || "warn",
    global_budget_tokens: meta.global_budget_tokens,
    max_active_workers: meta.max_active_workers,
    team_name: meta.team_name,
    context_level: meta.context_level || "standard",
  });
}

/**
 * Handle coord_upgrade_worker tool call.
 * Kills a pipe worker and respawns as interactive, carrying over progress.
 * @param {object} args - { task_id }
 * @returns {object} MCP text response
 */
export function handleUpgradeWorker(args) {
  const { RESULTS_DIR } = cfg();
  const task_id = sanitizeId(args.task_id, "task_id");
  const metaFile = join(RESULTS_DIR, `${task_id}.meta.json`);

  const meta = readJSON(metaFile);
  if (!meta) return text(`Task ${task_id} not found.`);
  if (meta.mode === "interactive")
    return text(`Worker ${task_id} is already in interactive mode.`);

  // Kill the pipe worker first
  const killResult = handleKillWorker({ task_id });

  // Resume as interactive
  const resumeResult = handleResumeWorker({ task_id, mode: "interactive" });

  return text(
    `## Worker Upgraded: ${task_id}\n\n` +
      `**Kill:** ${killResult.content[0]?.text || "done"}\n` +
      `**Resume:** ${resumeResult.content[0]?.text || "spawned"}\n\n` +
      `Worker is now interactive — you can send directives via \`coord_send_directive\`.`,
  );
}

/**
 * Handle coord_spawn_terminal tool call.
 * @param {object} args - { directory, initial_prompt, layout }
 * @returns {object} MCP text response
 */
/**
 * Handle coord_spawn_workers (plural) tool call.
 * Spawns multiple workers from a single call for parallel execution.
 * @param {object} args - { workers: [{directory, prompt, model, ...}, ...] }
 * @returns {object} MCP text response
 */
export function handleSpawnWorkers(args) {
  const workers = args.workers;
  if (!Array.isArray(workers) || workers.length === 0) {
    return text("'workers' array is required with at least one entry.");
  }
  if (workers.length > 10) {
    return text("Maximum 10 workers per multi-spawn call.");
  }

  const results = [];
  for (const w of workers) {
    const result = handleSpawnWorker(w);
    const resultText = result.content?.[0]?.text || "spawned";
    results.push(resultText);
  }

  return text(
    `## Multi-Spawn: ${workers.length} workers\n\n` +
      results.map((r, i) => `### Worker ${i + 1}\n${r}`).join("\n\n"),
  );
}

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
    const fullCmd =
      PLATFORM === "win32"
        ? `cd /d "${dir}" && ${claudeCmd}`
        : `cd ${dir} && ${claudeCmd}`;

    const usedApp = openTerminalWithCommand(fullCmd, layout);
    return text(
      `Terminal spawned in ${directory} via ${usedApp}${layout === "split" ? " (split)" : ""}.\nWill auto-register via hooks.`,
    );
  } catch (err) {
    return text(`Failed to spawn terminal: ${err.message}`);
  }
}
