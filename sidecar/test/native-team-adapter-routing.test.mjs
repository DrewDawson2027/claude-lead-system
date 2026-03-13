import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sidecarPaths } from "../core/paths.js";
import { NativeTeamAdapter } from "../adapters/native-team-adapter.js";

function withTempHome(fn) {
  const prevHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "sidecar-native-adapter-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  process.env.HOME = home;
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    });
}

test("native adapter uses native-direct before bridge for task", async () =>
  withTempHome(async () => {
    let runnerCalls = 0;
    let bridgeCalls = 0;
    const adapter = new NativeTeamAdapter({
      paths: sidecarPaths(),
      runner: {
        async run() {
          runnerCalls += 1;
          return { ok: true, native_tool: "Task", result: { task_id: "T1" } };
        },
      },
      bridgeController: {
        getHealth() {
          return { bridge_status: "healthy", session_id: "bridge001" };
        },
        async ensureBridge() {
          return { ok: true, bridge_status: "healthy" };
        },
        async execute() {
          bridgeCalls += 1;
          return { ok: true };
        },
      },
      store: { raiseAlert() {}, emitBridgeStatus() {} },
    });
    adapter.health = async () => ({
      capabilities: { available: true },
      bridge: { bridge_status: "healthy", session_id: "bridge001" },
    });

    const out = await adapter.execute("task", { task: "do work", team_name: "alpha" });
    assert.equal(out.ok, true);
    assert.equal(out.path_mode, "native-direct");
    assert.equal(out.route_mode, "native-direct");
    assert.equal(Array.isArray(out.fallback_history), true);
    assert.equal(out.fallback_history.length, 0);
    assert.equal(out.probe_source, "native-runner");
    assert.equal(runnerCalls, 1);
    assert.equal(bridgeCalls, 0);
  }));

test("native adapter falls back from native-direct to bridge", async () =>
  withTempHome(async () => {
    let runnerCalls = 0;
    let bridgeCalls = 0;
    const adapter = new NativeTeamAdapter({
      paths: sidecarPaths(),
      runner: {
        async run() {
          runnerCalls += 1;
          return {
            ok: false,
            native_tool: "Task",
            error: { code: "native_failed", message: "native failed" },
          };
        },
      },
      bridgeController: {
        getHealth() {
          return { bridge_status: "healthy", session_id: "bridge001" };
        },
        async ensureBridge() {
          return { ok: true, bridge_status: "healthy" };
        },
        async execute() {
          bridgeCalls += 1;
          return {
            ok: true,
            native_tool: "Task",
            result: { task_id: "T2" },
            bridge_session_id: "bridge001",
          };
        },
      },
      store: { raiseAlert() {}, emitBridgeStatus() {} },
    });
    adapter.health = async () => ({
      capabilities: { available: true },
      bridge: { bridge_status: "healthy", session_id: "bridge001" },
    });

    const out = await adapter.execute("task", { task: "resume", team_name: "alpha" });
    assert.equal(out.ok, true);
    assert.equal(out.path_mode, "bridge");
    assert.equal(out.route_mode, "bridge");
    assert.match(out.route_reason, /native-direct failed/i);
    assert.equal(Array.isArray(out.fallback_history), true);
    assert.equal(out.fallback_history.length, 2);
    assert.equal(out.fallback_history[0]?.route_mode, "native-direct");
    assert.equal(out.fallback_history[1]?.route_mode, "bridge");
    assert.equal(out.probe_source, "bridge-controller");
    assert.equal(runnerCalls, 1);
    assert.equal(bridgeCalls, 1);
  }));

