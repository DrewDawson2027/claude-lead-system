#!/usr/bin/env node
import http from "http";
import readline from "readline";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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
  viewMode: "main", // 'main' | 'approval' | 'teammate'
  selectedApprovalIdx: 0,
  selectedMemberIdx: 0,
  autoRefreshInterval: 5000,
  autoRefreshTimer: null,
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
    } catch {}
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
  line(
    `${C.bold}Lead Sidecar TUI${C.reset}  ${C.dim}focus:${C.cyan}${mode}${C.reset}  ${C.dim}path:${fp}${C.reset}  ${C.dim}view:${state.viewMode}${C.reset}`,
  );
  line(
    `${C.dim}[F]ocus [P]approvals [j/k]team [[]|[]]action [y]retry [c]coord [v]native [d]dispatch [q]queue [a]assign [r]rebalance [s]sim [Shift+UP/DN]teammate [SPACE]refresh [x]quit${C.reset}`,
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
  box("Interrupts");
  for (const int of interrupts.slice(0, 8)) {
    const lvl = int.level || "info";
    const clr = lvl === "error" ? C.red : lvl === "warn" ? C.yellow : C.dim;
    const score =
      int.priority_score != null
        ? ` ${C.dim}(score:${int.priority_score})${C.reset}`
        : "";
    line(
      `  ${clr}[${lvl}]${C.reset} ${int.code || "alert"}: ${truncate(int.message, 60)}${score}`,
    );
  }
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
    `${C.bold}Approval Inbox${C.reset}  ${C.dim}[1-9]select [a]approve [r]reject [Esc]back${C.reset}`,
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
// Emulates native Agent Teams in-process display (Shift+Up/Down cycling).
// Primary: tmux capture-pane reads the live visible content of the worker's
// pane. Fallback: reads the last output from the results JSON file.

function renderTeammateView() {
  const teammates = state.detail?.teammates || [];
  const m = teammates[state.selectedMemberIdx];
  if (!m) {
    state.viewMode = "main";
    return render();
  }
  clear();
  const total = teammates.length;
  const idx = state.selectedMemberIdx;
  line(
    `${C.bold}Teammate View${C.reset}  ${C.dim}[${idx + 1}/${total}]  [Shift+UP/DN]cycle  [Esc]back${C.reset}`,
  );
  hr();
  const pc = presenceColor(m.presence);
  line(
    `${pc}o${C.reset} ${C.bold}${m.display_name || m.name || "?"}${C.reset}  ${C.dim}role=${m.role || "-"}${C.reset}  ${pc}${m.presence}${C.reset}  ${C.dim}task=${m.current_task_ref || m.worker_task_id || "-"}${C.reset}`,
  );
  line(
    `  ${C.dim}load=${m.load_score ?? "-"}  ready=${m.dispatch_readiness ?? "-"}  session=${m.session_id || "-"}  pane=${m.tmux_pane_id || "-"}${C.reset}`,
  );
  hr();

  // Primary: tmux capture-pane (live terminal content of worker pane)
  let output = null;
  if (m.tmux_pane_id) {
    try {
      output = execFileSync(
        "tmux",
        ["capture-pane", "-t", m.tmux_pane_id, "-p", "-e"],
        { encoding: "utf8", timeout: 1000 },
      );
    } catch {
      output = null;
    }
  }

  // Fallback: tail the results JSON file for last written output
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

  if (output) {
    w(output.slice(-2000));
  } else {
    line(
      `${C.dim}[No live output -- teammate may be offline or not yet assigned a task]${C.reset}`,
    );
  }
  line("");
  line(state.message || `${C.dim}Ready.${C.reset}`);
}

// ── Main Render ──

function render() {
  if (state.viewMode === "approval") return renderApprovalView();
  if (state.viewMode === "teammate") return renderTeammateView();
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
  } catch {}
  try {
    const actions = await request("/actions");
    state.actions = actions.actions || [];
  } catch {}
  try {
    state.metrics = await request("/metrics.json");
  } catch {}
  if (state.selectedTeamIdx >= state.teams.length)
    state.selectedTeamIdx = Math.max(0, state.teams.length - 1);
  const selected = teamName();
  if (selected) {
    state.detail = await request(`/teams/${encodeURIComponent(selected)}`);
    state.interrupts = state.detail?.interrupts || [];
    state.alerts = state.detail?.alerts || [];
    try {
      const ap = await request(
        `/teams/${encodeURIComponent(selected)}/approvals`,
      );
      state.approvals = ap.approvals || [];
    } catch {
      state.approvals = [];
    }
  } else {
    state.detail = null;
    state.interrupts = [];
    state.approvals = [];
  }
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

async function doAction(action, body = {}) {
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
    await refresh();
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

// ── Auto-refresh ──

function startAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => {
    refresh().catch(() => {});
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
      if (str >= "1" && str <= "9") {
        state.selectedApprovalIdx = Math.min(
          Number(str) - 1,
          state.approvals.length - 1,
        );
        return render();
      }
      if (key.name === "a") {
        const ap = state.approvals[state.selectedApprovalIdx];
        if (!ap) {
          state.message = "No approval selected";
          return render();
        }
        return promptInput("Approval note (optional)", async (message) => {
          await doAction("approve-plan", {
            task_id: ap.task_id || ap.worker,
            message,
          });
          state.message = `Approved ${ap.task_id || ap.worker}`;
          await refresh();
        });
      }
      if (key.name === "r") {
        const ap = state.approvals[state.selectedApprovalIdx];
        if (!ap) {
          state.message = "No approval selected";
          return render();
        }
        return promptInput("Revision feedback", async (feedback) => {
          await doAction("reject-plan", {
            task_id: ap.task_id || ap.worker,
            feedback,
          });
          state.message = `Rejected ${ap.task_id || ap.worker}`;
          await refresh();
        });
      }
      return;
    }

    // Escape -- exit teammate view back to main
    if (key.name === "escape" && state.viewMode === "teammate") {
      state.viewMode = "main";
      return render();
    }

    // Shift+Up -- cycle teammate view up (native Agent Teams parity: in-process display)
    if (key.shift && key.name === "up") {
      const teammates = state.detail?.teammates || [];
      if (!teammates.length) return;
      state.selectedMemberIdx =
        (state.selectedMemberIdx - 1 + teammates.length) % teammates.length;
      state.viewMode = "teammate";
      return render();
    }

    // Shift+Down -- cycle teammate view down
    if (key.shift && key.name === "down") {
      const teammates = state.detail?.teammates || [];
      if (!teammates.length) return;
      state.selectedMemberIdx =
        (state.selectedMemberIdx + 1) % teammates.length;
      state.viewMode = "teammate";
      return render();
    }

    // Main view keys
    if (key.name === "j") {
      state.selectedTeamIdx = Math.min(
        state.selectedTeamIdx + 1,
        Math.max(0, state.teams.length - 1),
      );
      return refresh().catch(() => {});
    }
    if (key.name === "k") {
      state.selectedTeamIdx = Math.max(0, state.selectedTeamIdx - 1);
      return refresh().catch(() => {});
    }
    if (str === "[") {
      state.selectedActionIdx = Math.max(0, state.selectedActionIdx - 1);
      return render();
    }
    if (str === "]") {
      state.selectedActionIdx = Math.min(
        state.selectedActionIdx + 1,
        Math.max(0, Math.min(7, state.actions.length - 1)),
      );
      return render();
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
              await doAction("approve-plan", { task_id, message });
            });
          } else {
            promptInput("Revision feedback", async (feedback) => {
              await doAction("reject-plan", { task_id, feedback });
            });
          }
        });
      });
    }

    // Wake session
    if (key.name === "w") {
      return promptInput("Session id", (session_id) => {
        promptInput("Wake message", async (message) => {
          await doAction("wake", { session_id, message });
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
    if (key.name === "space") return refresh().catch(() => {});
  });
}

main();
