#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

const PLATFORMS = [
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "windows", label: "Windows" },
];

const CAPABILITIES = [
  { id: "install", label: "Install" },
  { id: "launch", label: "Launch" },
  { id: "lead_boot", label: "Lead boot" },
  { id: "message_delivery", label: "Message delivery" },
  { id: "task_dispatch", label: "Task dispatch" },
  { id: "conflict_detection", label: "Conflict detection" },
  { id: "resume", label: "Resume" },
  { id: "sidecar_health", label: "Sidecar health" },
];

function parseArgs(argv) {
  const opts = {
    proofRoot: "reports/compatibility/proofs",
    output: "docs/COMPATIBILITY_MATRIX.md",
    check: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--proof-root") {
      opts.proofRoot = argv[i + 1] ?? opts.proofRoot;
      i += 1;
      continue;
    }
    if (arg === "--output") {
      opts.output = argv[i + 1] ?? opts.output;
      i += 1;
      continue;
    }
    if (arg === "--check") {
      opts.check = true;
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
      "generate-compatibility-matrix.mjs",
      "",
      "Usage:",
      "  node scripts/proof/generate-compatibility-matrix.mjs [--proof-root reports/compatibility/proofs] [--output docs/COMPATIBILITY_MATRIX.md] [--check]",
      "",
    ].join("\n"),
  );
}

function loadArtifact(proofRoot, platformId) {
  const path = resolve(repoRoot, proofRoot, "latest", `${platformId}.json`);
  if (!existsSync(path)) return null;
  return {
    path,
    data: JSON.parse(readFileSync(path, "utf8")),
  };
}

function findCheck(artifact, capabilityId) {
  if (!artifact) return null;
  return artifact.data.checks.find((item) => item.capability === capabilityId) ?? null;
}

function checkReason(check) {
  if (!check) return "no check result";
  return check.reason || check.error || `status=${check.status || "unknown"}`;
}

function maturityForArtifact(artifact) {
  if (!artifact) return "unproven (no artifact)";
  const results = CAPABILITIES.map((capability) => findCheck(artifact, capability.id));
  const missing = results.filter((result) => result === null).length;
  const failed = results.filter((result) => result && result.status === "fail").length;
  const unsupported = results.filter((result) => result && result.status === "unsupported").length;
  const notRun = results.filter((result) => result && result.status === "not_run").length;
  if (missing === 0 && failed === 0 && unsupported === 0 && notRun === 0) return "evidence-backed";

  const reasons = [];
  if (failed > 0) reasons.push(`${failed} failed`);
  if (missing > 0) reasons.push(`${missing} missing`);
  if (unsupported > 0) reasons.push(`${unsupported} unsupported`);
  if (notRun > 0) reasons.push(`${notRun} not run`);
  return `artifact-backed with gaps (${reasons.join(", ")})`;
}

function cellForCapability(artifact, capabilityId, outputDir) {
  if (!artifact) return "⛔ no artifact";
  const check = findCheck(artifact, capabilityId);
  const artifactRel = relative(outputDir, artifact.path).replaceAll("\\", "/");
  if (!check) return `⚪ not run (missing check in [artifact](${artifactRel}))`;

  const logRel =
    typeof check.log_file === "string" && check.log_file.length > 0
      ? relative(outputDir, resolve(repoRoot, check.log_file)).replaceAll("\\", "/")
      : null;
  const logLink = logRel ? `[log](${logRel})` : `[artifact](${artifactRel})`;

  if (check.status === "pass") return `✅ pass (${logLink})`;
  if (check.status === "fail") return `❌ fail (${logLink})`;
  if (check.status === "unsupported") return `🚫 unsupported (${checkReason(check)})`;
  if (check.status === "not_run") return `⚪ not run (${checkReason(check)})`;
  return `⚪ unknown (${checkReason(check)})`;
}

function latestProofTimestamp(artifacts) {
  let latest = null;
  for (const artifact of artifacts.values()) {
    if (!artifact) continue;
    const ts = artifact.data.ended_at || artifact.data.started_at || null;
    if (!ts) continue;
    if (!latest || ts > latest) latest = ts;
  }
  return latest || "none";
}

