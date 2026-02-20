/**
 * E2E tests for the MCP coordinator filesystem protocol.
 *
 * These tests verify the core file-based communication contracts:
 * session files, inbox delivery, worker meta files, pipeline directories.
 * No live server is required — tests exercise the protocol directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readJSON, readJSONL, getSessionStatus } from "../lib.js";

// Temp directory for each test run
const TEST_DIR = join(tmpdir(), `mcp-e2e-${Date.now()}`);
const TERMINALS_DIR = join(TEST_DIR, "terminals");
const INBOX_DIR = join(TERMINALS_DIR, "inbox");
const RESULTS_DIR = join(TERMINALS_DIR, "results");

// Setup
mkdirSync(INBOX_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

// Cleanup after all tests
process.on("exit", () => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

// ─── Session file protocol ────────────────────────────────

test("e2e: session file can be written and read back", () => {
  const sessionId = "abcd1234";
  const sessionFile = join(TERMINALS_DIR, `session-${sessionId}.json`);
  const session = {
    session: sessionId,
    status: "active",
    project: "test-project",
    branch: "main",
    cwd: "/tmp/test",
    transcript: "unknown",
    started: new Date().toISOString(),
    last_active: new Date().toISOString(),
    tool_counts: { Write: 2, Edit: 5, Bash: 10, Read: 3 },
    files_touched: ["/tmp/test/src/index.js"],
    recent_ops: [{ t: new Date().toISOString(), tool: "Edit", file: "index.js" }],
    schema_version: 2,
  };
  writeFileSync(sessionFile, JSON.stringify(session, null, 2));

  const loaded = readJSON(sessionFile);
  assert.ok(loaded, "session file should be readable");
  assert.equal(loaded.session, sessionId);
  assert.equal(loaded.project, "test-project");
  assert.equal(loaded.tool_counts.Edit, 5);
  assert.deepEqual(loaded.files_touched, ["/tmp/test/src/index.js"]);
});

test("e2e: session status detection from file", () => {
  const recentTs = new Date(Date.now() - 30 * 1000).toISOString();
  const activeSession = { status: "active", last_active: recentTs };
  assert.equal(getSessionStatus(activeSession), "active");

  const closedSession = { status: "closed", last_active: recentTs };
  assert.equal(getSessionStatus(closedSession), "closed");
});

// ─── Inbox protocol ──────────────────────────────────────

test("e2e: message can be written to inbox and read back", () => {
  const targetSession = "ef567890";
  const inboxFile = join(INBOX_DIR, `${targetSession}.jsonl`);

  const message = {
    ts: new Date().toISOString(),
    from: "lead",
    priority: "normal",
    content: "Please refactor the auth module.",
  };
  writeFileSync(inboxFile, JSON.stringify(message) + "\n");

  const messages = readJSONL(inboxFile);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, "lead");
  assert.equal(messages[0].content, "Please refactor the auth module.");
});

test("e2e: multiple messages accumulate in inbox", () => {
  const targetSession = "aa112233";
  const inboxFile = join(INBOX_DIR, `${targetSession}.jsonl`);

  // Append 3 messages
  for (let i = 0; i < 3; i++) {
    const msg = { ts: new Date().toISOString(), from: "lead", priority: "normal", content: `Task ${i}` };
    const existing = existsSync(inboxFile) ? readFileSync(inboxFile, "utf-8") : "";
    writeFileSync(inboxFile, existing + JSON.stringify(msg) + "\n");
  }

  const messages = readJSONL(inboxFile);
  assert.equal(messages.length, 3);
  assert.equal(messages[2].content, "Task 2");
  rmSync(inboxFile, { force: true });
});

test("e2e: inbox drain (clear after reading)", () => {
  const targetSession = "bb223344";
  const inboxFile = join(INBOX_DIR, `${targetSession}.jsonl`);

  writeFileSync(inboxFile, JSON.stringify({ from: "lead", content: "hi" }) + "\n");
  assert.equal(readJSONL(inboxFile).length, 1);

  // Drain: overwrite with empty
  writeFileSync(inboxFile, "");
  assert.equal(readJSONL(inboxFile).length, 0);
});

// ─── Worker meta protocol ────────────────────────────────

test("e2e: worker meta file can be written and read", () => {
  const taskId = "W1234567890";
  const metaFile = join(RESULTS_DIR, `${taskId}.meta.json`);

  const meta = {
    task_id: taskId,
    directory: "/tmp/test-project",
    prompt: "Refactor the database layer.",
    model: "sonnet",
    agent: null,
    files: [],
    spawned: new Date().toISOString(),
    status: "running",
  };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  const loaded = readJSON(metaFile);
  assert.ok(loaded);
  assert.equal(loaded.task_id, taskId);
  assert.equal(loaded.status, "running");
  assert.equal(loaded.model, "sonnet");
});

test("e2e: worker done file signals completion", () => {
  const taskId = "W9876543210";
  const metaFile = join(RESULTS_DIR, `${taskId}.meta.json`);
  const doneFile = `${metaFile}.done`;

  writeFileSync(metaFile, JSON.stringify({ task_id: taskId, status: "running" }, null, 2));
  assert.ok(!existsSync(doneFile), "done file should not exist while running");

  writeFileSync(doneFile, JSON.stringify({ status: "completed", finished: new Date().toISOString(), task_id: taskId }));
  assert.ok(existsSync(doneFile), "done file should exist after completion");

  const done = readJSON(doneFile);
  assert.equal(done.status, "completed");
});

// ─── Pipeline directory protocol ─────────────────────────

test("e2e: pipeline directory structure is correct", () => {
  const pipelineId = "P1234567890";
  const pipelineDir = join(RESULTS_DIR, pipelineId);
  mkdirSync(pipelineDir, { recursive: true });

  // Write step prompt files
  writeFileSync(join(pipelineDir, "0-setup.prompt"), "Set up the project.");
  writeFileSync(join(pipelineDir, "1-implement.prompt"), "Implement the feature.");

  // Write pipeline meta
  const meta = {
    pipeline_id: pipelineId,
    directory: "/tmp/project",
    total_steps: 2,
    tasks: [
      { step: 0, name: "setup", model: "sonnet" },
      { step: 1, name: "implement", model: "sonnet" },
    ],
    started: new Date().toISOString(),
    status: "running",
  };
  writeFileSync(join(pipelineDir, "pipeline.meta.json"), JSON.stringify(meta, null, 2));

  assert.ok(existsSync(join(pipelineDir, "0-setup.prompt")));
  assert.ok(existsSync(join(pipelineDir, "1-implement.prompt")));

  const loadedMeta = readJSON(join(pipelineDir, "pipeline.meta.json"));
  assert.equal(loadedMeta.total_steps, 2);
  assert.equal(loadedMeta.tasks[1].name, "implement");
});
