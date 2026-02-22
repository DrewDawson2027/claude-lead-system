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

const line = readme.split('\n').find((l) => l.includes('CI enforces') && l.includes('line coverage') && l.includes('currently ~'));
if (!line) fail('README coverage claim line not found');
const claimGateMatch = line.match(/CI enforces\s+(\d+)%\+/i);
const claimCurrentMatch = line.match(/currently ~([0-9]+(?:\.[0-9]+)?)/i);
if (!claimGateMatch || !claimCurrentMatch) fail('README coverage claim format not recognized');
const readmeGate = Number(claimGateMatch[1]);
const readmeCurrent = Number(claimCurrentMatch[1]);

if (readmeGate !== gate) fail(`README gate (${readmeGate}%) does not match package gate (${gate}%)`);
if (readmeCurrent < gate) fail(`README current (~${readmeCurrent}%) is below gate (${gate}%)`);
if (readmeCurrent >= 90 && gate < 90) fail('README appears to overstate coverage (90%+) relative to configured gate');

let measured = null;
try {
  const out = spawnSync('npx', ['c8', 'report', '--reporter=text-summary'], {
    cwd: resolve(root, 'mcp-coordinator'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const summary = `${out.stdout || ''}\n${out.stderr || ''}`;
  const m = summary.match(/Lines\s*:\s*([0-9.]+)%/i);
  if (m) measured = Number(m[1]);
} catch {
  // Best-effort; gate/README alignment checks still provide protection.
}

if (measured !== null) {
  if (measured + 1e-9 < gate) fail(`measured coverage (${measured}%) below gate (${gate}%)`);
  if (Math.abs(measured - readmeCurrent) > 3.0) {
    fail(`README current (~${readmeCurrent}%) drifts too far from measured coverage (${measured}%)`);
  }
}

console.log(`coverage-claim check passed (gate=${gate}%, README≈${readmeCurrent}%, measured=${measured ?? 'n/a'}%)`);
