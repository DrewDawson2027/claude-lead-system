#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), "lead-boot-proof-"));
  const terminals = join(home, ".claude", "terminals");
  mkdirSync(join(terminals, "inbox"), { recursive: true });
  mkdirSync(join(terminals, "results"), { recursive: true });
  mkdirSync(join(home, ".claude", "session-cache"), { recursive: true });
  writeFileSync(
    join(terminals, "session-abcd1234.json"),
    JSON.stringify({
      session: "abcd1234",
      tty: "/dev/ttys009",
      project: "proof-project",
      cwd: repoRoot,
      status: "active",
      started: new Date().toISOString(),
      last_active: new Date().toISOString(),
      tool_counts: { Write: 2, Edit: 1, Bash: 1, Read: 4 },
      files_touched: ["docs/COMPATIBILITY_MATRIX.md"],
      recent_ops: [{ t: new Date().toISOString(), tool: "Edit", file: "docs/COMPATIBILITY_MATRIX.md" }],
    }),
  );
  return home;
}

async function loadCoordinatorApi(home) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = "1";
  process.env.COORDINATOR_PLATFORM = "linux";

  const moduleUrl = new URL(pathToFileURL(join(repoRoot, "mcp-coordinator/index.js")).href);
  moduleUrl.search = `proof-lead-boot=${Date.now()}-${Math.random()}`;
  const mod = await import(moduleUrl.href);
  return {
    api: mod.__test__,
    restore: () => {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}

async function main() {
  const home = setupHome();
  let restore = () => {};
  try {
    const loaded = await loadCoordinatorApi(home);
    restore = loaded.restore;
    const { api } = loaded;
    api.ensureDirsOnce();
    const result = await Promise.resolve(api.handleToolCall("coord_boot_snapshot", {}));
    const text = result?.content?.[0]?.text || "";

    assert.match(text, /^# Lead \u2014 Online/m);
    assert.match(text, /## Sessions \(1\)/);
    assert.match(text, /\| abcd1234 \|/);
    assert.match(text, /## What Each Terminal Is Doing/);
    assert.match(text, /## Conflicts/);
    assert.match(text, /## Recommended/);
    process.stdout.write("lead boot snapshot proof passed\n");
  } finally {
    restore();
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
