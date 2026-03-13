import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const TOOL_BY_ACTION = {
  "team-create": "TeamCreate",
  "team-status": "TeamStatus",
  "send-message": "SendMessage",
  task: "Task",
  probe: "TeamStatus",
};

function normalizeNativeModel(value) {
  const raw = String(value || "sonnet").trim().toLowerCase();
  if (!raw) return "sonnet";
  if (raw === "sonnet" || raw === "haiku") return raw;
  if (raw.startsWith("claude-sonnet-")) return "sonnet";
  if (raw.startsWith("claude-haiku-")) return "haiku";
  throw new Error("Only sonnet and haiku models are allowed.");
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, String(v));
  }
  return out;
}

function parseStructuredJson(output) {
  const trimmed = String(output || "").trim();
  if (!trimmed) throw new Error("empty_output");
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  const fence = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  throw new Error("malformed_response");
}

function redactedPayload(payload) {
  const p = JSON.parse(JSON.stringify(payload || {}));
  for (const key of ["content", "prompt", "message"]) {
    if (typeof p[key] === "string" && p[key].length > 160)
      p[key] = `${p[key].slice(0, 160)}…`;
  }
  return p;
}

function withRouteMetadata(
  payload = {},
  {
    routeMode = "native-direct",
    routeReason = null,
    probeSource = "native-runner",
  } = {},
) {
  const fallback_history = Array.isArray(payload?.fallback_history)
    ? payload.fallback_history
    : [];
  const probe_source = String(payload?.probe_source || probeSource || "").trim();
  return {
    ...payload,
    path_mode: payload?.path_mode || "native-direct",
    route_mode: payload?.route_mode || routeMode,
    route_reason:
      payload?.route_reason ||
      routeReason ||
      (payload?.ok === false
        ? "native direct execution returned failure"
        : "native direct execution succeeded"),
    fallback_history,
    probe_source: probe_source || "native-runner",
  };
}

export class NativeActionRunner {
  constructor({ sidecarDir = null, execImpl = null } = {}) {
    this.sidecarDir = sidecarDir;
    this.execImpl = execImpl;
  }

  templatePath(name) {
    if (this.sidecarDir) return join(this.sidecarDir, "templates", name);
    return new URL(`../templates/${name}`, import.meta.url);
  }

  readTemplate(name) {
    const p = this.templatePath(name);
    if (p instanceof URL) return readFileSync(p, "utf-8");
    return readFileSync(p, "utf-8");
  }

  _mockResponse(action, payload) {
    const tool = TOOL_BY_ACTION[action] || "Unknown";
    const mode = process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK || "";
    if (mode === "unavailable") {
      return {
        ok: false,
        action,
        native_tool: tool,
        error: {
          code: "tool_unavailable",
          message: `${tool} unavailable in this runtime`,
        },
        tool_available: false,
        notes: "mock unavailable",
        route_mode: "native-direct",
        route_reason: "mock native unavailable",
      };
    }
    if (mode === "permission_denied") {
      return {
        ok: false,
        action,
        native_tool: tool,
        error: { code: "permission_denied", message: `${tool} not permitted` },
        tool_available: true,
        notes: "mock permission denied",
        route_mode: "native-direct",
        route_reason: "mock permission denied",
      };
    }
    return {
      ok: true,
      action,
      native_tool: tool,
      result: {
        mock: true,
        action,
        payload: redactedPayload(payload),
        no_team: action === "team-status" || action === "probe",
      },
      tool_available: true,
      notes: "mock success",
      route_mode: "native-direct",
      route_reason: "mock native execution succeeded",
    };
  }

