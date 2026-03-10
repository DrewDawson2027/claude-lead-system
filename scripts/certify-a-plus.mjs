#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const steps = [
  ['lint:shell', ['npm', ['run', 'lint:shell']]],
  ['lint:python', ['npm', ['run', 'lint:python']]],
  ['lint:coordinator', ['npm', ['run', 'lint:coordinator']]],
  ['test:coverage', ['npm', ['--workspace', 'mcp-coordinator', 'run', 'test:coverage']]],
  ['docs:audit', ['npm', ['run', 'docs:audit']]],
  ['typecheck:sidecar', ['npm', ['run', 'typecheck:sidecar']]],
  ['test:sidecar', ['npm', ['run', 'test:sidecar']]],
  ['verify:hooks', ['npm', ['run', 'verify:hooks']]],
  ['check:claim-drift', ['bash', ['scripts/check-claim-drift.sh']]],
];

function stripAnsi(text) {
  return text.replace(/\u001B\[[0-9;]*m/g, '').replace(/\u001B\][^\u0007]*\u0007/g, '');
}

function runStep(name, command, args) {
  console.log(`\n== ${name} ==`);
  const res = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  return {
    name,
    code: typeof res.status === 'number' ? res.status : 1,
    output: stripAnsi(`${stdout}\n${stderr}`),
  };
}

function findMatch(text, regex) {
  const match = text.match(regex);
  return match || null;
}

const results = steps.map(([name, [command, args]]) => runStep(name, command, args));

console.log('\n== cert:a-plus:fresh summary ==');
for (const result of results) {
  console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}  ${result.name}${result.code === 0 ? '' : ` (exit ${result.code})`}`);
}

const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
  console.error(`\n${failed.length} step(s) failed.`);
  process.exit(1);
}

const coordinatorPkg = JSON.parse(readFileSync(resolve(process.cwd(), 'mcp-coordinator/package.json'), 'utf8'));
const gateMatch = String(coordinatorPkg.scripts?.['test:coverage'] || '').match(/--lines\s+(\d+)/);
const configuredCoverageGate = gateMatch ? Number(gateMatch[1]) : null;

const coverageStep = results.find((result) => result.name === 'test:coverage');
const docsAuditStep = results.find((result) => result.name === 'docs:audit');
const sidecarStep = results.find((result) => result.name === 'test:sidecar');
const hooksStep = results.find((result) => result.name === 'verify:hooks');
const driftStep = results.find((result) => result.name === 'check:claim-drift');

const coveragePassMatch = coverageStep ? findMatch(coverageStep.output, /\nℹ pass\s+(\d+)/) : null;
const sidecarPassMatch = sidecarStep ? findMatch(sidecarStep.output, /\nℹ pass\s+(\d+)/) : null;
const measuredCoverageMatch = docsAuditStep
  ? findMatch(
      docsAuditStep.output,
      /coverage-claim check passed \(gate=(\d+)%, README≈([^,]+), measured=([0-9.]+|n\/a)%\)/,
    )
  : null;
const hookUnitMatch = hooksStep ? findMatch(hooksStep.output, /Total:\s+(\d+)\s+Pass:\s+(\d+)\s+Fail:\s+(\d+)/) : null;
const hookPytestMatch = hooksStep ? findMatch(hooksStep.output, /(\d+)\s+passed in\s+([0-9.]+)s/) : null;
const driftSummaryMatch = driftStep ? findMatch(driftStep.output, /Results:\s+(\d+)\s+pass,\s+(\d+)\s+fail,\s+(\d+)\s+warn/) : null;

console.log('\n== Live Metrics ==');
console.log(`commands run: ${steps.length}`);
console.log(`coordinator coverage gate: ${configuredCoverageGate ?? 'unknown'}%`);
if (measuredCoverageMatch) {
  console.log(`coordinator measured coverage: ${measuredCoverageMatch[3]}%`);
  console.log(`README coverage claim: ${measuredCoverageMatch[2]}`);
} else {
  console.log('coordinator measured coverage: unknown');
  console.log('README coverage claim: unknown');
}
console.log(`coordinator tests passed: ${coveragePassMatch ? coveragePassMatch[1] : 'unknown'}`);
console.log(`sidecar tests passed: ${sidecarPassMatch ? sidecarPassMatch[1] : 'unknown'}`);
if (hookUnitMatch) {
  console.log(`hook shell/unit checks: ${hookUnitMatch[2]}/${hookUnitMatch[1]} passed`);
} else {
  console.log('hook shell/unit checks: unknown');
}
if (hookPytestMatch) {
  console.log(`hook pytest checks: ${hookPytestMatch[1]} passed (${hookPytestMatch[2]}s)`);
} else {
  console.log('hook pytest checks: unknown');
}
if (driftSummaryMatch) {
  console.log(
    `claim drift checks: ${driftSummaryMatch[1]} pass, ${driftSummaryMatch[2]} fail, ${driftSummaryMatch[3]} warn`,
  );
} else {
  console.log('claim drift checks: unknown');
}

console.log('\nA+ fresh-checkout certification passed.');
