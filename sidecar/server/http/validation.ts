const BODY_ALLOWLISTS = [
  { rx: /^\/native\/probe$/, keys: [] },
  { rx: /^\/native\/bridge\/ensure$/, keys: ["team_name", "directory"] },
  {
    rx: /^\/native\/bridge\/validate$/,
    keys: ["team_name", "directory", "timeout_ms", "timeoutMs", "simulate"],
  },
  {
    rx: /^\/native\/actions\/[^/]+$/,
    keys: [
      "team_name",
      "agent",
      "task",
      "message",
      "metadata",
      "goal",
      "members",
      "force_path_mode",
      "timeout_ms",
      "model",
    ],
  },
  { rx: /^\/actions\/[^/]+\/retry$/, keys: [] },
  { rx: /^\/actions\/[^/]+\/fallback$/, keys: ["force_path"] },
  {
    rx: /^\/teams\/[^/]+\/rebalance$/,
    keys: [
      "apply",
      "force_path",
      "limit",
      "dispatch_next",
      "include_in_progress",
    ],
  },
  { rx: /^\/teams\/[^/]+\/rebalance-explain$/, keys: ["limit", "assignee"] },
  {
    rx: /^\/teams\/[^/]+\/tasks\/[^/]+\/reassign$/,
    keys: ["new_assignee", "reason", "progress_context"],
  },
  { rx: /^\/teams\/[^/]+\/tasks\/[^/]+\/gate-check$/, keys: [] },
  {
    rx: /^\/teams\/[^/]+\/actions\/[^/]+$/,
    keys: [
      "team_name",
      "subject",
      "prompt",
      "priority",
      "role_hint",
      "role",
      "directory",
      "force_path",
      "to",
      "content",
      "message",
      "task_id",
      "feedback",
      "session_id",
      "target_name",
      "from",
      "files",
      "blocked_by",
      "acceptance_criteria",
      "metadata",
      "agent",
    ],
  },
  {
    rx: /^\/teams\/[^/]+\/batch-triage$/,
    keys: ["op", "confirm", "message", "limit"],
  },
  {
    rx: /^\/dispatch$/,
    keys: [
      "team_name",
      "subject",
      "prompt",
      "directory",
      "priority",
      "role",
      "files",
      "blocked_by",
      "metadata",
      "force_path",
    ],
  },
  { rx: /^\/route\/simulate$/, keys: ["team_name", "action", "payload"] },
  { rx: /^\/open-dashboard$/, keys: [] },
  { rx: /^\/maintenance\/run$/, keys: ["source"] },
  { rx: /^\/diagnostics\/export$/, keys: ["label"] },
  {
    rx: /^\/teams\/[^/]+\/interrupt-priorities$/,
    keys: [
      "approval",
      "bridge",
      "stale",
      "conflict",
      "budget",
      "error",
      "warn",
      "default",
    ],
  },
  {
    rx: /^\/agents$/,
    keys: [
      "agent_name",
      "scope",
      "description",
      "model",
      "tools",
      "memory",
      "skills",
      "prompt",
      "project_dir",
      "overwrite",
      "include_invalid",
      "include_shadowed",
    ],
  },
  {
    rx: /^\/agents\/sync-manifest$/,
    keys: [
      "manifest_path",
      "scope",
      "include_invalid",
      "include_shadowed",
      "project_dir",
    ],
  },
  {
    rx: /^\/agents\/[^/]+$/,
    keys: [
      "scope",
      "new_name",
      "description",
      "model",
      "tools",
      "memory",
      "skills",
      "prompt",
      "project_dir",
      "overwrite",
      "all_scopes",
    ],
  },
  { rx: /^\/ui\/preferences$/, keys: null, allowAny: true },
  { rx: /^\/checkpoints\/create$/, keys: ["label"] },
  { rx: /^\/checkpoints\/restore$/, keys: ["file"] },
  { rx: /^\/repair\/scan$/, keys: [] },
  { rx: /^\/repair\/fix$/, keys: ["path", "dry_run"] },
  { rx: /^\/events\/rebuild-check$/, keys: ["from_ts"] },
  { rx: /^\/backups\/restore$/, keys: ["file"] },
  { rx: /^\/health\/hooks\/selftest$/, keys: [] },
  { rx: /^\/maintenance\/rotate-api-token$/, keys: [] },
  { rx: /^\/health\/request-audit$/, keys: [] },
  {
    rx: /^\/task-templates$/,
    keys: [
      "id",
      "name",
      "subject_template",
      "prompt_template",
      "role_hint",
      "priority",
      "quality_gates",
      "acceptance_criteria",
    ],
  },
];

export function validateBody(
  pathname: string,
  body: any,
):
  | { ok: true }
  | { ok: false; status: number; error: string; error_code: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: true };
  if (body.__parse_error) {
    const isPayloadTooLarge = body.__parse_error === "payload_too_large";
    return {
      ok: false,
      status: isPayloadTooLarge ? 413 : 400,
      error: body.__parse_error,
      error_code: isPayloadTooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
    };
  }
  const rule = BODY_ALLOWLISTS.find((r) => r.rx.test(pathname));
  if (rule && !rule.allowAny) {
    const allowedKeys = Array.isArray(rule.keys) ? rule.keys : [];
    const badKeys = Object.keys(body).filter((k) => !allowedKeys.includes(k));
    if (badKeys.length)
      return {
        ok: false,
        status: 400,
        error: `Unexpected keys: ${badKeys.join(", ")}`,
        error_code: "VALIDATION_ERROR",
      };
  }
  const stack: any[] = [body];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const v of Object.values(cur)) {
      if (typeof v === "string" && v.length > 100_000)
        return {
          ok: false,
          status: 413,
          error: "String field too large",
          error_code: "PAYLOAD_TOO_LARGE",
        };
      if (Array.isArray(v)) {
        if (v.length > 1000)
          return {
            ok: false,
            status: 413,
            error: "Array field too large",
            error_code: "PAYLOAD_TOO_LARGE",
          };
        stack.push(...v);
      } else if (v && typeof v === "object") stack.push(v);
    }
  }
  return { ok: true };
}

export { BODY_ALLOWLISTS };