  async run(
    action,
    payload = {},
    { timeoutMs = 15000, model = "sonnet" } = {},
  ) {
    let resolvedModel;
    try {
      resolvedModel = normalizeNativeModel(model);
    } catch (err) {
      return withRouteMetadata({
        ok: false,
        action,
        native_tool: TOOL_BY_ACTION[action] || null,
        error: { code: "unsupported_model", message: err.message },
        tool_available: null,
        notes: `Rejected model: ${String(model || "") || "(empty)"}`,
        latency_ms: 0,
      }, {
        routeReason: "native execution blocked: unsupported model",
      });
    }

    if (process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK) {
      const out = this._mockResponse(action, payload);
      return withRouteMetadata({
        ...out,
        latency_ms: 1,
      }, {
        routeReason:
          out.route_reason ||
          (out.ok
            ? "mock native execution succeeded"
            : "mock native execution failed"),
        probeSource: "native-runner-mock",
      });
    }

    const templateMap = {
      probe: "native-capability-probe.txt",
      "team-create": "native-action-team-create.txt",
      "team-status": "native-action-team-status.txt",
      "send-message": "native-action-send-message.txt",
      task: "native-action-task.txt",
    };
    const templateName = templateMap[action];
    if (!templateName) throw new Error(`unsupported_action:${action}`);

    const template = this.readTemplate(templateName);
    const prompt = fillTemplate(template, {
      ACTION: action,
      MODEL: model,
      PAYLOAD_JSON: JSON.stringify(payload || {}),
    });

    if (this.execImpl) {
      const raw = await this.execImpl({
        prompt,
        timeoutMs,
        action,
        payload,
        model: resolvedModel,
      });
      try {
        const parsed = parseStructuredJson(raw.stdout || raw.output || "");
        return withRouteMetadata({
          ...parsed,
          latency_ms: raw.latency_ms ?? 0,
        }, {
          routeReason:
            parsed?.ok === false
              ? "native direct execution returned failure"
              : "native direct execution succeeded",
        });
      } catch (err) {
        return withRouteMetadata({
          ok: false,
          action,
          native_tool: TOOL_BY_ACTION[action] || null,
          error: { code: "malformed_response", message: err.message },
          tool_available: null,
          notes: String(raw.stderr || raw.stdout || raw.output || "").slice(
            -1000,
          ),
          latency_ms: raw.latency_ms ?? 0,
        }, {
          routeReason: "native direct execution returned malformed response",
        });
      }
    }

    const started = Date.now();
    const args = ["-p", "--model", resolvedModel, prompt];
    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {}
        resolve({ timeout: true, stdout, stderr, code: null });
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ error: err, stdout, stderr, code: null });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });

    const latency_ms = Date.now() - started;
    if (result.timeout) {
      return withRouteMetadata({
        ok: false,
        action,
        native_tool: TOOL_BY_ACTION[action] || null,
        error: {
          code: "native_execution_failed",
          message: "timeout",
          detail: "runner timed out",
        },
        tool_available: null,
        notes: stderr.slice(-500),
        latency_ms,
      }, {
        routeReason: "native direct execution timed out",
      });
    }
    if (result.error) {
      return withRouteMetadata({
        ok: false,
        action,
        native_tool: TOOL_BY_ACTION[action] || null,
        error: {
          code: "native_execution_failed",
          message: result.error.message,
        },
        tool_available: null,
        notes: stderr.slice(-500),
        latency_ms,
      }, {
        routeReason: "native direct execution failed to start",
      });
    }

    try {
      const parsed = parseStructuredJson(result.stdout);
      return withRouteMetadata({
        ...parsed,
        latency_ms,
        raw_code: result.code,
      }, {
        routeReason:
          parsed?.ok === false
            ? "native direct execution returned failure"
            : "native direct execution succeeded",
      });
    } catch (err) {
      return withRouteMetadata({
        ok: false,
        action,
        native_tool: TOOL_BY_ACTION[action] || null,
        error: { code: "malformed_response", message: err.message },
        tool_available: null,
        notes: (result.stderr || result.stdout || "").slice(-1000),
        latency_ms,
      }, {
        routeReason: "native direct execution returned malformed response",
      });
    }
  }
}
