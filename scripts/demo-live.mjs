#!/usr/bin/env node
// Live product demo — runs actual coordinator tool calls
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const home = mkdtempSync(join(tmpdir(), "cls-demo-"));
process.env.HOME = home;
process.env.COORDINATOR_TEST_MODE = "1";
process.env.COORDINATOR_PLATFORM = "linux";

const mod = await import(`../mcp-coordinator/index.js?demo=${Date.now()}`);
const api = mod.__test__;
api.ensureDirsOnce();

const TERMINALS = join(home, ".claude", "terminals");
const RESULTS = join(TERMINALS, "results");
const INBOX = join(TERMINALS, "inbox");
mkdirSync(INBOX, { recursive: true });

function say(text) { console.log(text); }
function pause(ms) { return new Promise(r => setTimeout(r, ms)); }
function call(tool, args = {}) {
  const r = api.handleToolCall(tool, args);
  return r.content[0].text;
}

say("");
say("  \x1b[1;36m═══ Claude Lead System — Live Demo ═══\x1b[0m");
say("  Every command below is a real MCP tool call.");
say("");
await pause(2000);

// Step 1: Create tasks
say("  \x1b[1m── Step 1: Create & assign tasks ──\x1b[0m");
say("  \x1b[33m> coord_create_task subject='Review auth module'\x1b[0m");
say("");
say(call("coord_create_task", { subject: "Review auth module", description: "Audit src/auth/ for vulnerabilities" }));
say("");
say("  \x1b[33m> coord_create_task subject='Write API tests'\x1b[0m");
say("");
say(call("coord_create_task", { subject: "Write API tests", description: "Cover all endpoints in src/api/" }));
say("");
await pause(2000);

// Step 2: List tasks
say("  \x1b[1m── Step 2: View task board ──\x1b[0m");
say("  \x1b[33m> coord_list_tasks\x1b[0m");
say("");
say(call("coord_list_tasks", {}));
say("");
await pause(2000);

// Step 3: Set up two workers and show conflict detection
say("  \x1b[1m── Step 3: Conflict Detection ──\x1b[0m");
say("  Two workers both editing src/auth.ts.");
say("  Native Agent Teams: 'break work so each owns different files'");
say("  Lead System: detects it BEFORE the collision.");
say("");

writeFileSync(join(TERMINALS, "session-alpha111.json"),
  JSON.stringify({ session: "alpha111", status: "active", worker_name: "alpha",
    files_touched: ["src/auth.ts", "src/utils.ts"], current_task: "Review auth",
    cwd: "/project" }), { mode: 0o600 });
writeFileSync(join(TERMINALS, "session-beta2222.json"),
  JSON.stringify({ session: "beta2222", status: "active", worker_name: "beta",
    files_touched: ["src/auth.ts", "src/config.ts"], current_task: "Write tests",
    cwd: "/project" }), { mode: 0o600 });

say("  \x1b[33m> coord_detect_conflicts session=alpha files=[src/auth.ts]\x1b[0m");
say("");
say(call("coord_detect_conflicts", { session_id: "alpha111", files: ["src/auth.ts"] }));
say("");
await pause(3000);

// Step 4: Send a message
say("  \x1b[1m── Step 4: Direct worker messaging ──\x1b[0m");
say("  \x1b[33m> coord_send_message to=beta 'Stop editing auth.ts — alpha owns it'\x1b[0m");
say("");
say(call("coord_send_message", { from: "lead", target_name: "beta", content: "Stop editing auth.ts — alpha owns that file" }));
say("");
await pause(2000);

// Step 5: Watch output
say("  \x1b[1m── Step 5: Live worker output ──\x1b[0m");

writeFileSync(join(RESULTS, "TASK001.meta.json"),
  JSON.stringify({ task_id: "TASK001", worker_name: "alpha", status: "running", model: "sonnet" }), { mode: 0o600 });
writeFileSync(join(RESULTS, "TASK001.txt"),
  "Reading src/auth.ts...\nFound JWT token handler at line 42\nChecking for token expiry validation...\nWARNING: No expiry check on refresh tokens\nRecommendation: Add exp claim validation", { mode: 0o600 });
writeFileSync(join(RESULTS, "TASK001.pid"), process.pid.toString(), { mode: 0o600 });

say("  \x1b[33m> coord_watch_output worker_name=alpha\x1b[0m");
say("");
say(call("coord_watch_output", { worker_name: "alpha", lines: 10 }));
say("");
await pause(2000);

// Step 6: Operator dashboard
say("  \x1b[1m── Step 6: Operator dashboard ──\x1b[0m");
say("  \x1b[33m> coord_list_sessions\x1b[0m");
say("");
say(call("coord_list_sessions", {}));
say("");
await pause(2000);

// Final
say("  \x1b[1;32m═══════════════════════════════════════════════════\x1b[0m");
say("  81 tools | 996 tests | All CI green");
say("  Pre-edit conflict detection | Budget governance");
say("  Worker output streaming | Session resumption");
say("  Zero API tokens for coordination");
say("  github.com/DrewDawson2027/claude-lead-system");
say("  \x1b[1;32m═══════════════════════════════════════════════════\x1b[0m");
say("");
await pause(4000);

process.exit(0);
