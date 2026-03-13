#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

const CAPABILITIES = [
  {
    id: "install",
    description: "Install smoke",
    command: ["bash", "tests/smoke-install.sh", "--ref", "HEAD", "--mode", "full"],
  },
  {
    id: "launch",
    description: "Platform launch command proof",
    command: ["npm", "--workspace", "mcp-coordinator", "exec", "--", "node", "--test", "test/platform-launch.test.mjs"],
  },
  {
    id: "lead_boot",
    description: "Lead boot snapshot semantics proof",
    command: ["node", "scripts/proof/check-lead-boot.mjs"],
  },
  {
    id: "message_delivery",
    description: "Bidirectional message delivery proof",
    command: ["npm", "--workspace", "mcp-coordinator", "exec", "--", "node", "--test", "test/e2e-bidirectional-comms.test.mjs"],
  },
  {
    id: "task_dispatch",
    description: "Team task dispatch proof",
    command: [
      "npm",
      "--workspace",
      "mcp-coordinator",
      "exec",
      "--",
      "node",
      "--test",
      "--test-name-pattern",
      "coord_team_dispatch creates team task, spawns worker, and links live team state",
      "test/e2e-worker-pipeline.test.mjs",
    ],
    env: { COORDINATOR_FORCE_E2E: "1" },
  },
  {
    id: "conflict_detection",
    description: "Conflict detection proof",
    command: ["npm", "--workspace", "mcp-coordinator", "exec", "--", "node", "--test", "test/conflicts.test.mjs"],
  },
  {
    id: "resume",
    description: "Worker resume path proof",
    command: ["npm", "--workspace", "mcp-coordinator", "exec", "--", "node", "--test", "test/e2e-agent-resume.test.mjs"],
  },
  {
    id: "sidecar_health",
    description: "Sidecar health proof",
    command: ["npm", "--workspace", "sidecar", "exec", "--", "node", "--test", "test/terminal-health.test.mjs", "test/bridge-health.test.mjs"],
  },
];

function parseArgs(argv) {
  const opts = {
    platformId: null,
    outputRoot: "reports/compatibility/proofs",
    failOnCheckFailure: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--platform-id") {
      opts.platformId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--output-root") {
      opts.outputRoot = argv[i + 1] ?? opts.outputRoot;
      i += 1;
      continue;
    }
    if (arg === "--fail-on-check-failure") {
      opts.failOnCheckFailure = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return opts;
}

function printHelp() {
  process.stdout.write(
    [
      "run-platform-proof.mjs",
      "",
      "Usage:",
      "  node scripts/proof/run-platform-proof.mjs [--platform-id macos|linux|windows] [--output-root reports/compatibility/proofs] [--fail-on-check-failure]",
      "",
      "Writes proof artifacts to:",
      "  <output-root>/runs/<platform>/<run-id>/",
      "  <output-root>/latest/<platform>.json",
      "",
    ].join("\n"),
  );
}

function detectPlatformId() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "linux") return "linux";
  if (process.platform === "win32") return "windows";
  return process.platform;
}

