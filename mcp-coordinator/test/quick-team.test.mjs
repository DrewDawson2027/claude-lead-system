/**
 * Tests for coord_quick_team and getActiveWorkerSummaries.
 * Verifies Gap 1 closure: single-call team + worker spawn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function loadForTest(home) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = "1";
  process.env.COORDINATOR_PLATFORM = "linux";
  process.env.COORDINATOR_CLAUDE_BIN = "echo";
  const mod = await import(
    `../index.js?quickteam=${Date.now()}-${Math.random()}`
  );
  return {
    api: mod.__test__,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), "coord-quickteam-"));
  mkdirSync(join(home, ".claude", "terminals", "inbox"), { recursive: true });
  mkdirSync(join(home, ".claude", "terminals", "results"), { recursive: true });
  mkdirSync(join(home, ".claude", "terminals", "teams"), { recursive: true });
  mkdirSync(join(home, ".claude", "session-cache"), { recursive: true });
  return home;
}

test("coord_quick_team — rejects empty workers array", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_quick_team", { workers: [] });
    const text = result?.content?.[0]?.text || "";
    assert.match(text, /workers.*required/i);
  } finally {
    restore();
  }
});

test("coord_quick_team — rejects more than 10 workers", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const workers = Array.from({ length: 11 }, (_, i) => ({
      prompt: `task ${i}`,
    }));
    const result = api.handleToolCall("coord_quick_team", { workers });
    const text = result?.content?.[0]?.text || "";
    assert.match(text, /maximum 10/i);
  } finally {
    restore();
  }
});

test("coord_quick_team — creates team and spawns workers", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_quick_team", {
      name: "test-squad",
      directory: home,
      workers: [
        { role: "reviewer", prompt: "Review the auth module" },
        { role: "researcher", prompt: "Investigate test coverage" },
      ],
    });
    const text = result?.content?.[0]?.text || "";
    assert.match(text, /test-squad/i, "should include team name");
    assert.match(text, /2 spawned|Worker 1|Worker 2/i, "should mention workers");
  } finally {
    restore();
  }
});

test("coord_quick_team — auto-generates team name when omitted", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_quick_team", {
      directory: home,
      workers: [{ prompt: "Do something useful", role: "implementer" }],
    });
    const text = result?.content?.[0]?.text || "";
    assert.match(text, /quick-[a-f0-9]+/i, "should auto-generate a quick-xxxx team name");
  } finally {
    restore();
  }
});

test("coord_quick_team — exposed in ALL_TOOLS schema", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    const tool = api.ALL_TOOLS.find((t) => t.name === "coord_quick_team");
    assert.ok(tool, "coord_quick_team should be in ALL_TOOLS");
    assert.ok(tool.inputSchema?.properties?.workers, "should have workers property");
    assert.ok(tool.inputSchema?.properties?.name, "should have name property");
    assert.ok(tool.inputSchema?.properties?.directory, "should have directory property");
  } finally {
    restore();
  }
});

test("coord_quick_team — in CORE_TOOLS profile", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    assert.ok(
      api.CORE_TOOLS.has("coord_quick_team"),
      "coord_quick_team should be in CORE_TOOLS",
    );
  } finally {
    restore();
  }
});

test("getActiveWorkerSummaries — returns empty array when no results dir", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const summaries = api.getActiveWorkerSummaries();
    assert.ok(Array.isArray(summaries), "should return an array");
    assert.strictEqual(summaries.length, 0, "should be empty with no workers");
  } finally {
    restore();
  }
});

test("getActiveWorkerSummaries — returns entry for .done worker", async () => {
  const home = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const resultsDir = join(home, ".claude", "terminals", "results");
    const tid = "testworker123";
    const metaFile = join(resultsDir, `${tid}.meta.json`);
    const doneFile = `${metaFile}.done`;
    const resultFile = join(resultsDir, `${tid}.txt`);
    writeFileSync(metaFile, JSON.stringify({ worker_name: "alpha", task_id: tid }));
    writeFileSync(doneFile, JSON.stringify({ status: "completed" }));
    writeFileSync(resultFile, "line1\nfinal line here");

    const summaries = api.getActiveWorkerSummaries();
    const entry = summaries.find((s) => s.name === "alpha");
    assert.ok(entry, "should find the done worker");
    assert.strictEqual(entry.status, "done");
    assert.strictEqual(entry.lastLine, "final line here");
  } finally {
    restore();
  }
});
