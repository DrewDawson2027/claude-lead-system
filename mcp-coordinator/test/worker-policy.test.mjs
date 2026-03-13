import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function loadForTest(home, envOverrides = {}) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
    TG_BLOCK: process.env.TG_BLOCK,
    TG_NOTE: process.env.TG_NOTE,
    TG_CAPTURE: process.env.TG_CAPTURE,
    MR_BLOCK: process.env.MR_BLOCK,
    MR_NOTE: process.env.MR_NOTE,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = "1";
  process.env.COORDINATOR_PLATFORM = "linux";
  process.env.COORDINATOR_CLAUDE_BIN = "echo";
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  const mod = await import(
    `../index.js?worker-policy=${Date.now()}-${Math.random()}`
  );
  return {
    api: mod.__test__,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      for (const k of Object.keys(envOverrides)) {
        if (!(k in prev)) delete process.env[k];
      }
    },
  };
}

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), "coord-worker-policy-"));
  const claudeDir = join(home, ".claude");
  const terminals = join(claudeDir, "terminals");
  mkdirSync(join(terminals, "inbox"), { recursive: true });
  mkdirSync(join(terminals, "results"), { recursive: true });
  mkdirSync(join(terminals, "tasks"), { recursive: true });
  mkdirSync(join(terminals, "teams"), { recursive: true });
  mkdirSync(join(claudeDir, "session-cache"), { recursive: true });
  mkdirSync(join(claudeDir, "hooks"), { recursive: true });
  return { home, claudeDir, terminals };
}

function writeMockHooks(claudeDir) {
  const hooksDir = join(claudeDir, "hooks");
  writeFileSync(
    join(hooksDir, "token-guard.py"),
    `#!/usr/bin/env python3
import json
import os
import sys

payload = json.load(sys.stdin)
capture = os.environ.get("TG_CAPTURE")
if capture:
    with open(capture, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
note = os.environ.get("TG_NOTE")
if note:
    print(note, file=sys.stderr)
block = os.environ.get("TG_BLOCK")
desc = str(payload.get("tool_input", {}).get("description", ""))
if block and block in desc:
    print(f"BLOCKED: {block}", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(hooksDir, "model-router.py"),
    `#!/usr/bin/env python3
import json
import os
import sys

payload = json.load(sys.stdin)
note = os.environ.get("MR_NOTE")
if note:
    print(note)
block = os.environ.get("MR_BLOCK")
desc = str(payload.get("tool_input", {}).get("description", ""))
if block and block in desc:
    print(json.dumps({"reason": f"BLOCKED: {block}"}))
    sys.exit(2)
sys.exit(0)
`,
    { mode: 0o755 },
  );
}

function textOf(result) {
  return result?.content?.[0]?.text || "";
}

test("handleSpawnWorker blocks when token-guard blocks", async () => {
  const { home, claudeDir } = setupHome();
  writeMockHooks(claudeDir);
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home, { TG_BLOCK: "deny-this" });
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_spawn_worker", {
      directory: projectDir,
      prompt: "deny-this worker request",
    });
    assert.match(textOf(result), /BLOCKED: deny-this/);
  } finally {
    restore();
  }
});

test("handleSpawnWorker uses bundled model-router fallback when local hook is absent", async () => {
  const { home } = setupHome();
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_spawn_worker", {
      directory: projectDir,
      prompt: "safe worker request",
      model: "sonnet",
    });
    assert.match(textOf(result), /Worker spawned:/);
  } finally {
    restore();
  }
});

test("handleSpawnWorker surfaces advisory notes from both policy hooks", async () => {
  const { home, claudeDir } = setupHome();
  writeMockHooks(claudeDir);
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home, {
    TG_NOTE: "token guard advisory",
    MR_NOTE: "router advisory",
  });
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall("coord_spawn_worker", {
      directory: projectDir,
      prompt: "safe worker request",
    });
    const text = textOf(result);
    assert.match(text, /Worker spawned:/);
    assert.match(text, /Policy: token-guard: token guard advisory/);
    assert.match(text, /Policy: model-router: router advisory/);
  } finally {
    restore();
  }
});

test("handleResumeWorker true-resume runs the shared worker policy preflight", async () => {
  const { home, claudeDir } = setupHome();
  writeMockHooks(claudeDir);
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });
  const resultsDir = join(home, ".claude", "terminals", "results");
  const captureFile = join(home, "policy-capture.json");
  writeFileSync(
    join(resultsDir, "W_RESUME_POLICY.meta.json"),
    JSON.stringify({
      task_id: "W_RESUME_POLICY",
      directory: projectDir,
      original_directory: projectDir,
      mode: "interactive",
      model: "haiku",
      agent: "scout",
      prompt: "continue work",
      claude_session_id: "11111111-1111-1111-1111-111111111111",
      claude_parent_session_id: "22222222-2222-2222-2222-222222222222",
      notify_session_id: "lead1234",
    }),
  );

  const { api, restore } = await loadForTest(home, { TG_CAPTURE: captureFile });
  try {
    api.ensureDirsOnce();
    const result = api.handleResumeWorker({
      task_id: "W_RESUME_POLICY",
      mode: "interactive",
    });
    assert.match(textOf(result), /Worker resumed \(true resume\)/);
    const captured = JSON.parse(readFileSync(captureFile, "utf8"));
    assert.equal(captured.session_id, "22222222-2222-2222-2222-222222222222");
    assert.equal(
      captured.tool_input.resume,
      "11111111-1111-1111-1111-111111111111",
    );
    assert.equal(captured.tool_input.subagent_type, "scout");
  } finally {
    restore();
  }
});

test("handleSpawnWorkers inherits per-worker policy enforcement", async () => {
  const { home, claudeDir } = setupHome();
  writeMockHooks(claudeDir);
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home, { MR_BLOCK: "second-task" });
  try {
    api.ensureDirsOnce();
    const result = api.handleSpawnWorkers({
      workers: [
        { directory: projectDir, prompt: "first-task" },
        { directory: projectDir, prompt: "second-task" },
      ],
    });
    const text = textOf(result);
    assert.match(text, /Multi-Spawn: 2 workers/);
    assert.match(text, /Worker spawned:/);
    assert.match(text, /BLOCKED: second-task/);
  } finally {
    restore();
  }
});
