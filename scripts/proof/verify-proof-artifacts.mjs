#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

const PLATFORMS = ["macos", "linux", "windows"];
const REQUIRED_CAPABILITIES = [
  "install",
  "launch",
  "lead_boot",
  "message_delivery",
  "task_dispatch",
  "conflict_detection",
  "resume",
  "sidecar_health",
];
const VALID_STATUSES = new Set(["pass", "fail", "unsupported", "not_run"]);

function detectPlatformId() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "linux") return "linux";
  if (process.platform === "win32") return "windows";
  return process.platform;
}

function parseArgs(argv) {
  const opts = {
    proofRoot: "reports/compatibility/proofs",
    platformId: detectPlatformId(),
    requireCurrentPlatform: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--proof-root") {
      opts.proofRoot = argv[i + 1] ?? opts.proofRoot;
      i += 1;
      continue;
    }
    if (arg === "--platform-id") {
      opts.platformId = argv[i + 1] ?? opts.platformId;
      i += 1;
      continue;
    }
    if (arg === "--allow-missing-current-platform") {
      opts.requireCurrentPlatform = false;
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
      "verify-proof-artifacts.mjs",
      "",
      "Usage:",
      "  node scripts/proof/verify-proof-artifacts.mjs [--proof-root reports/compatibility/proofs] [--platform-id macos|linux|windows] [--allow-missing-current-platform]",
      "",
      "Checks schema and required capability coverage in latest proof artifacts.",
      "",
    ].join("\n"),
  );
}

function parseArtifact(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateArtifact(platformId, artifactPath, artifact) {
  const errors = [];
  if (!Array.isArray(artifact.checks)) {
    errors.push(`${platformId}: checks must be an array (${artifactPath})`);
    return errors;
  }

  const byCapability = new Map();
  for (const check of artifact.checks) {
    const capability = check?.capability;
    if (!capability) {
      errors.push(`${platformId}: check missing capability id (${artifactPath})`);
      continue;
    }
    if (byCapability.has(capability)) {
      errors.push(`${platformId}: duplicate capability "${capability}" (${artifactPath})`);
      continue;
    }
    byCapability.set(capability, check);
  }

  for (const capability of REQUIRED_CAPABILITIES) {
    const check = byCapability.get(capability);
    if (!check) {
      errors.push(`${platformId}: missing required capability "${capability}" (${artifactPath})`);
      continue;
    }
    if (!VALID_STATUSES.has(check.status)) {
      errors.push(`${platformId}: invalid status "${check.status}" for ${capability} (${artifactPath})`);
    }
    if (typeof check.log_file !== "string" || check.log_file.length === 0) {
      errors.push(`${platformId}: ${capability} missing log_file (${artifactPath})`);
      continue;
    }
    const logAbs = resolve(repoRoot, check.log_file);
    if (!existsSync(logAbs)) {
      errors.push(`${platformId}: ${capability} log_file does not exist (${check.log_file})`);
    }
  }

  return errors;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const latestRoot = resolve(repoRoot, opts.proofRoot, "latest");
  const errors = [];
  let seen = 0;

  for (const platformId of PLATFORMS) {
    const artifactPath = resolve(latestRoot, `${platformId}.json`);
    if (!existsSync(artifactPath)) {
      if (opts.requireCurrentPlatform && platformId === opts.platformId) {
        errors.push(`${platformId}: missing required artifact ${artifactPath}`);
      } else {
        process.stdout.write(`[proof-verify] ${platformId}: no artifact (explicitly unproven)\n`);
      }
      continue;
    }

    let artifact = null;
    try {
      artifact = parseArtifact(artifactPath);
    } catch (error) {
      errors.push(`${platformId}: invalid JSON in ${artifactPath}: ${error.message}`);
      continue;
    }

    const artifactErrors = validateArtifact(platformId, artifactPath, artifact);
    errors.push(...artifactErrors);
    if (artifactErrors.length === 0) {
      const status = artifact?.summary?.status || "unknown";
      process.stdout.write(
        `[proof-verify] ${platformId}: run=${artifact.run_id || "unknown"} checks=${artifact.checks.length} status=${status}\n`,
      );
      seen += 1;
    }
  }

  if (errors.length > 0) {
    process.stderr.write("[proof-verify] FAIL\n");
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`[proof-verify] PASS: validated ${seen} artifact(s)\n`);
}

main();
