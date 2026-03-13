import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-val-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'val-team.json'), JSON.stringify({
    team_name: 'val-team', execution_path: 'hybrid', low_overhead_mode: 'simple',
    members: [{ name: 'v1', role: 'coder' }], policy: {},
    created: new Date().toISOString(), updated: new Date().toISOString(),
  }));
  return home;
}

function requestJson(port, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: body === null ? headers : { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw || '{}') }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: raw }); }
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

function postJson(port, path, body, headers = {}) {
  return requestJson(port, path, 'POST', body, headers);
}

// ─── Unit tests for validateBody ─────────────────────────────────────────────

test('validateBody: rejects unexpected keys for /native/probe (empty allowlist)', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/native/probe', { unexpected: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error_code, 'VALIDATION_ERROR');
  assert.match(result.error, /unexpected/i);
});

test('validateBody: accepts empty body for /native/probe', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(mod.validateBody('/native/probe', {}), { ok: true });
});

test('validateBody: rejects unexpected keys for /dispatch', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/dispatch', { team_name: 'x', subject: 'y', evil_key: 'z' });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'VALIDATION_ERROR');
  assert.match(result.error, /evil_key/);
});

test('validateBody: accepts valid keys for /dispatch', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(mod.validateBody('/dispatch', { team_name: 'x', subject: 'y', prompt: 'z' }), { ok: true });
});

test('validateBody: rejects unexpected keys for /maintenance/run', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/maintenance/run', { source: 'test', hack: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /hack/);
});

test('validateBody: accepts valid keys for /maintenance/run', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(mod.validateBody('/maintenance/run', { source: 'test' }), { ok: true });
});

test('validateBody: rejects unexpected keys for /actions/{id}/retry (empty allowlist)', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/actions/abc123/retry', { extra: true });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'VALIDATION_ERROR');
});

test('validateBody: rejects unexpected keys for /actions/{id}/fallback', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/actions/abc123/fallback', { force_path: 'native', extra: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /extra/);
});

test('validateBody: accepts valid keys for /actions/{id}/fallback', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(mod.validateBody('/actions/abc123/fallback', { force_path: 'native' }), { ok: true });
});

test('validateBody: rejects unexpected keys for /teams/{name}/rebalance', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/teams/myteam/rebalance', { apply: true, bad_key: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /bad_key/);
});

test('validateBody: rejects unexpected keys for /teams/{name}/tasks/{id}/reassign', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/teams/myteam/tasks/t1/reassign', { new_assignee: 'alice', bad_key: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /bad_key/);
});

test('validateBody: accepts valid keys for /teams/{name}/tasks/{id}/reassign', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(
    mod.validateBody('/teams/myteam/tasks/t1/reassign', { new_assignee: 'alice', reason: 'handoff', progress_context: 'ready' }),
    { ok: true },
  );
});

test('validateBody: rejects unexpected keys for /teams/{name}/tasks/{id}/gate-check (empty allowlist)', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/teams/myteam/tasks/t1/gate-check', { anything: true });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /teams/{name}/batch-triage', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/teams/myteam/batch-triage', { op: 'resolve', inject: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /inject/);
});

test('validateBody: rejects unexpected keys for /route/simulate', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/route/simulate', { team_name: 'x', action: 'y', extra: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /extra/);
});

test('validateBody: rejects unexpected keys for /open-dashboard (empty allowlist)', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/open-dashboard', { anything: true });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /diagnostics/export', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/diagnostics/export', { label: 'test', hack: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /hack/);
});

test('validateBody: accepts arbitrary preference keys for /ui/preferences', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/ui/preferences', { theme: 'dark', layout: { columns: 3 } });
  assert.deepEqual(result, { ok: true });
});

test('validateBody: rejects unexpected keys for /checkpoints/create', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/checkpoints/create', { label: 'cp1', extra: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /extra/);
});

