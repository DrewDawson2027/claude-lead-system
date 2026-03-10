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
  const mod = await import(`../index.js?cost=${Date.now()}-${Math.random()}`);
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
  const home = mkdtempSync(join(tmpdir(), "coord-cost-"));
  const terminals = join(home, ".claude", "terminals");
  const results = join(terminals, "results");
  const inbox = join(terminals, "inbox");
  const sessionCache = join(home, ".claude", "session-cache");
  mkdirSync(results, { recursive: true });
  mkdirSync(inbox, { recursive: true });
  mkdirSync(sessionCache, { recursive: true });
  return { home, terminals, results };
}

test("handleCostComparison returns full cost table with no workers or sessions", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_cost_comparison", {});
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /Cost Comparison/);
    assert.match(txt, /Lead System/);
    assert.match(txt, /Agent Teams/);
    assert.match(txt, /Savings/);
    assert.match(txt, /Active sessions: 0/);
    assert.match(txt, /Workers spawned: 0/);
    assert.match(txt, /saved/);
  } finally {
    restore();
  }
});

test("handleCostComparison includes sonnet worker from meta file", async () => {
  const { home, results } = setupHome();
  writeFileSync(
    join(results, "meta-W99.json"),
    JSON.stringify({
      worker_id: "W99",
      model: "sonnet",
      estimated_tokens: 50000,
    }),
  );
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_cost_comparison", {});
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /W99/);
    assert.match(txt, /Workers spawned: 1/);
    assert.match(txt, /50K/);
  } finally {
    restore();
  }
});

test("handleCostComparison handles opus model worker with higher pricing", async () => {
  const { home, results } = setupHome();
  writeFileSync(
    join(results, "meta-OPUS1.json"),
    JSON.stringify({
      worker_id: "OPUS1",
      model: "opus",
      estimated_tokens: 80000,
    }),
  );
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_cost_comparison", {});
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /OPUS1/);
    assert.match(txt, /saved/);
    assert.match(txt, /reduction/);
  } finally {
    restore();
  }
});

test("handleCostComparison handles haiku model worker", async () => {
  const { home, results } = setupHome();
  writeFileSync(
    join(results, "meta-HAI1.json"),
    JSON.stringify({ worker_id: "HAI1", model: "haiku", tokens: 30000 }),
  );
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_cost_comparison", {});
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /HAI1/);
    assert.match(txt, /Workers spawned: 1/);
  } finally {
    restore();
  }
});

test("handleCostComparison only counts open (non-closed) sessions", async () => {
  const { home, terminals } = setupHome();
  writeFileSync(
    join(terminals, "session-abc12345.json"),
    JSON.stringify({ status: "open", session_id: "abc12345" }),
  );
  writeFileSync(
    join(terminals, "session-xyz67890.json"),
    JSON.stringify({ status: "closed", session_id: "xyz67890" }),
  );
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_cost_comparison", {});
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /Active sessions: 1/);
  } finally {
    restore();
  }
});

test("handleCostComparison uses default 80K tokens when meta has no token field", async () => {
  const { home, results } = setupHome();
  writeFileSync(
    join(results, "meta-NOTOKENS.json"),
    JSON.stringify({ worker_id: "NOTOKENS", model: "sonnet" }),
  );
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_cost_comparison", {});
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /80K/);
  } finally {
    restore();
  }
});

test("handleCostComparison shows coordination cost is zero for Lead System", async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_cost_comparison", {});
    const txt = result?.content?.[0]?.text || "";
    assert.match(txt, /Coordination \(filesystem\).*\$0\.00/);
  } finally {
    restore();
  }
});
