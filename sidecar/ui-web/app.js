const state = {
  teams: [],
  selectedTeam: null,
  detail: null,
  native: null,
  actions: [],
  alerts: [],
  interrupts: [],
  approvals: [],
  templates: [],
  metrics: null,
  selectedMember: null,
  liveTeammatesById: {},
  liveTeammatesAt: 0,
  paletteIndex: 0,
  rebalancePreview: null,
  rebalanceExplain: null,
  bridgeValidation: null,
  csrfToken: null,
  routeSimulation: null,
  agents: [],
  agentDetail: null,
  focusedTeammate: null,
  focusedMirrorTimer: null,
  focusedMirrorKey: null,
  focusRenderNonce: 0,
  selectedInterruptId: null,
  selectedApprovalTaskId: null,
  uiPrefs: {
    focusMode: "all",
    filter: "",
    density: "standard",
    hotkeys: {},
    macros: [],
  },
};
const $ = (id) => document.getElementById(id);
const LIVE_STALE_AFTER_MS = 6000;
const LIVE_FRESHNESS = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  NONE: "no-live-signal",
});
const ROUTE_MODE_PREFERENCE = Object.freeze([
  "native-live",
  "sidecar-live",
  "tmux-mirror",
]);
const ROUTE_LABEL_PREFERENCE = Object.freeze([
  "native live",
  "sidecar live",
  "tmux mirror",
]);

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function presenceClass(p) {
  if (!p) return "p-offline";
  if (p.includes("active") || p.startsWith("running_")) return "p-active";
  if (p === "idle") return "p-idle";
  return "p-stale";
}

function parseScoreComponents(reasons = []) {
  return (reasons || []).map((r) => {
    const text = String(r || "");
    const m = text.match(/(.+?)\s+([+-]\d+)\s*$/);
    if (!m) return { label: text, delta: null, raw: text };
    return { label: m[1].trim(), delta: Number(m[2]), raw: text };
  });
}

function prefsKey() {
  return "lead-sidecar-ui-prefs-v1";
}

function defaultHotkeys() {
  return {
    palette: "a",
    simulate: "s",
    queue: "q",
    dispatch: "d",
    rebalance: "r",
    nativeMessage: "m",
    directive: "i",
    approval: "p",
    wake: "w",
    bridgeValidate: "b",
    approveSafe: "u",
    wakeStale: "z",
    teammatePrev: "[",
    teammateNext: "]",
    focusedTeammate: "t",
    triageInterrupt: "x",
    approveSelected: "y",
    rejectSelected: "n",
    forcePathToggle: "f",
    help: "?",
    openWeb: "g",
  };
}

function teammateLiveKey(m) {
  if (!m) return "";
  return String(m.id || `${m.team_name || ""}:${m.display_name || m.name || ""}`);
}

function classifyFreshness(updatedAtMs, nowMs = Date.now(), staleAfterMs = LIVE_STALE_AFTER_MS) {
  const updated = Number(updatedAtMs) || 0;
  const threshold = Number(staleAfterMs) || LIVE_STALE_AFTER_MS;
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

function focusedFreshnessMeta(teammate) {
  if (!teammate) return classifyFreshness(0);
  const key = teammateLiveKey(teammate);
  const updatedAt = state.liveTeammatesById[key]?.updated_at_ms || 0;
  return classifyFreshness(updatedAt);
}

function formatFreshness(meta) {
  if (!meta || meta.freshness === LIVE_FRESHNESS.NONE) return "no-live-signal";
  const ageS = Math.max(0, Math.round((Number(meta.live_age_ms) || 0) / 1000));
  return `${meta.freshness}:${ageS}s`;
}

function focusedInterrupt(preferFocusedTeammate = true) {
  const interrupts = Array.isArray(state.interrupts) ? state.interrupts : [];
  if (!interrupts.length) return null;
  if (preferFocusedTeammate) {
    const teammate = selectedTeammate();
    const teammateId = teammate?.id || null;
    if (teammateId) {
      const match = interrupts.find(
        (item) => item?.teammate_id && String(item.teammate_id) === String(teammateId),
      );
      if (match) return match;
    }
  }
  if (state.selectedInterruptId) {
    const byId = interrupts.find(
      (item) => String(item.id) === String(state.selectedInterruptId),
    );
    if (byId) return byId;
  }
  return interrupts[0] || null;
}

function focusedApproval(preferFocusedTeammate = true) {
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  if (!approvals.length) return null;
  if (preferFocusedTeammate) {
    const teammate = selectedTeammate();
    const teammateId = teammate?.id || null;
    if (teammateId) {
      const match = approvals.find(
        (item) => item?.teammate_id && String(item.teammate_id) === String(teammateId),
      );
      if (match) return match;
    }
  }
  if (state.selectedApprovalTaskId) {
    const byTask = approvals.find(
      (item) => String(item.task_id || "") === String(state.selectedApprovalTaskId),
    );
    if (byTask) return byTask;
  }
  return approvals[0] || null;
}

function syncFocusSelections(preferFocusedTeammate = true) {
  const interrupt = focusedInterrupt(preferFocusedTeammate);
  state.selectedInterruptId = interrupt?.id || null;
  const approval = focusedApproval(preferFocusedTeammate);
  state.selectedApprovalTaskId = approval?.task_id || null;
  if ($("approval-task-id")) $("approval-task-id").value = approval?.task_id || "";
}

function focusedRouteModes() {
  const fromSnapshot = state.detail?.focused_teammate_live?.route_mode_preference;
  if (Array.isArray(fromSnapshot) && fromSnapshot.length) return fromSnapshot;
  return [...ROUTE_MODE_PREFERENCE];
}

function focusedRouteLabels() {
  const fromSnapshot = state.detail?.focused_teammate_live?.stream_fallback_order;
  if (Array.isArray(fromSnapshot) && fromSnapshot.length) return fromSnapshot;
  return [...ROUTE_LABEL_PREFERENCE];
}

function hydrateFocusTargets() {
  const teammate = selectedTeammate();
  if (teammate) {
    if ($("target-agent")) $("target-agent").value = teammate.display_name || teammate.name || "";
    if ($("target-session")) $("target-session").value = teammate.session_id || "";
  }
  const interrupt = focusedInterrupt(true);
  if (interrupt?.session_id && $("target-session")) {
    $("target-session").value = interrupt.session_id;
  }
}

function routePillClass(routeMode = "") {
  if (routeMode === "native-live") return "p-route-native";
  if (routeMode === "tmux-mirror") return "p-route-tmux";
  return "p-route-sidecar";
}

function cacheLiveTeammates(teammates = [], ts = Date.now()) {
  const next = { ...(state.liveTeammatesById || {}) };
  for (const m of teammates || []) {
    const key = teammateLiveKey(m);
    if (!key) continue;
    next[key] = { teammate: m, updated_at_ms: ts };
  }
  state.liveTeammatesById = next;
  state.liveTeammatesAt = ts;
}

function selectedTeammate() {
  const teammates = state.detail?.teammates || [];
  return (
    teammates.find((m) => teammateLiveKey(m) === state.selectedMember) ||
    teammates[0] ||
    null
  );
}

function selectFocusedRoute(teammate) {
  const nativeAvailable = Boolean(
    state.native?.adapter_ok ?? state.native?.native?.available,
  );
  const hasNativeIdentity = Boolean(
    teammate?.native_agent_id || teammate?.claude_session_id,
  );
  const freshnessMeta = focusedFreshnessMeta(teammate);
  const sidecarLiveAvailable = freshnessMeta.freshness === LIVE_FRESHNESS.FRESH;
  const hasTmuxMirror = Boolean(
    teammate?.tmux_pane_id || teammate?.current_task_ref || teammate?.worker_task_id,
  );
  const base = {
    ...freshnessMeta,
    route_mode_preference: focusedRouteModes(),
    stream_fallback_order: focusedRouteLabels(),
  };

  if (nativeAvailable && hasNativeIdentity) {
    return {
      ...base,
      route_mode: "native-live",
      route_label: "native live",
      route_reason: "native adapter available with teammate native identity",
      fallback_reason: null,
      source_truth: "native adapter live state mirror (not in-process rendering)",
    };
  }
  if (sidecarLiveAvailable) {
    return {
      ...base,
      route_mode: "sidecar-live",
      route_label: "sidecar live",
      route_reason: "runtime/SSE teammate stream available",
      fallback_reason: null,
      source_truth: "sidecar runtime live state stream",
    };
  }
  if (hasTmuxMirror) {
    const fallbackReason =
      freshnessMeta.freshness === LIVE_FRESHNESS.STALE
        ? "sidecar live stream stale; tmux mirror fallback"
        : "native and sidecar live streams unavailable; tmux mirror fallback";
    return {
      ...base,
      route_mode: "tmux-mirror",
      route_label: "tmux mirror",
      route_reason: fallbackReason,
      fallback_reason: fallbackReason,
      source_truth: "tmux terminal mirror fallback",
    };
  }
  const fallbackReason =
    freshnessMeta.freshness === LIVE_FRESHNESS.STALE
      ? "sidecar live stream stale and no tmux mirror; snapshot metadata fallback"
      : "runtime snapshot teammate metadata only";
  return {
    ...base,
    route_mode: "sidecar-live",
    route_label: "sidecar live",
    route_reason: fallbackReason,
    fallback_reason: fallbackReason,
    source_truth: "sidecar snapshot metadata only",
  };
}

function cycleFocusedTeammate(delta) {
  const teammates = state.detail?.teammates || [];
  if (!teammates.length) return null;
  const currentIdx = teammates.findIndex(
    (m) => teammateLiveKey(m) === state.selectedMember,
  );
  if (currentIdx < 0) {
    const bootstrapIdx = delta >= 0 ? 0 : teammates.length - 1;
    state.selectedMember = teammateLiveKey(teammates[bootstrapIdx]);
    return teammates[bootstrapIdx];
  }
  const nextIdx = ((currentIdx + delta) % teammates.length + teammates.length) % teammates.length;
  state.selectedMember = teammateLiveKey(teammates[nextIdx]);
  return teammates[nextIdx];
}

function stopFocusedMirrorPolling() {
  if (state.focusedMirrorTimer) {
    clearInterval(state.focusedMirrorTimer);
    state.focusedMirrorTimer = null;
  }
  state.focusedMirrorKey = null;
}

function ensureFocusedMirrorPolling(teammate, routeMode) {
  const key = teammateLiveKey(teammate);
  if (!teammate || routeMode !== "tmux-mirror" || !key) {
    stopFocusedMirrorPolling();
    return;
  }
  if (state.focusedMirrorTimer && state.focusedMirrorKey === key) return;
  stopFocusedMirrorPolling();
  state.focusedMirrorKey = key;
  state.focusedMirrorTimer = setInterval(() => {
    const current = selectedTeammate();
    if (!current || teammateLiveKey(current) !== key) {
      stopFocusedMirrorPolling();
      return;
    }
    fetchTeammateMirror(current).catch(() => {});
  }, 700);
}

function scheduleFocusedPanelRender() {
  const nonce = (state.focusRenderNonce || 0) + 1;
  state.focusRenderNonce = nonce;
  setTimeout(() => {
    if (state.focusRenderNonce !== nonce) return;
    renderDetail();
    renderApprovalInbox();
    renderAlerts();
  }, 0);
}

function applyFocusedTeammateSelection(delta, statusPrefix = "Focused teammate") {
  const m = cycleFocusedTeammate(delta);
  if (!m) return null;
  syncFocusSelections(true);
  hydrateFocusTargets();
  renderFocusedTeammate();
  scheduleFocusedPanelRender();
  $("status").textContent = `${statusPrefix}: ${m.display_name || m.name || m.id || "-"}`;
  return m;
}

function loadUiPrefsLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(prefsKey()) || "{}");
    state.uiPrefs = {
      ...state.uiPrefs,
      ...parsed,
      hotkeys: { ...defaultHotkeys(), ...(parsed.hotkeys || {}) },
      macros: Array.isArray(parsed.macros) ? parsed.macros : [],
    };
  } catch {
    state.uiPrefs.hotkeys = defaultHotkeys();
  }
  if (!state.uiPrefs.hotkeys) state.uiPrefs.hotkeys = defaultHotkeys();
}

