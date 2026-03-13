import test from "node:test";
import assert from "node:assert/strict";
import {
  FOCUSED_ROUTE_MODE_PREFERENCE,
  classifySidecarFreshness,
  cycleIndex,
  LIVE_ROUTE_LABEL,
  LIVE_ROUTE_MODE,
  LIVE_FRESHNESS,
  selectFocusedTeammateRoute,
} from "../core/teammate-live.js";

test("focused teammate route prefers native live when native identity exists", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: true,
    hasNativeIdentity: true,
    sidecarLiveAvailable: true,
    hasTmuxMirror: true,
  });
  assert.equal(out.route_mode, "native-live");
  assert.equal(out.route_label, "native live");
  assert.match(String(out.source_truth || ""), /not in-process/i);
});

test("focused teammate route publishes explicit route preference ordering", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: false,
    sidecarLiveAvailable: true,
  });
  assert.deepEqual(out.route_mode_preference, [...FOCUSED_ROUTE_MODE_PREFERENCE]);
  assert.deepEqual(out.stream_fallback_order, [
    LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.NATIVE],
    LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.SIDECAR],
    LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.TMUX],
  ]);
});

test("focused teammate route uses sidecar live before tmux mirror", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: false,
    hasNativeIdentity: false,
    sidecarLiveAvailable: true,
    hasTmuxMirror: true,
  });
  assert.equal(out.route_mode, "sidecar-live");
  assert.equal(out.route_label, "sidecar live");
  assert.equal(out.fallback_reason, null);
});

test("focused teammate route uses tmux mirror only as fallback", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: false,
    hasNativeIdentity: false,
    sidecarLiveAvailable: false,
    hasTmuxMirror: true,
  });
  assert.equal(out.route_mode, "tmux-mirror");
  assert.equal(out.route_label, "tmux mirror");
  assert.match(out.route_reason, /fallback/i);
  assert.match(out.fallback_reason, /fallback/i);
});

test("focused teammate route marks stale sidecar stream before tmux fallback", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: false,
    hasNativeIdentity: false,
    sidecarLiveAvailable: false,
    sidecarFreshness: LIVE_FRESHNESS.STALE,
    liveAgeMs: 8_000,
    staleAfterMs: 6_000,
    hasTmuxMirror: true,
  });
  assert.equal(out.route_mode, "tmux-mirror");
  assert.equal(out.freshness, LIVE_FRESHNESS.STALE);
  assert.equal(out.live_age_ms, 8_000);
  assert.match(String(out.fallback_reason || ""), /stale/i);
});

test("stale freshness never routes sidecar-live even if sidecar availability is stale-incorrect", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: false,
    hasNativeIdentity: false,
    sidecarLiveAvailable: true,
    sidecarFreshness: LIVE_FRESHNESS.STALE,
    liveAgeMs: 12_000,
    staleAfterMs: 6_000,
    hasTmuxMirror: true,
  });
  assert.equal(out.route_mode, "tmux-mirror");
  assert.equal(out.freshness, LIVE_FRESHNESS.STALE);
  assert.match(String(out.fallback_reason || ""), /stale/i);
});

test("focused teammate route falls back to sidecar metadata when no mirror exists", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: false,
    hasNativeIdentity: false,
    sidecarLiveAvailable: false,
    hasTmuxMirror: false,
  });
  assert.equal(out.route_mode, "sidecar-live");
  assert.match(out.route_reason, /snapshot|fallback/i);
  assert.match(out.fallback_reason, /snapshot|fallback/i);
});

test("focused teammate route never labels native live without native identity", () => {
  const out = selectFocusedTeammateRoute({
    nativeAvailable: true,
    hasNativeIdentity: false,
    sidecarLiveAvailable: true,
    hasTmuxMirror: true,
  });
  assert.equal(out.route_mode, "sidecar-live");
  assert.ok(!String(out.route_label || "").includes("native"));
});

test("sidecar freshness transitions from fresh to stale to no-live-signal", () => {
  const now = 100_000;
  const fresh = classifySidecarFreshness({
    updatedAtMs: now - 1000,
    nowMs: now,
    staleAfterMs: 6000,
  });
  assert.equal(fresh.freshness, LIVE_FRESHNESS.FRESH);
  assert.equal(fresh.live_age_ms, 1000);

  const stale = classifySidecarFreshness({
    updatedAtMs: now - 7000,
    nowMs: now,
    staleAfterMs: 6000,
  });
  assert.equal(stale.freshness, LIVE_FRESHNESS.STALE);
  assert.equal(stale.live_age_ms, 7000);

  const none = classifySidecarFreshness({
    updatedAtMs: 0,
    nowMs: now,
    staleAfterMs: 6000,
  });
  assert.equal(none.freshness, LIVE_FRESHNESS.NONE);
  assert.equal(none.live_age_ms, null);

  const edge = classifySidecarFreshness({
    updatedAtMs: now - 6000,
    nowMs: now,
    staleAfterMs: 6000,
  });
  assert.equal(edge.freshness, LIVE_FRESHNESS.FRESH);
});

test("cycleIndex wraps in both directions for teammate selection", () => {
  assert.equal(cycleIndex(0, -1, 4), 3);
  assert.equal(cycleIndex(3, 1, 4), 0);
  assert.equal(cycleIndex(2, 5, 4), 3);
  assert.equal(cycleIndex(1, -9, 4), 0);
  assert.equal(cycleIndex(0, 1, 0), 0);
  assert.equal(cycleIndex(undefined, 1, 3), 1);
});

test("cycleIndex stays deterministic under fast repeated teammate cycling", () => {
  const size = 7;
  let idx = 0;
  for (let i = 0; i < 10_000; i += 1) {
    const delta = i % 2 === 0 ? 1 : -2;
    idx = cycleIndex(idx, delta, size);
  }
  assert.equal(idx, 5);
  assert.equal(cycleIndex(idx, 70_001, size), 6);
  assert.equal(cycleIndex(idx, -70_001, size), 4);
});
