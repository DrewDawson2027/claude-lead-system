#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const routesDir = resolve(root, 'sidecar/server/routes');
const files = readdirSync(routesDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'shared.ts').sort();

const exactRe = /req\.method\s*===\s*["']([A-Z]+)["']\s*&&\s*url\.pathname\s*===\s*["']([^"']+)["']/g;
const regexRe = /req\.method\s*===\s*["']([A-Z]+)["']\s*&&\s*\/(.+?)\/\.test\(url\.pathname\)/g;

const inventory = [];
for (const file of files) {
  const full = resolve(routesDir, file);
  const src = readFileSync(full, 'utf8');
  for (const m of src.matchAll(exactRe)) {
    inventory.push({ file, method: m[1], kind: 'exact', path: m[2] });
  }
  for (const m of src.matchAll(regexRe)) {
    inventory.push({ file, method: m[1], kind: 'regex', path_pattern: `/${m[2]}/` });
  }
}

if (inventory.length === 0) {
  process.stderr.write(
    `Endpoint audit failed: no routes matched in ${routesDir}. ` +
      'Expected patterns like req.method === "GET" && url.pathname === "/path" or /.../.test(url.pathname).\n',
  );
  process.exit(1);
}

const out = {
  source: routesDir,
  route_module_count: files.length,
  route_modules: files,
  counts: {
    total: inventory.length,
    exact: inventory.filter((r) => r.kind === 'exact').length,
    regex: inventory.filter((r) => r.kind === 'regex').length,
  },
  canonical_examples: inventory
    .filter((r) => r.kind === 'exact')
    .slice(0, 200)
    .map((r) => ({ ...r, canonical_v1: r.path === '/' ? '/v1' : `/v1${r.path}` })),
  routes: inventory,
  notes: [
    'Routes are implemented in sidecar/server/routes/*.ts and normalized at runtime so /v1/* is canonical.',
    'Unversioned aliases are maintained temporarily and emit deprecation headers centrally.',
  ],
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
} else {
  process.stdout.write('# Sidecar Endpoint Audit\n\n');
  process.stdout.write(`Source: ${routesDir}\n\n`);
  process.stdout.write(`Route modules: ${files.length}\n`);
  process.stdout.write(`Total route checks: ${out.counts.total} (exact ${out.counts.exact}, regex ${out.counts.regex})\n\n`);
  process.stdout.write('## Modules\n');
  for (const f of files) process.stdout.write(`- \`${f}\`\n`);
  process.stdout.write('\n## Exact Routes (sample, canonical /v1)\n');
  for (const r of out.canonical_examples) process.stdout.write(`- \`${r.method} ${r.canonical_v1}\` (${r.file})\n`);
  process.stdout.write('\n## Notes\n');
  for (const note of out.notes) process.stdout.write(`- ${note}\n`);
}
