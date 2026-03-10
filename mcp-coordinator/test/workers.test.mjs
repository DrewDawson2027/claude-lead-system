import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
} from "node:fs";
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
    `../index.js?workers=${Date.now()}-${Math.random()}`
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
  const home = mkdtempSync(join(tmpdir(), "coord-workers-"));
  const terminals = join(home, ".claude", "terminals");
  const inbox = join(terminals, "inbox");
  const results = join(terminals, "results");
  const sessionCache = join(home, ".claude", "session-cache");
  mkdirSync(inbox, { recursive: true });
  mkdirSync(results, { recursive: true });
  mkdirSync(sessionCache, { recursive: true });
  return { home, terminals, inbox, results };
}

test("spawn_terminal requires valid directory", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_spawn_terminal", {
      directory: "/tmp/does-not-exist-" + Date.now(),
    });
    assert.match(result?.content?.[0]?.text || "", /not found/i);
  } finally {
    restore();
  }
});

test("spawn_terminal succeeds with valid directory", async () => {
  const { home } = setupHome();
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_spawn_terminal", {
      directory: projectDir,
      layout: "split",
    });
    const text = result?.content?.[0]?.text || "";
    assert.match(text, /Terminal spawned/);
    assert.match(text, /split/);
  } finally {
    restore();
  }
});

test("get_result returns not found for missing task", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_get_result", {
      task_id: "W_MISSING",
    });
    assert.match(result?.content?.[0]?.text || "", /not found/);
  } finally {
    restore();
  }
});

test("kill_worker returns appropriate message for missing PID", async () => {
  const { home, results } = setupHome();
  writeFileSync(
    join(results, "W_TEST.meta.json"),
    JSON.stringify({ task_id: "W_TEST", status: "running" }),
  );

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_kill_worker", {
      task_id: "W_TEST",
    });
    assert.match(result?.content?.[0]?.text || "", /no PID file/i);
  } finally {
    restore();
  }
});

test("kill_worker recognizes already completed tasks", async () => {
  const { home, results } = setupHome();
  writeFileSync(
    join(results, "W_DONE.meta.json"),
    JSON.stringify({ task_id: "W_DONE", status: "completed" }),
  );
  writeFileSync(
    join(results, "W_DONE.meta.json.done"),
    JSON.stringify({ status: "completed" }),
  );

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_kill_worker", {
      task_id: "W_DONE",
    });
    assert.match(result?.content?.[0]?.text || "", /already completed/i);
  } finally {
    restore();
  }
});

test("handleResumeWorker returns not found for missing task", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleResumeWorker({ task_id: "W_MISSING_RESUME" });
    assert.match(result?.content?.[0]?.text || "", /not found/i);
  } finally {
    restore();
  }
});

test("handleResumeWorker returns still-running message when PID is alive", async () => {
  const { home, results } = setupHome();
  // Write meta + a PID file pointing at our own process (definitely alive)
  writeFileSync(
    join(results, "W_ALIVE.meta.json"),
    JSON.stringify({
      task_id: "W_ALIVE",
      status: "running",
      mode: "pipe",
      directory: home,
      model: "sonnet",
    }),
  );
  writeFileSync(join(results, "W_ALIVE.pid"), String(process.pid));

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleResumeWorker({ task_id: "W_ALIVE" });
    assert.match(result?.content?.[0]?.text || "", /still running/i);
  } finally {
    restore();
  }
});

test("handleResumeWorker spawns a new worker for a stopped task", async () => {
  const { home, results } = setupHome();
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(results, "W_STOPPED.meta.json"),
    JSON.stringify({
      task_id: "W_STOPPED",
      status: "running",
      mode: "pipe",
      original_directory: projectDir,
      directory: projectDir,
      model: "sonnet",
      files: [],
      context_level: "minimal",
    }),
  );
  writeFileSync(join(results, "W_STOPPED.txt"), "partial output");
  // No PID file — worker is not running

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleResumeWorker({ task_id: "W_STOPPED" });
    const txt = result?.content?.[0]?.text || "";
    // Should either spawn a continuation worker or report success
    assert.ok(txt.length > 0, "should return some response");
    // Not "not found"
    assert.doesNotMatch(txt, /not found/i);
  } finally {
    restore();
  }
});

test("handleUpgradeWorker returns not found for missing task", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleUpgradeWorker({ task_id: "W_MISSING_UPGRADE" });
    assert.match(result?.content?.[0]?.text || "", /not found/i);
  } finally {
    restore();
  }
});

test("handleUpgradeWorker rejects already-interactive workers", async () => {
  const { home, results } = setupHome();
  writeFileSync(
    join(results, "W_ACTIVE.meta.json"),
    JSON.stringify({
      task_id: "W_ACTIVE",
      status: "running",
      mode: "interactive",
    }),
  );

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleUpgradeWorker({ task_id: "W_ACTIVE" });
    assert.match(
      result?.content?.[0]?.text || "",
      /already in interactive mode/i,
    );
  } finally {
    restore();
  }
});

test("handleSpawnWorkers rejects empty workers array", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleSpawnWorkers({ workers: [] });
    assert.match(result?.content?.[0]?.text || "", /required/i);
  } finally {
    restore();
  }
});

test("handleSpawnWorkers rejects more than 10 workers", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleSpawnWorkers({
      workers: Array(11).fill({ directory: home, prompt: "test" }),
    });
    assert.match(result?.content?.[0]?.text || "", /Maximum 10/i);
  } finally {
    restore();
  }
});

test("handleSpawnWorkers spawns multiple workers and returns multi-spawn summary", async () => {
  const { home } = setupHome();
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleSpawnWorkers({
      workers: [
        { directory: projectDir, prompt: "task one", model: "sonnet" },
        { directory: projectDir, prompt: "task two", model: "sonnet" },
      ],
    });
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /Multi-Spawn: 2 workers/i);
    assert.match(txt, /Worker 1/);
    assert.match(txt, /Worker 2/);
  } finally {
    restore();
  }
});
