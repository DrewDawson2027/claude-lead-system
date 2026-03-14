/**
 * Schema validation tests:
 *   1. API_SCHEMA data integrity
 *   2. core/schema.js — migrateBundle, validateSchemaVersion, dryRunMigration
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { API_SCHEMA } from '../server/http/schema.ts';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VALID_AUTH = new Set(['none', 'bearer', 'optional']);

test('API_SCHEMA.routes — all routes have required fields', () => {
  for (const route of API_SCHEMA.routes) {
    assert.ok(route.method, `missing method: ${JSON.stringify(route)}`);
    assert.ok(route.path, `missing path: ${JSON.stringify(route)}`);
    assert.ok(route.description, `missing description: ${route.path}`);
    assert.ok(route.auth !== undefined, `missing auth: ${route.path}`);
  }
});

test('API_SCHEMA.routes — all HTTP methods are valid', () => {
  for (const route of API_SCHEMA.routes) {
    assert.ok(
      VALID_METHODS.has(route.method.toUpperCase()),
      `invalid method "${route.method}" on ${route.path}`,
    );
  }
});

test('API_SCHEMA.routes — all auth values are valid', () => {
  for (const route of API_SCHEMA.routes) {
    assert.ok(
      VALID_AUTH.has(route.auth),
      `invalid auth "${route.auth}" on ${route.method} ${route.path}`,
    );
  }
});

test('API_SCHEMA.routes — no duplicate method+path combinations', () => {
  const seen = new Set();
  for (const route of API_SCHEMA.routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    assert.equal(seen.has(key), false, `duplicate route: ${key}`);
    seen.add(key);
  }
});

test('API_SCHEMA.routes — bearer-auth routes have a body or response', () => {
  for (const route of API_SCHEMA.routes) {
    if (route.auth === 'bearer') {
      assert.ok(
        route.body !== undefined || route.response !== undefined,
        `bearer route ${route.method} ${route.path} missing body+response`,
      );
    }
  }
});

test('API_SCHEMA.routes — body.required entries are arrays of strings', () => {
  for (const route of API_SCHEMA.routes) {
    if (route.body && route.body.required) {
      assert.ok(
        Array.isArray(route.body.required),
        `body.required on ${route.path} is not an array`,
      );
      for (const field of route.body.required) {
        assert.equal(typeof field, 'string', `body.required has non-string on ${route.path}`);
      }
    }
  }
});

test('API_SCHEMA.version is a non-empty string', () => {
  assert.equal(typeof API_SCHEMA.version, 'string');
  assert.ok(API_SCHEMA.version.length > 0);
});

import {
  CURRENT_SCHEMA_VERSION,
  migrateBundle,
  validateSchemaVersion,
  dryRunMigration,
  migrations,
} from '../core/schema.js';

test('CURRENT_SCHEMA_VERSION is 3', () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 3);
});

test('migrateBundle — v1 bundle migrates to v3 in two steps', () => {
  const bundle = {
    schema_version: 1,
    snapshot: {
      tasks: [{ task_id: 'T1' }],
      teams: [{ team_name: 'alpha', policy: {} }],
    },
  };
  const result = migrateBundle(bundle);
  assert.equal(result.final_version, 3);
  assert.equal(result.applied.length, 2);
  assert.equal(result.applied[0].from, 1);
  assert.equal(result.applied[0].to, 2);
  assert.equal(result.applied[1].from, 2);
  assert.equal(result.applied[1].to, 3);
  assert.ok(Array.isArray(result.bundle.snapshot.tasks[0].quality_gates));
  assert.ok(result.bundle.snapshot.teams[0].recovery_metadata !== undefined);
});

test('migrateBundle — v2 bundle migrates to v3 in one step', () => {
  const bundle = {
    schema_version: 2,
    snapshot: { tasks: [], teams: [{ team_name: 'beta', policy: {} }] },
  };
  const result = migrateBundle(bundle);
  assert.equal(result.final_version, 3);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].from, 2);
  assert.equal(result.applied[0].to, 3);
});

test('migrateBundle — v3 bundle is no-op', () => {
  const bundle = { schema_version: 3, snapshot: { tasks: [], teams: [] } };
  const result = migrateBundle(bundle);
  assert.equal(result.final_version, 3);
  assert.equal(result.applied.length, 0);
});

test('migrateBundle — null bundle returns null', () => {
  assert.equal(migrateBundle(null), null);
});

test('migrateBundle — v1 to v2 adds auto_rebalance policy', () => {
  const bundle = {
    schema_version: 1,
    snapshot: { tasks: [], teams: [{ team_name: 'x', policy: {} }] },
  };
  migrateBundle(bundle);
  assert.ok(bundle.snapshot.teams[0].policy.auto_rebalance !== undefined);
  assert.equal(bundle.snapshot.teams[0].policy.auto_rebalance.enabled, false);
});

test('validateSchemaVersion — v3 is valid', () => {
  const r = validateSchemaVersion({ schema_version: 3 });
  assert.equal(r.valid, true);
  assert.equal(r.needs_migration, false);
  assert.equal(r.version, 3);
});

test('validateSchemaVersion — v1 needs migration', () => {
  const r = validateSchemaVersion({ schema_version: 1 });
  assert.equal(r.valid, false);
  assert.equal(r.needs_migration, true);
  assert.equal(r.current, 3);
});

test('validateSchemaVersion — missing version defaults to 1', () => {
  const r = validateSchemaVersion({});
  assert.equal(r.version, 1);
  assert.equal(r.needs_migration, true);
});

test('dryRunMigration — v1 would apply 2 migrations', () => {
  const r = dryRunMigration({ schema_version: 1 });
  assert.equal(r.would_apply.length, 2);
  assert.equal(r.current_version, 1);
  assert.equal(r.target_version, 3);
});

test('dryRunMigration — v3 would apply nothing', () => {
  const r = dryRunMigration({ schema_version: 3 });
  assert.equal(r.would_apply.length, 0);
});

test('dryRunMigration — does not mutate the input bundle', () => {
  const bundle = { schema_version: 1, snapshot: { tasks: [], teams: [] } };
  dryRunMigration(bundle);
  assert.equal(bundle.schema_version, 1);
});

test('migrations list — each entry has description and migrate function', () => {
  for (const m of migrations) {
    assert.ok(m.description && m.description.length > 0);
    assert.equal(typeof m.migrate, 'function');
  }
});
