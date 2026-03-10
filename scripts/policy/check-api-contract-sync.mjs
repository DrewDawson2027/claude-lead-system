#!/usr/bin/env node
/**
 * check-api-contract-sync.mjs
 *
 * Validates that docs/API_CONTRACT.md body shapes match the runtime truth:
 *   - For schema-validated routes: fields in BODY_ALLOWLISTS (sidecar/server/http/validation.ts)
 *   - For schema-less routes: hardcoded handler field lists
 *
 * Exit 0 = clean. Exit 1 = drift detected.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ---------------------------------------------------------------------------
// Schema-less routes: source-of-truth is the handler's destructured fields.
// Update this list whenever a handler changes what it reads from body.
// ---------------------------------------------------------------------------
const SCHEMA_LESS_ROUTES = [
  {
    pathPattern: /^\/teams\/[^/]+\/tasks\/[^/]+\/reassign$/,
    method: 'POST',
    expectedFields: ['new_assignee', 'reason', 'progress_context'],
    label: 'POST /teams/:name/tasks/:id/reassign',
  },
];

// ---------------------------------------------------------------------------
// Parse BODY_ALLOWLISTS from validation.ts
// Each line looks like: { rx: /^\/foo$/, keys: ['a', 'b'] },
// ---------------------------------------------------------------------------
function parseAllowlists(src) {
  const allowlists = [];
  const entryRe = /\{\s*rx:\s*\/(.*?)\/,\s*keys:\s*\[(.*?)\]\s*\}/g;
  let m;
  while ((m = entryRe.exec(src)) !== null) {
    const pattern = m[1];
    const keysRaw = m[2].trim();
    const keys = keysRaw
      ? keysRaw.split(',').map((k) => k.trim().replace(/['"]/g, '')).filter(Boolean)
      : [];
    allowlists.push({ rx: new RegExp(pattern), keys });
  }
  return allowlists;
}

// ---------------------------------------------------------------------------
// Parse API_CONTRACT.md for table rows with a `{ ... }` body shape in col 3.
// Matches: | POST | `path` | `{ field1, field2? }` | description |
// ---------------------------------------------------------------------------
function parseDocumentedRoutes(src) {
  const routes = [];
  const rowRe = /\|\s*(POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*`(\{[^`]*\})`\s*\|/g;
  let m;
  while ((m = rowRe.exec(src)) !== null) {
    const method = m[1];
    const path = m[2];
    const bodyStr = m[3];
    const inner = bodyStr.replace(/^\{/, '').replace(/\}$/, '').trim();
    const fields = inner
      .split(',')
      .map((f) => f.trim().replace(/\?$/, '').trim())
      .filter(Boolean);
    routes.push({ method, path, fields });
  }
  return routes;
}

// ---------------------------------------------------------------------------
// Normalize a doc path for regex testing: replace :param with a literal 'x'
// '/teams/:name/tasks/:id/reassign' → '/teams/x/tasks/x/reassign'
// ---------------------------------------------------------------------------
function normalizePath(path) {
  return path.replace(/:([^/]+)/g, 'x');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const validationSrc = readFileSync(
  join(ROOT, 'sidecar/server/http/validation.ts'),
  'utf8'
);
const contractSrc = readFileSync(join(ROOT, 'docs/API_CONTRACT.md'), 'utf8');

const allowlists = parseAllowlists(validationSrc);
const docRoutes = parseDocumentedRoutes(contractSrc);

const failures = [];
const warnings = [];

for (const route of docRoutes) {
  const normalized = normalizePath(route.path);

  // Check against schema-less hardcoded routes first
  const schemaLess = SCHEMA_LESS_ROUTES.find(
    (sl) => sl.method === route.method && sl.pathPattern.test(normalized)
  );

  if (schemaLess) {
    const extra = route.fields.filter((f) => !schemaLess.expectedFields.includes(f));
    const missing = schemaLess.expectedFields.filter((f) => !route.fields.includes(f));
    if (extra.length) {
      failures.push(
        `FAIL [${schemaLess.label}]: doc has fields not read by handler: ${extra.join(', ')}`
      );
    }
    if (missing.length) {
      failures.push(
        `FAIL [${schemaLess.label}]: doc missing handler fields: ${missing.join(', ')}`
      );
    }
    continue;
  }

  // Check against allowlist (schema-validated routes)
  const match = allowlists.find((al) => al.rx.test(normalized));

  if (!match) {
    // Not in allowlist and not a schema-less route — no check possible, skip silently
    continue;
  }

  // Documented fields that are NOT in the allowlist → runtime will reject them
  const illegalFields = route.fields.filter((f) => !match.keys.includes(f));
  if (illegalFields.length) {
    failures.push(
      `FAIL [${route.method} ${route.path}]: doc has fields the runtime REJECTS: ${illegalFields.join(', ')}`
    );
  }

  // Allowlist fields not documented → undocumented capability (warning only)
  const undocumented = match.keys.filter((k) => !route.fields.includes(k));
  if (undocumented.length) {
    warnings.push(
      `WARN [${route.method} ${route.path}]: allowlist has undocumented fields: ${undocumented.join(', ')}`
    );
  }
}

// Print results
if (warnings.length) {
  for (const w of warnings) console.warn(w);
}

if (failures.length) {
  console.error('\n--- API CONTRACT SYNC FAILURES ---');
  for (const f of failures) console.error(f);
  console.error(`\n${failures.length} failure(s). Fix docs/API_CONTRACT.md to match runtime truth.`);
  process.exit(1);
}

console.log(`api-contract-sync: OK (${docRoutes.length} routes checked, ${warnings.length} warnings)`);