function saveUiPrefsLocal() {
  localStorage.setItem(prefsKey(), JSON.stringify(state.uiPrefs));
  saveServerPrefs();
}

function applyUiPrefsToControls() {
  if ($("focus-mode")) $("focus-mode").value = state.uiPrefs.focusMode || "all";
  if ($("focus-filter")) $("focus-filter").value = state.uiPrefs.filter || "";
  if ($("layout-density"))
    $("layout-density").value = state.uiPrefs.density || "standard";
  if ($("hotkeys-json"))
    $("hotkeys-json").value = JSON.stringify(
      state.uiPrefs.hotkeys || defaultHotkeys(),
      null,
      2,
    );
  if ($("macros-json"))
    $("macros-json").value = JSON.stringify(
      state.uiPrefs.macros || [],
      null,
      2,
    );
  document.body.dataset.density = state.uiPrefs.density || "standard";
  document.body.dataset.focus = state.uiPrefs.focusMode || "all";
}

// B6: Server-side prefs loading
async function loadServerPrefs() {
  try {
    const data = await api("/ui/preferences");
    if (data?.preferences && typeof data.preferences === "object") {
      state.uiPrefs = {
        ...state.uiPrefs,
        ...data.preferences,
        hotkeys: {
          ...defaultHotkeys(),
          ...(data.preferences.hotkeys || {}),
          ...(state.uiPrefs.hotkeys || {}),
        },
        macros: Array.isArray(data.preferences.macros)
          ? data.preferences.macros
          : state.uiPrefs.macros,
      };
      applyUiPrefsToControls();
    }
  } catch {}
}

async function saveServerPrefs() {
  try {
    await api("/ui/preferences", {
      method: "PUT",
      body: JSON.stringify(state.uiPrefs),
    });
  } catch {}
}

function getFocusMode() {
  return $("focus-mode")?.value || state.uiPrefs.focusMode || "all";
}
function getFocusFilter() {
  return ($("focus-filter")?.value || state.uiPrefs.filter || "")
    .trim()
    .toLowerCase();
}

function passesTextFilter(obj) {
  const q = getFocusFilter();
  if (!q) return true;
  const hay = JSON.stringify(obj || {}).toLowerCase();
  return hay.includes(q);
}

