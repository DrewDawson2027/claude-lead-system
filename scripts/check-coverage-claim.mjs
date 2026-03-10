#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.cwd());
const readmePath = resolve(root, 'README.md');
const pkgPath = resolve(root, 'mcp-coordinator/package.json');

function fail(msg) {
  console.error(`coverage-claim check failed: ${msg}`);
  process.exit(1);
}

const readme = readFileSync(readmePath, 'utf8');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const testCoverage = String(pkg.scripts?.['test:coverage'] || '');
const gateMatch = testCoverage.match(/--lines\s+(\d+)/);
if (!gateMatch) fail('could not parse coverage gate from mcp-coordinator/package.json test:coverage');
const gate = Number(gateMatch[1]);

const line = readme
  .split('\n')
  .find((l) => l.includes('CI enforces') && l.includes('line coverage') && l.includes('currently ~'));
let readmeGate = null;
let readmeCurrent = null;
if (line) {
  const claimGateMatch = line.match(/CI enforces\s+(\d+)%\+/i);
  const claimCurrentMatch = line.match(/currently ~([0-9]+(?:\.[0-9]+)?)/i);
  if (!claimGateMatch || !claimCurrentMatch) fail('README coverage claim format not recognized');
  readmeGate = Number(claimGateMatch[1]);
  readmeCurrent = Number(claimCurrentMatch[1]);

  if (readmeGate !== gate) fail(`README gate (${readmeGate}%) does not match package gate (${gate}%)`);
  if (readmeCurrent < gate) fail(`README current (~${readmeCurrent}%) is below gate (${gate}%)`);
  if (readmeCurrent >= 90 && gate < 90) fail('README appears to overstate coverage (90%+) relative to configured gate');
}

const coordinatorRoot = resolve(root, 'mcp-coordinator');

function run(command, args) {
  const out = spawnSync(command, args, {
    cwd: coordinatorRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (out.error) fail(`failed to run ${command} ${args.join(' ')}: ${out.error.message}`);
  return {
    code: typeof out.status === 'number' ? out.status : 1,
    text: `${out.stdout || ''}\n${out.stderr || ''}`,
  };
}

function parseLinesPct(text) {
  const summaryMatch = text.match(/Lines\s*:\s*([0-9.]+)%/i);
  if (summaryMatch) return Number(summaryMatch[1]);

  const tableMatch = text.match(/All files\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([0-9.]+)/i);
  if (tableMatch) return Number(tableMatch[1]);

  return null;
}

let measured = parseLinesPct(run('npx', ['c8', 'report', '--reporter=text-summary']).text);

if (measured === null) {
  // Fresh-checkout path: generate coverage before enforcing claim drift.
  const coverageRun = run('npm', ['run', 'test:coverage']);
  if (coverageRun.code !== 0) {
    fail('could not generate coverage via mcp-coordinator npm run test:coverage');
  }
  measured = parseLinesPct(coverageRun.text);
  if (measured === null) {
    measured = parseLinesPct(run('npx', ['c8', 'report', '--reporter=text-summary']).text);
  }
}

if (measured === null) fail('could not parse measured line coverage from c8 output');
measured = Number(measured.toFixed(1));

if (measured + 1e-9 < gate) fail(`measured coverage (${measured}%) below gate (${gate}%)`);
if (readmeCurrent !== null && Math.abs(measured - readmeCurrent) > 3.0) {
  fail(`README current (~${readmeCurrent}%) drifts too far from measured coverage (${measured}%)`);
}

const readmeDisplay = readmeCurrent === null ? 'not-claimed' : `${readmeCurrent}%`;
console.log(`coverage-claim check passed (gate=${gate}%, README≈${readmeDisplay}, measured=${measured}%)`);
