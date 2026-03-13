#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = ["--noEmit", "-p", "./tsconfig.typecheck.json", "--extendedDiagnostics", "--pretty", "false"];
const result = spawnSync("tsc", args, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
const output = `${stdout}${stderr}`;

if (output.length > 0) {
  process.stdout.write(output);
}

if (result.error) {
  process.stderr.write(`typecheck launcher error: ${result.error.message}\n`);
  process.exit(1);
}

if (result.signal === "SIGKILL" || result.status === 137) {
  process.stderr.write("typecheck was killed (exit 137 / SIGKILL). This indicates memory pressure, not a TypeScript diagnostic.\n");
  process.exit(1);
}

if (typeof result.status === "number" && result.status !== 0) {
  process.exit(result.status);
}

const jsLineMatch = output.match(/Lines of JavaScript:\s+(\d+)/);
if (!jsLineMatch) {
  process.stderr.write("failed to parse extended diagnostics output (missing 'Lines of JavaScript').\n");
  process.exit(1);
}

const jsLineCount = Number(jsLineMatch[1]);
if (!Number.isFinite(jsLineCount)) {
  process.stderr.write("failed to parse JavaScript line count in diagnostics output.\n");
  process.exit(1);
}

if (jsLineCount !== 0) {
  process.stderr.write(`typecheck regression: expected 0 JavaScript lines in the TS graph, found ${jsLineCount}.\n`);
  process.exit(1);
}
