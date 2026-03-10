import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../index.js";

// ─── buildInteractiveWorkerScript ───────────────────────────────────────────

test("buildInteractiveWorkerScript linux uses script transcript wrapper", () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: "W5",
    workDir: "/tmp/work",
    resultFile: "/tmp/result.txt",
    pidFile: "/tmp/pid.txt",
    metaFile: "/tmp/meta.json",
    model: "sonnet",
    agent: "",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
    permissionMode: "acceptEdits",
  });
  assert.match(cmd, /script -q/);
  assert.match(cmd, /WORKER_PROMPT/);
  assert.match(cmd, /unset CLAUDECODE/);
  assert.match(cmd, /transcript/);
});

test("buildInteractiveWorkerScript linux includes agent flag when set", () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: "W6",
    workDir: "/tmp/work",
    resultFile: "/tmp/result.txt",
    pidFile: "/tmp/pid.txt",
    metaFile: "/tmp/meta.json",
    model: "sonnet",
    agent: "role-implementer",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
    permissionMode: "acceptEdits",
  });
  assert.match(cmd, /--agent 'role-implementer'/);
});

test("buildInteractiveWorkerScript darwin uses script without -c flag", () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: "W7",
    workDir: "/tmp/work",
    resultFile: "/tmp/result.txt",
    pidFile: "/tmp/pid.txt",
    metaFile: "/tmp/meta.json",
    model: "sonnet",
    agent: "",
    promptFile: "/tmp/prompt.txt",
    platformName: "darwin",
    permissionMode: "acceptEdits",
  });
  assert.match(cmd, /script -q/);
  assert.doesNotMatch(cmd, /script -q.*-c/);
});

test("buildInteractiveWorkerScript win32 falls back to pipe mode script", () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: "W8",
    workDir: "C:\\work",
    resultFile: "C:\\r.txt",
    pidFile: "C:\\p.pid",
    metaFile: "C:\\m.meta.json",
    model: "sonnet",
    agent: "",
    promptFile: "C:\\prompt.txt",
    workerPs1File: "C:\\w.ps1",
    platformName: "win32",
    permissionMode: "acceptEdits",
  });
  assert.match(cmd, /ExecutionPolicy Bypass -File/);
});

test("buildInteractiveWorkerScript exports workerName and maxTurns env vars", () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: "W9",
    workDir: "/tmp/work",
    resultFile: "/tmp/result.txt",
    pidFile: "/tmp/pid.txt",
    metaFile: "/tmp/meta.json",
    model: "sonnet",
    agent: "",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
    permissionMode: "readOnly",
    workerName: "alice",
    maxTurns: 50,
  });
  assert.match(cmd, /CLAUDE_WORKER_NAME='alice'/);
  assert.match(cmd, /CLAUDE_WORKER_MAX_TURNS='50'/);
  assert.match(cmd, /CLAUDE_WORKER_PERMISSION_MODE='readOnly'/);
});

test("buildInteractiveWorkerScript omits permission mode export for default acceptEdits", () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: "W10",
    workDir: "/tmp/work",
    resultFile: "/tmp/result.txt",
    pidFile: "/tmp/pid.txt",
    metaFile: "/tmp/meta.json",
    model: "sonnet",
    agent: "",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
    permissionMode: "acceptEdits",
  });
  assert.doesNotMatch(cmd, /CLAUDE_WORKER_PERMISSION_MODE/);
});

// ─── buildCodexWorkerScript ──────────────────────────────────────────────────

test("buildCodexWorkerScript linux generates codex exec command", () => {
  const cmd = __test__.buildCodexWorkerScript({
    taskId: "CW1",
    workDir: "/tmp/codex-work",
    resultFile: "/tmp/r.txt",
    pidFile: "/tmp/p.pid",
    metaFile: "/tmp/m.meta.json",
    model: "sonnet",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
  });
  assert.match(cmd, /codex exec/);
  assert.match(cmd, /--full-auto/);
  assert.match(cmd, /WORKER_PROMPT/);
  assert.match(cmd, /status.*completed/);
});

test("buildCodexWorkerScript omits -m flag for default sonnet model", () => {
  const cmd = __test__.buildCodexWorkerScript({
    taskId: "CW2",
    workDir: "/tmp/work",
    resultFile: "/tmp/r.txt",
    pidFile: "/tmp/p.pid",
    metaFile: "/tmp/m.meta.json",
    model: "sonnet",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
  });
  assert.doesNotMatch(cmd, / -m /);
});

test("buildCodexWorkerScript includes -m flag for non-default model", () => {
  const cmd = __test__.buildCodexWorkerScript({
    taskId: "CW3",
    workDir: "/tmp/work",
    resultFile: "/tmp/r.txt",
    pidFile: "/tmp/p.pid",
    metaFile: "/tmp/m.meta.json",
    model: "opus",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
  });
  assert.match(cmd, /-m 'opus'/);
});

test("buildCodexWorkerScript win32 returns unsupported message", () => {
  const cmd = __test__.buildCodexWorkerScript({
    taskId: "CW4",
    workDir: "C:\\work",
    resultFile: "C:\\r.txt",
    pidFile: "C:\\p.pid",
    metaFile: "C:\\m.meta.json",
    model: "sonnet",
    promptFile: "C:\\prompt.txt",
    platformName: "win32",
  });
  assert.match(cmd, /not supported on Windows/);
});

// ─── buildCodexInteractiveWorkerScript ──────────────────────────────────────

test("buildCodexInteractiveWorkerScript linux generates codex TUI command", () => {
  const cmd = __test__.buildCodexInteractiveWorkerScript({
    taskId: "CI1",
    workDir: "/tmp/ci-work",
    resultFile: "/tmp/r.txt",
    pidFile: "/tmp/p.pid",
    metaFile: "/tmp/m.meta.json",
    model: "sonnet",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
  });
  assert.match(cmd, /codex.*--full-auto/);
  assert.doesNotMatch(cmd, /codex exec/);
  assert.match(cmd, /WORKER_PROMPT/);
  assert.match(cmd, /status.*completed/);
});

test("buildCodexInteractiveWorkerScript includes -m for non-sonnet model", () => {
  const cmd = __test__.buildCodexInteractiveWorkerScript({
    taskId: "CI2",
    workDir: "/tmp/work",
    resultFile: "/tmp/r.txt",
    pidFile: "/tmp/p.pid",
    metaFile: "/tmp/m.meta.json",
    model: "haiku",
    promptFile: "/tmp/prompt.txt",
    platformName: "linux",
  });
  assert.match(cmd, /-m 'haiku'/);
});

test("buildCodexInteractiveWorkerScript win32 returns unsupported message", () => {
  const cmd = __test__.buildCodexInteractiveWorkerScript({
    taskId: "CI3",
    workDir: "C:\\work",
    resultFile: "C:\\r.txt",
    pidFile: "C:\\p.pid",
    metaFile: "C:\\m.meta.json",
    model: "sonnet",
    promptFile: "C:\\prompt.txt",
    platformName: "win32",
  });
  assert.match(cmd, /not supported on Windows/);
});
