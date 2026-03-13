#!/usr/bin/env node
import http from "http";
import readline from "readline";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  cycleIndex,
  classifySidecarFreshness,
  DEFAULT_LIVE_STALE_AFTER_MS,
  LIVE_FRESHNESS,
  selectFocusedTeammateRoute,
} from "../core/teammate-live.js";

const host = process.env.LEAD_SIDECAR_HOST || "127.0.0.1";
let sidecarPort =
  Number(process.env.LEAD_SIDECAR_PORT || process.argv[2]) || null;
let sidecarToken = process.env.LEAD_SIDECAR_API_TOKEN || null;

// ── ANSI Colors ──
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

const state = {
  teams: [],
  selectedTeamIdx: 0,
  selectedActionIdx: 0,
  detail: null,
  native: null,
  actions: [],
  alerts: [],
  interrupts: [],
  approvals: [],
  message: "",
  forcePath: "",
  metrics: null,
  focusMode: "all",
  viewMode: "main", // 'main' | 'approval' | 'teammate' | 'split'
  selectedApprovalIdx: 0,
  selectedMemberIdx: 0,
  selectedInterruptIdx: 0,
  autoRefreshInterval: 5000,
  autoRefreshTimer: null,
  teammateRefreshTimer: null,
  liveTeammatesById: new Map(),
  liveTeammatesAtMs: 0,
  focusedRoute: null,
  sseConnected: false,
  sseRequest: null,
  sseReconnectTimer: null,
};

// ── HTTP Client ──

