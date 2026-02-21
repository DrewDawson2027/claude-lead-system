/**
 * Pipeline execution: run sequential multi-step task pipelines.
 * @module pipelines
 */

import { existsSync, readFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import {
  sanitizeId, sanitizeName, sanitizeModel, sanitizeAgent,
  requireDirectoryPath, writeFileSecure,
} from "./security.js";
import { readJSON, shellQuote, batQuote, text } from "./helpers.js";
import { openTerminalWithCommand } from "./platform/common.js";

/**
 * Handle coord_run_pipeline tool call.
 * @param {object} args - { directory, tasks, pipeline_id }
 * @returns {object} MCP text response
 */
export function handleRunPipeline(args) {
  const { PLATFORM, RESULTS_DIR, SESSION_CACHE_DIR, SETTINGS_FILE, CLAUDE_BIN } = cfg();
  const directory = requireDirectoryPath(args.directory);
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const pipeline_id = args.pipeline_id;
  if (!existsSync(directory)) return text(`Directory not found: ${directory}`);
  if (!tasks?.length) return text("No tasks provided.");

  const pipelineId = pipeline_id ? sanitizeId(pipeline_id, "pipeline_id") : `P${Date.now()}`;
  const pipelineDir = join(RESULTS_DIR, pipelineId);
  if (existsSync(pipelineDir)) return text(`Pipeline ID ${pipelineId} already exists. Use a new pipeline_id.`);
  mkdirSync(pipelineDir, { recursive: true });

  const qClaudeBin = PLATFORM === "win32" ? CLAUDE_BIN : shellQuote(CLAUDE_BIN);

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

  let script;
  const winSettingsFlag = existsSync(SETTINGS_FILE) ? `--settings ${batQuote(SETTINGS_FILE)}` : "";
  if (PLATFORM === "win32") {
    script = `@echo off\ncd /d ${batQuote(directory)}\n`;
    normalizedTasks.forEach((task, i) => {
      const pf = join(pipelineDir, `${i}-${task.name}.prompt`);
      const rf = join(pipelineDir, `${i}-${task.name}.txt`);
      script += `echo Step ${i}: ${task.name}\n`;
      script += `${CLAUDE_BIN} -p --model ${batQuote(task.model)} ${task.agent ? `--agent ${batQuote(task.agent)}` : ""} ${winSettingsFlag} < ${batQuote(pf)} > ${batQuote(rf)} 2>&1\n`;
    });
    script += `echo {"status":"completed"} > ${batQuote(join(pipelineDir, "pipeline.done"))}\n`;
    const runnerFile = join(pipelineDir, "run.bat");
    writeFileSecure(runnerFile, script);
  } else {
    const settingsArgs = existsSync(SETTINGS_FILE) ? `--settings ${shellQuote(SETTINGS_FILE)}` : "";
    script = `#!/bin/bash\nset -e\ncd ${shellQuote(directory)}\n`;
    normalizedTasks.forEach((task, i) => {
      const pf = join(pipelineDir, `${i}-${task.name}.prompt`);
      const rf = join(pipelineDir, `${i}-${task.name}.txt`);
      const logFile = join(pipelineDir, "pipeline.log");
      const qName = shellQuote(task.name);
      const qModel = shellQuote(task.model);
      const agentArgs = task.agent ? `--agent ${shellQuote(task.agent)}` : "";
      script += `echo "=== Step ${i}: ${qName} ===" | tee -a ${shellQuote(logFile)}\n`;
      script += `printf '{"step":%d,"name":"%s","status":"running","started":"%s"}\\n' ${i} ${qName} "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" >> ${shellQuote(logFile)}\n`;
      // unset CLAUDECODE: prevent child claude process from inheriting parent's session env (POSIX-compatible)
      script += `unset CLAUDECODE && ${qClaudeBin} -p --model ${qModel} ${agentArgs} ${settingsArgs} < ${shellQuote(pf)} > ${shellQuote(rf)} 2>&1\n`;
      script += `printf '{"step":%d,"name":"%s","status":"completed","finished":"%s"}\\n' ${i} ${qName} "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" >> ${shellQuote(logFile)}\n`;
    });
    script += `printf '{"status":"completed","finished":"%s"}' "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)" > ${shellQuote(join(pipelineDir, "pipeline.done"))}\n`;
    const runnerFile = join(pipelineDir, "run.sh");
    writeFileSecure(runnerFile, script);
    try { chmodSync(runnerFile, 0o700); } catch {}
  }

  try {
    const runnerFile = join(pipelineDir, PLATFORM === "win32" ? "run.bat" : "run.sh");
    openTerminalWithCommand(PLATFORM === "win32" ? `"${runnerFile}"` : shellQuote(runnerFile), "tab");

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

/**
 * Handle coord_get_pipeline tool call.
 * @param {object} args - { pipeline_id }
 * @returns {object} MCP text response
 */
export function handleGetPipeline(args) {
  const { RESULTS_DIR } = cfg();
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
