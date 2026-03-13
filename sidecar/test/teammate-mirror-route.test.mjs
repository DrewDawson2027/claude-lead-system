import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), "sidecar-mirror-route-"));
  const terminals = join(home, ".claude", "terminals");
  mkdirSync(join(terminals, "teams"), { recursive: true });
  mkdirSync(join(terminals, "tasks"), { recursive: true });
  mkdirSync(join(terminals, "results"), { recursive: true });

  const now = new Date().toISOString();
  writeFileSync(
    join(terminals, "teams", "mirror-team.json"),
    JSON.stringify({
      team_name: "mirror-team",
      execution_path: "hybrid",
      low_overhead_mode: "simple",
      members: [{ name: "alice", role: "implementer", task_id: "W123" }],
      policy: {},
      created: now,
      updated: now,
    }),
  );
  writeFileSync(
    join(terminals, "results", "W123.transcript"),
    "line one\nline two\nline three from transcript fallback\n",
  );
  return home;
}

function requestJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(raw || "{}"),
            });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: raw });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("focused teammate mirror route returns explicit tmux-mirror metadata", async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const team = await requestJson(sidecar.port, "/v1/teams/mirror-team");
    assert.equal(team.status, 200);
    assert.deepEqual(
      team.body.focused_teammate_live?.stream_fallback_order,
      ["native live", "sidecar live", "tmux mirror"],
    );
    assert.deepEqual(
      team.body.focused_teammate_live?.route_mode_preference,
      ["native-live", "sidecar-live", "tmux-mirror"],
    );
    const teammate = (team.body.teammates || [])[0];
    assert.ok(teammate?.id);

    const mirror = await requestJson(
      sidecar.port,
      `/v1/teams/mirror-team/teammates/${encodeURIComponent(teammate.id)}/mirror`,
    );
    assert.equal(mirror.status, 200);
    assert.equal(mirror.body.ok, true);
    assert.equal(mirror.body.route_mode, "tmux-mirror");
    assert.equal(mirror.body.route_label, "tmux mirror");
    assert.deepEqual(
      mirror.body.route_mode_preference,
      ["native-live", "sidecar-live", "tmux-mirror"],
    );
    assert.deepEqual(
      mirror.body.stream_fallback_order,
      ["native live", "sidecar live", "tmux mirror"],
    );
    assert.match(String(mirror.body.route_reason || ""), /fallback/i);
    assert.equal(mirror.body.freshness, "fallback");
    assert.match(String(mirror.body.fallback_reason || ""), /fallback/i);
    assert.match(String(mirror.body.source_truth || ""), /tmux/i);
    assert.ok(
      !/native live|in-process parity/i.test(
        `${mirror.body.route_mode || ""} ${mirror.body.route_label || ""} ${mirror.body.source_truth || ""}`,
      ),
      "tmux mirror route must not be labeled as native live/in-process",
    );
    assert.match(
      String(mirror.body.output || ""),
      /transcript fallback/i,
      "expected transcript fallback output",
    );
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});
