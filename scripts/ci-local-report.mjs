#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const steps = [
  ['lint:shell', ['npm', ['run', 'lint:shell']]],
  ['lint:python', ['npm', ['run', 'lint:python']]],
  ['lint:coordinator', ['npm', ['run', 'lint:coordinator']]],
  ['test:coverage', ['npm', ['--workspace', 'mcp-coordinator', 'run', 'test:coverage']]],
  ['docs:audit', ['npm', ['run', 'docs:audit']]],
  ['typecheck:sidecar', ['npm', ['run', 'typecheck:sidecar']]],
  ['test:sidecar', ['npm', ['run', 'test:sidecar']]],
  ['verify:hooks', ['npm', ['run', 'verify:hooks']]],
];

const results = [];

for (const [name, [cmd, args]] of steps) {
  console.log(`\n== ${name} ==`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: process.cwd() });
  const code = typeof res.status === 'number' ? res.status : 1;
  results.push({ name, code });
}

console.log('\n== ci:local:report summary ==');
for (const r of results) {
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name}${r.code === 0 ? '' : ` (exit ${r.code})`}`);
}

const failed = results.filter((r) => r.code !== 0);
if (failed.length > 0) {
  console.error(`\n${failed.length} step(s) failed.`);
  process.exit(1);
}

console.log('\nAll steps passed.');
