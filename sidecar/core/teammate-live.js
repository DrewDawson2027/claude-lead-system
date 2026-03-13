export const LIVE_ROUTE_MODE = Object.freeze({
  NATIVE: "native-live",
  SIDECAR: "sidecar-live",
  TMUX: "tmux-mirror",
});

export const LIVE_ROUTE_LABEL = Object.freeze({
  [LIVE_ROUTE_MODE.NATIVE]: "native live",
  [LIVE_ROUTE_MODE.SIDECAR]: "sidecar live",
  [LIVE_ROUTE_MODE.TMUX]: "tmux mirror",
});

export const LIVE_FRESHNESS = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  NONE: "no-live-signal",
});

export const DEFAULT_LIVE_STALE_AFTER_MS = 6000;
export const FOCUSED_ROUTE_MODE_PREFERENCE = Object.freeze([
  LIVE_ROUTE_MODE.NATIVE,
  LIVE_ROUTE_MODE.SIDECAR,
  LIVE_ROUTE_MODE.TMUX,
]);
export const FOCUSED_STREAM_FALLBACK_ORDER = Object.freeze([
  LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.NATIVE],
  LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.SIDECAR],
  LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.TMUX],
]);

export function cycleIndex(current, delta, length) {
  const size = Number(length) || 0;
  if (size <= 0) return 0;
  const idx = Number(current) || 0;
  const shift = Number(delta) || 0;
  return ((idx + shift) % size + size) % size;
}

export function classifySidecarFreshness({
  updatedAtMs = 0,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_LIVE_STALE_AFTER_MS,
} = {}) {
  const updated = Number(updatedAtMs) || 0;
  const threshold = Number(staleAfterMs) || DEFAULT_LIVE_STALE_AFTER_MS;
  if (!updated) {
    return {
      freshness: LIVE_FRESHNESS.NONE,
      live_age_ms: null,
      stale_after_ms: threshold,
    };
  }
  const age = Math.max(0, Number(nowMs) - updated);
  return {
    freshness: age <= threshold ? LIVE_FRESHNESS.FRESH : LIVE_FRESHNESS.STALE,
    live_age_ms: age,
    stale_after_ms: threshold,
  };
}

export function selectFocusedTeammateRoute({
  nativeAvailable = false,
  hasNativeIdentity = false,
  sidecarLiveAvailable = false,
  sidecarFreshness = null,
  liveAgeMs = null,
  staleAfterMs = DEFAULT_LIVE_STALE_AFTER_MS,
  hasTmuxMirror = false,
} = {}) {
  const freshness = [
    LIVE_FRESHNESS.FRESH,
    LIVE_FRESHNESS.STALE,
    LIVE_FRESHNESS.NONE,
  ].includes(sidecarFreshness)
    ? sidecarFreshness
    : sidecarLiveAvailable
      ? LIVE_FRESHNESS.FRESH
      : LIVE_FRESHNESS.NONE;
  const sidecarRouteEligible =
    freshness !== LIVE_FRESHNESS.STALE &&
    (sidecarLiveAvailable || freshness === LIVE_FRESHNESS.FRESH);
  const base = {
    freshness,
    live_age_ms: Number.isFinite(Number(liveAgeMs)) ? Number(liveAgeMs) : null,
    stale_after_ms: Number(staleAfterMs) || DEFAULT_LIVE_STALE_AFTER_MS,
    route_mode_preference: [...FOCUSED_ROUTE_MODE_PREFERENCE],
    stream_fallback_order: [...FOCUSED_STREAM_FALLBACK_ORDER],
  };
  if (nativeAvailable && hasNativeIdentity) {
    return {
      ...base,
      route_mode: LIVE_ROUTE_MODE.NATIVE,
      route_label: LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.NATIVE],
      route_reason: "native adapter available with teammate native identity",
      fallback_reason: null,
      source_truth: "native adapter live state mirror (not in-process rendering)",
    };
  }
  if (sidecarRouteEligible) {
    return {
      ...base,
      route_mode: LIVE_ROUTE_MODE.SIDECAR,
      route_label: LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.SIDECAR],
      route_reason: "runtime/SSE teammate stream available",
      fallback_reason: null,
      source_truth: "sidecar runtime live state stream",
    };
  }
  if (hasTmuxMirror) {
    const fallbackReason =
      freshness === LIVE_FRESHNESS.STALE
        ? "sidecar live stream stale; tmux mirror fallback"
        : "native and sidecar live streams unavailable; tmux mirror fallback";
    return {
      ...base,
      route_mode: LIVE_ROUTE_MODE.TMUX,
      route_label: LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.TMUX],
      route_reason: fallbackReason,
      fallback_reason: fallbackReason,
      source_truth: "tmux terminal mirror fallback",
    };
  }
  const fallbackReason =
    freshness === LIVE_FRESHNESS.STALE
      ? "sidecar live stream stale and no tmux mirror; snapshot metadata fallback"
      : "fallback to runtime snapshot metadata only";
  return {
    ...base,
    route_mode: LIVE_ROUTE_MODE.SIDECAR,
    route_label: LIVE_ROUTE_LABEL[LIVE_ROUTE_MODE.SIDECAR],
    route_reason: fallbackReason,
    fallback_reason: fallbackReason,
    source_truth: "sidecar snapshot metadata only",
  };
}
