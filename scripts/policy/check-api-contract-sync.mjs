#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const schemaPath = resolve(root, 'sidecar/server/http/schema.ts');
const contractPath = resolve(root, 'docs/API_CONTRACT.md');

const schemaSrc = readFileSync(schemaPath, 'utf8');
const contractSrc = readFileSync(contractPath, 'utf8');

const schemaSet = new Set();
for (const m of schemaSrc.matchAll(/\{\s*method:\s*'([A-Z]+)'\s*,\s*path:\s*'([^']+)'/g)) {
  schemaSet.add(`${m[1]} ${m[2]}`);
}

const contractSet = new Set();
for (const line of contractSrc.split('\n')) {
  const m = line.match(/^\|\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\|\s*`([^`]+)`\s*\|/);
  if (m) contractSet.add(`${m[1]} ${m[2]}`);
}

const ignored = new Set([
  'GET /health.json',
]);

const missingInDocs = [...schemaSet].filter((r) => !contractSet.has(r) && !ignored.has(r));
const missingInSchema = [...contractSet].filter((r) => !schemaSet.has(r) && !ignored.has(r));

if (missingInDocs.length || missingInSchema.length) {
  console.error('API contract drift detected.');
  if (missingInDocs.length) {
    console.error('Missing in docs:');
    for (const r of missingInDocs) console.error(`  - ${r}`);
  }
  if (missingInSchema.length) {
    console.error('Missing in schema:');
    for (const r of missingInSchema) console.error(`  - ${r}`);
  }
  process.exit(1);
}

console.log(`api-contract sync check passed (${schemaSet.size} schema routes)`);
