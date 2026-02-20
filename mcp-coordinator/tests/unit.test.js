import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { sanitizeId, sanitizeModel, readJSON, readJSONL, getSessionStatus, timeAgo } from "../lib.js";

// ─── sanitizeId ───────────────────────────────────────────

test("sanitizeId: accepts alphanumeric", () => {
  assert.equal(sanitizeId("abc123"), "abc123");
});

test("sanitizeId: accepts hyphen, underscore, dot", () => {
  assert.equal(sanitizeId("my-task_1.2"), "my-task_1.2");
});

test("sanitizeId: rejects path traversal", () => {
  assert.equal(sanitizeId("../etc/passwd"), null);
  assert.equal(sanitizeId(".."), null);
  assert.equal(sanitizeId("foo..bar"), null);
});

test("sanitizeId: rejects shell metacharacters", () => {
  assert.equal(sanitizeId("foo;rm -rf /"), null);
  assert.equal(sanitizeId("$(evil)"), null);
  assert.equal(sanitizeId("foo|bar"), null);
  assert.equal(sanitizeId("foo&bar"), null);
});

test("sanitizeId: rejects empty string", () => {
  assert.equal(sanitizeId(""), null);
});

test("sanitizeId: rejects null/undefined", () => {
  assert.equal(sanitizeId(null), null);
  assert.equal(sanitizeId(undefined), null);
});

test("sanitizeId: rejects value over 128 chars", () => {
  assert.equal(sanitizeId("a".repeat(129)), null);
});

test("sanitizeId: accepts exactly 128 chars", () => {
  const v = "a".repeat(128);
  assert.equal(sanitizeId(v), v);
});

// ─── sanitizeModel ────────────────────────────────────────

test("sanitizeModel: returns valid model as-is", () => {
  assert.equal(sanitizeModel("claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.equal(sanitizeModel("haiku"), "haiku");
  assert.equal(sanitizeModel("sonnet"), "sonnet");
});

test("sanitizeModel: returns 'sonnet' for null/undefined", () => {
  assert.equal(sanitizeModel(null), "sonnet");
  assert.equal(sanitizeModel(undefined), "sonnet");
});

test("sanitizeModel: returns 'sonnet' for invalid model", () => {
  assert.equal(sanitizeModel("model; rm -rf /"), "sonnet");
  assert.equal(sanitizeModel("../../bin/sh"), "sonnet");
});

// ─── readJSON ─────────────────────────────────────────────

test("readJSON: returns null for missing file", () => {
  assert.equal(readJSON("/tmp/nonexistent-file-xyz.json"), null);
});

test("readJSON: returns null for malformed JSON", () => {
  const f = join(tmpdir(), "test-malformed.json");
  writeFileSync(f, "{not valid json}");
  assert.equal(readJSON(f), null);
  rmSync(f);
});

test("readJSON: parses valid JSON", () => {
  const f = join(tmpdir(), "test-valid.json");
  writeFileSync(f, JSON.stringify({ key: "value", num: 42 }));
  const result = readJSON(f);
  assert.deepEqual(result, { key: "value", num: 42 });
  rmSync(f);
});

// ─── readJSONL ────────────────────────────────────────────

test("readJSONL: returns empty array for missing file", () => {
  assert.deepEqual(readJSONL("/tmp/nonexistent-file-xyz.jsonl"), []);
});

test("readJSONL: parses valid JSONL", () => {
  const f = join(tmpdir(), "test.jsonl");
  writeFileSync(f, '{"a":1}\n{"b":2}\n');
  const result = readJSONL(f);
  assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
  rmSync(f);
});

test("readJSONL: skips malformed lines", () => {
  const f = join(tmpdir(), "test-mixed.jsonl");
  writeFileSync(f, '{"a":1}\nbad line\n{"c":3}\n');
  const result = readJSONL(f);
  assert.deepEqual(result, [{ a: 1 }, { c: 3 }]);
  rmSync(f);
});

// ─── getSessionStatus ─────────────────────────────────────

test("getSessionStatus: returns 'closed' for closed status", () => {
  assert.equal(getSessionStatus({ status: "closed" }), "closed");
});

test("getSessionStatus: returns 'stale' for stale status", () => {
  assert.equal(getSessionStatus({ status: "stale" }), "stale");
});

test("getSessionStatus: returns 'unknown' when no last_active", () => {
  assert.equal(getSessionStatus({ status: "active" }), "unknown");
});

test("getSessionStatus: returns 'active' for recent last_active (<3min)", () => {
  const recent = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
  assert.equal(getSessionStatus({ status: "active", last_active: recent }), "active");
});

test("getSessionStatus: returns 'idle' for 3-10min old last_active", () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.equal(getSessionStatus({ status: "active", last_active: fiveMinAgo }), "idle");
});

test("getSessionStatus: returns 'stale' for >10min old last_active", () => {
  const oldTs = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  assert.equal(getSessionStatus({ status: "active", last_active: oldTs }), "stale");
});

// ─── timeAgo ──────────────────────────────────────────────

test("timeAgo: returns 'unknown' for null", () => {
  assert.equal(timeAgo(null), "unknown");
});

test("timeAgo: formats seconds", () => {
  const ts = new Date(Date.now() - 30 * 1000).toISOString();
  assert.match(timeAgo(ts), /^\d+s ago$/);
});

test("timeAgo: formats minutes", () => {
  const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.match(timeAgo(ts), /^\d+m ago$/);
});

test("timeAgo: formats hours", () => {
  const ts = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  assert.match(timeAgo(ts), /^\d+h ago$/);
});

test("timeAgo: formats days", () => {
  const ts = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  assert.match(timeAgo(ts), /^\d+d ago$/);
});