test('validateBody: rejects unexpected keys for /checkpoints/restore', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/checkpoints/restore', { file: '/a/b', other: 1 });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /repair/scan (empty allowlist)', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/repair/scan', { path: '/etc' });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /repair/fix', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/repair/fix', { path: '/a', dry_run: true, evil: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /evil/);
});

test('validateBody: rejects unexpected keys for /events/rebuild-check', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/events/rebuild-check', { from_ts: '2025-01-01', inject: true });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /backups/restore', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/backups/restore', { file: '/a', extra: 1 });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /health/hooks/selftest (empty allowlist)', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/health/hooks/selftest', { inject: true });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /maintenance/rotate-api-token (empty allowlist)', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/maintenance/rotate-api-token', { steal: true });
  assert.equal(result.ok, false);
});

test('validateBody: rejects unexpected keys for /task-templates', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/task-templates', { name: 'tpl', bad: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /bad/);
});

test('validateBody: accepts valid keys for /task-templates', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(mod.validateBody('/task-templates', { name: 'tpl', subject_template: 'x', priority: 'high' }), { ok: true });
});

test('validateBody: rejects unexpected keys for /agents', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/agents', { agent_name: 'a', description: 'd', bad: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /bad/);
});

test('validateBody: accepts valid keys for /agents', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(
    mod.validateBody('/agents', {
      agent_name: 'a',
      scope: 'project',
      description: 'desc',
      tools: ['Read'],
      skills: ['qa'],
      model: 'sonnet',
      memory: 'local',
      prompt: 'x',
      overwrite: true,
    }),
    { ok: true },
  );
});

test('validateBody: rejects unexpected keys for /agents/{name}', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/agents/reviewer', { scope: 'project', hack: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /hack/);
});

test('validateBody: accepts valid keys for /agents/{name}', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(
    mod.validateBody('/agents/reviewer', {
      scope: 'project',
      new_name: 'reviewer-v2',
      description: 'updated',
      tools: ['Read', 'Edit'],
      memory: 'project',
      all_scopes: false,
    }),
    { ok: true },
  );
});

test('validateBody: rejects unexpected keys for /agents/sync-manifest', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/agents/sync-manifest', { manifest_path: '/x', inject: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /inject/);
});

test('validateBody: accepts valid keys for /agents/sync-manifest', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  assert.deepEqual(
    mod.validateBody('/agents/sync-manifest', {
      manifest_path: '/tmp/MANIFEST.md',
      scope: 'all',
      include_invalid: false,
      include_shadowed: true,
      project_dir: '/tmp/project',
    }),
    { ok: true },
  );
});

test('validateBody: rejects overly large string fields', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/dispatch', { team_name: 'x'.repeat(200_000) });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'PAYLOAD_TOO_LARGE');
});

test('validateBody: rejects overly large array fields', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/dispatch', { team_name: 'x', files: new Array(1001).fill('f') });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'PAYLOAD_TOO_LARGE');
});

test('validateBody: handles __parse_error payload_too_large', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/dispatch', { __parse_error: 'payload_too_large' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
  assert.equal(result.error_code, 'PAYLOAD_TOO_LARGE');
});

test('validateBody: handles __parse_error invalid_json', async () => {
  const mod = await import(`../server/http/validation.ts?t=${Date.now()}`);
  const result = mod.validateBody('/dispatch', { __parse_error: 'invalid_json' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error_code, 'INVALID_JSON');
});

// ─── Integration: unexpected key rejected at HTTP level ──────────────────────

test('integration: POST /native/probe rejects unexpected key via HTTP', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await postJson(sidecar.port, '/native/probe', { evil: true });
    assert.equal(res.status, 400);
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.match(res.body.message, /evil/i);
    assert.ok(res.body.request_id, 'error should include request_id');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('integration: POST /dispatch rejects unexpected key via HTTP', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  try {
    const res = await postJson(sidecar.port, '/dispatch', { team_name: 'val-team', bad_key: true });
    assert.equal(res.status, 400);
    assert.equal(res.body.error_code, 'VALIDATION_ERROR');
    assert.match(res.body.message, /bad_key/);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});
