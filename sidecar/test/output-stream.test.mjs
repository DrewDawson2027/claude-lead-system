import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OutputStreamManager } from "../core/output-stream.js";

// Helper: write content to a tmp file and return its path
function makeTmpFile(dir, name, content = "") {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

// Helper: wait up to maxMs for condition to become true
async function waitFor(condition, maxMs = 2000, intervalMs = 50) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

describe("OutputStreamManager", () => {
  let tmpDir;
  let mgr;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-test-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mgr = new OutputStreamManager();
  });

  afterEach(() => {
    mgr.stopAll();
  });

  // ── getBuffer ──────────────────────────────────────────────────────────

  it("getBuffer returns empty array for unknown taskId", () => {
    assert.deepEqual(mgr.getBuffer("nonexistent"), []);
  });

  it("getBuffer returns empty array for watched task with no file content", () => {
    const p = makeTmpFile(tmpDir, "empty.txt", "");
    mgr.startWatching("task-empty", p, "worker-empty");
    assert.deepEqual(mgr.getBuffer("task-empty"), []);
  });

  // ── startWatching ──────────────────────────────────────────────────────

  it("startWatching is idempotent — second call is a no-op", () => {
    const p = makeTmpFile(tmpDir, "idem.txt", "");
    mgr.startWatching("task-idem", p);
    mgr.startWatching("task-idem", p); // should not throw or double-register
    assert.equal(mgr.workers.size, 1);
  });

  it("startWatching reads existing content on attach", async () => {
    const p = makeTmpFile(tmpDir, "existing.txt", "line1\nline2\n");
    const events = [];
    mgr.onOutput((e) => events.push(e));
    mgr.startWatching("task-existing", p, "worker-existing");
    await waitFor(() => events.length > 0);
    assert.equal(events[0].task_id, "task-existing");
    assert.equal(events[0].worker_name, "worker-existing");
    assert.ok(events[0].lines.includes("line1"));
  });

  // ── stopWatching ───────────────────────────────────────────────────────

  it("stopWatching removes the task entry", () => {
    const p = makeTmpFile(tmpDir, "stop.txt", "");
    mgr.startWatching("task-stop", p);
    assert.equal(mgr.workers.size, 1);
    mgr.stopWatching("task-stop");
    assert.equal(mgr.workers.size, 0);
  });

  it("stopWatching on unknown taskId is a no-op", () => {
    assert.doesNotThrow(() => mgr.stopWatching("does-not-exist"));
  });

  // ── delta streaming ────────────────────────────────────────────────────

  it("emits output event when new lines are appended", async () => {
    const p = makeTmpFile(tmpDir, "delta.txt", "");
    const events = [];
    mgr.onOutput((e) => events.push(e));
    mgr.startWatching("task-delta", p, "worker-delta");

    // Give fs.watch a moment to attach before writing
    await new Promise((r) => setTimeout(r, 100));
    fs.appendFileSync(p, "alpha\nbeta\n");

    await waitFor(() => events.some((e) => e.lines.includes("beta")), 4000);
    const merged = events.flatMap((e) => e.lines);
    assert.ok(merged.includes("alpha"), "alpha present");
    assert.ok(merged.includes("beta"), "beta present");
  });

  it("ring buffer caps at 200 lines", async () => {
    const p = makeTmpFile(tmpDir, "ring.txt", "");
    mgr.startWatching("task-ring", p);
    // Give watcher time to attach
    await new Promise((r) => setTimeout(r, 100));
    // Write 250 lines
    const content = Array.from({ length: 250 }, (_, i) => `line${i}`).join(
      "\n",
    );
    fs.appendFileSync(p, content + "\n");
    await waitFor(() => mgr.getBuffer("task-ring").length >= 200, 4000);
    assert.ok(
      mgr.getBuffer("task-ring").length <= 200,
      "buffer capped at 200",
    );
  });

  // ── stopAll ────────────────────────────────────────────────────────────

  it("stopAll removes all watchers", () => {
    makeTmpFile(tmpDir, "a.txt", "");
    makeTmpFile(tmpDir, "b.txt", "");
    mgr.startWatching("task-a", path.join(tmpDir, "a.txt"));
    mgr.startWatching("task-b", path.join(tmpDir, "b.txt"));
    assert.equal(mgr.workers.size, 2);
    mgr.stopAll();
    assert.equal(mgr.workers.size, 0);
  });

  // ── onOutput ──────────────────────────────────────────────────────────

  it("onOutput callback receives correct shape", async () => {
    const p = makeTmpFile(tmpDir, "shape.txt", "hello\nworld\n");
    let received;
    mgr.onOutput((e) => {
      received = e;
    });
    mgr.startWatching("task-shape", p, "my-worker");
    await waitFor(() => received !== undefined);
    assert.equal(received.task_id, "task-shape");
    assert.equal(received.worker_name, "my-worker");
    assert.ok(Array.isArray(received.lines));
    assert.ok(typeof received.total_lines === "number");
    assert.ok(typeof received.timestamp === "string");
  });

  // ── MAX_WATCHERS ───────────────────────────────────────────────────────

  it("exceeding MAX_WATCHERS (20) does not throw", () => {
    assert.doesNotThrow(() => {
      for (let i = 0; i < 22; i++) {
        const p = makeTmpFile(tmpDir, `max${i}.txt`, "");
        mgr.startWatching(`task-max-${i}`, p);
      }
    });
  });
});
