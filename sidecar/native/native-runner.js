import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const TOOL_BY_ACTION = {
  'team-create': 'TeamCreate',
  'team-status': 'TeamStatus',
  'send-message': 'SendMessage',
  'task': 'Task',
  probe: 'TeamStatus',
};

function fillTemplate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, String(v));
  }
  return out;
}

function parseStructuredJson(output) {
  const trimmed = String(output || '').trim();
  if (!trimmed) throw new Error('empty_output');
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  const fence = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  throw new Error('malformed_response');
}

function redactedPayload(payload) {
  const p = JSON.parse(JSON.stringify(payload || {}));
  for (const key of ['content', 'prompt', 'message']) {
    if (typeof p[key] === 'string' && p[key].length > 160) p[key] = `${p[key].slice(0, 160)}…`; 
  }
  return p;
}

export class NativeActionRunner {
  constructor({ sidecarDir = null, execImpl = null } = {}) {
    this.sidecarDir = sidecarDir;
    this.execImpl = execImpl;
  }

  templatePath(name) {
    if (this.sidecarDir) return join(this.sidecarDir, 'templates', name);
    return new URL(`../templates/${name}`, import.meta.url);
  }

  readTemplate(name) {
    const p = this.templatePath(name);
    if (p instanceof URL) return readFileSync(p, 'utf-8');
    return readFileSync(p, 'utf-8');
  }

  _mockResponse(action, payload) {
    const tool = TOOL_BY_ACTION[action] || 'Unknown';
    const mode = process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK || '';
    if (mode === 'unavailable') {
      return {
        ok: false,
        action,
        native_tool: tool,
        error: { code: 'tool_unavailable', message: `${tool} unavailable in this runtime` },
        tool_available: false,
        notes: 'mock unavailable',
      };
    }
    if (mode === 'permission_denied') {
      return {
        ok: false,
        action,
        native_tool: tool,
        error: { code: 'permission_denied', message: `${tool} not permitted` },
        tool_available: true,
        notes: 'mock permission denied',
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
        no_team: action === 'team-status' || action === 'probe',
      },
      tool_available: true,
      notes: 'mock success',
    };
  }

  async run(action, payload = {}, { timeoutMs = 15000, model = 'sonnet' } = {}) {
    if (process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK) {
      const out = this._mockResponse(action, payload);
      return { ...out, latency_ms: 1, path_mode: 'ephemeral' };
    }

    const templateMap = {
      probe: 'native-capability-probe.txt',
      'team-create': 'native-action-team-create.txt',
      'team-status': 'native-action-team-status.txt',
      'send-message': 'native-action-send-message.txt',
      task: 'native-action-task.txt',
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
      const raw = await this.execImpl({ prompt, timeoutMs, action, payload, model });
      try {
        const parsed = parseStructuredJson(raw.stdout || raw.output || '');
        return { ...parsed, latency_ms: raw.latency_ms ?? 0, path_mode: 'ephemeral' };
      } catch (err) {
        return {
          ok: false,
          action,
          native_tool: TOOL_BY_ACTION[action] || null,
          error: { code: 'malformed_response', message: err.message },
          tool_available: null,
          notes: String(raw.stderr || raw.stdout || raw.output || '').slice(-1000),
          latency_ms: raw.latency_ms ?? 0,
          path_mode: 'ephemeral',
        };
      }
    }

    const started = Date.now();
    const args = ['-p', prompt];
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        resolve({ timeout: true, stdout, stderr, code: null });
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ error: err, stdout, stderr, code: null });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });

    const latency_ms = Date.now() - started;
    if (result.timeout) {
      return {
        ok: false,
        action,
        native_tool: TOOL_BY_ACTION[action] || null,
        error: { code: 'native_execution_failed', message: 'timeout', detail: 'runner timed out' },
        tool_available: null,
        notes: stderr.slice(-500),
        latency_ms,
        path_mode: 'ephemeral',
      };
    }
    if (result.error) {
      return {
        ok: false,
        action,
        native_tool: TOOL_BY_ACTION[action] || null,
        error: { code: 'native_execution_failed', message: result.error.message },
        tool_available: null,
        notes: stderr.slice(-500),
        latency_ms,
        path_mode: 'ephemeral',
      };
    }

    try {
      const parsed = parseStructuredJson(result.stdout);
      return { ...parsed, latency_ms, path_mode: 'ephemeral', raw_code: result.code };
    } catch (err) {
      return {
        ok: false,
        action,
        native_tool: TOOL_BY_ACTION[action] || null,
        error: { code: 'malformed_response', message: err.message },
        tool_available: null,
        notes: (result.stderr || result.stdout || '').slice(-1000),
        latency_ms,
        path_mode: 'ephemeral',
      };
    }
  }
}