async function api(path, opts = {}) {
  const targetPath = String(path || "");
  const apiPath = targetPath.startsWith("/v1/")
    ? targetPath
    : targetPath.startsWith("/")
      ? `/v1${targetPath}`
      : `/v1/${targetPath}`;
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (
    (opts.method || "GET") !== "GET" &&
    state.csrfToken &&
    !headers["X-Sidecar-CSRF"]
  ) {
    headers["X-Sidecar-CSRF"] = state.csrfToken;
  }
  const res = await fetch(apiPath, { ...opts, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      json.message || json.error || json.reason || res.statusText,
    );
  return json;
}

async function loadUiBootstrap() {
  try {
    const data = await api("/ui/bootstrap.json");
    state.csrfToken = data.csrf_token || null;
  } catch {}
}

function forcePathValue() {
  const v = $("force-path").value || "";
  return v || undefined;
}

function nativeForceModeValue() {
  const v = $("native-force-mode")?.value || "";
  return v || undefined;
}

async function loadTeams() {
  const data = await api("/teams");
  state.teams = data.teams || [];
  state.native = data.native || state.native;
  if (!state.selectedTeam && state.teams[0])
    state.selectedTeam = state.teams[0].team_name;
  renderTeams();
  if (state.selectedTeam) await loadTeamDetail(state.selectedTeam);
  await loadActions();
  renderNativeLane();
  renderFocusedTeammate();
}

async function loadActions() {
  const data = await api("/actions").catch(() => ({ actions: [] }));
  state.actions = data.actions || [];
  renderActions();
}

async function loadNativeStatus() {
  const data = await api("/native/status").catch((err) => ({
    adapter_ok: false,
    error: err.message,
  }));
  state.native = data;
  state.bridgeValidation = data.bridge_validation || state.bridgeValidation;
  renderNativeLane();
  renderBridgeValidation();
  renderFocusedTeammate();
}

async function loadBridgeValidation() {
  const data = await api("/native/bridge/validation").catch(() => ({
    ok: false,
    validation: null,
  }));
  state.bridgeValidation = data.validation || null;
  renderBridgeValidation();
}

async function loadInterrupts(teamName = state.selectedTeam) {
  if (!teamName) {
    state.interrupts = [];
    return;
  }
  const data = await api(
    `/teams/${encodeURIComponent(teamName)}/interrupts`,
  ).catch(() => ({ interrupts: [] }));
  state.interrupts = data.interrupts || [];
  syncFocusSelections(true);
  hydrateFocusTargets();
  renderAlerts();
}

// B1: Dedicated approval inbox
async function loadApprovals(teamName = state.selectedTeam) {
  if (!teamName) {
    state.approvals = [];
    return;
  }
  const data = await api(
    `/teams/${encodeURIComponent(teamName)}/approvals`,
  ).catch(() => ({ approvals: [] }));
  state.approvals = data.approvals || [];
  syncFocusSelections(true);
  hydrateFocusTargets();
  renderApprovalInbox();
}

function renderApprovalInbox() {
  const node = $("approval-inbox");
  if (!node) return;
  const approvals = (state.approvals || []).filter((a) => passesTextFilter(a));
  if (!approvals.length) {
    node.innerHTML = '<div class="mini">No pending approvals.</div>';
    return;
  }
  node.innerHTML = approvals
    .map(
      (a) => `
    <div class="approval-card ${String(a.task_id || "") === String(state.selectedApprovalTaskId || "") ? "active" : ""}" data-approval-task="${esc(a.task_id || "")}">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          <strong>${esc(a.teammate_name || "Worker")}</strong>
          <span class="mini"> — ${esc(a.title || "Plan approval needed")}</span>
        </div>
        <span class="pill warn">p=${esc(a.priority_score)}</span>
      </div>
      <div class="tiny" style="margin-top:4px">${esc(a.message || "")}</div>
      <div class="tiny mono">${esc(a.task_id || "")} ${a.safe_auto ? "· safe_auto" : "· needs review"}</div>
      <div class="actions" style="margin-top:8px">
        <button class="success" data-approval-op="approve" data-task-id="${esc(a.task_id || "")}">Approve</button>
        <button class="err" data-approval-op="reject-toggle" data-task-id="${esc(a.task_id || "")}">Reject</button>
      </div>
      <div class="feedback-inline" id="fb-${esc(a.task_id || "")}">
        <textarea placeholder="Revision feedback..." style="min-height:40px;margin-bottom:6px" data-fb-text="${esc(a.task_id || "")}"></textarea>
        <button class="err" data-approval-op="reject-confirm" data-task-id="${esc(a.task_id || "")}">Send Rejection</button>
      </div>
    </div>
  `,
    )
    .join("");

  node.querySelectorAll("[data-approval-task]").forEach((el) => {
    el.onclick = () => {
      const taskId = el.getAttribute("data-approval-task") || "";
      state.selectedApprovalTaskId = taskId || null;
      if ($("approval-task-id")) $("approval-task-id").value = taskId;
      renderApprovalInbox();
      renderFocusedTeammate();
    };
  });

  node.querySelectorAll("[data-approval-op]").forEach((el) => {
    el.onclick = async (evt) => {
      evt.stopPropagation();
      const op = el.getAttribute("data-approval-op");
      const taskId = el.getAttribute("data-task-id");
      state.selectedApprovalTaskId = taskId || null;
      try {
        if (op === "approve") {
          await runTeamAction("approve-plan", {
            task_id: taskId,
            message: "Approved from inbox",
          }, { refreshMode: "focused" });
          await loadApprovals();
        } else if (op === "reject-toggle") {
          const fb = document.getElementById(`fb-${taskId}`);
          if (fb) fb.classList.toggle("open");
        } else if (op === "reject-confirm") {
          const textarea = node.querySelector(`[data-fb-text="${taskId}"]`);
          const feedback = textarea?.value || "Needs revision";
          await runTeamAction("reject-plan", { task_id: taskId, feedback }, { refreshMode: "focused" });
          await loadApprovals();
        }
      } catch (err) {
        $("result").textContent = err.message;
      }
    };
  });
}

// C3: Task templates
async function loadTemplates() {
  const data = await api("/task-templates").catch(() => ({ templates: [] }));
  state.templates = data.templates || [];
  renderTemplateSelector();
}

function renderTemplateSelector() {
  const sel = $("task-template");
  if (!sel) return;
  sel.innerHTML =
    '<option value="">— none —</option>' +
    state.templates
      .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`)
      .join("");
  sel.onchange = () => {
    const tpl = state.templates.find((t) => t.id === sel.value);
    if (tpl) {
      if ($("dispatch-subject") && tpl.subject_template)
        $("dispatch-subject").value = tpl.subject_template;
      if ($("dispatch-prompt") && tpl.prompt_template)
        $("dispatch-prompt").value = tpl.prompt_template;
      if ($("dispatch-role") && tpl.role_hint)
        $("dispatch-role").value = tpl.role_hint;
      if ($("dispatch-priority") && tpl.priority)
        $("dispatch-priority").value = tpl.priority;
    }
  };
}

function csvList(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function agentPayloadFromForm(includeName = true) {
  const payload = {
    scope: $("agent-scope")?.value || "project",
    description: $("agent-description")?.value || undefined,
    model: $("agent-model")?.value || undefined,
    tools: csvList($("agent-tools")?.value || ""),
    memory: $("agent-memory")?.value || undefined,
    skills: csvList($("agent-skills")?.value || ""),
    prompt: $("agent-prompt")?.value || undefined,
  };
  if (includeName) payload.agent_name = $("agent-name")?.value || undefined;
  if (!payload.tools?.length) delete payload.tools;
  if (!payload.skills?.length) delete payload.skills;
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined && v !== ""),
  );
}

function renderAgents() {
  const node = $("agents-list");
  if (!node) return;
  const agents = Array.isArray(state.agents) ? state.agents : [];
  if (!agents.length) {
    node.innerHTML = '<div class="mini">No agents loaded.</div>';
    return;
  }
  node.innerHTML = agents
    .map(
      (agent) => `
    <div class="task-row" data-agent-name="${esc(agent.name || agent.id || "")}" data-agent-scope="${esc(agent.scope || "project")}">
      <div><strong>${esc(agent.name || agent.id || "unknown")}</strong> <span class="mini">${esc(agent.scope || "-")} ${agent.effective ? "· effective" : ""}</span></div>
      <div class="tiny">${esc(agent.model || "-")} · ${esc(agent.memory || "no memory")}</div>
      <div class="tiny">${esc(agent.description || "")}</div>
      <div class="tiny mono">${esc(agent.path || "-")}</div>
      ${
        Array.isArray(agent.errors) && agent.errors.length
          ? `<div class="tiny err">${esc(agent.errors.join(" | "))}</div>`
          : ""
      }
    </div>
  `,
    )
    .join("");
  node.querySelectorAll("[data-agent-name]").forEach((el) => {
    el.onclick = async () => {
      const name = el.getAttribute("data-agent-name");
      const scope = el.getAttribute("data-agent-scope");
      $("agent-name").value = name || "";
      if (scope) $("agent-scope").value = scope;
      await loadAgent(name, scope).catch((err) => {
        $("result").textContent = err.message;
      });
    };
  });
}

async function loadAgents() {
  const scope = $("agent-scope")?.value || "all";
  const query = new URLSearchParams({
    scope: scope === "all" ? "all" : scope,
    include_invalid: "true",
    include_shadowed: "true",
  });
  const data = await api(`/agents?${query.toString()}`).catch(() => ({
    agents: [],
  }));
  state.agents = Array.isArray(data.agents) ? data.agents : [];
  renderAgents();
}

async function loadAgent(name, scope = null) {
  if (!name) throw new Error("Agent name is required");
  const query = new URLSearchParams();
  if (scope && scope !== "all") query.set("scope", scope);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const data = await api(`/agents/${encodeURIComponent(name)}${suffix}`);
  state.agentDetail = data.agent || null;
  if (state.agentDetail) {
    $("agent-name").value = state.agentDetail.name || name;
    $("agent-scope").value = state.agentDetail.scope || $("agent-scope").value;
    $("agent-model").value = state.agentDetail.model || "";
    $("agent-description").value = state.agentDetail.description || "";
    $("agent-tools").value = (state.agentDetail.tools || []).join(", ");
    $("agent-skills").value = (state.agentDetail.skills || []).join(", ");
    $("agent-memory").value = state.agentDetail.memory || "";
    $("agent-prompt").value = state.agentDetail.prompt || "";
  }
  $("result").textContent = JSON.stringify(data, null, 2);
  return data;
}

async function simulateRoute(action = null, payload = null) {
  if (!state.selectedTeam) throw new Error("Select a team first");
  const chosenAction = action || $("route-sim-action")?.value || "dispatch";
  const simPayload = payload || buildRouteSimPayload(chosenAction);
  const data = await api("/route/simulate", {
    method: "POST",
    body: JSON.stringify({
      team_name: state.selectedTeam,
      action: chosenAction,
      payload: simPayload,
    }),
  });
  state.routeSimulation = data;
  renderRouteSimulation();
  return data;
}

async function loadTeamDetail(teamName) {
  state.selectedTeam = teamName;
  state.detail = await api(`/teams/${encodeURIComponent(teamName)}`);
  state.alerts = state.detail.alerts || [];
  cacheLiveTeammates(state.detail.teammates || [], Date.now());
  if (
    !state.selectedMember ||
    !(state.detail.teammates || []).some(
      (m) => teammateLiveKey(m) === state.selectedMember,
    )
  ) {
    state.selectedMember = state.detail.teammates?.length
      ? teammateLiveKey(state.detail.teammates[0])
      : null;
  }
  syncFocusSelections(true);
  hydrateFocusTargets();
  await loadRebalanceExplain(teamName).catch(() => {
    state.rebalanceExplain = null;
  });
  await loadInterrupts(teamName).catch(() => {
    state.interrupts = [];
  });
  renderTeams();
  renderDetail();
  renderAlerts();
  renderRebalanceExplain();
  renderNativeLane();
  renderRouteSimulation();
  renderFocusedTeammate();
}

async function loadRebalanceExplain(teamName = state.selectedTeam) {
  if (!teamName) {
    state.rebalanceExplain = null;
    return;
  }
  const data = await api(
    `/teams/${encodeURIComponent(teamName)}/rebalance-explain?limit=10`,
  );
  state.rebalanceExplain = data;
}

function renderTeams() {
  const node = $("teams");
  node.innerHTML = "";
  for (const team of state.teams) {
    const div = document.createElement("div");
    div.className = `team-row ${state.selectedTeam === team.team_name ? "active" : ""}`;
    div.innerHTML = `
      <div><strong>${esc(team.team_name)}</strong></div>
      <div class="mini">${esc(team.execution_path || "hybrid")} · queued ${team.summary?.queued_tasks ?? 0} · active ${team.summary?.active ?? 0} · blocked ${team.summary?.blocked ?? 0}</div>
      <div class="tiny">${esc(team.low_overhead_mode || "advanced")}</div>`;
    div.onclick = () => loadTeamDetail(team.team_name);
    node.appendChild(div);
  }
  if (!state.teams.length)
    node.innerHTML =
      '<div class="mini">No teams found. Create one with coordinator tools.</div>';
}

function selectedMemberObj() {
  return selectedTeammate();
}

function renderDetail() {
  const node = $("detail");
  if (!state.detail) {
    node.innerHTML = '<div class="mini">Select a team.</div>';
    return;
  }
  const {
    team,
    teammates = [],
    tasks = [],
    timeline = [],
    native,
  } = state.detail;
  const focus = getFocusMode();
  const visibleTasks = tasks.filter((t) => {
    if (focus === "dispatch") return passesTextFilter(t);
    if (focus === "approval")
      return (
        (t.status === "in_progress" || t.dispatch_status === "spawned") &&
        passesTextFilter(t)
      );
    if (focus === "recovery") return passesTextFilter(t);
    return passesTextFilter(t);
  });
  const visibleTimeline = timeline.filter((e) => passesTextFilter(e));
  const selected = selectedMemberObj() || teammates[0] || null;
  const membersHtml = teammates
    .map(
      (m) => `
    <div class="member-row ${state.selectedMember === teammateLiveKey(m) ? "active" : ""}" data-member-id="${esc(teammateLiveKey(m))}">
      <div><strong>${esc(m.display_name)}</strong> <span class="mini">(${esc(m.role)})</span></div>
      <div class="mini"><span class="pill ${presenceClass(m.presence)}">${esc(m.presence)}</span> load=${m.load_score} ready=${m.dispatch_readiness}</div>
      <div class="tiny mono">task=${esc(m.current_task_ref || "-")} session=${esc(m.session_id || "-")}</div>
      <div class="tiny">risks=${esc((m.risk_flags || []).join(",") || "none")}</div>
    </div>
  `,
    )
    .join("");

  const tasksHtml = visibleTasks
    .map((t) => {
      const explain = t.metadata?.dispatch?.rebalance_last;
      return `
      <div class="task-row">
        <div><strong>${esc(t.task_id)}</strong> <span class="mini">${esc(t.priority)} · ${esc(t.status)} / ${esc(t.dispatch_status)}</span></div>
        <div>${esc(t.subject)}</div>
        <div class="tiny">assignee=${esc(t.assignee || "-")} worker=${esc(t.worker_task_id || "-")}</div>
        ${explain ? `<div class="tiny">rebalance: ${esc(explain.assignee_from || "none")} -> ${esc(explain.assignee_to || "-")}; score=${esc(explain.score)}</div>` : ""}
      </div>`;
    })
    .join("");

  const eventsHtml = visibleTimeline
    .slice(-16)
    .map(
      (e) => `
    <div class="event-row"><div class="tiny mono">${esc(e.ts || e.t || "")}</div><div>${esc(e.type || e.tool || e.event || JSON.stringify(e).slice(0, 120))}</div></div>`,
    )
    .join("");

  const teammateDetail = selected
    ? `
    <div class="section">
      <h3>Teammate Detail</h3>
      <div><strong>${esc(selected.display_name)}</strong> <span class="mini">(${esc(selected.role)})</span></div>
      <div class="mini"><span class="pill ${presenceClass(selected.presence)}">${esc(selected.presence)}</span> load=${selected.load_score} ready=${selected.dispatch_readiness}</div>
      <div class="tiny mono">session=${esc(selected.session_id || "-")} current_task=${esc(selected.current_task_ref || "-")}</div>
      <div class="tiny">last_tool=${esc(selected.last_tool || "-")} risks=${esc((selected.risk_flags || []).join(",") || "none")}</div>
      <div class="tiny">files=${esc((selected.files_touched || []).slice(-5).join(", ") || "none")}</div>
      <div class="tiny">ops=${esc((selected.recent_ops || []).map((x) => x.tool || x.file || "?").join(" | ") || "none")}</div>
    </div>`
    : "";

  node.innerHTML = `
    <div class="grid3">
      <div><div class="mini">Execution</div><div><strong>${esc(team.execution_path || "hybrid")}</strong></div></div>
      <div><div class="mini">Overhead</div><div><strong>${esc(team.low_overhead_mode || "advanced")}</strong></div></div>
      <div><div class="mini">Native</div><div><strong>${esc(state.native?.mode || native?.mode || "unknown")}</strong></div></div>
    </div>
    <div class="section" style="margin-top:10px"><h3>Members</h3>${membersHtml || '<div class="mini">No members</div>'}</div>
    ${teammateDetail}
    <div class="section"><h3>Task Queue / Board View</h3>${tasksHtml || '<div class="mini">No tasks</div>'}</div>
    <div class="section"><h3>Timeline</h3>${eventsHtml || '<div class="mini">No events</div>'}</div>
  `;

  node.querySelectorAll("[data-member-id]").forEach((el) => {
    el.onclick = () => {
      state.selectedMember = el.getAttribute("data-member-id");
      const m = selectedMemberObj();
      if (m) {
        $("target-agent").value = m.display_name || "";
        $("target-session").value = m.session_id || "";
      }
      syncFocusSelections(true);
      hydrateFocusTargets();
      renderFocusedTeammate();
      scheduleFocusedPanelRender();
    };
  });
}

async function fetchTeammateMirror(teammate) {
  if (!state.selectedTeam || !teammate) return;
  const key = teammateLiveKey(teammate);
  try {
    const out = await api(
      `/teams/${encodeURIComponent(state.selectedTeam)}/teammates/${encodeURIComponent(key)}/mirror`,
    );
    if (
      state.focusedTeammate &&
      state.focusedTeammate.key === key &&
      state.focusedTeammate.route_mode === "tmux-mirror"
    ) {
      state.focusedTeammate.mirror_output = out.output || null;
      state.focusedTeammate.mirror_at = out.generated_at || new Date().toISOString();
      renderFocusedTeammate();
    }
  } catch {
    if (
      state.focusedTeammate &&
      state.focusedTeammate.key === key &&
      state.focusedTeammate.route_mode === "tmux-mirror"
    ) {
      state.focusedTeammate.mirror_output = null;
      renderFocusedTeammate();
    }
  }
}

function renderFocusedTeammate() {
  const node = $("focused-teammate");
  if (!node) return;
  const teammate = selectedTeammate();
  if (!teammate) {
    stopFocusedMirrorPolling();
    state.focusedTeammate = null;
    node.innerHTML = '<div class="mini">Select a teammate to start live focus.</div>';
    return;
  }
  const key = teammateLiveKey(teammate);
  const route = selectFocusedRoute(teammate);
  const live = state.liveTeammatesById[key]?.teammate || teammate;
  const liveAge = route.live_age_ms != null ? `${Math.max(0, Math.round(route.live_age_ms / 1000))}s` : "n/a";
  const model = {
    key,
    teammate,
    live,
    ...route,
    mirror_output:
      state.focusedTeammate?.key === key ? state.focusedTeammate?.mirror_output : null,
    mirror_at: state.focusedTeammate?.key === key ? state.focusedTeammate?.mirror_at : null,
  };
  state.focusedTeammate = model;
  ensureFocusedMirrorPolling(teammate, route.route_mode);
  if (
    route.route_mode === "tmux-mirror" &&
    state.focusedTeammate.mirror_output === null
  ) {
    fetchTeammateMirror(teammate).catch(() => {});
  }
  const interrupt = focusedInterrupt(true);
  const approval = focusedApproval(true);
  const routePreference = (route.route_mode_preference || focusedRouteModes()).join(" > ");
  const fallbackOrder = (route.stream_fallback_order || focusedRouteLabels()).join(" > ");

  const output =
    route.route_mode === "tmux-mirror"
      ? model.mirror_output || "[tmux mirror unavailable yet]"
      : [
          `presence=${live.presence || "-"}`,
          `task=${live.current_task_ref || live.worker_task_id || "-"}`,
          `session=${live.session_id || "-"}`,
          `agent=${live.native_agent_id || "-"}`,
          `last_tool=${live.last_tool || "-"}`,
          `risk=${(live.risk_flags || []).join(",") || "none"}`,
          `recent_ops=${(live.recent_ops || [])
            .slice(-6)
            .map((x) => x.tool || x.file || "?")
            .join(" | ") || "none"}`,
          "Note: this is not in-process native rendering; it is live state mirrored by sidecar.",
        ].join("\n");

  node.innerHTML = `
    <div class="tiny"><strong>${esc(live.display_name || live.name || "teammate")}</strong> · role=${esc(live.role || "-")} · <span class="pill ${routePillClass(route.route_mode)}">${esc(route.route_label)}</span></div>
    <div class="kvline"><span class="key">route_mode</span><span class="value">${esc(route.route_mode)}</span><span class="key">freshness</span><span class="value">${esc(formatFreshness(route))}</span><span class="key">live_age</span><span class="value">${esc(liveAge)}</span><span class="key">stale_after</span><span class="value">${esc(`${Math.round((route.stale_after_ms || LIVE_STALE_AFTER_MS) / 1000)}s`)}</span></div>
    <div class="kvline"><span class="key">reason</span><span class="value">${esc(route.route_reason || "-")}</span></div>
    ${
      route.fallback_reason
        ? `<div class="kvline warn"><span class="key">fallback_reason</span><span class="value">${esc(route.fallback_reason)}</span></div>`
        : ""
    }
    <div class="kvline"><span class="key">source_truth</span><span class="value">${esc(route.source_truth || "sidecar mirrored state")}</span></div>
    <div class="kvline"><span class="key">preference</span><span class="value">${esc(routePreference)}</span><span class="key">fallback_order</span><span class="value">${esc(fallbackOrder)}</span></div>
    <div class="kvline"><span class="key">selected_interrupt</span><span class="value">${esc(interrupt?.code || interrupt?.kind || "none")}</span><span class="key">selected_approval</span><span class="value">${esc(approval?.task_id || "none")}</span></div>
    <pre style="margin-top:8px">${esc(String(output || "").slice(-4000))}</pre>
  `;
}

function renderNativeLane() {
  const node = $("native-lane");
  const n = state.native || {};
  const caps = n.native || n.capabilities || {};
  const bridge = n.bridge || caps.bridge || {};
  const tools = caps.tools || {};
  const metrics = state.metrics || {};
  node.innerHTML = `
    <div class="tiny">adapter_ok: <strong class="${n.adapter_ok || caps.available ? "ok" : "err"}">${esc(String(Boolean(n.adapter_ok ?? caps.available)))}</strong></div>
    <div class="tiny">mode: <strong>${esc(n.mode || caps.mode || "unknown")}</strong></div>
    <div class="tiny">bridge: <strong class="${bridge.bridge_status === "healthy" ? "ok" : bridge.bridge_status ? "warn" : ""}">${esc(bridge.bridge_status || caps.bridge_status || "down")}</strong> ${bridge.session_id ? `| session=${esc(bridge.session_id)}` : ""}</div>
    <div class="tiny">tools: TeamCreate=${tools.TeamCreate ? "Y" : "N"} TeamStatus=${tools.TeamStatus ? "Y" : "N"} SendMessage=${tools.SendMessage ? "Y" : "N"} Task=${tools.Task ? "Y" : "N"}</div>
    <div class="tiny">probe: ${esc(caps.last_probe_at || "none")} ${caps.last_probe_error ? `| err=${esc(caps.last_probe_error)}` : ""}</div>
    ${metrics?.action_latency_ms ? `<div class="tiny">p95 action latency: ${esc(metrics.action_latency_ms.p95 ?? "n/a")}ms</div>` : ""}
    ${
      metrics?.by_path
        ? `<div class="tiny">path p95: ${esc(
            Object.entries(metrics.by_path)
              .map(([k, v]) => `${k}=${v.p95 ?? "n/a"}ms`)
              .join(" | ") || "n/a",
          )}</div>`
        : ""
    }
  `;
}

function renderBridgeValidation() {
  const node = $("bridge-validation");
  if (!node) return;
  const v = state.bridgeValidation;
  if (!v) {
    node.innerHTML = '<div class="mini">No bridge validation report yet.</div>';
    return;
  }
  const diag = v.diagnostics || {};
  const pre = diag.pre_health || {};
  const post = diag.post_health || {};
  node.innerHTML = `
    <div class="section">
      <h3>Bridge Validation</h3>
      <div class="tiny">status: <strong class="${v.ok ? "ok" : "err"}">${esc(v.ok ? "PASS" : "FAIL")}</strong> · latency=${esc(v.latency_ms ?? "n/a")}ms · simulate=${esc(String(Boolean(v.simulate)))}</div>
      <div class="tiny">pre=${esc(pre.bridge_status || "-")} · post=${esc(post.bridge_status || "-")} · q=${esc(String(diag.queue_counts_before?.request_queue ?? 0))}/${esc(String(diag.queue_counts_before?.response_queue ?? 0))} -> ${esc(String(diag.queue_counts_after?.request_queue ?? 0))}/${esc(String(diag.queue_counts_after?.response_queue ?? 0))}</div>
      ${v.error ? `<div class="tiny err">${esc(v.error.code || v.error.message || "bridge validation failed")}</div>` : ""}
      <div class="tiny mono">${esc(v.finished_at || v.started_at || "")}</div>
    </div>
  `;
}

function renderAlerts() {
  const node = $("alerts");
  const focus = getFocusMode();
  let interrupts = Array.isArray(state.interrupts) ? [...state.interrupts] : [];
  if (focus === "approval")
    interrupts = interrupts.filter((i) => i.kind === "approval");
  if (focus === "recovery")
    interrupts = interrupts.filter((i) =>
      ["stale", "alert", "risk"].includes(i.kind),
    );
  if (focus === "dispatch")
    interrupts = interrupts.filter(
      (i) => i.kind !== "alert" || i.code.includes("bridge"),
    );
  interrupts = interrupts.filter((i) => passesTextFilter(i)).slice(0, 40);

  node.innerHTML = interrupts.length
    ? interrupts
        .map(
          (i) => `
    <div class="alert-row ${String(i.id) === String(state.selectedInterruptId || "") ? "active" : ""}" data-int-id="${esc(i.id)}">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><strong class="${i.severity === "error" ? "err" : i.severity === "warn" ? "warn" : ""}">${esc(i.code || i.kind)}</strong></div>
        <div class="tiny">p=${esc(i.priority_score)}</div>
      </div>
      <div class="tiny">${esc(i.title || "")}</div>
      <div class="tiny">${esc(i.message || "")}</div>
      <div class="tiny mono">${esc(i.teammate_name || i.task_id || i.session_id || i.action_id || i.request_id || "")}</div>
      <div class="actions" style="margin-top:6px">
        ${i.kind === "approval" && i.task_id ? `<button data-int-op="approve" data-task-id="${esc(i.task_id)}">Approve</button><button class="warn" data-int-op="reject" data-task-id="${esc(i.task_id)}">Reject</button>` : ""}
        ${i.kind === "stale" && i.session_id ? `<button data-int-op="wake" data-session-id="${esc(i.session_id)}">Wake</button>` : ""}
        ${i.code === "bridge_stuck_request" ? `<button data-int-op="bridge-validate">Bridge Validate</button><button class="warn" data-int-op="bridge-ensure">Bridge Ensure</button>` : ""}
        ${i.action_id ? `<button data-int-op="view-action" data-action-id="${esc(i.action_id)}">View Action</button>` : ""}
      </div>
    </div>
  `,
        )
        .join("")
    : '<div class="mini">No interrupts in current focus.</div>';

  node.querySelectorAll("[data-int-id]").forEach((el) => {
    el.onclick = () => {
      const id = el.getAttribute("data-int-id") || "";
      state.selectedInterruptId = id || null;
      const selected = (state.interrupts || []).find((item) => String(item.id) === String(id));
      if (selected?.task_id && $("approval-task-id")) $("approval-task-id").value = selected.task_id;
      if (selected?.session_id && $("target-session")) $("target-session").value = selected.session_id;
      renderAlerts();
      renderFocusedTeammate();
    };
  });

  node.querySelectorAll("[data-int-op]").forEach((el) => {
    el.onclick = async (evt) => {
      evt.stopPropagation();
      const op = el.getAttribute("data-int-op");
      const card = el.closest("[data-int-id]");
      if (card) state.selectedInterruptId = card.getAttribute("data-int-id") || null;
      try {
        if (op === "approve") {
          const taskId = el.getAttribute("data-task-id");
          $("approval-task-id").value = taskId || "";
          $("approval-mode").value = "approve";
          await runTeamAction("approve-plan", {
            task_id: taskId,
            message: "Approved from interrupt inbox",
          }, { refreshMode: "focused" });
          return;
        }
        if (op === "reject") {
          const taskId = el.getAttribute("data-task-id");
          $("approval-task-id").value = taskId || "";
          $("approval-mode").value = "reject";
          await runTeamAction("reject-plan", {
            task_id: taskId,
            feedback: "Rejected from interrupt inbox",
          }, { refreshMode: "focused" });
          return;
        }
        if (op === "wake") {
          const sid = el.getAttribute("data-session-id");
          $("target-session").value = sid || "";
          await runTeamAction("wake", {
            session_id: sid,
            message: "Wake from interrupt inbox",
          }, { refreshMode: "focused" });
          return;
        }
        if (op === "bridge-validate") return $("btn-bridge-validate").click();
        if (op === "bridge-ensure") return $("btn-bridge-ensure").click();
        if (op === "view-action") {
          const id = el.getAttribute("data-action-id");
          const rec = await api(`/actions/${encodeURIComponent(id)}`);
          $("result").textContent = JSON.stringify(rec, null, 2);
          return;
        }
      } catch (err) {
        $("result").textContent = err.message;
      }
    };
  });
}

function renderActions() {
  const node = $("actions-list");
  const focus = getFocusMode();
  let actions = [...(state.actions || [])];
  if (focus === "recovery")
    actions = actions.filter(
      (a) => a.state === "failed" || a.fallback_used || a.error,
    );
  if (focus === "dispatch")
    actions = actions.filter((a) =>
      ["dispatch", "queue-task", "assign-next", "rebalance"].includes(a.action),
    );
  if (focus === "approval")
    actions = actions.filter((a) =>
      ["approve-plan", "reject-plan"].includes(a.action),
    );
  actions = actions.filter((a) => passesTextFilter(a));
  node.innerHTML =
    actions
      .slice(0, 20)
      .map(
        (a) => `
    <div class="action-row" data-action-id="${esc(a.action_id)}">
      <div><strong>${esc(a.action)}</strong> <span class="mini">${esc(a.state)}</span></div>
      <div class="tiny">${esc(a.adapter || "-")}/${esc(a.path_mode || "-")} · team=${esc(a.team_name || "-")} ${a.fallback_used ? "· fallback" : ""}</div>
      <div class="tiny mono">${esc(a.action_id)} ${a.latency_ms ? `· ${a.latency_ms}ms` : ""} ${a.error ? "· err" : ""}</div>
      <div class="actions" style="margin-top:6px">
        <button data-action-op="view" data-action-id="${esc(a.action_id)}">View</button>
        ${a.state === "failed" || a.state === "done" ? `<button data-action-op="retry" data-action-id="${esc(a.action_id)}">Retry</button>` : ""}
        ${a.state === "failed" ? `<button class="warn" data-action-op="force-coordinator" data-action-id="${esc(a.action_id)}">Force Coord</button>` : ""}
        ${a.state === "failed" ? `<button class="warn" data-action-op="force-native" data-action-id="${esc(a.action_id)}">Force Native</button>` : ""}
      </div>
    </div>
  `,
      )
      .join("") || '<div class="mini">No actions yet.</div>';
  node.querySelectorAll("[data-action-op]").forEach((el) => {
    el.onclick = async () => {
      const id = el.getAttribute("data-action-id");
      const op = el.getAttribute("data-action-op");
      try {
        if (op === "view") {
          const rec = await api(`/actions/${encodeURIComponent(id)}`);
          $("result").textContent = JSON.stringify(rec, null, 2);
          return;
        }
        if (op === "retry") {
          const out = await api(`/actions/${encodeURIComponent(id)}/retry`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          $("result").textContent = actionResultText(out);
          await refreshAll();
          return;
        }
        if (op === "force-coordinator" || op === "force-native") {
          const out = await api(`/actions/${encodeURIComponent(id)}/fallback`, {
            method: "POST",
            body: JSON.stringify({
              force_path: op === "force-native" ? "native" : "coordinator",
            }),
          });
          $("result").textContent = actionResultText(out);
          await refreshAll();
          return;
        }
      } catch (err) {
        $("result").textContent = err.message;
      }
    };
  });
}

function renderRebalanceExplain() {
  const node = $("rebalance-explain");
  if (!node) return;
  const tasks = state.detail?.tasks || [];
  const withExplain = tasks
    .map((t) => ({
      task: t,
      explain: t?.metadata?.dispatch?.rebalance_last || null,
    }))
    .filter((x) => x.explain);
  const preview = state.rebalancePreview;
  const explainData = state.rebalanceExplain;

  const explainCards = withExplain.length
    ? withExplain
        .map(
          ({ task, explain }) => `
    <div class="task-row">
      <div><strong>${esc(task.task_id)}</strong> <span class="mini">${esc(task.subject || "")}</span></div>
      <div class="tiny">${esc(explain.assignee_from || "unassigned")} -> ${esc(explain.assignee_to || "-")} · score=${esc(explain.score)}</div>
      <div class="tiny">${esc((explain.reasons || []).join("; ") || "no reasons")}</div>
      <div class="tiny mono">${esc(explain.at || "")}</div>
    </div>
  `,
        )
        .join("")
    : '<div class="mini">No rebalance history yet. Run a rebalance or preview.</div>';

  const structuredCards =
    Array.isArray(explainData?.tasks) && explainData.tasks.length
      ? explainData.tasks
          .map((t) => {
            const valid = (t.candidates || []).filter(
              (c) => c.valid && typeof c.score === "number",
            );
            const maxScore = valid.length
              ? Math.max(...valid.map((c) => c.score))
              : 1;
            const candidateRows = (t.candidates || [])
              .slice(0, 6)
              .map((c) => {
                const pct =
                  c.valid && typeof c.score === "number"
                    ? Math.max(4, Math.round((c.score / (maxScore || 1)) * 100))
                    : 0;
                const barColor = !c.valid
                  ? "rgba(255,107,107,.45)"
                  : c.rank === 1
                    ? "rgba(83,209,125,.55)"
                    : "rgba(78,161,255,.42)";
                const comps = parseScoreComponents(c.reasons || []);
                const bonus = comps
                  .filter((x) => typeof x.delta === "number" && x.delta > 0)
                  .reduce((s, x) => s + x.delta, 0);
                const penalty = comps
                  .filter((x) => typeof x.delta === "number" && x.delta < 0)
                  .reduce((s, x) => s + x.delta, 0);
                const reasons = comps
                  .map((x) => {
                    const cls =
                      typeof x.delta !== "number"
                        ? ""
                        : x.delta >= 0
                          ? "ok"
                          : "err";
                    const label =
                      typeof x.delta === "number"
                        ? `${x.label} ${x.delta >= 0 ? "+" : ""}${x.delta}`
                        : x.label;
                    return `<span class="pill ${cls}">${esc(label)}</span>`;
                  })
                  .join("");
                return `
          <div class="task-row" style="cursor:default">
            <div style="display:flex;justify-content:space-between;gap:8px">
              <div><strong>#${esc(c.rank)} ${esc(c.name)}</strong> <span class="mini">(${esc(c.role || "-")})</span></div>
              <div class="mini">${c.valid ? `score=${esc(c.score)}` : '<span class="err">ineligible</span>'}</div>
            </div>
            <div class="tiny">${esc(c.presence || "-")} · load=${esc(c.load_score)} · intr=${esc(c.interruptibility_score)} · ready=${esc(c.dispatch_readiness)}</div>
            ${c.valid ? `<div class="tiny">components: bonus=${esc(bonus)} penalty=${esc(penalty)} total=${esc(c.score)}</div>` : ""}
            <div style="margin-top:6px;height:8px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;border:1px solid rgba(255,255,255,.06)">
              <div style="width:${pct}%;height:100%;background:${barColor}"></div>
            </div>
            <div class="tiny" style="margin-top:6px">${reasons || '<span class="mini">No scoring reasons</span>'}</div>
          </div>
        `;
              })
              .join("");
            return `
        <div class="section" style="margin-bottom:8px">
          <h3>${esc(t.task_id)} · ${esc(t.subject || "")}</h3>
          <div class="tiny">priority=${esc(t.priority || "normal")} · current=${esc(t.current_assignee || "unassigned")} · recommended=<strong>${esc(t.recommended_assignee || "-")}</strong> ${typeof t.recommended_score === "number" ? `(score ${esc(t.recommended_score)})` : ""}</div>
          <div class="tiny">role_hint=${esc(t.role_hint || "-")} · blockers=${esc((t.blocked_by || []).join(",") || "none")}</div>
          <div style="margin-top:8px">${candidateRows || '<div class="mini">No candidates</div>'}</div>
        </div>
      `;
          })
          .join("")
      : '<div class="mini">No structured rebalance analysis available.</div>';

  const previewBlock = preview
    ? `
    <div class="section" style="margin-top:8px">
      <h3>Latest Dry-Run Preview</h3>
      <pre>${esc(preview)}</pre>
    </div>
  `
    : "";

  node.innerHTML = `
    <div class="section" style="margin-bottom:8px">
      <h3>Candidate Scoring (Live)</h3>
      ${structuredCards}
    </div>
    ${explainCards}
    ${previewBlock}
  `;
}

function actionResultText(data) {
  return [
    `action_id=${data.action_id || "-"}`,
    `adapter=${data.adapter || "-"}`,
    `path_mode=${data.path_mode || "-"}`,
    `fallback_used=${Boolean(data.fallback_used)}`,
    `reason=${data.reason || "-"}`,
    `latency_ms=${data.latency_ms ?? "-"}`,
    data.fallback_from
      ? `fallback_from=${JSON.stringify(data.fallback_from)}`
      : null,
    "",
    data.result?.text || JSON.stringify(data.result || data, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRouteSimPayload(action) {
  const base = {};
  if (action === "dispatch" || action === "queue-task") {
    base.subject = $("dispatch-subject")?.value || "Task";
    base.prompt = $("dispatch-prompt")?.value || "Do the work";
    base.priority = $("dispatch-priority")?.value || "normal";
    base.role_hint = $("dispatch-role")?.value || undefined;
    base.directory = $("dispatch-directory")?.value || undefined;
  } else if (action === "assign-next" || action === "rebalance") {
    base.directory = $("dispatch-directory")?.value || undefined;
    base.force_path = forcePathValue();
  } else if (action === "message" || action === "native-message") {
    base.target_name = $("target-agent")?.value || undefined;
    base.content = $("message-content")?.value || "Message";
    base.force_path = forcePathValue();
  } else if (action === "directive") {
    base.to = $("target-session")?.value || undefined;
    base.content = $("message-content")?.value || "Directive";
  } else if (action === "wake") {
    base.session_id = $("target-session")?.value || undefined;
    base.message = $("message-content")?.value || "Wake";
  } else if (action === "native-task") {
    base.agent = $("target-agent")?.value || undefined;
    base.task = $("dispatch-prompt")?.value || "Task";
    base.force_path_mode = nativeForceModeValue();
  }
  return Object.fromEntries(
    Object.entries(base).filter(([, v]) => v !== undefined && v !== ""),
  );
}

function renderRouteSimulation() {
  const node = $("route-sim-result");
  const traceNode = $("route-sim-trace");
  if (!node) return;
  const sim = state.routeSimulation;
  if (!sim) {
    node.textContent = "No route simulation yet.";
    if (traceNode) traceNode.innerHTML = "";
    return;
  }
  const d = sim.decision || {};
  const n = sim.health?.native || {};
  const c = sim.health?.coordinator || {};
  const adapterColor =
    d.adapter === "coordinator"
      ? "ok"
      : d.path_mode === "bridge"
        ? "warn"
        : "err";
  node.textContent = [
    `action=${sim.action}`,
    `team=${sim.team_name || "-"}`,
    `adapter=${d.adapter || "-"}`,
    `path_mode=${d.path_mode || "-"}`,
    `reason=${d.reason || "-"}`,
    `semantic=${d.semantic || "-"}`,
    `fallback_plan=${JSON.stringify(d.fallback_plan || [])}`,
    `cost=${d.cost_estimate_class || "-"}`,
    "",
    `native_ok=${Boolean(n.ok)} mode=${n.mode || "-"} bridge=${n.bridge?.bridge_status || "-"}`,
    `coordinator_ok=${Boolean(c.ok)}`,
    `simulated_at=${sim.simulated_at || "-"}`,
  ].join("\n");

  // B3: Decision trace stepper
  if (traceNode && Array.isArray(d.decision_trace) && d.decision_trace.length) {
    traceNode.innerHTML =
      `<div class="tiny" style="margin-bottom:6px">Decision Trace:</div>` +
      d.decision_trace
        .map((step, i) => {
          const isFinal = i === d.decision_trace.length - 1;
          return `<div class="trace-step ${isFinal ? "final" : ""}"><span class="tiny">${esc(step)}</span></div>`;
        })
        .join("");
  } else if (traceNode) {
    traceNode.innerHTML = "";
  }
}

async function runBatchTriage(op) {
  if (!state.selectedTeam) throw new Error("Select a team first");
  const label =
    op === "approve_all_safe"
      ? "approve all safe approvals"
      : "wake all stale teammates";
  if (!window.confirm(`Confirm batch triage: ${label}?`)) return;
  const data = await api(
    `/teams/${encodeURIComponent(state.selectedTeam)}/batch-triage`,
    {
      method: "POST",
      body: JSON.stringify({ op, confirm: true }),
    },
  );
  $("result").textContent = JSON.stringify(data, null, 2);
  await refreshAll();
}

async function runMacro(macro) {
  if (!macro || !Array.isArray(macro.steps)) throw new Error("Invalid macro");
  const outputs = [];
  for (const step of macro.steps) {
    if (step.kind === "bridgeEnsure")
      outputs.push(
        await api("/native/bridge/ensure", {
          method: "POST",
          body: JSON.stringify({ team_name: state.selectedTeam }),
        }),
      );
    else if (step.kind === "bridgeValidate")
      outputs.push(
        await api("/native/bridge/validate", {
          method: "POST",
          body: JSON.stringify({
            team_name: state.selectedTeam,
            timeout_ms: 10000,
          }),
        }),
      );
    else if (step.kind === "batchApproveSafe")
      outputs.push(
        await api(
          `/teams/${encodeURIComponent(state.selectedTeam)}/batch-triage`,
          {
            method: "POST",
            body: JSON.stringify({ op: "approve_all_safe", confirm: true }),
          },
        ),
      );
    else if (step.kind === "batchWakeStale")
      outputs.push(
        await api(
          `/teams/${encodeURIComponent(state.selectedTeam)}/batch-triage`,
          {
            method: "POST",
            body: JSON.stringify({ op: "wake_all_stale", confirm: true }),
          },
        ),
      );
    else if (step.kind === "routeSim" && step.action)
      outputs.push(
        await api("/route/simulate", {
          method: "POST",
          body: JSON.stringify({
            team_name: state.selectedTeam,
            action: step.action,
            payload: step.payload || {},
          }),
        }),
      );
  }
  $("result").textContent = JSON.stringify(
    { ok: true, macro: macro.name || "unnamed", outputs },
    null,
    2,
  );
  await refreshAll();
}

async function refreshAfterTeamAction(refreshMode = "full") {
  if (refreshMode === "full") {
    await refreshAll();
    return;
  }
  if (!state.selectedTeam) {
    await refreshAll();
    return;
  }
  if (refreshMode === "focused") {
    await Promise.all([
      loadTeamDetail(state.selectedTeam).catch(() => {}),
      loadApprovals(state.selectedTeam).catch(() => {}),
      loadActions().catch(() => {}),
    ]);
    renderFocusedTeammate();
    return;
  }
  await Promise.all([
    loadInterrupts(state.selectedTeam).catch(() => {}),
    loadApprovals(state.selectedTeam).catch(() => {}),
    loadActions().catch(() => {}),
  ]);
  renderFocusedTeammate();
}

async function runTeamAction(action, body = {}, opts = {}) {
  if (!state.selectedTeam) throw new Error("Select a team first");
  const refreshMode = opts.refreshMode || "full";
  const data = await api(
    `/teams/${encodeURIComponent(state.selectedTeam)}/actions/${encodeURIComponent(action)}`,
    {
      method: "POST",
      body: JSON.stringify({ ...body, force_path: forcePathValue() }),
    },
  );
  $("result").textContent = actionResultText(data);
  await refreshAfterTeamAction(refreshMode);
}

async function runNativeAction(httpAction, body = {}) {
  const data = await api(`/native/actions/${httpAction}`, {
    method: "POST",
    body: JSON.stringify({
      team_name: state.selectedTeam,
      force_path_mode: nativeForceModeValue(),
      ...body,
    }),
  });
  $("result").textContent = actionResultText(data);
  await refreshAll();
}

async function refreshAll() {
  await loadTeams().catch((err) => {
    $("status").textContent = err.message;
  });
  await loadNativeStatus().catch(() => {});
  await loadBridgeValidation().catch(() => {});
  await loadActions().catch(() => {});
  if (state.selectedTeam) {
    await loadInterrupts(state.selectedTeam).catch(() => {});
    await loadApprovals(state.selectedTeam).catch(() => {});
  }
  await loadTemplates().catch(() => {});
  await loadAgents().catch(() => {});
  renderRouteSimulation();
  renderFocusedTeammate();
}

function bindActions() {
  $("focus-mode").onchange = () => {
    state.uiPrefs.focusMode = $("focus-mode").value;
    document.body.dataset.focus = state.uiPrefs.focusMode;
    saveUiPrefsLocal();
    renderAlerts();
    renderActions();
    renderDetail();
    renderApprovalInbox();
  };
  $("focus-filter").oninput = () => {
    state.uiPrefs.filter = $("focus-filter").value;
    saveUiPrefsLocal();
    renderAlerts();
    renderActions();
    renderDetail();
    renderRebalanceExplain();
  };
  $("layout-density").onchange = () => {
    state.uiPrefs.density = $("layout-density").value;
    saveUiPrefsLocal();
    document.body.dataset.density = state.uiPrefs.density;
  };
  $("btn-save-ui-prefs").onclick = async () => {
    try {
      const hotkeys = JSON.parse($("hotkeys-json").value || "{}");
      const macros = JSON.parse($("macros-json").value || "[]");
      state.uiPrefs.hotkeys = { ...defaultHotkeys(), ...hotkeys };
      state.uiPrefs.macros = Array.isArray(macros) ? macros : [];
      saveUiPrefsLocal();
      await saveServerPrefs();
      $("result").textContent = "UI preferences saved (local + server).";
    } catch (err) {
      $("result").textContent = `Invalid JSON: ${err.message}`;
    }
  };
  $("btn-run-macro").onclick = async () => {
    try {
      const macro = (state.uiPrefs.macros || [])[0];
      if (!macro) throw new Error("No saved macros");
      await runMacro(macro);
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-route-simulate").onclick = async () => {
    try {
      const sim = await simulateRoute();
      $("result").textContent = JSON.stringify(sim, null, 2);
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-batch-approve-safe").onclick = async () => {
    try {
      await runBatchTriage("approve_all_safe");
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-batch-wake-stale").onclick = async () => {
    try {
      await runBatchTriage("wake_all_stale");
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-batch-reject-risky").onclick = async () => {
    try {
      await runBatchTriage("reject_all_risky");
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-batch-dismiss-resolved").onclick = async () => {
    try {
      await runBatchTriage("dismiss_resolved");
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-queue").onclick = async () => {
    try {
      await runTeamAction("queue-task", {
        subject: $("dispatch-subject").value,
        prompt: $("dispatch-prompt").value,
        priority: $("dispatch-priority").value,
        role_hint: $("dispatch-role").value || undefined,
      });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-assign").onclick = async () => {
    try {
      await runTeamAction("assign-next", {
        directory: $("dispatch-directory").value || undefined,
      });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-rebalance").onclick = async () => {
    try {
      const data = await api(
        `/teams/${encodeURIComponent(state.selectedTeam)}/rebalance`,
        {
          method: "POST",
          body: JSON.stringify({ apply: true, force_path: forcePathValue() }),
        },
      );
      $("result").textContent = actionResultText(data);
      await refreshAll();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-rebalance-preview").onclick = async () => {
    try {
      const data = await api(
        `/teams/${encodeURIComponent(state.selectedTeam)}/rebalance`,
        {
          method: "POST",
          body: JSON.stringify({ apply: false, force_path: forcePathValue() }),
        },
      );
      state.rebalancePreview =
        data.result?.text || JSON.stringify(data.result || data, null, 2);
      await loadRebalanceExplain(state.selectedTeam).catch(() => {});
      $("result").textContent = actionResultText(data);
      renderRebalanceExplain();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-dispatch").onclick = async () => {
    try {
      // B3: Preview before dispatch
      if ($("preview-before-dispatch")?.checked) {
        const sim = await simulateRoute("dispatch");
        const d = sim?.decision || {};
        const confirmed = window.confirm(
          `Route Preview:\n` +
            `Adapter: ${d.adapter || "?"}\n` +
            `Path: ${d.path_mode || "?"}\n` +
            `Cost: ${d.cost_estimate_class || "?"}\n` +
            `Reason: ${d.reason || "?"}\n\n` +
            `Proceed with dispatch?`,
        );
        if (!confirmed) return;
      }
      await runTeamAction("dispatch", {
        subject: $("dispatch-subject").value,
        prompt: $("dispatch-prompt").value,
        directory: $("dispatch-directory").value,
        priority: $("dispatch-priority").value,
        role: $("dispatch-role").value || undefined,
      });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-native-probe").onclick = async () => {
    try {
      const data = await api("/native/probe", {
        method: "POST",
        body: JSON.stringify({}),
      });
      $("result").textContent = JSON.stringify(data, null, 2);
      await refreshAll();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-bridge-ensure").onclick = async () => {
    try {
      const data = await api("/native/bridge/ensure", {
        method: "POST",
        body: JSON.stringify({ team_name: state.selectedTeam }),
      });
      $("result").textContent = JSON.stringify(data, null, 2);
      await refreshAll();
      await loadBridgeValidation().catch(() => {});
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-bridge-validate").onclick = async () => {
    try {
      const data = await api("/native/bridge/validate", {
        method: "POST",
        body: JSON.stringify({
          team_name: state.selectedTeam,
          timeout_ms: 10000,
        }),
      });
      state.bridgeValidation = data;
      $("result").textContent = JSON.stringify(data, null, 2);
      renderBridgeValidation();
      await refreshAll();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-native-team-status").onclick = async () => {
    try {
      await runNativeAction("team-status", { team_name: state.selectedTeam });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-native-task").onclick = async () => {
    try {
      await runNativeAction("task", {
        team_name: state.selectedTeam,
        agent: $("target-agent").value || undefined,
        task: $("dispatch-prompt").value,
      });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-native-message").onclick = async () => {
    try {
      await runNativeAction("send-message", {
        team_name: state.selectedTeam,
        agent: $("target-agent").value || undefined,
        message: $("message-content").value,
      });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-directive").onclick = async () => {
    try {
      await runTeamAction("directive", {
        to: $("target-session").value,
        content: $("message-content").value,
        priority: "urgent",
      }, { refreshMode: "focused" });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-wake").onclick = async () => {
    try {
      await runTeamAction("wake", {
        session_id: $("target-session").value,
        message: $("message-content").value || "Lead sidecar wake",
      }, { refreshMode: "focused" });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-approval").onclick = async () => {
    try {
      const mode = $("approval-mode").value;
      const task_id = $("approval-task-id").value;
      if (mode === "approve")
        await runTeamAction("approve-plan", {
          task_id,
          message: $("message-content").value || "Approved",
        }, { refreshMode: "focused" });
      else
        await runTeamAction("reject-plan", {
          task_id,
          feedback: $("message-content").value || "Needs revision",
        }, { refreshMode: "focused" });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-agent-list").onclick = async () => {
    try {
      await loadAgents();
      $("result").textContent = JSON.stringify(
        { ok: true, count: state.agents.length },
        null,
        2,
      );
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-agent-get").onclick = async () => {
    try {
      const name = $("agent-name").value.trim();
      const scope = $("agent-scope").value;
      if (!name) throw new Error("Agent name is required");
      await loadAgent(name, scope);
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-agent-create").onclick = async () => {
    try {
      const payload = agentPayloadFromForm(true);
      if (!payload.agent_name) throw new Error("agent_name is required");
      if (!payload.description) throw new Error("description is required");
      const data = await api("/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      $("result").textContent = JSON.stringify(data, null, 2);
      await loadAgents();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-agent-update").onclick = async () => {
    try {
      const name = $("agent-name").value.trim();
      if (!name) throw new Error("agent_name is required");
      const payload = agentPayloadFromForm(false);
      const data = await api(`/agents/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      $("result").textContent = JSON.stringify(data, null, 2);
      await loadAgents();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-agent-delete").onclick = async () => {
    try {
      const name = $("agent-name").value.trim();
      if (!name) throw new Error("agent_name is required");
      const data = await api(`/agents/${encodeURIComponent(name)}`, {
        method: "DELETE",
        body: JSON.stringify({ scope: $("agent-scope").value }),
      });
      $("result").textContent = JSON.stringify(data, null, 2);
      await loadAgents();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-agent-sync-manifest").onclick = async () => {
    try {
      const data = await api("/agents/sync-manifest", {
        method: "POST",
        body: JSON.stringify({ scope: "all" }),
      });
      $("result").textContent = JSON.stringify(data, null, 2);
      await loadAgents();
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-focus-prev").onclick = () => {
    applyFocusedTeammateSelection(-1, "Focused teammate");
  };
  $("btn-focus-next").onclick = () => {
    applyFocusedTeammateSelection(1, "Focused teammate");
  };
  $("btn-triage-interrupt").onclick = async () => {
    try {
      const interrupt = focusedInterrupt(true);
      if (!interrupt) throw new Error("No interrupt available");
      state.selectedInterruptId = interrupt.id || null;
      if (interrupt.task_id && $("approval-task-id")) {
        $("approval-task-id").value = interrupt.task_id;
      }
      if (interrupt.session_id && $("target-session")) {
        $("target-session").value = interrupt.session_id;
      }
      if (interrupt.kind === "approval" && interrupt.task_id) {
        await runTeamAction("approve-plan", {
          task_id: interrupt.task_id,
          message: "Approved from focused teammate triage",
        }, { refreshMode: "focused" });
      } else if (interrupt.kind === "stale" && interrupt.session_id) {
        await runTeamAction("wake", {
          session_id: interrupt.session_id,
          message: "Wake from focused teammate triage",
        }, { refreshMode: "focused" });
      } else if (interrupt.code === "bridge_stuck_request") {
        $("btn-bridge-validate").click();
      } else {
        $("result").textContent = `No triage handler for interrupt kind=${interrupt.kind || "-"} code=${interrupt.code || "-"}`;
      }
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-approve-selected").onclick = async () => {
    try {
      const ap = focusedApproval(true);
      if (!ap?.task_id) throw new Error("No pending approval");
      state.selectedApprovalTaskId = ap.task_id;
      if ($("approval-task-id")) $("approval-task-id").value = ap.task_id;
      await runTeamAction("approve-plan", {
        task_id: ap.task_id,
        message: "Approved from focused teammate controls",
      }, { refreshMode: "focused" });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
  $("btn-reject-selected").onclick = async () => {
    try {
      const ap = focusedApproval(true);
      if (!ap?.task_id) throw new Error("No pending approval");
      state.selectedApprovalTaskId = ap.task_id;
      if ($("approval-task-id")) $("approval-task-id").value = ap.task_id;
      const feedback = window.prompt("Revision feedback", "Needs revision");
      if (feedback === null) return;
      await runTeamAction("reject-plan", {
        task_id: ap.task_id,
        feedback: feedback || "Needs revision",
      }, { refreshMode: "focused" });
    } catch (err) {
      $("result").textContent = err.message;
    }
  };
}

function paletteCommands() {
  const lastFailed = (state.actions || []).find((a) => a.state === "failed");
  const firstMacro = (state.uiPrefs.macros || [])[0] || null;
  return [
    { key: "queue", label: "Queue Task", run: () => $("btn-queue").click() },
    {
      key: "dispatch",
      label: "Dispatch Task",
      run: () => $("btn-dispatch").click(),
    },
    { key: "assign", label: "Assign Next", run: () => $("btn-assign").click() },
    {
      key: "rebalance",
      label: "Rebalance Team",
      run: () => $("btn-rebalance").click(),
    },
    {
      key: "route simulate",
      label: "Route Simulation Preview",
      run: () => $("btn-route-simulate").click(),
    },
    {
      key: "batch approve safe",
      label: "Batch Triage: Approve All Safe",
      run: () => $("btn-batch-approve-safe").click(),
    },
    {
      key: "batch wake stale",
      label: "Batch Triage: Wake All Stale",
      run: () => $("btn-batch-wake-stale").click(),
    },
    {
      key: "probe native",
      label: "Probe Native Capabilities",
      run: () => $("btn-native-probe").click(),
    },
    {
      key: "bridge ensure",
      label: "Ensure Native Bridge",
      run: () => $("btn-bridge-ensure").click(),
    },
    {
      key: "bridge validate",
      label: "Validate Native Bridge",
      run: () => $("btn-bridge-validate").click(),
    },
    {
      key: "native message",
      label: "Send Native Message",
      run: () => $("btn-native-message").click(),
    },
    {
      key: "native task",
      label: "Native Task Delegate",
      run: () => $("btn-native-task").click(),
    },
    {
      key: "directive",
      label: "Send Directive",
      run: () => $("btn-directive").click(),
    },
    { key: "wake", label: "Wake Session", run: () => $("btn-wake").click() },
    {
      key: "approval",
      label: "Approve/Reject Plan",
      run: () => $("btn-approval").click(),
    },
    ...(firstMacro
      ? [
          {
            key: "run macro",
            label: `Run Macro (${firstMacro.name || "first"})`,
            run: () => $("btn-run-macro").click(),
          },
        ]
      : []),
    ...(lastFailed
      ? [
          {
            key: "retry failed",
            label: `Retry Failed Action (${lastFailed.action})`,
            run: async () => {
              const out = await api(
                `/actions/${encodeURIComponent(lastFailed.action_id)}/retry`,
                { method: "POST", body: JSON.stringify({}) },
              );
              $("result").textContent = actionResultText(out);
              await refreshAll();
            },
          },
          {
            key: "force coord failed",
            label: `Force Coordinator Fallback (${lastFailed.action})`,
            run: async () => {
              const out = await api(
                `/actions/${encodeURIComponent(lastFailed.action_id)}/fallback`,
                {
                  method: "POST",
                  body: JSON.stringify({ force_path: "coordinator" }),
                },
              );
              $("result").textContent = actionResultText(out);
              await refreshAll();
            },
          },
        ]
      : []),
  ];
}

function renderPalette() {
  const query = $("palette-input").value.trim().toLowerCase();
  const cmds = paletteCommands().filter(
    (c) =>
      !query || c.key.includes(query) || c.label.toLowerCase().includes(query),
  );
  state.paletteIndex = Math.min(
    state.paletteIndex,
    Math.max(0, cmds.length - 1),
  );
  $("palette-list").innerHTML =
    cmds
      .map(
        (c, i) =>
          `<div class="palette-item ${i === state.paletteIndex ? "active" : ""}" data-idx="${i}"><strong>${esc(c.label)}</strong><div class="tiny">${esc(c.key)}</div></div>`,
      )
      .join("") || '<div class="mini">No matches.</div>';
  $("palette-list")
    .querySelectorAll("[data-idx]")
    .forEach((el) => {
      el.onclick = () => {
        state.paletteIndex = Number(el.dataset.idx);
        runPaletteSelected();
      };
    });
  state._paletteCmds = cmds;
}

function togglePalette(open) {
  $("palette").classList.toggle("open", open);
  if (open) {
    $("palette-input").value = "";
    state.paletteIndex = 0;
    renderPalette();
    setTimeout(() => $("palette-input").focus(), 0);
  }
}

function runPaletteSelected() {
  const cmd = state._paletteCmds?.[state.paletteIndex];
  if (!cmd) return;
  togglePalette(false);
  Promise.resolve(cmd.run()).catch((err) => {
    $("result").textContent = err.message;
  });
}

function setupPalette() {
  $("palette-input").addEventListener("input", renderPalette);
  $("palette-input").addEventListener("keydown", (e) => {
    const len = state._paletteCmds?.length || 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.paletteIndex = Math.min(
        Math.max(0, len - 1),
        state.paletteIndex + 1,
      );
      renderPalette();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      state.paletteIndex = Math.max(0, state.paletteIndex - 1);
      renderPalette();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runPaletteSelected();
    }
    if (e.key === "Escape") togglePalette(false);
  });
  $("palette").addEventListener("click", (e) => {
    if (e.target === $("palette")) togglePalette(false);
  });
}

function setupEvents() {
  const es = new EventSource("/events");
  es.onopen = () => {
    $("status").textContent = "Live";
  };
  es.onerror = () => {
    $("status").textContent = "Reconnecting…";
  };

  es.addEventListener("team.updated", async (e) => {
    try {
      const payload = JSON.parse(e.data || "{}");
      if (Array.isArray(payload.teams)) {
        state.teams = payload.teams;
        renderTeams();
      } else {
        await loadTeams();
      }
    } catch {
      await loadTeams().catch(() => {});
    }
  });
  es.addEventListener("teammate.updated", (e) => {
    try {
      const payload = JSON.parse(e.data || "{}");
      const teammates = Array.isArray(payload.teammates) ? payload.teammates : [];
      cacheLiveTeammates(teammates, Date.now());
      if (state.selectedTeam && state.detail) {
        state.detail.teammates = teammates.filter(
          (t) => t.team_name === state.selectedTeam,
        );
        if (
          !(state.detail.teammates || []).some(
            (m) => teammateLiveKey(m) === state.selectedMember,
          )
        ) {
          state.selectedMember = state.detail.teammates?.length
            ? teammateLiveKey(state.detail.teammates[0])
            : null;
        }
      }
      syncFocusSelections(true);
      hydrateFocusTargets();
      renderDetail();
      renderApprovalInbox();
      renderAlerts();
      renderFocusedTeammate();
    } catch {}
  });
  es.addEventListener("task.updated", (e) => {
    try {
      const payload = JSON.parse(e.data || "{}");
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      if (state.selectedTeam && state.detail) {
        state.detail.tasks = tasks.filter((t) => t.team_name === state.selectedTeam);
        renderDetail();
      }
    } catch {}
  });
  es.addEventListener("native.capabilities.updated", (e) => {
    try {
      state.native = {
        ...(state.native || {}),
        capabilities: JSON.parse(e.data),
      };
      renderNativeLane();
      renderFocusedTeammate();
    } catch {}
  });
  es.addEventListener("native.bridge.status", (e) => {
    try {
      const bridge = JSON.parse(e.data);
      state.native = {
        ...(state.native || {}),
        bridge,
        mode:
          bridge.bridge_status === "healthy"
            ? "bridge"
            : state.native?.mode || "native-direct",
      };
      if (bridge.validation)
        state.bridgeValidation = {
          ...(state.bridgeValidation || {}),
          ...bridge.validation,
        };
      renderNativeLane();
      renderBridgeValidation();
      renderFocusedTeammate();
    } catch {}
  });
  es.addEventListener("action.queued", () => loadActions().catch(() => {}));
  es.addEventListener("action.started", () => loadActions().catch(() => {}));
  es.addEventListener("action.completed", async () => {
    await loadActions().catch(() => {});
    await loadTeams().catch(() => {});
    if (state.selectedTeam)
      await loadRebalanceExplain(state.selectedTeam).catch(() => {});
    if (state.selectedTeam)
      await loadInterrupts(state.selectedTeam).catch(() => {});
    renderRebalanceExplain();
  });
  es.addEventListener("action.failed", async () => {
    await loadActions().catch(() => {});
    await loadTeams().catch(() => {});
    if (state.selectedTeam)
      await loadInterrupts(state.selectedTeam).catch(() => {});
  });
  es.addEventListener("alert.raised", async () => {
    if (state.selectedTeam) {
      await loadTeamDetail(state.selectedTeam).catch(() => {});
      await loadInterrupts(state.selectedTeam).catch(() => {});
    }
  });
  es.addEventListener("metrics.updated", (e) => {
    try {
      state.metrics = JSON.parse(e.data).metrics || JSON.parse(e.data);
      renderNativeLane();
    } catch {}
  });
  es.addEventListener("adapter.health", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.adapter === "native") {
        $("status").textContent =
          `Live · native:${data.ok ? "ok" : "off"} · ${data.mode || ""}`;
      }
    } catch {}
  });
}

function setupHotkeys() {
  window.addEventListener("keydown", (e) => {
    const hk = { ...defaultHotkeys(), ...(state.uiPrefs.hotkeys || {}) };
    const tag = document.activeElement?.tagName?.toLowerCase();
    const editing = ["input", "textarea", "select"].includes(tag);
    if (e.key === "Escape" && $("palette").classList.contains("open"))
      return togglePalette(false);
    if (editing && e.key !== "Escape") return;
    if (e.key === hk.palette) {
      e.preventDefault();
      return togglePalette(true);
    }
    if (e.key === hk.queue) {
      e.preventDefault();
      return $("btn-queue").click();
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      return applyFocusedTeammateSelection(-1, "Focused teammate");
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      return applyFocusedTeammateSelection(1, "Focused teammate");
    }
    if (e.key === hk.teammatePrev) {
      e.preventDefault();
      return $("btn-focus-prev").click();
    }
    if (e.key === hk.teammateNext) {
      e.preventDefault();
      return $("btn-focus-next").click();
    }
    if (e.key === hk.focusedTeammate) {
      e.preventDefault();
      syncFocusSelections(true);
      hydrateFocusTargets();
      renderFocusedTeammate();
      scheduleFocusedPanelRender();
      $("status").textContent = "Focused teammate refreshed";
      return;
    }
    if (e.key === hk.dispatch) {
      e.preventDefault();
      return $("btn-dispatch").click();
    }
    if (e.key === hk.rebalance) {
      e.preventDefault();
      return $("btn-rebalance").click();
    }
    if (e.key === hk.simulate) {
      e.preventDefault();
      return $("btn-route-simulate").click();
    }
    if (e.key === hk.nativeMessage) {
      e.preventDefault();
      return $("btn-native-message").click();
    }
    if (e.key === hk.directive) {
      e.preventDefault();
      return $("btn-directive").click();
    }
    if (e.key === hk.approval) {
      e.preventDefault();
      return $("btn-approval").click();
    }
    if (e.key === hk.wake) {
      e.preventDefault();
      return $("btn-wake").click();
    }
    if (e.key === hk.bridgeValidate) {
      e.preventDefault();
      return $("btn-bridge-validate").click();
    }
    if (e.key === hk.approveSafe) {
      e.preventDefault();
      return $("btn-batch-approve-safe").click();
    }
    if (e.key === hk.approveSelected) {
      e.preventDefault();
      return $("btn-approve-selected").click();
    }
    if (e.key === hk.rejectSelected) {
      e.preventDefault();
      return $("btn-reject-selected").click();
    }
    if (e.key === hk.triageInterrupt) {
      e.preventDefault();
      return $("btn-triage-interrupt").click();
    }
    if (e.key === hk.wakeStale) {
      e.preventDefault();
      return $("btn-batch-wake-stale").click();
    }
    if (e.key === hk.forcePathToggle) {
      e.preventDefault();
      const sel = $("force-path");
      const values = ["", "coordinator", "native"];
      const idx = Math.max(0, values.indexOf(sel.value));
      sel.value = values[(idx + 1) % values.length];
      $("status").textContent = `Force path: ${sel.value || "auto"}`;
      return;
    }
    if (e.key === hk.help) {
      e.preventDefault();
      $("result").textContent = [
        "Hotkeys:",
        "Teammate prev/next/focus ([ ] or ArrowLeft/ArrowRight), interrupt triage, approve/reject selected, palette, route simulate, queue, dispatch, rebalance, native message, directive, wake, batch triage, bridge validate, force-path toggle, open dashboard",
        "",
        "Tips:",
        '- Use "Preview Rebalance" for dry-run scoring before applying.',
        "- Recent Actions panel supports Retry / Force Coord / Force Native on failed actions.",
        "- Native Path Mode only affects direct native actions (TeamStatus/Task/SendMessage).",
        "- Focused teammate stream is explicit: native live -> sidecar live -> tmux mirror fallback.",
        "- Route labels are source-truthful: native-live, sidecar-live, and tmux-mirror are distinct.",
        "- In-process native parity is not available in sidecar; the view mirrors state streams.",
      ].join("\n");
      return;
    }
    if (e.key === hk.openWeb) {
      e.preventDefault();
      return window.open("/", "_blank");
    }
  });
}

(async function init() {
  loadUiPrefsLocal();
  await loadServerPrefs();
  await loadUiBootstrap();
  applyUiPrefsToControls();
  bindActions();
  setupPalette();
  setupHotkeys();
  await refreshAll().catch((err) => {
    $("status").textContent = err.message;
  });
  setupEvents();
})();