function renderDoc(proofRoot, artifacts, outputDir) {
  const latestArtifactAt = latestProofTimestamp(artifacts);
  const generatedAt = latestArtifactAt;

  const header = [
    "<!-- GENERATED FILE: do not edit manually. -->",
    "<!-- Source: scripts/proof/generate-compatibility-matrix.mjs -->",
    "",
    "# Compatibility Matrix",
    "",
    "Evidence-backed platform matrix derived from committed proof artifacts.",
    "",
    `Generated at: ${generatedAt}`,
    `Latest artifact completed at: ${latestArtifactAt}`,
    `Proof root: \`${proofRoot}\``,
    "",
    "Rule: platform claims must be grounded in in-repo proof artifacts with explicit pass/fail/unproven reasons.",
    "",
    "Legend: ✅ pass | ❌ fail | ⚪ not run | 🚫 unsupported | ⛔ no artifact",
    "",
    "## Proof Coverage Contract",
    "",
    CAPABILITIES.map((capability) => `- \`${capability.id}\`: ${capability.label}`).join("\n"),
    "",
  ];

  const maturity = [
    "## Platform Maturity",
    "",
    "| Platform | Maturity | Artifact |",
    "| --- | --- | --- |",
    ...PLATFORMS.map((platform) => {
      const artifact = artifacts.get(platform.id);
      const artifactRel = artifact ? relative(outputDir, artifact.path).replaceAll("\\", "/") : "n/a";
      const artifactLink = artifact ? `[proof](${artifactRel})` : "none";
      return `| ${platform.label} | ${maturityForArtifact(artifact)} | ${artifactLink} |`;
    }),
    "",
  ];

  const capabilityRows = CAPABILITIES.map((capability) => {
    const cells = PLATFORMS.map((platform) => cellForCapability(artifacts.get(platform.id), capability.id, outputDir));
    return `| ${capability.label} | ${cells.join(" | ")} |`;
  });

  const matrix = [
    "## Proof Matrix",
    "",
    "| Capability | macOS | Linux | Windows |",
    "| --- | --- | --- | --- |",
    ...capabilityRows,
    "",
  ];

  const artifactRows = PLATFORMS.map((platform) => {
    const artifact = artifacts.get(platform.id);
    if (!artifact) return `| ${platform.label} | none | none | n/a |`;
    const data = artifact.data;
    const pathRel = relative(outputDir, artifact.path).replaceAll("\\", "/");
    return `| ${platform.label} | \`${data.run_id}\` | ${data.ended_at} | [proof.json](${pathRel}) |`;
  });

  const inventory = [
    "## Artifact Inventory",
    "",
    "| Platform | Run ID | Completed At (UTC) | Artifact |",
    "| --- | --- | --- | --- |",
    ...artifactRows,
    "",
    "## Regeneration",
    "",
    "```bash",
    "node scripts/proof/generate-compatibility-matrix.mjs",
    "```",
    "",
  ];

  return [...header, ...maturity, ...matrix, ...inventory].join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outputPath = resolve(repoRoot, opts.output);
  const outputDir = dirname(outputPath);
  const artifacts = new Map();

  for (const platform of PLATFORMS) {
    artifacts.set(platform.id, loadArtifact(opts.proofRoot, platform.id));
  }

  const rendered = renderDoc(opts.proofRoot, artifacts, outputDir);

  if (opts.check) {
    const existing = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    if (existing !== rendered) {
      process.stderr.write(`compatibility matrix is out of date: ${relative(repoRoot, outputPath)}\n`);
      process.exit(1);
    }
    process.stdout.write(`compatibility matrix is current: ${relative(repoRoot, outputPath)}\n`);
    return;
  }

  writeFileSync(outputPath, rendered, "utf8");
  process.stdout.write(`wrote ${relative(repoRoot, outputPath)}\n`);
}

main();
