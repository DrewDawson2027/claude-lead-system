import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'sidecar-http-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  writeFileSync(join(terminals, 'teams', 'delta.json'), JSON.stringify({
    team_name: 'delta',
    execution_path: 'hybrid',
    low_overhead_mode: 'simple',
    members: [{ name: 'd1', role: 'researcher' }],
    policy: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }));
  return home;
}

function getJson(port, path, headers = {}) {
  return requestJson(port, path, 'GET', null, headers);
}

function postJson(port, path, body, headers = {}) {
  return requestJson(port, path, 'POST', body, headers);
}

function putJson(port, path, body, headers = {}) {
  return requestJson(port, path, 'PUT', body, headers);
}

function patchJson(port, path, body, headers = {}) {
  return requestJson(port, path, 'PATCH', body, headers);
}

function deleteJson(port, path, body = {}, headers = {}) {
  return requestJson(port, path, 'DELETE', body, headers);
}

function requestJson(port, path, method, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body || {});
    const reqHeaders = body === null
      ? headers
      : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload, 'utf8'),
          ...headers,
        };
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw || '{}') }); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

test('sidecar server exposes health and teams endpoints', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const health = await getJson(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.headers.deprecation, 'true');
    assert.match(String(health.headers.link || ''), /\/v1\/health/);

    const healthV1 = await getJson(port, '/v1/health');
    assert.equal(healthV1.status, 200);
    assert.equal(healthV1.body.ok, true);
    assert.equal(healthV1.headers.deprecation, undefined);

    const teams = await getJson(port, '/teams');
    assert.equal(teams.status, 200);
    assert.equal(Array.isArray(teams.body.teams), true);
    assert.equal(teams.body.teams[0].team_name, 'delta');

    const teamsV1 = await getJson(port, '/v1/teams');
    assert.equal(teamsV1.status, 200);
    assert.deepEqual(
      teamsV1.body.teams.map((t) => t.team_name),
      teams.body.teams.map((t) => t.team_name),
    );

    const schemaLegacy = await getJson(port, '/schema/version');
    assert.equal(schemaLegacy.status, 200);
    assert.equal(typeof schemaLegacy.body.api_version, 'string');
    assert.equal(schemaLegacy.body.compat_aliases_enabled, true);
    assert.equal(typeof schemaLegacy.body.sunset_date, 'string');

    const schemaV1 = await getJson(port, '/v1/schema/version');
    assert.equal(schemaV1.status, 200);
    assert.equal(schemaV1.body.api_version, 'v1');
    assert.equal(schemaV1.headers.deprecation, undefined);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});

