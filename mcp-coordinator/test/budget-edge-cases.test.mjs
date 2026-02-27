/**
 * Deterministic tests for budget policy edge cases:
 * boundary values, overflow-like inputs, and zero-budget enforcement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-budget-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'inbox'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'session-cache'), { recursive: true });
  return { home, terminals };
}

async function loadForTest(home, envOverrides = {}) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
    COORDINATOR_GLOBAL_BUDGET_POLICY: process.env.COORDINATOR_GLOBAL_BUDGET_POLICY,
    COORDINATOR_GLOBAL_BUDGET_TOKENS: process.env.COORDINATOR_GLOBAL_BUDGET_TOKENS,
    COORDINATOR_MAX_ACTIVE_WORKERS: process.env.COORDINATOR_MAX_ACTIVE_WORKERS,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  process.env.COORDINATOR_CLAUDE_BIN = 'echo';
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  const mod = await import(`../index.js?budget=${Date.now()}-${Math.random()}`);
  return {
    api: mod.__test__,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      for (const k of Object.keys(envOverrides)) {
        if (!(k in prev)) delete process.env[k];
      }
    },
  };
}

function textOf(result) {
  return result?.content?.[0]?.text || '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token estimation
// ═══════════════════════════════════════════════════════════════════════════════

test('estimateWorkerTokens returns expected values for known models', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    const sonnet = api.estimateWorkerTokens?.('sonnet');
    const haiku = api.estimateWorkerTokens?.('haiku');
    const opus = api.estimateWorkerTokens?.('opus');

    if (sonnet !== undefined) {
      assert.ok(sonnet > 0, 'sonnet estimate should be positive');
      assert.ok(haiku > 0, 'haiku estimate should be positive');
      assert.ok(opus > 0, 'opus estimate should be positive');
      // opus > sonnet > haiku (general expectation)
      assert.ok(opus > sonnet, 'opus should cost more than sonnet');
      assert.ok(sonnet > haiku, 'sonnet should cost more than haiku');
    }
  } finally {
    restore();
  }
});

test('estimateWorkerTokens defaults to sonnet for undefined model', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    if (api.estimateWorkerTokens) {
      const defaultEst = api.estimateWorkerTokens(undefined);
      const sonnetEst = api.estimateWorkerTokens('sonnet');
      assert.equal(defaultEst, sonnetEst, 'undefined model should default to sonnet estimate');
    }
  } finally {
    restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Global budget policy enforcement
// ═══════════════════════════════════════════════════════════════════════════════

test('global budget enforce with very low global tokens blocks all spawns', async () => {
  const { home } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });

  // Note: positiveIntOrFallback requires n > 0, so we pass 1 via args
  const { api, restore } = await loadForTest(home, {
    COORDINATOR_GLOBAL_BUDGET_POLICY: 'enforce',
  });
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Should be blocked',
      model: 'sonnet',
      global_budget_tokens: 1, // estimate will always exceed 1
    });
    const txt = textOf(result);
    // Should be blocked by global budget
    assert.match(txt, /budget.*blocked/i);
  } finally {
    restore();
  }
});

test('global budget enforce at max_active_workers limit blocks spawns', async () => {
  const { home } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });
  const results = join(home, '.claude', 'terminals', 'results');

  // Pre-populate one active worker so count=1 hits max_active_workers=1
  writeFileSync(join(results, 'W_FILL.meta.json'), JSON.stringify({
    task_id: 'W_FILL', model: 'sonnet', status: 'running',
  }));
  writeFileSync(join(results, 'W_FILL.pid'), String(process.pid));

  const { api, restore } = await loadForTest(home, {
    COORDINATOR_GLOBAL_BUDGET_POLICY: 'enforce',
  });
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Should be blocked by max workers',
      model: 'sonnet',
      max_active_workers: 1, // already 1 running, so at limit
    });
    const txt = textOf(result);
    // concurrency policy should block
    assert.match(txt, /concurrency.*blocked|max.*worker/i);
  } finally {
    restore();
  }
});

test('global budget warn with large tokens allows spawn with warning', async () => {
  const { home } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home, {
    COORDINATOR_GLOBAL_BUDGET_POLICY: 'warn',
    COORDINATOR_GLOBAL_BUDGET_TOKENS: `${Number.MAX_SAFE_INTEGER}`,
  });
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Should succeed with large budget',
      model: 'sonnet',
    });
    const txt = textOf(result);
    // Should succeed (Worker spawned)
    assert.match(txt, /Worker spawned|spawned/i);
  } finally {
    restore();
  }
});

test('global budget off allows spawn without budget info', async () => {
  const { home } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home, {
    COORDINATOR_GLOBAL_BUDGET_POLICY: 'off',
  });
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'No budget enforcement',
      model: 'haiku',
    });
    assert.match(textOf(result), /Worker spawned|spawned/i);
  } finally {
    restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Per-worker budget via team policy
// ═══════════════════════════════════════════════════════════════════════════════

test('per-worker budget enforce with very low tokens blocks spawn', async () => {
  const { home } = setupHome();
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Create team with very restrictive budget
    api.handleCreateTeam({
      team_name: 'tight-budget',
      preset: 'strict',
      policy: { budget_policy: 'enforce', budget_tokens: 1 },
    });

    const result = api.handleToolCall('coord_spawn_worker', {
      directory: projectDir,
      prompt: 'Should be blocked by per-worker budget',
      model: 'opus', // opus uses the most tokens
      team_name: 'tight-budget',
      budget_policy: 'enforce',
      budget_tokens: 1,
    });
    const txt = textOf(result);
    // Per-worker budget should block
    assert.match(txt, /budget|blocked|Budget/i);
  } finally {
    restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Active worker usage counting
// ═══════════════════════════════════════════════════════════════════════════════

test('getActiveWorkerUsage returns zero when no workers running', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    if (api.getActiveWorkerUsage) {
      const usage = api.getActiveWorkerUsage();
      assert.equal(typeof usage.count, 'number');
      assert.equal(typeof usage.estimated_tokens, 'number');
      assert.equal(usage.count, 0, 'No active workers');
      assert.equal(usage.estimated_tokens, 0, 'No estimated tokens');
    }
  } finally {
    restore();
  }
});

test('getActiveWorkerUsage counts active workers correctly', async () => {
  const { home } = setupHome();
  const results = join(home, '.claude', 'terminals', 'results');
  const projectDir = join(home, 'project');
  mkdirSync(projectDir, { recursive: true });

  // Simulate running workers by writing meta.json + pid files
  writeFileSync(join(results, 'W_ACT1.meta.json'), JSON.stringify({
    task_id: 'W_ACT1', model: 'sonnet', status: 'running',
  }));
  writeFileSync(join(results, 'W_ACT1.pid'), String(process.pid)); // alive

  writeFileSync(join(results, 'W_ACT2.meta.json'), JSON.stringify({
    task_id: 'W_ACT2', model: 'haiku', status: 'running',
  }));
  writeFileSync(join(results, 'W_ACT2.pid'), String(process.pid)); // alive

  // Completed worker (should not count)
  writeFileSync(join(results, 'W_DONE.meta.json'), JSON.stringify({
    task_id: 'W_DONE', model: 'sonnet', status: 'completed',
  }));
  writeFileSync(join(results, 'W_DONE.meta.json.done'), JSON.stringify({ status: 'completed' }));

  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    if (api.getActiveWorkerUsage) {
      const usage = api.getActiveWorkerUsage();
      assert.ok(usage.count >= 2, `Should count at least 2 active workers, got ${usage.count}`);
      assert.ok(usage.estimated_tokens > 0, 'Should have positive estimated tokens');
    }
  } finally {
    restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// pickPolicy helper
// ═══════════════════════════════════════════════════════════════════════════════

test('pickPolicy returns "off" when team is undefined', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    if (api.pickPolicy) {
      assert.equal(api.pickPolicy(undefined, 'budget_policy'), 'off');
      assert.equal(api.pickPolicy(null, 'budget_policy'), 'off');
    }
  } finally {
    restore();
  }
});

test('pickPolicy returns team value when set', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    if (api.pickPolicy) {
      const team = { policy: { budget_policy: 'enforce' } };
      assert.equal(api.pickPolicy(team, 'budget_policy'), 'enforce');
    }
  } finally {
    restore();
  }
});