function request(path, method = "GET", body = null) {
  const targetPath = String(path || "");
  const apiPath = targetPath.startsWith("/v1/")
    ? targetPath
    : targetPath.startsWith("/")
      ? `/v1${targetPath}`
      : `/v1/${targetPath}`;
  const targetPort = sidecarPort || 0;
  if (!targetPort)
    return Promise.reject(new Error("Port not set. Use LEAD_SIDECAR_PORT."));
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (sidecarToken) headers.Authorization = `Bearer ${sidecarToken}`;
    const req = http.request(
      { host, port: targetPort, path: apiPath, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw || "{}");
            if (res.statusCode >= 400)
              reject(
                new Error(
                  parsed.error ||
                  parsed.reason ||
                  raw ||
                  `HTTP ${res.statusCode}`,
                ),
              );
            else resolve(parsed);
          } catch {
            if (res.statusCode >= 400)
              reject(new Error(raw || `HTTP ${res.statusCode}`));
            else resolve(raw);
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function discoverPort() {
  if (sidecarPort) return sidecarPort;
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  try {
    const runtimeDir = path.join(
      process.env.HOME || os.homedir(),
      ".claude",
      "lead-sidecar",
      "runtime",
    );
    const p = JSON.parse(
      fs.readFileSync(path.join(runtimeDir, "sidecar.port"), "utf-8"),
    );
    sidecarPort = p.port;
    try {
      sidecarToken =
        JSON.parse(fs.readFileSync(path.join(runtimeDir, "api.token"), "utf-8"))
          .token || sidecarToken;
    } catch { }
    return sidecarPort;
  } catch {
    return null;
  }
}

// ── Helpers ──

function teamName() {
  return state.teams[state.selectedTeamIdx]?.team_name || null;
}
function clear() {
  process.stdout.write("\x1Bc");
}
function w(text = "") {
  process.stdout.write(text);
}
function line(text = "") {
  process.stdout.write(`${text}\n`);
}
function selectedAction() {
  return state.actions[state.selectedActionIdx] || null;
}

function teammateKey(m) {
  if (!m) return "";
  return String(m.id || `${m.team_name || teamName()}:${m.display_name || m.name || ""}`);
}

function cacheTeammates(teammates = [], atMs = Date.now()) {
  for (const m of teammates) {
    const key = teammateKey(m);
    if (!key) continue;
    state.liveTeammatesById.set(key, { teammate: m, updated_at_ms: atMs });
  }
  if (teammates.length) state.liveTeammatesAtMs = atMs;
}

function selectedTeammate() {
  const teammates = state.detail?.teammates || [];
  if (!teammates.length) return null;
  if (state.selectedMemberIdx >= teammates.length) {
    state.selectedMemberIdx = Math.max(0, teammates.length - 1);
  }
  return teammates[state.selectedMemberIdx] || null;
}

function isNativeAvailable() {
  return Boolean(state.native?.adapter_ok ?? state.native?.native?.available);
}

function focusedFreshnessMeta(teammate) {
  const key = teammateKey(teammate);
  const live = key ? state.liveTeammatesById.get(key) : null;
  return classifySidecarFreshness({
    updatedAtMs: live?.updated_at_ms || 0,
    nowMs: Date.now(),
    staleAfterMs: DEFAULT_LIVE_STALE_AFTER_MS,
  });
}

function formatFreshness(meta) {
  if (!meta || meta.freshness === LIVE_FRESHNESS.NONE) return "no-live-signal";
  const ageS = Math.max(0, Math.round((Number(meta.live_age_ms) || 0) / 1000));
  return `${meta.freshness}:${ageS}s`;
}

function findFocusedInterruptIndex() {
  const interrupts = state.interrupts || state.detail?.interrupts || [];
  if (!interrupts.length) return -1;
  const focused = selectedTeammate();
  const focusedId = focused?.id || null;
  if (!focusedId) return Math.max(0, Math.min(state.selectedInterruptIdx, interrupts.length - 1));
  const matchIdx = interrupts.findIndex(
    (item) => item?.teammate_id && String(item.teammate_id) === String(focusedId),
  );
  if (matchIdx >= 0) return matchIdx;
  return Math.max(0, Math.min(state.selectedInterruptIdx, interrupts.length - 1));
}

function findFocusedApprovalIndex() {
  const approvals = state.approvals || [];
  if (!approvals.length) return -1;
  const focused = selectedTeammate();
  const focusedId = focused?.id || null;
  if (!focusedId) return Math.max(0, Math.min(state.selectedApprovalIdx, approvals.length - 1));
  const matchIdx = approvals.findIndex(
    (item) => item?.teammate_id && String(item.teammate_id) === String(focusedId),
  );
  if (matchIdx >= 0) return matchIdx;
  return Math.max(0, Math.min(state.selectedApprovalIdx, approvals.length - 1));
}

function syncFocusedSelections() {
  const interruptIdx = findFocusedInterruptIndex();
  if (interruptIdx >= 0) state.selectedInterruptIdx = interruptIdx;
  const approvalIdx = findFocusedApprovalIndex();
  if (approvalIdx >= 0) state.selectedApprovalIdx = approvalIdx;
}

function focusedInterruptRecord() {
  const interrupts = state.interrupts || state.detail?.interrupts || [];
  if (!interrupts.length) return null;
  const idx = Math.max(
    0,
    Math.min(state.selectedInterruptIdx, interrupts.length - 1),
  );
  return interrupts[idx] || null;
}

function focusedApprovalRecord() {
  const approvals = state.approvals || [];
  if (!approvals.length) return null;
  const idx = Math.max(0, Math.min(state.selectedApprovalIdx, approvals.length - 1));
  return approvals[idx] || null;
}

function routeModeColor(routeMode = "") {
  if (routeMode === "native-live") return C.green;
  if (routeMode === "tmux-mirror") return C.yellow;
  return C.cyan;
}

function applyFocusedTeammateCycle(delta, { enterFocusedView = true } = {}) {
  const teammates = state.detail?.teammates || [];
  if (!teammates.length) return false;
  state.selectedMemberIdx = cycleIndex(
    state.selectedMemberIdx,
    delta,
    teammates.length,
  );
  syncFocusedSelections();
  if (enterFocusedView && state.viewMode !== "split") {
    state.viewMode = "teammate";
  }
  const m = selectedTeammate();
  const int = focusedInterruptRecord();
  const ap = focusedApprovalRecord();
  const name = m?.display_name || m?.name || m?.id || "-";
  state.message = `focused=${name} interrupt=${int?.code || int?.kind || "none"} approval=${ap?.task_id || "none"}`;
  startTeammateAutoRefresh();
  return true;
}

function resolveFocusedRoute(teammate) {
  const freshness = focusedFreshnessMeta(teammate);
  const sidecarLiveAvailable = freshness.freshness === LIVE_FRESHNESS.FRESH;
  return selectFocusedTeammateRoute({
    nativeAvailable: isNativeAvailable(),
    hasNativeIdentity: Boolean(
      teammate?.native_agent_id || teammate?.claude_session_id,
    ),
    sidecarLiveAvailable,
    sidecarFreshness: freshness.freshness,
    liveAgeMs: freshness.live_age_ms,
    staleAfterMs: freshness.stale_after_ms,
    hasTmuxMirror: Boolean(
      teammate?.tmux_pane_id || teammate?.current_task_ref || teammate?.worker_task_id,
    ),
  });
}

function focusedLiveText(teammate) {
  if (!teammate) return "No teammate selected.";
  const key = teammateKey(teammate);
  const live = key ? state.liveTeammatesById.get(key)?.teammate || teammate : teammate;
  return [
    `presence=${live.presence || "-"}`,
    `task=${live.current_task_ref || live.worker_task_id || "-"}`,
    `session=${live.session_id || "-"}`,
    `agent=${live.native_agent_id || "-"}`,
    `last_tool=${live.last_tool || "-"}`,
    `risk=${(live.risk_flags || []).join(",") || "none"}`,
    `recent_ops=${(live.recent_ops || [])
      .slice(-8)
      .map((x) => x.tool || x.file || "?")
      .join(" | ") || "none"}`,
    `live_freshness=${formatFreshness(focusedFreshnessMeta(teammate))}`,
    "Note: this is not in-process parity; it mirrors native/runtime state.",
  ].join("\n");
}

function cols() {
  return process.stdout.columns || 80;
}
function hr(ch = "─") {
  line(C.dim + ch.repeat(cols()) + C.reset);
}

function box(title) {
  const pad = Math.max(0, cols() - title.length - 4);
  line(`${C.bold}${C.cyan}┌─ ${title} ${C.dim}${"─".repeat(pad)}${C.reset}`);
}

function presenceColor(p) {
  if (!p) return C.dim;
  if (p.includes("active") || p.startsWith("running_")) return C.green;
  if (p === "idle") return C.yellow;
  if (p === "stale" || p === "offline") return C.red;
  if (p.includes("blocked") || p.includes("waiting")) return C.magenta;
  return C.dim;
}

function priorityColor(p) {
  if (p === "critical") return C.bgRed + C.white;
  if (p === "high") return C.red;
  if (p === "low") return C.dim;
  return C.reset;
}

function statusColor(s) {
  if (s === "completed") return C.green;
  if (s === "in_progress") return C.yellow;
  if (s === "failed" || s === "cancelled") return C.red;
  return C.dim;
}

function truncate(s, max) {
  return String(s || "").length > max
    ? String(s).slice(0, max - 1) + "…"
    : String(s || "");
}

function focusVisible(section) {
  const m = state.focusMode;
  if (m === "all") return true;
  const map = {
    approval: ["approvals", "interrupts"],
    dispatch: ["tasks", "queue", "members", "rebalance"],
    recovery: ["alerts", "native", "interrupts"],
  };
  return (map[m] || []).includes(section);
}

// ── Render Functions ──

function renderHeader() {
  const mode =
    state.focusMode === "all" ? "ALL" : state.focusMode.toUpperCase();
  const fp = state.forcePath || "auto";
  const live = state.sseConnected ? "sse:live" : "sse:reconnect";
  line(
    `${C.bold}Lead Sidecar TUI${C.reset}  ${C.dim}focus:${C.cyan}${mode}${C.reset}  ${C.dim}path:${fp}${C.reset}  ${C.dim}view:${state.viewMode}${C.reset}  ${C.dim}${live}${C.reset}`,
  );
  line(
    `${C.dim}[F]ocus [Shift+P]approvals [j/k]team [h/l or [/] teammate] [,/.]interrupt [Enter]triage [y/n]approve/reject focused [y]retry(main) [c]coord [v]native [d]dispatch [q]queue [a]assign [r]rebalance [s]sim [{/}]action [Tab]split<->focus [SPACE]refresh [x]quit${C.reset}`,
  );
  hr();
}

function renderNative() {
  if (!state.native || !focusVisible("native")) return;
  const caps = state.native.native || state.native.capabilities || {};
  const bridge = state.native.bridge || {};
  const ok = Boolean(state.native.adapter_ok ?? caps.available);
  const bridgeStatus = bridge.bridge_status || caps.bridge_status || "down";
  const statusClr = ok ? C.green : C.red;
  const bridgeClr =
    bridgeStatus === "healthy"
      ? C.green
      : bridgeStatus === "degraded"
        ? C.yellow
        : C.red;
  box("Native Runtime");
  line(
    `  ${C.dim}Available:${C.reset} ${statusClr}${ok}${C.reset}  ${C.dim}Mode:${C.reset} ${state.native.mode || caps.mode || "-"}  ${C.dim}Bridge:${C.reset} ${bridgeClr}${bridgeStatus}${C.reset}  ${C.dim}p95:${C.reset} ${state.metrics?.action_latency_ms?.p95 ?? "n/a"}ms`,
  );
}

function renderTeams() {
  box("Teams");
  if (state.teams.length === 0) {
    line(`  ${C.dim}No teams${C.reset}`);
    return;
  }
  for (let i = 0; i < state.teams.length; i++) {
    const t = state.teams[i];
    const sel = i === state.selectedTeamIdx ? `${C.bold}${C.cyan}> ` : `  `;
    const s = t.summary || {};
    line(
      `${sel}${t.team_name}${C.reset}  ${C.dim}path=${t.execution_path || "hybrid"}${C.reset}  ${C.green}active=${s.active ?? 0}${C.reset} ${C.yellow}idle=${s.idle ?? 0}${C.reset} ${C.red}stale=${s.stale ?? 0}${C.reset} ${C.dim}queued=${s.queued_tasks ?? 0}${C.reset}`,
    );
  }
}

function renderMembers() {
  if (!state.detail || !focusVisible("members")) return;
  box("Members");
  const teammates = state.detail.teammates || state.detail.members || [];
  if (teammates.length === 0) {
    line(`  ${C.dim}No members${C.reset}`);
    return;
  }
  for (const m of teammates) {
    const pc = presenceColor(m.presence);
    const name = truncate(m.display_name || m.name, 16);
    const role = truncate(m.role || "-", 12);
    const task = m.current_task_ref || "-";
    const risks = (m.risk_flags || []).length
      ? ` ${C.red}[${m.risk_flags.join(",")}]${C.reset}`
      : "";
    line(
      `  ${pc}●${C.reset} ${C.bold}${name}${C.reset} ${C.dim}(${role})${C.reset} ${pc}${m.presence}${C.reset} load=${m.load_score} ready=${m.dispatch_readiness} task=${task}${risks}`,
    );
  }
}

function renderTasks() {
  if (!state.detail || !focusVisible("tasks")) return;
  box("Task Queue");
  const tasks = (state.detail.tasks || []).slice(0, 12);
  if (tasks.length === 0) {
    line(`  ${C.dim}No tasks${C.reset}`);
    return;
  }
  for (const t of tasks) {
    const pc = priorityColor(t.priority);
    const sc = statusColor(t.status);
    const assignee = t.assignee || "-";
    const blocked = (t.blocked_by || []).length
      ? ` ${C.magenta}BLOCKED(${t.blocked_by.join(",")})${C.reset}`
      : "";
    const gates =
      Array.isArray(t.quality_gates) && t.quality_gates.length
        ? ` ${C.dim}gates:${t.quality_gates.length}${C.reset}`
        : "";
    line(
      `  ${pc}${t.priority}${C.reset} ${sc}${t.status}${C.reset}/${t.dispatch_status || "-"} ${C.bold}${truncate(t.subject, 40)}${C.reset} ${C.dim}${t.task_id}${C.reset} @${assignee}${blocked}${gates}`,
    );
  }
}

function renderInterrupts() {
  if (!focusVisible("interrupts")) return;
  const interrupts = state.interrupts || state.detail?.interrupts || [];
  if (interrupts.length === 0) return;
  if (state.selectedInterruptIdx >= interrupts.length) {
    state.selectedInterruptIdx = Math.max(0, interrupts.length - 1);
  }
  box("Interrupts");
  for (let i = 0; i < interrupts.slice(0, 8).length; i++) {
    const int = interrupts[i];
    const sel = i === state.selectedInterruptIdx ? `${C.bold}${C.cyan}> ` : "  ";
    const lvl = int.level || "info";
    const clr = lvl === "error" ? C.red : lvl === "warn" ? C.yellow : C.dim;
    const score =
      int.priority_score != null
        ? ` ${C.dim}(score:${int.priority_score})${C.reset}`
        : "";
    line(
      `${sel}${clr}[${lvl}]${C.reset} ${int.code || "alert"}: ${truncate(int.message, 60)}${score}`,
    );
  }
  line(`  ${C.dim}Use ,/. to select and Enter to triage selected interrupt.${C.reset}`);
}

function renderAlerts() {
  if (!focusVisible("alerts")) return;
  const alerts = state.detail?.alerts || state.alerts || [];
  if (alerts.length === 0) return;
  box("Alerts");
  for (const a of alerts.slice(0, 5)) {
    const clr =
      a.level === "error" ? C.red : a.level === "warn" ? C.yellow : C.dim;
    line(
      `  ${clr}[${a.level || "info"}]${C.reset} ${a.code || "alert"}: ${truncate(a.message, 60)}`,
    );
  }
}

function renderActions() {
  if (!focusVisible("tasks")) return;
  box("Recent Actions");
  const recent = (state.actions || []).slice(0, 8);
  if (state.selectedActionIdx >= recent.length)
    state.selectedActionIdx = Math.max(0, recent.length - 1);
  if (recent.length === 0) {
    line(`  ${C.dim}No actions${C.reset}`);
    return;
  }
  for (let i = 0; i < recent.length; i++) {
    const a = recent[i];
    const sel = i === state.selectedActionIdx ? `${C.bold}${C.cyan}> ` : `  `;
    const sc =
      a.state === "ok" ? C.green : a.state === "failed" ? C.red : C.yellow;
    line(
      `${sel}${C.dim}${truncate(a.action_id, 10)}${C.reset} ${a.action} ${sc}${a.state}${C.reset} ${C.dim}${a.adapter || "-"}/${a.path_mode || "-"}${C.reset} ${a.latency_ms ? `${a.latency_ms}ms` : ""}`,
    );
  }
}

function renderTimeline() {
  if (!state.detail) return;
  const timeline = (state.detail.timeline || []).slice(-6);
  if (timeline.length === 0) return;
  box("Timeline");
  for (const e of timeline) {
    line(
      `  ${C.dim}${(e.ts || e.t || "").slice(11, 19)}${C.reset} ${e.type || e.tool || e.event || "event"}`,
    );
  }
}

function renderRebalanceExplain() {
  if (!state.detail?.rebalance_explain || !focusVisible("rebalance")) return;
  const re = state.detail.rebalance_explain;
  if (!re?.tasks?.length) return;
  box("Rebalance Explain");
  for (const t of re.tasks.slice(0, 5)) {
    line(
      `  ${C.bold}${t.task_id}${C.reset} ${t.subject} -> ${C.cyan}${t.recommended_assignee || "?"}${C.reset} (score=${t.recommended_score ?? "-"})`,
    );
    if (t.candidates?.length) {
      for (const c of t.candidates.slice(0, 3)) {
        const valid = c.valid ? C.green : C.red;
        line(
          `    ${valid}${c.rank}.${C.reset} ${c.name} ${c.presence} load=${c.load_score} score=${c.score ?? "-"} ${C.dim}${(c.reasons || []).join("; ")}${C.reset}`,
        );
      }
    }
  }
}

// ── Approval Inbox View ──

function renderApprovalView() {
  clear();
  line(
    `${C.bold}Approval Inbox${C.reset}  ${C.dim}[j/k|1-9]select [y/Enter]approve [n]reject [Esc]back${C.reset}`,
  );
  hr();
  if (state.approvals.length === 0) {
    line(`  ${C.dim}No pending approvals.${C.reset}`);
    line("");
    line(state.message || "");
    return;
  }
  for (let i = 0; i < state.approvals.length; i++) {
    const ap = state.approvals[i];
    const sel = i === state.selectedApprovalIdx ? `${C.bold}${C.cyan}> ` : `  `;
    const riskClr = ap.safe_auto === false ? C.red : C.green;
    const riskLabel = ap.safe_auto === false ? "RISKY" : "safe";
    line(
      `${sel}${i + 1}. ${C.bold}${truncate(ap.task_id || ap.worker || "unknown", 20)}${C.reset} ${truncate(ap.subject || ap.message || "", 40)} ${riskClr}[${riskLabel}]${C.reset}`,
    );
    if (ap.plan_preview)
      line(`     ${C.dim}${truncate(ap.plan_preview, 60)}${C.reset}`);
  }
  line("");
  line(state.message || "");
}

// ── Teammate Live View ──
// This does not provide native in-process parity.
// Route order is explicit: native live -> sidecar live -> tmux mirror fallback.
// tmux capture is only used when native/runtime live streams are unavailable.

// Shared output capture: tmux scrollback → script transcript → results JSON.
// Used by both renderTeammateView (full-screen) and renderSplit (right panel).
function getTeammateOutput(m) {
  let output = null;
  if (m.tmux_pane_id) {
    try {
      output = execFileSync(
        "tmux",
        ["capture-pane", "-t", m.tmux_pane_id, "-p", "-S", "-", "-e"],
        { encoding: "utf8", timeout: 2000 },
      );
    } catch {
      output = null;
    }
  }
  if (!output) {
    const taskId = m.current_task_ref || m.worker_task_id;
    if (taskId) {
      try {
        const transcriptPath = join(
          homedir(),
          ".claude",
          "terminals",
          "results",
          `${taskId}.transcript`,
        );
        if (existsSync(transcriptPath)) {
          output = readFileSync(transcriptPath, "utf-8").slice(-4000);
        }
      } catch {
        output = null;
      }
    }
  }
  if (!output) {
    const taskId = m.current_task_ref || m.worker_task_id;
    if (taskId) {
      try {
        const resultsPath = join(
          homedir(),
          ".claude",
          "terminals",
          "results",
          `${taskId}.json`,
        );
        if (existsSync(resultsPath)) {
          const data = JSON.parse(readFileSync(resultsPath, "utf-8"));
          output =
            typeof data.output === "string"
              ? data.output.slice(-2000)
              : JSON.stringify(data, null, 2).slice(-2000);
        }
      } catch {
        output = null;
      }
    }
  }
  return output;
}

function renderTeammateView() {
  const teammates = state.detail?.teammates || [];
  const m = selectedTeammate();
  if (!m) {
    state.viewMode = "main";
    return render();
  }
  const route = resolveFocusedRoute(m);
  state.focusedRoute = route;
  clear();
  const total = teammates.length;
  const idx = state.selectedMemberIdx;
  const interrupt = focusedInterruptRecord();
  const approval = focusedApprovalRecord();
  line(
    `${C.bold}Teammate View${C.reset}  ${C.dim}[${idx + 1}/${total}] [h/l|[/]]cycle [,/ .]interrupt [Enter]triage [y/n]approve [Tab]split [Esc]back${C.reset}`,
  );
  hr();
  const pc = presenceColor(m.presence);
  const routeClr = routeModeColor(route.route_mode);
  line(
    `${pc}o${C.reset} ${C.bold}${m.display_name || m.name || "?"}${C.reset}  ${C.dim}role=${m.role || "-"}${C.reset}  ${pc}${m.presence}${C.reset}  ${C.dim}task=${m.current_task_ref || m.worker_task_id || "-"}${C.reset}`,
  );
  const freshnessMeta = focusedFreshnessMeta(m);
  line(
    `  ${C.dim}route=${route.route_label}${C.reset} ${routeClr}(${route.route_mode})${C.reset}  ${C.dim}freshness=${formatFreshness(freshnessMeta)} age=${route.live_age_ms != null ? `${Math.round(route.live_age_ms / 1000)}s` : "n/a"} stale_after=${Math.round((route.stale_after_ms || DEFAULT_LIVE_STALE_AFTER_MS) / 1000)}s${C.reset}`,
  );
  line(`  ${C.dim}reason=${route.route_reason || "-"}${C.reset}`);
  line(
    route.fallback_reason
      ? `  ${C.yellow}fallback_reason=${route.fallback_reason}${C.reset}`
      : `  ${C.dim}fallback_reason=none${C.reset}`,
  );
  line(`  ${C.dim}source_truth=${route.source_truth || "-"}${C.reset}`);
  line(
    `  ${C.dim}preference=${(route.route_mode_preference || ["native-live", "sidecar-live", "tmux-mirror"]).join(" > ")}${C.reset}`,
  );
  line(
    `  ${C.dim}selected_interrupt=${interrupt?.code || interrupt?.kind || "none"} selected_approval=${approval?.task_id || "none"}${C.reset}`,
  );
  line(
    `  ${C.dim}load=${m.load_score ?? "-"}  ready=${m.dispatch_readiness ?? "-"}  session=${m.session_id || "-"}  pane=${m.tmux_pane_id || "-"}${C.reset}`,
  );
  hr();

  const output =
    route.route_mode === "tmux-mirror" ? getTeammateOutput(m) : focusedLiveText(m);
  if (output) {
    const maxLines = Math.max(10, (process.stdout.rows || 40) - 8);
    const lines = output.split("\n");
    const visible = lines.slice(-maxLines).join("\n");
    w(visible);
  } else {
    line(
      `${C.dim}[No live output -- teammate may be offline or not yet assigned a task]${C.reset}`,
    );
  }
  line("");
  line(state.message || `${C.dim}Ready.${C.reset}`);
}

// ── Split-Pane Layout ──
// Renders two columns using ANSI cursor absolute positioning.
// Left panel: team/member list (fixed ~42 cols wide)
// Right panel: selected teammate's live output (remaining cols)

const SPLIT_LEFT_WIDTH = 42;

function moveTo(row, col) {
  process.stdout.write(`\x1b[${row};${col}H`);
}

function renderSplit() {
  const totalCols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;
  const rightStart = SPLIT_LEFT_WIDTH + 2;
  const rightWidth = Math.max(20, totalCols - rightStart);

  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  // ── Left panel: member list ──
  const teammates = state.detail?.teammates || [];
  let row = 1;
  moveTo(row++, 1);
  process.stdout.write(
    `${C.bold}Workers${C.reset}  ${C.dim}[j/k/h/l/[ ]]focus${C.reset}`,
  );
  moveTo(row++, 1);
  process.stdout.write("─".repeat(SPLIT_LEFT_WIDTH));
  for (let i = 0; i < teammates.length && row < rows - 2; i++) {
    const m = teammates[i];
    const sel = i === state.selectedMemberIdx;
    const pc = presenceColor(m.presence);
    const name = (m.display_name || m.name || "?").slice(0, 16).padEnd(16);
    const task = (m.current_task_ref || "-").slice(0, 12).padEnd(12);
    const prefix = sel ? `${C.cyan}▶${C.reset} ` : "  ";
    moveTo(row++, 1);
    process.stdout.write(
      `${prefix}${pc}●${C.reset} ${name} ${C.dim}${task}${C.reset}`,
    );
  }

  // ── Divider ──
  for (let r = 1; r <= rows - 1; r++) {
    moveTo(r, SPLIT_LEFT_WIDTH + 1);
    process.stdout.write(`${C.dim}│${C.reset}`);
  }

  // ── Right panel: selected worker output ──
  const m = teammates[state.selectedMemberIdx];
  let rightRow = 1;
  if (m) {
    const route = resolveFocusedRoute(m);
    const freshnessMeta = focusedFreshnessMeta(m);
    const interrupt = focusedInterruptRecord();
    const approval = focusedApprovalRecord();
    const routeClr = routeModeColor(route.route_mode);
    state.focusedRoute = route;
    moveTo(rightRow++, rightStart);
    process.stdout.write(
      `${C.bold}${m.display_name || m.name}${C.reset}  ${presenceColor(m.presence)}${m.presence}${C.reset}  ${C.dim}${m.current_task_ref || "idle"}${C.reset}`,
    );
    moveTo(rightRow++, rightStart);
    process.stdout.write(
      `${route.route_label} ${routeClr}(${route.route_mode})${C.reset} · ${formatFreshness(freshnessMeta)} · age=${route.live_age_ms != null ? `${Math.round(route.live_age_ms / 1000)}s` : "n/a"}`,
    );
    moveTo(rightRow++, rightStart);
    process.stdout.write(
      `reason: ${route.route_reason || "-"}`.slice(0, rightWidth),
    );
    if (route.fallback_reason) {
      moveTo(rightRow++, rightStart);
      process.stdout.write(`fallback: ${route.fallback_reason}`.slice(0, rightWidth));
    } else {
      moveTo(rightRow++, rightStart);
      process.stdout.write("fallback: none".slice(0, rightWidth));
    }
    moveTo(rightRow++, rightStart);
    process.stdout.write(
      `source: ${route.source_truth || "-"}`.slice(0, rightWidth),
    );
    moveTo(rightRow++, rightStart);
    process.stdout.write(
      `focused interrupt=${interrupt?.code || interrupt?.kind || "none"} approval=${approval?.task_id || "none"}`.slice(
        0,
        rightWidth,
      ),
    );
    moveTo(rightRow++, rightStart);
    process.stdout.write("─".repeat(Math.min(rightWidth, 60)));

    const output =
      route.route_mode === "tmux-mirror" ? getTeammateOutput(m) : focusedLiveText(m);
    if (output) {
      const maxLines = Math.max(5, rows - rightRow - 2);
      const outputLines = output.split("\n").slice(-maxLines);
      for (const l of outputLines) {
        if (rightRow >= rows - 1) break;
        moveTo(rightRow++, rightStart);
        process.stdout.write(l.slice(0, rightWidth));
      }
    } else {
      moveTo(rightRow, rightStart);
      process.stdout.write(`${C.dim}[no output]${C.reset}`);
    }
  }

  // ── Status bar ──
  moveTo(rows, 1);
  process.stdout.write(
    `${C.dim}[j/k or h/l or [/] teammate] [,/ .]interrupt [Enter]triage [y/n]approval [Tab]focus [SPACE]refresh [x]quit ${state.message || ""}${C.reset}`,
  );
}

// ── Main Render ──

function render() {
  if (state.viewMode === "approval") return renderApprovalView();
  if (state.viewMode === "teammate") return renderTeammateView();
  if (state.viewMode === "split") return renderSplit();
  clear();
  renderHeader();
  renderNative();
  renderTeams();
  line("");
  renderMembers();
  renderTasks();
  renderInterrupts();
  renderAlerts();
  renderActions();
  renderTimeline();
  renderRebalanceExplain();
  line("");
  line(state.message || `${C.dim}Ready.${C.reset}`);
}

// ── Data Refresh ──

async function refresh() {
  const teams = await request("/teams");
  state.teams = teams.teams || [];
  state.native = teams.native || state.native;
  try {
    state.native = await request("/native/status");
  } catch { }
  try {
    const actions = await request("/actions");
    state.actions = actions.actions || [];
  } catch { }
  try {
    state.metrics = await request("/metrics.json");
  } catch { }
  if (state.selectedTeamIdx >= state.teams.length)
    state.selectedTeamIdx = Math.max(0, state.teams.length - 1);
  const selected = teamName();
  if (selected) {
    state.detail = await request(`/teams/${encodeURIComponent(selected)}`);
    cacheTeammates(state.detail?.teammates || [], Date.now());
    if (state.selectedMemberIdx >= (state.detail?.teammates || []).length) {
      state.selectedMemberIdx = Math.max(
        0,
        (state.detail?.teammates || []).length - 1,
      );
    }
    try {
      const intr = await request(`/teams/${encodeURIComponent(selected)}/interrupts`);
      state.interrupts = intr.interrupts || [];
    } catch {
      state.interrupts = state.detail?.interrupts || [];
    }
    if (state.selectedInterruptIdx >= state.interrupts.length) {
      state.selectedInterruptIdx = Math.max(0, state.interrupts.length - 1);
    }
    state.alerts = state.detail?.alerts || [];
    try {
      const ap = await request(
        `/teams/${encodeURIComponent(selected)}/approvals`,
      );
      state.approvals = ap.approvals || [];
    } catch {
      state.approvals = [];
    }
    syncFocusedSelections();
  } else {
    state.detail = null;
    state.interrupts = [];
    state.approvals = [];
  }
  render();
}

async function refreshFocusedContext() {
  const selected = teamName();
  if (!selected) {
    await refresh();
    return;
  }
  const [detail, intr, ap, actions] = await Promise.all([
    request(`/teams/${encodeURIComponent(selected)}`),
    request(`/teams/${encodeURIComponent(selected)}/interrupts`).catch(() => ({
      interrupts: [],
    })),
    request(`/teams/${encodeURIComponent(selected)}/approvals`).catch(() => ({
      approvals: [],
    })),
    request("/actions").catch(() => ({ actions: [] })),
  ]);
  state.detail = detail;
  cacheTeammates(state.detail?.teammates || [], Date.now());
  if (state.selectedMemberIdx >= (state.detail?.teammates || []).length) {
    state.selectedMemberIdx = Math.max(0, (state.detail?.teammates || []).length - 1);
  }
  state.interrupts = intr.interrupts || state.detail?.interrupts || [];
  state.approvals = ap.approvals || [];
  state.actions = actions.actions || state.actions;
  syncFocusedSelections();
  render();
}

// ── Actions ──

async function actionControl(op, forcePath = null) {
  const rec = selectedAction();
  if (!rec) {
    state.message = "No action selected";
    render();
    return;
  }
  try {
    let res;
    if (op === "view") {
      res = await request(`/actions/${encodeURIComponent(rec.action_id)}`);
      state.message = `action ${rec.action_id}: ${res.state} ${res.adapter || "-"} ${res.path_mode || "-"}`;
      render();
      line("");
      line(JSON.stringify(res, null, 2));
      return;
    }
    if (op === "retry") {
      res = await request(
        `/actions/${encodeURIComponent(rec.action_id)}/retry`,
        "POST",
        {},
      );
    } else if (op === "fallback") {
      res = await request(
        `/actions/${encodeURIComponent(rec.action_id)}/fallback`,
        "POST",
        { force_path: forcePath || "coordinator" },
      );
    } else {
      throw new Error(`Unknown: ${op}`);
    }
    state.message = `${op} ${rec.action_id}: ${res.adapter || "sidecar"} ${res.path_mode ? `(${res.path_mode})` : ""} ${res.reason || ""}`;
    await refresh();
  } catch (err) {
    state.message = `${op} failed: ${err.message}`;
    render();
  }
}

function promptInput(prompt, cb) {
  process.stdin.setRawMode(false);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question(`${prompt}: `, (answer) => {
    rl.close();
    process.stdin.setRawMode(true);
    cb(answer);
  });
}

async function doAction(action, body = {}, opts = {}) {
  const t = teamName();
  if (!t) {
    state.message = "No team selected";
    render();
    return;
  }
  try {
    let res;
    if (action === "rebalance") {
      res = await request(`/teams/${encodeURIComponent(t)}/rebalance`, "POST", {
        ...body,
        ...(state.forcePath ? { force_path: state.forcePath } : {}),
      });
    } else if (
      action === "native-task" ||
      action === "native-send-message" ||
      action === "native-team-status"
    ) {
      const map = {
        "native-task": "task",
        "native-send-message": "send-message",
        "native-team-status": "team-status",
      };
      res = await request(`/native/actions/${map[action]}`, "POST", {
        team_name: t,
        ...body,
      });
    } else {
      res = await request(
        `/teams/${encodeURIComponent(t)}/actions/${encodeURIComponent(action)}`,
        "POST",
        {
          ...body,
          ...(state.forcePath ? { force_path: state.forcePath } : {}),
        },
      );
    }
    state.message = `${action}: ${res.adapter || "sidecar"} ${res.path_mode ? `(${res.path_mode})` : ""} - ${res.reason || "ok"}${res.action_id ? ` [${res.action_id}]` : ""}`;
    if (opts.refreshMode === "focused") await refreshFocusedContext();
    else await refresh();
  } catch (err) {
    state.message = `${action} failed: ${err.message}`;
    render();
  }
}

async function routeSim(action, payload = {}) {
  const t = teamName();
  if (!t) {
    state.message = "No team selected";
    render();
    return;
  }
  try {
    const res = await request("/route/simulate", "POST", {
      team_name: t,
      action,
      payload,
    });
    const trace = res.decision?.decision_trace || [];
    state.message = `route-sim ${action}: ${res.decision?.adapter || "?"} (${res.decision?.path_mode || "?"}) - ${res.decision?.reason || ""}`;
    render();
    if (trace.length) {
      line("");
      box("Decision Trace");
      for (const step of trace) line(`  ${C.dim}-->${C.reset} ${step}`);
    }
  } catch (err) {
    state.message = `route-sim failed: ${err.message}`;
    render();
  }
}

async function batchTriage(op) {
  const t = teamName();
  if (!t) {
    state.message = "No team selected";
    render();
    return;
  }
  try {
    const res = await request(
      `/teams/${encodeURIComponent(t)}/batch-triage`,
      "POST",
      { op, confirm: true },
    );
    state.message = `${op}: attempted=${res.summary?.attempted ?? 0} ok=${res.summary?.succeeded ?? 0} failed=${res.summary?.failed ?? 0}`;
    await refresh();
  } catch (err) {
    state.message = `${op} failed: ${err.message}`;
    render();
  }
}

async function triageSelectedInterrupt() {
  const interrupts = state.interrupts || state.detail?.interrupts || [];
  if (!interrupts.length) {
    state.message = "No interrupt selected";
    render();
    return;
  }
  const idx = Math.max(
    0,
    Math.min(state.selectedInterruptIdx, interrupts.length - 1),
  );
  if (idx < 0) {
    state.message = "No interrupt selected";
    render();
    return;
  }
  state.selectedInterruptIdx = idx;
  const selected = interrupts[idx];
  try {
    if (selected.kind === "approval" && selected.task_id) {
      await doAction("approve-plan", {
        task_id: selected.task_id,
        message: "Approved from interrupt triage",
      }, { refreshMode: "focused" });
      state.message = `Approved ${selected.task_id}`;
      return;
    }
    if (selected.kind === "stale" && selected.session_id) {
      await doAction("wake", {
        session_id: selected.session_id,
        message: "Wake from interrupt triage",
      }, { refreshMode: "focused" });
      state.message = `Wake sent ${selected.session_id}`;
      return;
    }
    if (selected.code === "bridge_stuck_request") {
      const res = await request("/native/bridge/validate", "POST", {
        team_name: teamName(),
        timeout_ms: 10000,
      });
      state.message = `bridge validate: ${res.ok ? "PASS" : "FAIL"} ${res.latency_ms || "-"}ms`;
      await refresh();
      return;
    }
    state.message = `No triage handler for ${selected.kind || selected.code || "interrupt"}`;
    render();
  } catch (err) {
    state.message = `triage failed: ${err.message}`;
    render();
  }
}

async function approveOrRejectFocused(mode = "approve") {
  const approvals = state.approvals || [];
  const idx = findFocusedApprovalIndex();
  if (!approvals.length || idx < 0 || !approvals[idx]) {
    state.message = "No focused approval";
    render();
    return;
  }
  state.selectedApprovalIdx = idx;
  const ap = approvals[idx];
  if (mode === "approve") {
    await doAction("approve-plan", {
      task_id: ap.task_id || ap.worker,
      message: "Approved from focused teammate controls",
    }, { refreshMode: "focused" });
    state.message = `Approved ${ap.task_id || ap.worker}`;
    return;
  }
  return promptInput("Revision feedback", async (feedback) => {
    await doAction("reject-plan", {
      task_id: ap.task_id || ap.worker,
      feedback: feedback || "Needs revision",
    }, { refreshMode: "focused" });
    state.message = `Rejected ${ap.task_id || ap.worker}`;
  });
}

// ── Auto-refresh ──

function handleLiveEvent(eventName, data) {
  if (!eventName) return;
  if (eventName === "teammate.updated") {
    const teammates = Array.isArray(data?.teammates) ? data.teammates : [];
    cacheTeammates(teammates, Date.now());
    const currentTeam = teamName();
    if (state.detail && currentTeam) {
      state.detail.teammates = teammates.filter((m) => m.team_name === currentTeam);
      if (state.selectedMemberIdx >= state.detail.teammates.length) {
        state.selectedMemberIdx = Math.max(0, state.detail.teammates.length - 1);
      }
      syncFocusedSelections();
    }
    if (state.viewMode === "teammate" || state.viewMode === "split") render();
    return;
  }
  if (eventName === "task.updated") {
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    const currentTeam = teamName();
    if (state.detail && currentTeam) {
      state.detail.tasks = tasks.filter((t) => t.team_name === currentTeam);
      if (state.viewMode === "main") render();
    }
    return;
  }
  if (eventName === "team.updated") {
    if (Array.isArray(data?.teams)) {
      state.teams = data.teams;
      if (state.selectedTeamIdx >= state.teams.length) {
        state.selectedTeamIdx = Math.max(0, state.teams.length - 1);
      }
      if (state.viewMode === "main") render();
    }
    return;
  }
  if (eventName === "native.capabilities.updated") {
    state.native = {
      ...(state.native || {}),
      native: data || {},
    };
    if (state.viewMode === "teammate" || state.viewMode === "split") render();
    return;
  }
  if (eventName === "native.bridge.status") {
    state.native = {
      ...(state.native || {}),
      bridge: data || {},
    };
    if (state.viewMode === "teammate" || state.viewMode === "split") render();
  }
}

function connectLiveEvents() {
  if (!sidecarPort) return;
  if (state.sseRequest) {
    try {
      state.sseRequest.destroy();
    } catch { }
    state.sseRequest = null;
  }
  const headers = { Accept: "text/event-stream" };
  if (sidecarToken) headers.Authorization = `Bearer ${sidecarToken}`;
  const req = http.request(
    { host, port: sidecarPort, path: "/v1/events", method: "GET", headers },
    (res) => {
      state.sseConnected = true;
      let buffer = "";
      let eventName = "";
      let dataParts = [];
      res.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (buffer.includes("\n")) {
          const idx = buffer.indexOf("\n");
          const lineRaw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          const line = lineRaw.endsWith("\r")
            ? lineRaw.slice(0, -1)
            : lineRaw;
          if (!line) {
            if (eventName) {
              const dataText = dataParts.join("\n");
              let parsed = null;
              try {
                parsed = dataText ? JSON.parse(dataText) : null;
              } catch {
                parsed = null;
              }
              handleLiveEvent(eventName, parsed);
            }
            eventName = "";
            dataParts = [];
            continue;
          }
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }
          if (line.startsWith("data:")) {
            dataParts.push(line.slice(5).trimStart());
          }
        }
      });
      res.on("end", () => {
        state.sseConnected = false;
        state.sseRequest = null;
        if (!state.sseReconnectTimer) {
          state.sseReconnectTimer = setTimeout(() => {
            state.sseReconnectTimer = null;
            connectLiveEvents();
          }, 1500);
        }
      });
    },
  );
  req.on("error", () => {
    state.sseConnected = false;
    state.sseRequest = null;
    if (!state.sseReconnectTimer) {
      state.sseReconnectTimer = setTimeout(() => {
        state.sseReconnectTimer = null;
        connectLiveEvents();
      }, 1500);
    }
  });
  req.end();
  state.sseRequest = req;
}

