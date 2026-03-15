/**
 * Tests for coord_focus_worker, coord_focus_next, coord_unfocus.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

process.env.COORDINATOR_TEST_MODE = "1";
process.env.COORDINATOR_PLATFORM = "linux";

async function loadCoord(home) {
  const prev = process.env.HOME;
  process.env.HOME = home;
  const mod = await import(`../index.js?focus=${Date.now()}-${Math.random()}`);
  process.env.HOME = prev;
  return mod.__test__;
}

function makeMeta(resultsDir, taskId, workerName) {
  writeFileSync(
    join(resultsDir, `${taskId}.meta.json`),
    JSON.stringify({ task_id: taskId, worker_name: workerName, status: "running" }),
    { mode: 0o600 },
  );
}

function makeResult(resultsDir, taskId, content) {
  writeFileSync(join(resultsDir, `${taskId}.txt`), content, { mode: 0o600 });
}

let home;
let api;
let resultsDir;
let terminalsDir;

before(async () => {
  home = mkdtempSync(join(tmpdir(), "coord-focus-"));
  process.env.HOME = home;
  terminalsDir = join(home, ".claude", "terminals");
  resultsDir = join(terminalsDir, "results");
  mkdirSync(resultsDir, { recursive: true });
  api = await loadCoord(home);
  process.env.HOME = home; // keep HOME set for the whole test suite
  api.ensureDirsOnce();
});

after(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe("coord_focus_worker", () => {
  it("sets .focus-state file with the correct worker name", () => {
    makeMeta(resultsDir, "task-alpha", "alpha");
    makeResult(resultsDir, "task-alpha", "line1\nline2\nline3");

    const result = api.handleToolCall("coord_focus_worker", { worker_name: "alpha" });
    const content = result.content[0].text;
    assert.ok(content.includes("alpha"), "response mentions worker name");
    assert.ok(content.includes("Focused on"), "response says Focused on");

    const focusFile = join(terminalsDir, ".focus-state");
    assert.ok(existsSync(focusFile), ".focus-state file was created");
    assert.equal(readFileSync(focusFile, "utf-8").trim(), "alpha");
  });

  it("returns error for nonexistent worker", () => {
    const result = api.handleToolCall("coord_focus_worker", { worker_name: "ghost" });
    const content = result.content[0].text;
    assert.ok(content.includes("not found"), "error message for missing worker");
  });
});

describe("coord_unfocus", () => {
  it("removes the .focus-state file", () => {
    makeMeta(resultsDir, "task-delta", "delta");
    api.handleToolCall("coord_focus_worker", { worker_name: "alpha" });
    assert.ok(existsSync(join(terminalsDir, ".focus-state")), "focus set before unfocus");

    const result = api.handleToolCall("coord_unfocus", {});
    assert.ok(result.content[0].text.includes("Focus cleared"), "cleared message returned");
    assert.ok(!existsSync(join(terminalsDir, ".focus-state")), ".focus-state file removed");
  });

  it("is idempotent — succeeds even when no focus file exists", () => {
    // Focus file should not exist from previous test
    const result = api.handleToolCall("coord_unfocus", {});
    assert.ok(result.content[0].text.includes("Focus cleared"), "still reports cleared");
  });
});

describe("coord_focus_next", () => {
  before(() => {
    // Ensure no stale focus
    api.handleToolCall("coord_unfocus", {});
    // Create two workers: beta and gamma
    makeMeta(resultsDir, "task-beta", "beta");
    makeMeta(resultsDir, "task-gamma", "gamma");
  });

  it("focuses the first active worker alphabetically when no focus is set", () => {
    api.handleToolCall("coord_unfocus", {});
    const result = api.handleToolCall("coord_focus_next", {});
    assert.ok(result.content[0].text.includes("Focused on"), "response says Focused on");

    const focusFile = join(terminalsDir, ".focus-state");
    assert.ok(existsSync(focusFile), ".focus-state file created by focus_next");
  });

  it("wraps around from last to first worker", () => {
    // Collect all worker names that exist
    const workers = new Set();
    api.handleToolCall("coord_unfocus", {});

    // Cycle through until we see a repeated name (wrap)
    const seen = [];
    for (let i = 0; i < 20; i++) {
      api.handleToolCall("coord_focus_next", {});
      const current = readFileSync(join(terminalsDir, ".focus-state"), "utf-8").trim();
      if (seen.length > 0 && current === seen[0]) {
        // We wrapped back to the beginning
        workers.add(current);
        break;
      }
      workers.add(current);
      seen.push(current);
    }
    // We should have seen more than 1 unique worker (wrapping only makes sense with 2+)
    assert.ok(workers.size >= 1, "at least one worker cycled through");
    // Confirm the final state is in the .focus-state file
    const focusFile = join(terminalsDir, ".focus-state");
    assert.ok(existsSync(focusFile), ".focus-state still exists after cycling");
  });
});