test("native adapter returns explicit fallback-required error when native-direct and bridge fail", async () =>
  withTempHome(async () => {
    const adapter = new NativeTeamAdapter({
      paths: sidecarPaths(),
      runner: {
        async run() {
          return {
            ok: false,
            native_tool: "SendMessage",
            error: { code: "native_failed", message: "native failed" },
          };
        },
      },
      bridgeController: {
        getHealth() {
          return { bridge_status: "healthy", session_id: "bridge001" };
        },
        async ensureBridge() {
          return { ok: true, bridge_status: "healthy" };
        },
        async execute() {
          throw new Error("bridge_failed");
        },
      },
      store: { raiseAlert() {}, emitBridgeStatus() {} },
    });
    adapter.health = async () => ({
      capabilities: { available: true },
      bridge: { bridge_status: "healthy", session_id: "bridge001" },
    });

    const out = await adapter.execute("message", {
      content: "hello",
      team_name: "alpha",
      target_name: "worker-a",
    });
    assert.equal(out.ok, false);
    assert.equal(out.fallback_required, true);
    assert.equal(out.route_mode, "coordinator");
    assert.match(out.route_reason, /coordinator fallback required/i);
    assert.equal(Array.isArray(out.fallback_history), true);
    assert.equal(out.fallback_history.length, 2);
    assert.equal(out.probe_source, "unknown");
  }));

test("native adapter uses bridge when native capability is unavailable but bridge is healthy", async () =>
  withTempHome(async () => {
    let bridgeCalls = 0;
    const adapter = new NativeTeamAdapter({
      paths: sidecarPaths(),
      runner: { async run() { throw new Error("should not execute native-direct"); } },
      bridgeController: {
        getHealth() {
          return { bridge_status: "healthy", session_id: "bridge007" };
        },
        async ensureBridge() {
          return { ok: true, bridge_status: "healthy", session_id: "bridge007" };
        },
        async execute() {
          bridgeCalls += 1;
          return { ok: true, native_tool: "SendMessage", result: { delivered: true } };
        },
      },
      store: { raiseAlert() {}, emitBridgeStatus() {} },
    });
    adapter.health = async () => ({
      capabilities: {
        available: false,
        last_probe_error: "tool_unavailable",
      },
      bridge: { bridge_status: "healthy", session_id: "bridge007" },
      route_mode: "bridge",
      route_reason: "native unavailable; bridge healthy",
    });

    const out = await adapter.execute("message", {
      content: "hello",
      team_name: "alpha",
      target_name: "worker-b",
    });
    assert.equal(out.ok, true);
    assert.equal(out.route_mode, "bridge");
    assert.match(String(out.route_reason || ""), /native unavailable/i);
    assert.equal(Array.isArray(out.fallback_history), true);
    assert.equal(out.fallback_history.length, 2);
    assert.equal(out.fallback_history[0]?.route_mode, "native-direct");
    assert.equal(out.fallback_history[1]?.route_mode, "bridge");
    assert.equal(out.probe_source, "bridge-controller");
    assert.equal(bridgeCalls, 1);
  }));

test("native adapter returns explicit coordinator reason when native and bridge are unavailable", async () =>
  withTempHome(async () => {
    const adapter = new NativeTeamAdapter({
      paths: sidecarPaths(),
      runner: { async run() { throw new Error("should not execute native-direct"); } },
      bridgeController: {
        getHealth() {
          return { bridge_status: "down", session_id: null };
        },
        async ensureBridge() {
          return { ok: false, status: "down", error: "bridge_not_running" };
        },
        async execute() {
          throw new Error("bridge_not_running");
        },
      },
      store: { raiseAlert() {}, emitBridgeStatus() {} },
    });
    adapter.health = async () => ({
      capabilities: {
        available: false,
        last_probe_error: "tool_unavailable",
      },
      bridge: { bridge_status: "down", session_id: null },
      route_mode: "coordinator",
      route_reason: "native and bridge are unavailable",
    });

    const out = await adapter.execute("task", {
      task: "recover",
      team_name: "alpha",
    });
    assert.equal(out.ok, false);
    assert.equal(out.fallback_required, true);
    assert.equal(out.route_mode, "coordinator");
    assert.match(String(out.route_reason || ""), /coordinator fallback required/i);
    assert.equal(Array.isArray(out.fallback_history), true);
    assert.equal(out.fallback_history.length, 2);
    assert.equal(out.fallback_history[0]?.route_mode, "native-direct");
    assert.equal(out.fallback_history[1]?.route_mode, "bridge");
    assert.equal(out.probe_source, "unknown");
  }));