// Focus view refreshes frequently only for tmux mirror fallback.
function startTeammateAutoRefresh() {
  if (state.teammateRefreshTimer) clearInterval(state.teammateRefreshTimer);
  state.teammateRefreshTimer = setInterval(() => {
    if (state.viewMode === "teammate" || state.viewMode === "split") {
      const m = selectedTeammate();
      const route = m ? resolveFocusedRoute(m) : null;
      if (
        route &&
        (route.route_mode === "tmux-mirror" ||
          route.freshness !== LIVE_FRESHNESS.FRESH)
      ) {
        render();
      }
    } else {
      clearInterval(state.teammateRefreshTimer);
      state.teammateRefreshTimer = null;
    }
  }, 450);
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => {
    refresh().catch(() => { });
  }, state.autoRefreshInterval);
}

// ── Main ──

async function main() {
  const p = await discoverPort();
  if (!p) {
    console.error(
      "Lead sidecar port not found. Start the server first or set LEAD_SIDECAR_PORT.",
    );
    process.exit(1);
  }
  await refresh().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
  startAutoRefresh();
  connectLiveEvents();
  const shutdown = () => {
    try {
      if (state.sseRequest) state.sseRequest.destroy();
    } catch { }
    try {
      if (state.sseReconnectTimer) clearTimeout(state.sseReconnectTimer);
    } catch { }
    try {
      if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    } catch { }
    try {
      if (state.teammateRefreshTimer) clearInterval(state.teammateRefreshTimer);
    } catch { }
  };
  process.on("exit", shutdown);

  // Auto-enable split pane if terminal is wide enough
  if ((process.stdout.columns || 0) >= 100) {
    state.viewMode = "split";
    startTeammateAutoRefresh();
    render();
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("keypress", async (str, key) => {
    if (key.ctrl && key.name === "c") process.exit(0);
    if (key.name === "x" && state.viewMode === "main") process.exit(0);

    // Approval inbox view keys
    if (state.viewMode === "approval") {
      if (key.name === "escape") {
        state.viewMode = "main";
        return render();
      }
      if (key.name === "j") {
        state.selectedApprovalIdx = Math.min(
          state.selectedApprovalIdx + 1,
          Math.max(0, state.approvals.length - 1),
        );
        return render();
      }
      if (key.name === "k") {
        state.selectedApprovalIdx = Math.max(0, state.selectedApprovalIdx - 1);
        return render();
      }
      if (str >= "1" && str <= "9") {
        state.selectedApprovalIdx = Math.min(
          Number(str) - 1,
          state.approvals.length - 1,
        );
        return render();
      }
      if (key.name === "a" || key.name === "y" || key.name === "return") {
        const ap = state.approvals[state.selectedApprovalIdx];
        if (!ap) {
          state.message = "No approval selected";
          return render();
        }
        return promptInput("Approval note (optional)", async (message) => {
          await doAction("approve-plan", {
            task_id: ap.task_id || ap.worker,
            message,
          }, { refreshMode: "focused" });
          state.message = `Approved ${ap.task_id || ap.worker}`;
        });
      }
      if (key.name === "r" || key.name === "n") {
        const ap = state.approvals[state.selectedApprovalIdx];
        if (!ap) {
          state.message = "No approval selected";
          return render();
        }
        return promptInput("Revision feedback", async (feedback) => {
          await doAction("reject-plan", {
            task_id: ap.task_id || ap.worker,
            feedback,
          }, { refreshMode: "focused" });
          state.message = `Rejected ${ap.task_id || ap.worker}`;
        });
      }
      return;
    }

    // Escape -- exit teammate or split view back to main
    if (
      key.name === "escape" &&
      (state.viewMode === "teammate" || state.viewMode === "split")
    ) {
      state.viewMode = "main";
      if (state.teammateRefreshTimer) {
        clearInterval(state.teammateRefreshTimer);
        state.teammateRefreshTimer = null;
      }
      return render();
    }

    // Tab -- toggle split pane on/off
    if (key.name === "tab") {
      if (state.viewMode === "split") {
        state.viewMode = (state.detail?.teammates || []).length
          ? "teammate"
          : "main";
        startTeammateAutoRefresh();
      } else {
        state.viewMode = "split";
        startTeammateAutoRefresh();
      }
      return render();
    }

    // Focused teammate cycle keys.
    if (
      (key.shift && key.name === "up") ||
      key.name === "h" ||
      (key.shift && key.name === "left")
    ) {
      if (!applyFocusedTeammateCycle(-1)) return;
      return render();
    }

    if (
      (key.shift && key.name === "down") ||
      key.name === "l" ||
      (key.shift && key.name === "right")
    ) {
      if (!applyFocusedTeammateCycle(1)) return;
      return render();
    }

    if (str === "[") {
      if (!applyFocusedTeammateCycle(-1)) return;
      return render();
    }
    if (str === "]") {
      if (!applyFocusedTeammateCycle(1)) return;
      return render();
    }

    // Main view keys
    if (key.name === "j") {
      if (state.viewMode === "split") {
        if (!applyFocusedTeammateCycle(1, { enterFocusedView: false })) return;
        return render();
      }
      state.selectedTeamIdx = Math.min(
        state.selectedTeamIdx + 1,
        Math.max(0, state.teams.length - 1),
      );
      return refresh().catch(() => { });
    }
    if (key.name === "k") {
      if (state.viewMode === "split") {
        if (!applyFocusedTeammateCycle(-1, { enterFocusedView: false })) return;
        return render();
      }
      state.selectedTeamIdx = Math.max(0, state.selectedTeamIdx - 1);
      return refresh().catch(() => { });
    }
    if (str === "{") {
      state.selectedActionIdx = Math.max(0, state.selectedActionIdx - 1);
      return render();
    }
    if (str === "}") {
      state.selectedActionIdx = Math.min(
        state.selectedActionIdx + 1,
        Math.max(0, Math.min(7, state.actions.length - 1)),
      );
      return render();
    }
    if (str === ",") {
      const interrupts = state.interrupts || state.detail?.interrupts || [];
      if (!interrupts.length) return;
      state.selectedInterruptIdx = cycleIndex(
        state.selectedInterruptIdx,
        -1,
        interrupts.length,
      );
      return render();
    }
    if (str === ".") {
      const interrupts = state.interrupts || state.detail?.interrupts || [];
      if (!interrupts.length) return;
      state.selectedInterruptIdx = cycleIndex(
        state.selectedInterruptIdx,
        1,
        interrupts.length,
      );
      return render();
    }
    if (key.name === "return") return triageSelectedInterrupt();

    if (
      (state.viewMode === "teammate" || state.viewMode === "split") &&
      key.name === "y"
    ) {
      return approveOrRejectFocused("approve").catch((err) => {
        state.message = `approve failed: ${err.message}`;
        render();
      });
    }
    if (
      (state.viewMode === "teammate" || state.viewMode === "split") &&
      key.name === "n"
    ) {
      return approveOrRejectFocused("reject").catch((err) => {
        state.message = `reject failed: ${err.message}`;
        render();
      });
    }

    // Focus mode cycling
    if (key.name === "f" && !key.shift) {
      const modes = ["all", "approval", "dispatch", "recovery"];
      const idx = modes.indexOf(state.focusMode);
      state.focusMode = modes[(idx + 1) % modes.length];
      state.message = `Focus: ${state.focusMode}`;
      return render();
    }

    // Approval inbox
    if (key.name === "p" && key.shift) {
      state.viewMode = "approval";
      state.selectedApprovalIdx = 0;
      return render();
    }

    // Force path toggle
    if (key.shift && key.name === "f") {
      const order = ["", "coordinator", "native"];
      const idx = Math.max(0, order.indexOf(state.forcePath || ""));
      state.forcePath = order[(idx + 1) % order.length];
      state.message = `Force path: ${state.forcePath || "auto"}`;
      return render();
    }

    // Action controls
    if (key.name === "y") return actionControl("retry");
    if (key.name === "c") return actionControl("fallback", "coordinator");
    if (key.name === "v") return actionControl("fallback", "native");
    if (key.name === "o") return actionControl("view");

    // Team actions
    if (key.name === "r") return doAction("rebalance", { apply: true });
    if (key.name === "a") return doAction("assign-next", {});

    // Route simulation
    if (key.name === "s") {
      return promptInput("Action to simulate", async (action) => {
        await routeSim(action);
      });
    }

    // Batch triage
    if (key.name === "u") return batchTriage("approve_all_safe");
    if (key.shift && key.name === "r") return batchTriage("reject_all_risky");
    if (key.shift && key.name === "s") return batchTriage("reassign_all_stale");
    if (key.name === "z") return batchTriage("wake_all_stale");

    // Queue task
    if (key.name === "q") {
      return promptInput("Queue subject", (subject) => {
        promptInput("Queue prompt", async (prompt) => {
          await doAction("queue-task", { subject, prompt });
        });
      });
    }

    // Dispatch
    if (key.name === "d") {
      return promptInput("Dispatch subject", (subject) => {
        promptInput("Dispatch prompt", (prompt) => {
          promptInput("Directory", async (directory) => {
            await doAction("dispatch", { subject, prompt, directory });
          });
        });
      });
    }

    // Directive
    if (key.name === "i") {
      return promptInput("Target session id (8 chars)", (to) => {
        promptInput("Directive", async (content) => {
          await doAction("directive", { to, content, from: "sidecar-tui" });
        });
      });
    }

    // Native message
    if (key.name === "m") {
      return promptInput("Native agent / teammate name", (agent) => {
        promptInput("Native message", async (message) => {
          await doAction("native-send-message", { agent, message });
        });
      });
    }

    // Approve/reject plan
    if (key.name === "p") {
      return promptInput("Worker task id", (task_id) => {
        promptInput("Approve or reject? (a/r)", (mode) => {
          if (String(mode).toLowerCase().startsWith("a")) {
            promptInput("Approval note (optional)", async (message) => {
              await doAction("approve-plan", { task_id, message }, { refreshMode: "focused" });
            });
          } else {
            promptInput("Revision feedback", async (feedback) => {
              await doAction("reject-plan", { task_id, feedback }, { refreshMode: "focused" });
            });
          }
        });
      });
    }

    // Wake session
    if (key.name === "w") {
      return promptInput("Session id", (session_id) => {
        promptInput("Wake message", async (message) => {
          await doAction("wake", { session_id, message }, { refreshMode: "focused" });
        });
      });
    }

    // Native probe
    if (key.name === "n") {
      try {
        const res = await request("/native/probe", "POST", {});
        state.message = `native probe: ${res.capabilities?.available ? "available" : "unavailable"}`;
        await refresh();
      } catch (err) {
        state.message = `native probe failed: ${err.message}`;
        render();
      }
      return;
    }

    // Bridge validate
    if (key.name === "b") {
      try {
        const res = await request("/native/bridge/validate", "POST", {
          team_name: teamName(),
          timeout_ms: 10000,
        });
        state.message = `bridge validate: ${res.ok ? "PASS" : "FAIL"} ${res.latency_ms || "-"}ms`;
        await refresh();
      } catch (err) {
        state.message = `bridge validate failed: ${err.message}`;
        render();
      }
      return;
    }

    // Open web UI
    if (key.name === "g") {
      state.message = `Open http://${host}:${p}/ in browser`;
      render();
      return;
    }

    // Refresh
    if (key.name === "space") return refresh().catch(() => { });
  });
}

main();
