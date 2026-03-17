import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import net from "net";
import { OutputStreamManager } from "../core/output-stream.js";

function tmpFile(dir) {
  const p = path.join(dir, `test-output-${Date.now()}.txt`);
  fs.writeFileSync(p, "");
  return p;
}

test("startWatching emits output event on file append", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-"));
  const filePath = tmpFile(dir);
  const mgr = new OutputStreamManager();

  const received = [];
  mgr.onOutput((data) => received.push(data));
  mgr.startWatching("task-1", filePath, "worker-a");

  // Give the watcher time to attach
  await new Promise((r) => setTimeout(r, 50));

  fs.appendFileSync(filePath, "hello world\n");

  // Wait for fs.watch / fs.watchFile to fire
  await new Promise((r) => setTimeout(r, 400));

  mgr.stopAll();
  fs.rmSync(dir, { recursive: true, force: true });

  assert.ok(received.length > 0, "Should have received at least one output event");
  assert.equal(received[0].task_id, "task-1");
  assert.equal(received[0].worker_name, "worker-a");
  assert.ok(received[0].lines.includes("hello world"));
});

test("ring buffer caps at 200 lines", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-ring-"));
  const filePath = path.join(dir, "output.txt");
  // Write 250 lines
  const lines = Array.from({ length: 250 }, (_, i) => `line-${i}`).join("\n") + "\n";
  fs.writeFileSync(filePath, lines);

  const mgr = new OutputStreamManager();
  mgr.startWatching("task-ring", filePath, "worker-b");

  // _readDelta fires synchronously on attach via initial read
  const buffer = mgr.getBuffer("task-ring");
  mgr.stopAll();
  fs.rmSync(dir, { recursive: true, force: true });

  assert.ok(buffer.length <= 200, `Buffer should be capped at 200, got ${buffer.length}`);
  // Last line should be line-249
  assert.equal(buffer[buffer.length - 1], "line-249");
});

test("getBuffer returns empty array for unknown task", () => {
  const mgr = new OutputStreamManager();
  const result = mgr.getBuffer("nonexistent");
  assert.deepEqual(result, []);
});

test("stopWatching removes the task from workers map", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-stop-"));
  const filePath = tmpFile(dir);
  const mgr = new OutputStreamManager();

  mgr.startWatching("task-stop", filePath, "worker-c");
  assert.ok(mgr.workers.has("task-stop"));

  mgr.stopWatching("task-stop");
  assert.ok(!mgr.workers.has("task-stop"));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("startWatching is idempotent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-idem-"));
  const filePath = tmpFile(dir);
  const mgr = new OutputStreamManager();

  mgr.startWatching("task-idem", filePath, "w1");
  mgr.startWatching("task-idem", filePath, "w1"); // second call should be no-op
  assert.equal(mgr.workers.size, 1);

  mgr.stopAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("stopAll clears all watchers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-all-"));
  const f1 = tmpFile(dir);
  const f2 = tmpFile(dir);
  const mgr = new OutputStreamManager();

  mgr.startWatching("t1", f1, "w1");
  mgr.startWatching("t2", f2, "w2");
  assert.equal(mgr.workers.size, 2);

  mgr.stopAll();
  assert.equal(mgr.workers.size, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("socket streaming: receives output via Unix socket when available", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-sock-"));
  const filePath = path.join(dir, "output.txt");
  fs.writeFileSync(filePath, "");
  const taskId = "sock-test-" + Date.now();
  const socketPath = `/tmp/claude-worker-${taskId}.sock`;

  // Clean up stale socket if any
  try { fs.unlinkSync(socketPath); } catch {}

  // Create a mock Unix socket server (simulates the output-forwarder)
  const server = net.createServer();
  const connections = [];
  server.on("connection", (conn) => connections.push(conn));

  await new Promise((resolve) => server.listen(socketPath, resolve));

  const mgr = new OutputStreamManager();
  const received = [];
  mgr.onOutput((data) => received.push(data));
  mgr.startWatching(taskId, filePath, "socket-worker");

  // Wait for the socket connection to be established
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Send lines through the socket (simulating worker output)
  for (const conn of connections) {
    conn.write("line 1\nline 2\nline 3\n");
  }

  await new Promise((resolve) => setTimeout(resolve, 100));

  mgr.stopAll();
  server.close();
  try { fs.unlinkSync(socketPath); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });

  assert.ok(received.length > 0, "Should have received output events");
  const allLines = received.flatMap((r) => r.lines);
  assert.ok(allLines.includes("line 1"), "Should contain line 1");
  assert.ok(allLines.includes("line 2"), "Should contain line 2");
  assert.ok(allLines.includes("line 3"), "Should contain line 3");
  assert.equal(received[0].worker_name, "socket-worker");
});

test("socket streaming: falls back to file watching when no socket exists", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "osm-nosock-"));
  const filePath = path.join(dir, "output.txt");
  fs.writeFileSync(filePath, "");

  const mgr = new OutputStreamManager();
  const received = [];
  mgr.onOutput((data) => received.push(data));
  mgr.startWatching("nosock-test", filePath, "file-worker");

  // No socket exists — should fall back to file watching immediately
  // Write to file and wait for watcher to pick it up
  // fs.watch can be slow on macOS — give it time to set up + detect change
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.appendFileSync(filePath, "file line 1\nfile line 2\n");
  await new Promise((resolve) => setTimeout(resolve, 600));

  mgr.stopAll();
  fs.rmSync(dir, { recursive: true, force: true });

  assert.ok(received.length > 0, "Should receive output from file watcher fallback");
  const allLines = received.flatMap((r) => r.lines);
  assert.ok(allLines.includes("file line 1"), "Should contain file line 1");
});