function sanitizeRunId(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function currentIso() {
  return new Date().toISOString();
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return (result.stdout || "").trim();
}

function commandToString(command) {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function resolveExecutable(command) {
  if (process.platform === "win32" && command === "npm") return "npm.cmd";
  return command;
}

function runCheck(check, runDir, platformId) {
  if (Array.isArray(check.supported_platforms) && !check.supported_platforms.includes(platformId)) {
    const startedIso = currentIso();
    const endedIso = currentIso();
    const status = "unsupported";
    const reason = `unsupported on platform ${platformId}`;
    const logName = `${check.id}.log`;
    const logPath = join(runDir, logName);
    writeFileSync(
      logPath,
      [
        `capability: ${check.id}`,
        `description: ${check.description}`,
        `status: ${status}`,
        `reason: ${reason}`,
        `command: ${commandToString(check.command)}`,
      ].join("\n"),
      "utf8",
    );
    return {
      capability: check.id,
      description: check.description,
      status,
      reason,
      started_at: startedIso,
      ended_at: endedIso,
      duration_ms: 0,
      command: check.command,
      env_overrides: check.env ?? {},
      exit_status: null,
      signal: null,
      error: null,
      log_file: relative(repoRoot, logPath),
    };
  }

  const [rawCommand, ...args] = check.command;
  const executable = resolveExecutable(rawCommand);
  const startedAt = Date.now();
  const startedIso = currentIso();
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    env: { ...process.env, ...(check.env ?? {}) },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const endedAt = Date.now();
  const endedIso = currentIso();

  const status = result.status === 0 && !result.signal && !result.error ? "pass" : "fail";
  const logName = `${check.id}.log`;
  const logPath = join(runDir, logName);
  const logBody = [
    `capability: ${check.id}`,
    `description: ${check.description}`,
    `started_at: ${startedIso}`,
    `ended_at: ${endedIso}`,
    `duration_ms: ${endedAt - startedAt}`,
    `command: ${commandToString(check.command)}`,
    `exit_status: ${result.status ?? "null"}`,
    `signal: ${result.signal ?? "null"}`,
    `error: ${result.error ? result.error.message : "null"}`,
    "",
    "--- stdout ---",
    result.stdout ?? "",
    "",
    "--- stderr ---",
    result.stderr ?? "",
  ].join("\n");
  writeFileSync(logPath, logBody, "utf8");

  return {
    capability: check.id,
    description: check.description,
    status,
    started_at: startedIso,
    ended_at: endedIso,
    duration_ms: endedAt - startedAt,
    command: check.command,
    env_overrides: check.env ?? {},
    exit_status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    log_file: relative(repoRoot, logPath),
  };
}

function summarizeChecks(checks) {
  const countsByStatus = {};
  for (const check of checks) {
    countsByStatus[check.status] = (countsByStatus[check.status] || 0) + 1;
  }
  const failed = countsByStatus.fail || 0;
  const total = checks.length;
  const passed = countsByStatus.pass || 0;
  return {
    total,
    passed,
    failed,
    counts_by_status: countsByStatus,
    status: failed > 0 ? "fail" : passed === total ? "pass" : "partial",
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const platformId = opts.platformId || detectPlatformId();
  const outputRoot = resolve(repoRoot, opts.outputRoot);
  const latestDir = join(outputRoot, "latest");
  const runsRoot = join(outputRoot, "runs", platformId);

  mkdirSync(latestDir, { recursive: true });
  mkdirSync(runsRoot, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:]/g, "").replace(/[.]/g, "");
  const shortSha = (runGit(["rev-parse", "--short", "HEAD"]) || "no-git").slice(0, 12);
  const runId = sanitizeRunId(`${timestamp}-${shortSha}`);
  const runDir = join(runsRoot, runId);
  mkdirSync(runDir, { recursive: true });

  const startedAt = currentIso();
  const checks = [];
  for (const check of CAPABILITIES) {
    process.stdout.write(`[proof] ${platformId} :: ${check.id}\n`);
    const result = runCheck(check, runDir, platformId);
    checks.push(result);
    process.stdout.write(`[proof] ${check.id} -> ${result.status}\n`);
  }
  const endedAt = currentIso();

  const summary = summarizeChecks(checks);
  const artifact = {
    schema_version: 2,
    capability_contract: CAPABILITIES.map(({ id, description }) => ({ id, description })),
    run_id: runId,
    started_at: startedAt,
    ended_at: endedAt,
    platform: {
      id: platformId,
      process_platform: process.platform,
      release: os.release(),
      arch: process.arch,
      node_version: process.version,
    },
    git: {
      sha: runGit(["rev-parse", "HEAD"]),
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: Boolean((runGit(["status", "--porcelain"]) || "").trim()),
    },
    checks,
    summary,
  };

  const artifactPath = join(runDir, "proof.json");
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  writeFileSync(join(latestDir, `${platformId}.json`), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  process.stdout.write(`[proof] artifact: ${relative(repoRoot, artifactPath)}\n`);
  process.stdout.write(`[proof] latest: ${relative(repoRoot, join(latestDir, `${platformId}.json`))}\n`);
  process.stdout.write(`[proof] summary: ${summary.passed}/${summary.total} passed (${summary.status})\n`);

  if (opts.failOnCheckFailure && summary.failed > 0) {
    process.exit(1);
  }
}

main();