test('sidecar server supports agent CRUD and manifest sync endpoints', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;

  const projectDir = join(home, 'project');
  mkdirSync(join(projectDir, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(projectDir, '.claude', 'agents.local'), { recursive: true });
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  const manifestPath = join(projectDir, 'MANIFEST.md');
  writeFileSync(
    manifestPath,
    [
      '# Manifest',
      '',
      '## Agents',
      '',
      'old',
      '',
      '### Worker Role Presets',
      '',
      'keep',
      '',
    ].join('\n'),
  );

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const apiToken = sidecar.apiToken;
  try {
    assert.equal(typeof apiToken, 'string');
    assert.equal(apiToken.length > 0, true);

    const created = await postJson(port, '/agents', {
      agent_name: 'api-agent',
      scope: 'project',
      description: 'API-created agent',
      model: 'sonnet',
      tools: ['Read', 'Edit'],
      memory: 'project',
      skills: ['qa'],
      prompt: 'You are API agent.',
      project_dir: projectDir,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.agent.name, 'api-agent');
    assert.equal(created.body.agent.scope, 'project');
    assert.equal(created.body.manifest_sync.ok, true);

    const listed = await getJson(
      port,
      `/agents?scope=all&project_dir=${encodeURIComponent(projectDir)}&include_invalid=true`,
    );
    assert.equal(listed.status, 200);
    assert.equal(Array.isArray(listed.body.agents), true);
    assert.equal(listed.body.agents.some((a) => a.name === 'api-agent'), true);

    const fetched = await getJson(
      port,
      `/agents/api-agent?scope=project&project_dir=${encodeURIComponent(projectDir)}`,
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.ok, true);
    assert.equal(fetched.body.agent.name, 'api-agent');
    assert.equal(fetched.body.agent.scope, 'project');
    assert.deepEqual(fetched.body.agent.tools, ['Read', 'Edit']);
    assert.equal('prompt' in fetched.body.agent, false);
    assert.equal('frontmatter' in fetched.body.agent, false);

    const fullAnonymous = await getJson(
      port,
      `/agents/api-agent/full?scope=project&project_dir=${encodeURIComponent(projectDir)}`,
    );
    assert.equal(fullAnonymous.status, 401);
    assert.equal(fullAnonymous.body.error_code, 'AUTH_REQUIRED');

    const fullAuthed = await getJson(
      port,
      `/agents/api-agent/full?scope=project&project_dir=${encodeURIComponent(projectDir)}`,
      { Authorization: `Bearer ${apiToken}` },
    );
    assert.equal(fullAuthed.status, 200);
    assert.equal(fullAuthed.body.ok, true);
    assert.match(fullAuthed.body.agent.prompt, /You are API agent/);
    assert.equal(typeof fullAuthed.body.agent.frontmatter, 'object');

    const shadowSource = await postJson(port, '/agents', {
      agent_name: 'api-agent',
      scope: 'user',
      description: 'User-scoped fallback',
      model: 'sonnet',
      project_dir: projectDir,
    });
    assert.equal(shadowSource.status, 200);
    assert.equal(shadowSource.body.ok, true);

    const fetchedAll = await getJson(
      port,
      `/agents/api-agent?scope=all&project_dir=${encodeURIComponent(projectDir)}`,
    );
    assert.equal(fetchedAll.status, 200);
    assert.equal(fetchedAll.body.ok, true);
    assert.equal(fetchedAll.body.agent.scope, 'project');

    const updated = await patchJson(port, '/agents/api-agent', {
      scope: 'project',
      new_name: 'api-agent-v2',
      model: 'opus',
      description: 'Updated agent',
      tools: ['Read', 'Write'],
      skills: ['qa', 'security-review'],
      project_dir: projectDir,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.ok, true);
    assert.equal(updated.body.agent.name, 'api-agent-v2');
    assert.equal(updated.body.agent.model, 'opus');
    assert.equal(updated.body.manifest_sync.ok, true);

    const userV2 = await postJson(port, '/agents', {
      agent_name: 'api-agent-v2',
      scope: 'user',
      description: 'User v2 fallback',
      project_dir: projectDir,
    });
    assert.equal(userV2.status, 200);
    assert.equal(userV2.body.ok, true);

    const sync = await postJson(port, '/agents/sync-manifest', {
      manifest_path: manifestPath,
      project_dir: projectDir,
      scope: 'all',
    });
    assert.equal(sync.status, 200);
    assert.equal(sync.body.ok, true);
    const manifest = readFileSync(manifestPath, 'utf-8');
    assert.match(manifest, /\| api-agent-v2 \|/);
    assert.doesNotMatch(manifest, /\nold\n/);

    const deleted = await deleteJson(
      port,
      `/agents/api-agent-v2?scope=all&project_dir=${encodeURIComponent(projectDir)}`,
      {
      scope: 'all',
      project_dir: projectDir,
      },
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);
    assert.equal(deleted.body.deleted_count, 1);
    assert.equal(deleted.body.deleted[0].scope, 'project');
    assert.equal(deleted.body.manifest_sync.ok, true);

    const missing = await getJson(
      port,
      `/agents/api-agent-v2?scope=project&project_dir=${encodeURIComponent(projectDir)}`,
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.error_code, 'NOT_FOUND');

    const winnerAfterDelete = await getJson(
      port,
      `/agents/api-agent-v2?scope=all&project_dir=${encodeURIComponent(projectDir)}`,
    );
    assert.equal(winnerAfterDelete.status, 200);
    assert.equal(winnerAfterDelete.body.ok, true);
    assert.equal(winnerAfterDelete.body.agent.scope, 'user');

    const badPrompt = await postJson(port, '/agents', {
      agent_name: 'bad-prompt',
      scope: 'project',
      description: 'bad prompt',
      prompt: '   ',
      project_dir: projectDir,
    });
    assert.equal(badPrompt.status, 400);
    assert.equal(badPrompt.body.ok, false);
    assert.equal(badPrompt.body.error_code, 'VALIDATION_ERROR');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});

test('sidecar server executes runtime reassign and gate-check flows (not just body validation)', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;

  const now = new Date().toISOString();
  const reassignTaskFile = join(home, '.claude', 'terminals', 'tasks', 'T_reassign.json');
  writeFileSync(reassignTaskFile, JSON.stringify({
    task_id: 'T_reassign',
    subject: 'Carry forward implementation context',
    status: 'in_progress',
    team_name: 'delta',
    assignee: 'd1',
    priority: 'normal',
    files: ['README.md'],
    blocked_by: [],
    blocks: [],
    metadata: {},
    created: now,
    updated: now,
  }));

  const gateTaskFile = join(home, '.claude', 'terminals', 'tasks', 'T_gate.json');
  writeFileSync(gateTaskFile, JSON.stringify({
    task_id: 'T_gate',
    subject: 'Run quality gate check',
    status: 'in_progress',
    team_name: 'delta',
    assignee: 'd1',
    priority: 'normal',
    files: [],
    blocked_by: [],
    blocks: [],
    metadata: {
      quality_gates: ['lint', 'tests'],
      acceptance_criteria: ['all checks pass'],
      gate_results: { lint: true, tests: false },
      criteria_results: [],
    },
    created: now,
    updated: now,
  }));

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const reassign = await postJson(port, '/teams/delta/tasks/T_reassign/reassign', {
      new_assignee: 'd2',
      reason: 'manual reassignment test',
      progress_context: 'handoff-ready',
    });
    assert.equal(reassign.status, 200);
    assert.equal(reassign.body.ok, true);
    assert.match(String(reassign.body.result || ''), /Task Reassigned: T_reassign/);

    const updatedTask = JSON.parse(readFileSync(reassignTaskFile, 'utf-8'));
    assert.equal(updatedTask.assignee, 'd2');
    assert.equal(updatedTask.metadata?.last_reassignment?.from, 'd1');
    assert.equal(updatedTask.metadata?.last_reassignment?.to, 'd2');
    assert.equal(updatedTask.metadata?.last_reassignment?.reason, 'manual reassignment test');

    const handoff = JSON.parse(readFileSync(join(home, '.claude', 'terminals', 'results', 'T_reassign.handoff.json'), 'utf-8'));
    assert.equal(handoff.from, 'd1');
    assert.equal(handoff.to, 'd2');
    assert.equal(handoff.reason, 'manual reassignment test');
    assert.equal(handoff.progress_context, 'handoff-ready');

    const gateCheck = await postJson(port, '/teams/delta/tasks/T_gate/gate-check', {});
    assert.equal(gateCheck.status, 200);
    assert.equal(gateCheck.body.ok, true);
    assert.match(String(gateCheck.body.result || ''), /Quality Gates: T_gate/);
    assert.match(String(gateCheck.body.result || ''), /Overall: FAIL/);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});

test('sidecar server exposes native status/probe endpoints and action queue metadata', async () => {
  const prevHome = process.env.HOME;
  const prevMock = process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK;
  const prevNativeEnable = process.env.LEAD_SIDECAR_NATIVE_ENABLE;
  const prevBridgeMock = process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_NATIVE_ENABLE = '1';
  process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = '1';
  process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK = '1';
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const ns = await getJson(port, '/native/status');
    assert.equal(ns.status, 200);
    assert.equal(typeof ns.body.mode, 'string');
    assert.equal(ns.headers.deprecation, 'true');
    assert.match(String(ns.headers.link || ''), /\/v1\/native\/status/);

    const nsV1 = await getJson(port, '/v1/native/status');
    assert.equal(nsV1.status, 200);
    assert.equal(nsV1.headers.deprecation, undefined);

    const probe = await postJson(port, '/native/probe', {});
    assert.equal(probe.status, 200);
    assert.equal(probe.body.ok, true);

    const nativeTask = await postJson(port, '/native/actions/task', { team_name: 'delta', agent: 'd1', task: 'Summarize progress' });
    assert.equal(nativeTask.status, 200);
    assert.equal(nativeTask.body.adapter, 'native');
    assert.equal(Boolean(nativeTask.body.action_id), true);
    assert.equal(typeof nativeTask.body.route_mode, 'string');
    assert.equal(typeof nativeTask.body.route_reason, 'string');

    const bridgeValidate = await postJson(port, '/native/bridge/validate', { team_name: 'delta', simulate: true, timeout_ms: 3000 });
    assert.equal([200, 400].includes(bridgeValidate.status), true);
    assert.equal(typeof bridgeValidate.body.ok, 'boolean');
    assert.equal(Boolean(bridgeValidate.body.diagnostics), true);

    const bridgeValidation = await getJson(port, '/native/bridge/validation');
    assert.equal(bridgeValidation.status, 200);
    assert.equal(Boolean(bridgeValidation.body.validation), true);

    const rebalanceExplain = await getJson(port, '/teams/delta/rebalance-explain?limit=5');
    assert.equal(rebalanceExplain.status, 200);
    assert.equal(rebalanceExplain.body.ok, true);
    assert.equal(Array.isArray(rebalanceExplain.body.tasks), true);

    const actions = await getJson(port, '/actions');
    assert.equal(actions.status, 200);
    assert.equal(actions.body.actions.length >= 1, true);
    const latestAction = actions.body.actions[0];
    assert.equal(typeof latestAction.route_mode, 'string');
    assert.equal(typeof latestAction.route_reason, 'string');
    assert.equal(actions.headers.deprecation, 'true');
    assert.match(String(actions.headers.link || ''), /\/v1\/actions/);

    const actionsV1 = await getJson(port, '/v1/actions');
    assert.equal(actionsV1.status, 200);
    assert.equal(actionsV1.headers.deprecation, undefined);
    assert.equal(Array.isArray(actionsV1.body.actions), true);

    const teamDetail = await getJson(port, '/teams/delta');
    assert.equal(teamDetail.status, 200);
    assert.equal(Array.isArray(teamDetail.body.actions?.recent), true);
    if (teamDetail.body.actions.recent.length > 0) {
      assert.equal(typeof teamDetail.body.actions.recent[0].route_mode, 'string');
      assert.equal(typeof teamDetail.body.actions.recent[0].route_reason, 'string');
    }
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK; else process.env.LEAD_SIDECAR_NATIVE_RUNNER_MOCK = prevMock;
    if (prevNativeEnable === undefined) delete process.env.LEAD_SIDECAR_NATIVE_ENABLE; else process.env.LEAD_SIDECAR_NATIVE_ENABLE = prevNativeEnable;
    if (prevBridgeMock === undefined) delete process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK; else process.env.LEAD_SIDECAR_NATIVE_BRIDGE_MOCK = prevBridgeMock;
  }
});

test('sidecar action retry/fallback reuse the same tracked action id (no duplicate pending record)', async () => {
  const prevHome = process.env.HOME;
  const home = setupHome();
  process.env.HOME = home;
  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  try {
    const dispatch = await postJson(port, '/dispatch', {
      team_name: 'delta',
      subject: 'Retry/fallback regression test',
      prompt: 'Verify tracked action id reuse',
      directory: home,
    });
    assert.equal(dispatch.status, 200);
    const actionId = dispatch.body.action_id;
    assert.equal(typeof actionId, 'string');

    const before = await getJson(port, '/actions');
    assert.equal(before.status, 200);
    const beforeCount = before.body.actions.length;
    assert.equal(before.body.actions.filter((a) => a.action_id === actionId).length, 1);

    const retry = await postJson(port, `/actions/${encodeURIComponent(actionId)}/retry`, {});
    assert.equal(retry.status, 200);
    assert.equal(retry.body.action_id, actionId);

    const afterRetry = await getJson(port, '/actions');
    assert.equal(afterRetry.status, 200);
    assert.equal(afterRetry.body.actions.length, beforeCount);
    assert.equal(afterRetry.body.actions.filter((a) => a.action_id === actionId).length, 1);
    const retried = afterRetry.body.actions.find((a) => a.action_id === actionId);
    assert.equal((retried?.retry_count || 0) >= 1, true);
    assert.notEqual(retried?.state, 'pending');

    const fallback = await postJson(port, `/actions/${encodeURIComponent(actionId)}/fallback`, { force_path: 'coordinator' });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body.action_id, actionId);

    const afterFallback = await getJson(port, '/actions');
    assert.equal(afterFallback.status, 200);
    assert.equal(afterFallback.body.actions.length, beforeCount);
    assert.equal(afterFallback.body.actions.filter((a) => a.action_id === actionId).length, 1);
    const fallbackRecord = afterFallback.body.actions.find((a) => a.action_id === actionId);
    assert.equal((fallbackRecord?.retry_count || 0) >= 2, true);
    assert.notEqual(fallbackRecord?.state, 'pending');
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('sidecar secure mode enforces auth and CSRF, and Phase A maintenance/diagnostics endpoints work', async () => {
  const prevHome = process.env.HOME;
  const prevRequire = process.env.LEAD_SIDECAR_REQUIRE_TOKEN;
  const prevLimit = process.env.LEAD_SIDECAR_RATE_LIMIT;
  const prevWindow = process.env.LEAD_SIDECAR_RATE_WINDOW_MS;
  const prevInflight = process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS;
  const home = setupHome();
  process.env.HOME = home;
  process.env.LEAD_SIDECAR_REQUIRE_TOKEN = '1';
  process.env.LEAD_SIDECAR_RATE_LIMIT = '6';
  process.env.LEAD_SIDECAR_RATE_WINDOW_MS = '60000';
  process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS = '1';

  const inflightDir = join(home, '.claude', 'lead-sidecar', 'runtime', 'actions', 'inflight');
  mkdirSync(inflightDir, { recursive: true });
  writeFileSync(join(inflightDir, 'A_recover.json'), JSON.stringify({
    action_id: 'A_recover',
    action: 'message',
    state: 'inflight',
    created_at: '2020-01-01T00:00:00.000Z',
    started_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    audit: [],
  }));

  const mod = await import(`../server/index.js?t=${Date.now()}-${Math.random()}`);
  const sidecar = await mod.startSidecarServer({ port: 0 });
  const { port } = sidecar;
  const runtimeDir = join(home, '.claude', 'lead-sidecar', 'runtime');
  const apiToken = JSON.parse(readFileSync(join(runtimeDir, 'api.token'), 'utf-8')).token;
  try {
    const unauth = await postJson(port, '/maintenance/run', { source: 'test' });
    assert.equal(unauth.status, 401);

    const bootstrap = await getJson(port, '/ui/bootstrap.json');
    assert.equal(bootstrap.status, 200);
    const csrf = bootstrap.body.csrf_token;
    assert.equal(typeof csrf, 'string');
    assert.equal(bootstrap.body.token_required, true);
    assert.equal(Object.hasOwn(bootstrap.body, 'api_token'), false);

    const bootstrapSameOrigin = await getJson(port, '/ui/bootstrap.json', { Origin: `http://127.0.0.1:${port}` });
    assert.equal(bootstrapSameOrigin.status, 200);
    assert.equal(bootstrapSameOrigin.headers['access-control-allow-origin'], `http://127.0.0.1:${port}`);

    const bootstrapCrossPort127 = await getJson(port, '/ui/bootstrap.json', { Origin: 'http://127.0.0.1:3000' });
    assert.equal(bootstrapCrossPort127.status, 403);
    assert.equal(bootstrapCrossPort127.headers['access-control-allow-origin'], undefined);

    const bootstrapCrossPortLocalhost = await getJson(port, '/ui/bootstrap.json', { Origin: 'http://localhost:3000' });
    assert.equal(bootstrapCrossPortLocalhost.status, 403);
    assert.equal(bootstrapCrossPortLocalhost.headers['access-control-allow-origin'], undefined);

    const csrfFail = await postJson(port, '/maintenance/run', { source: 'test' }, {
      Origin: `http://127.0.0.1:${port}`,
      Authorization: `Bearer ${apiToken}`,
    });
    assert.equal(csrfFail.status, 403);
    assert.equal(csrfFail.body.error_code, 'CSRF_REQUIRED');

    const noCsrfNoAuth = await postJson(port, '/maintenance/run', { source: 'test' }, { Origin: `http://127.0.0.1:${port}` });
    assert.equal(noCsrfNoAuth.status, 401);

    const noAuthWithCsrf = await postJson(port, '/maintenance/run', { source: 'test' }, {
      Origin: `http://127.0.0.1:${port}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(noAuthWithCsrf.status, 401);

    const prefsUnauth = await putJson(port, '/ui/preferences', { theme: 'light' });
    assert.equal(prefsUnauth.status, 401);

    const prefsNoCsrf = await putJson(port, '/ui/preferences', { theme: 'light' }, { Origin: `http://127.0.0.1:${port}` });
    assert.equal(prefsNoCsrf.status, 401);

    const prefsOk = await putJson(port, '/ui/preferences', { theme: 'light' }, {
      Origin: `http://127.0.0.1:${port}`,
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(prefsOk.status, 200);
    assert.equal(prefsOk.body.ok, true);

    const patchUnauth = await patchJson(port, '/teams/delta/interrupt-priorities', { approval: 10 });
    assert.equal(patchUnauth.status, 401);

    const patchNoCsrf = await patchJson(port, '/teams/delta/interrupt-priorities', { approval: 10 }, { Origin: `http://127.0.0.1:${port}` });
    assert.equal(patchNoCsrf.status, 401);

    const patchOk = await patchJson(port, '/teams/delta/interrupt-priorities', { approval: 10 }, {
      Origin: `http://127.0.0.1:${port}`,
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(patchOk.status, 200);
    assert.equal(patchOk.body.ok, true);
    const updatedTeam = JSON.parse(readFileSync(join(home, '.claude', 'terminals', 'teams', 'delta.json'), 'utf-8'));
    assert.equal(updatedTeam.policy?.interrupt_weights?.approval, 10);

    const diagnosticsBypassDir = join(home, '.claude', 'lead-sidecar', 'logs', 'diagnostics-evil');
    mkdirSync(diagnosticsBypassDir, { recursive: true });
    const diagnosticsBypassFile = join(diagnosticsBypassDir, 'outside-baseline.json');
    writeFileSync(diagnosticsBypassFile, JSON.stringify({ ok: true }));
    const diagnosticsBypass = await postJson(port, '/reports/comparison', {
      label: 'test',
      baseline_file: diagnosticsBypassFile,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(diagnosticsBypass.status, 400);
    assert.equal(diagnosticsBypass.body.error_code, 'VALIDATION_ERROR');

    const sidecarSiblingDir = join(home, '.claude', 'lead-sidecar-evil');
    mkdirSync(sidecarSiblingDir, { recursive: true });
    const sidecarSiblingFile = join(sidecarSiblingDir, 'probe.json');
    writeFileSync(sidecarSiblingFile, JSON.stringify({ probe: true }));
    const repairBypass = await postJson(port, '/repair/fix', {
      path: sidecarSiblingFile,
      dry_run: true,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(repairBypass.status, 400);
    assert.equal(repairBypass.body.error_code, 'VALIDATION_ERROR');

    const checkpointsBypassDir = join(home, '.claude', 'lead-sidecar', 'state', 'checkpoints-evil');
    mkdirSync(checkpointsBypassDir, { recursive: true });
    const checkpointsBypassFile = join(checkpointsBypassDir, 'outside-checkpoint.json');
    writeFileSync(checkpointsBypassFile, JSON.stringify({}));
    const checkpointsBypass = await postJson(port, '/checkpoints/restore', {
      file: checkpointsBypassFile,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(checkpointsBypass.status, 400);
    assert.equal(checkpointsBypass.body.error_code, 'VALIDATION_ERROR');

    const backupsBypassDir = join(home, '.claude', 'lead-sidecar', 'state', 'backups-evil');
    mkdirSync(backupsBypassDir, { recursive: true });
    const backupsBypassFile = join(backupsBypassDir, 'outside-backup.json');
    writeFileSync(backupsBypassFile, JSON.stringify({}));
    const backupsBypass = await postJson(port, '/backups/restore', {
      file: backupsBypassFile,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(backupsBypass.status, 400);
    assert.equal(backupsBypass.body.error_code, 'VALIDATION_ERROR');

    const symlinkDiagnostics = join(home, '.claude', 'lead-sidecar', 'logs', 'diagnostics', 'symlink-baseline.json');
    symlinkSync(diagnosticsBypassFile, symlinkDiagnostics);
    const diagnosticsSymlinkBypass = await postJson(port, '/reports/comparison', {
      label: 'test-symlink',
      baseline_file: symlinkDiagnostics,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(diagnosticsSymlinkBypass.status, 400);
    assert.equal(diagnosticsSymlinkBypass.body.error_code, 'VALIDATION_ERROR');

    const symlinkRepair = join(home, '.claude', 'lead-sidecar', 'state', 'symlink-repair.json');
    symlinkSync(sidecarSiblingFile, symlinkRepair);
    const repairSymlinkBypass = await postJson(port, '/repair/fix', {
      path: symlinkRepair,
      dry_run: true,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(repairSymlinkBypass.status, 400);
    assert.equal(repairSymlinkBypass.body.error_code, 'VALIDATION_ERROR');

    const symlinkCheckpoint = join(home, '.claude', 'lead-sidecar', 'state', 'checkpoints', 'symlink-checkpoint.json');
    mkdirSync(join(home, '.claude', 'lead-sidecar', 'state', 'checkpoints'), { recursive: true });
    symlinkSync(checkpointsBypassFile, symlinkCheckpoint);
    const checkpointsSymlinkBypass = await postJson(port, '/checkpoints/restore', {
      file: symlinkCheckpoint,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(checkpointsSymlinkBypass.status, 400);
    assert.equal(checkpointsSymlinkBypass.body.error_code, 'VALIDATION_ERROR');

    const symlinkBackup = join(home, '.claude', 'lead-sidecar', 'state', 'backups', 'symlink-backup.json');
    mkdirSync(join(home, '.claude', 'lead-sidecar', 'state', 'backups'), { recursive: true });
    symlinkSync(backupsBypassFile, symlinkBackup);
    const backupsSymlinkBypass = await postJson(port, '/backups/restore', {
      file: symlinkBackup,
    }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(backupsSymlinkBypass.status, 400);
    assert.equal(backupsSymlinkBypass.body.error_code, 'VALIDATION_ERROR');

    const badOrigin = await postJson(port, '/maintenance/run', { source: 'test' }, {
      Authorization: `Bearer ${apiToken}`,
      Origin: 'http://evil.example',
    });
    assert.equal(badOrigin.status, 403);

    const badKeys = await postJson(port, '/native/probe', { unexpected: true }, {
      Authorization: `Bearer ${apiToken}`,
      'X-Sidecar-CSRF': csrf,
    });
    assert.equal(badKeys.status, 400);

    let lastRate = null;
    for (let i = 0; i < 8; i += 1) {
      lastRate = await postJson(port, '/native/probe', {}, { Authorization: `Bearer ${apiToken}`, 'X-Sidecar-CSRF': csrf });
    }
    assert.equal(lastRate.status, 429);

    const maint = await postJson(port, '/maintenance/run', { source: 'test' }, { Authorization: `Bearer ${apiToken}`, 'X-Sidecar-CSRF': csrf });
    assert.equal(maint.status, 200);
    assert.equal(maint.body.ok, true);
    assert.equal(maint.body.maintenance.recovered_inflight >= 0, true);

    const actions = await getJson(port, '/actions');
    assert.equal(actions.status, 200);
    assert.equal(actions.body.actions.some((a) => a.action_id === 'A_recover' && a.state === 'failed'), true);

    const diag = await postJson(port, '/diagnostics/export', { label: 'test' }, { Authorization: `Bearer ${apiToken}`, 'X-Sidecar-CSRF': csrf });
    assert.equal(diag.status, 200);
    assert.equal(diag.body.ok, true);
    assert.equal(typeof diag.body.file, 'string');

    const latest = await getJson(port, '/diagnostics/latest');
    assert.equal(latest.status, 200);
    assert.equal(latest.body.ok, true);
    assert.equal(Boolean(latest.body.latest), true);
  } finally {
    sidecar.close();
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevRequire === undefined) delete process.env.LEAD_SIDECAR_REQUIRE_TOKEN; else process.env.LEAD_SIDECAR_REQUIRE_TOKEN = prevRequire;
    if (prevLimit === undefined) delete process.env.LEAD_SIDECAR_RATE_LIMIT; else process.env.LEAD_SIDECAR_RATE_LIMIT = prevLimit;
    if (prevWindow === undefined) delete process.env.LEAD_SIDECAR_RATE_WINDOW_MS; else process.env.LEAD_SIDECAR_RATE_WINDOW_MS = prevWindow;
    if (prevInflight === undefined) delete process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS; else process.env.LEAD_SIDECAR_INFLIGHT_STALE_MS = prevInflight;
  }
});
