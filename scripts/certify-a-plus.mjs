#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const CANONICAL_PUBLIC_BRANCH = 'main';
const CERT_FLOW_VERSION = 'release-discipline-v1';
const REPORT_PATH = resolve(process.cwd(), 'reports/a-plus-cert.json');
const CLAIM_POSTURE_SOURCE_PATH = resolve(process.cwd(), 'docs/CLAIM_POSTURE_SOURCE.json');
const ONE_FIFTH_CLAIM_PATTERNS = [
  /essentially same thing at ~?1\/5th price/i,
  /same thing at ~?1\/5th price/i,
  /same workload at ~?1\/5th price/i,
];
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

function runCaptured(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runStep(name, command, args) {
  console.log(`\n== ${name} ==`);
  const res = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
  return {
    name,
    code: typeof res.status === 'number' ? res.status : 1,
    command,
    args,
  };
}

function buildFlowFingerprint() {
  const payload = steps.map(([name, [command, args]]) => `${name}\t${command}\t${args.join(' ')}`).join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

function sanitizeStepName(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function detectBranch() {
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME.trim()) {
    return process.env.GITHUB_REF_NAME.trim();
  }

  const current = runCaptured('git', ['branch', '--show-current']);
  const branch = current.stdout.trim();
  if (current.code === 0 && branch) return branch;

  const fallback = runCaptured('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (fallback.code === 0 && fallback.stdout.trim() && fallback.stdout.trim() !== 'HEAD') {
    return fallback.stdout.trim();
  }

  return 'detached';
}

function detectCommit() {
  const rev = runCaptured('git', ['rev-parse', 'HEAD']);
  return rev.code === 0 ? rev.stdout.trim() : 'unknown';
}

function detectWorktreeClean() {
  const status = runCaptured('git', ['status', '--porcelain']);
  return status.code === 0 ? status.stdout.trim().length === 0 : false;
}

function loadClaimScanTargets() {
  const defaults = [
    'README.md',
    'CLAUDE.md',
    'MANIFEST.md',
    'reports/release-readiness-report-2026-03-09.md',
  ];

  if (!existsSync(CLAIM_POSTURE_SOURCE_PATH)) {
    return defaults.map((relPath) => resolve(process.cwd(), relPath));
  }

  try {
    const src = JSON.parse(readFileSync(CLAIM_POSTURE_SOURCE_PATH, 'utf8'));
    const extra = Array.isArray(src?.posture_sync_targets) ? src.posture_sync_targets : [];
    const relTargets = [...new Set([...defaults, ...extra])];
    return relTargets.map((relPath) => resolve(process.cwd(), relPath));
  } catch {
    return defaults.map((relPath) => resolve(process.cwd(), relPath));
  }
}

function scanForOneFifthClaim() {
  const targets = loadClaimScanTargets();
  const matches = [];

  for (const absPath of targets) {
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!ONE_FIFTH_CLAIM_PATTERNS.some((pattern) => pattern.test(line))) continue;
      matches.push({
        file: relative(process.cwd(), absPath),
        line: i + 1,
        text: line.trim(),
      });
    }
  }

  return {
    claim_present: matches.length > 0,
    matches,
  };
}

function listAbSummaryCandidates() {
  const root = resolve(process.cwd(), 'reports/ab-harness');
  if (!existsSync(root)) return [];
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const summaryPath = join(root, entry.name, 'summary.json');
    if (!existsSync(summaryPath)) continue;
    try {
      const st = statSync(summaryPath);
      candidates.push({
        path: summaryPath,
        mtime_ms: st.mtimeMs,
      });
    } catch {
      // ignore unreadable summaries
    }
  }
  candidates.sort((a, b) => b.mtime_ms - a.mtime_ms);
  return candidates;
}

function evaluateEconomicsProofGuard() {
  const claimScan = scanForOneFifthClaim();
  const summaries = listAbSummaryCandidates();
  const latestSummaryPath = summaries.length > 0 ? summaries[0].path : null;
  let latestSummary = null;

  if (latestSummaryPath && existsSync(latestSummaryPath)) {
    try {
      latestSummary = JSON.parse(readFileSync(latestSummaryPath, 'utf8'));
    } catch {
      latestSummary = null;
    }
  }

  const certResult = latestSummary?.economics_certification?.overall_result || null;
  const targetClaim = latestSummary?.economics_certification?.target_claim || null;
  const evidenceTier = latestSummary?.economics_certification?.evidence_tier
    || latestSummary?.workload?.evidence_tier
    || null;
  const runState = latestSummary?.run_status?.state || null;

  if (!claimScan.claim_present) {
    return {
      pass: true,
      claim_present: false,
      reason: '1/5th-price claim language not present in claim-governed docs',
      latest_summary_path: latestSummaryPath ? relative(process.cwd(), latestSummaryPath) : null,
      latest_summary_economics_result: certResult,
      latest_summary_target_claim: targetClaim,
      latest_summary_evidence_tier: evidenceTier,
      latest_summary_run_state: runState,
      claim_matches: [],
    };
  }

  const proofValid = certResult === 'certified'
    && targetClaim === 'essentially_same_workload_at_1_5th_price'
    && evidenceTier === 'production_measured'
    && runState === 'completed';

  return {
    pass: proofValid,
    claim_present: true,
    reason: proofValid
      ? 'claim language present and backed by certified production-measured economics summary'
      : '1/5th-price claim language present without certified production-measured economics proof',
    latest_summary_path: latestSummaryPath ? relative(process.cwd(), latestSummaryPath) : null,
    latest_summary_economics_result: certResult,
    latest_summary_target_claim: targetClaim,
    latest_summary_evidence_tier: evidenceTier,
    latest_summary_run_state: runState,
    claim_matches: claimScan.matches,
  };
}

const gitBranch = detectBranch();
const gitCommit = detectCommit();
const worktreeClean = detectWorktreeClean();
const flowFingerprint = buildFlowFingerprint();
const economicsProofGuard = evaluateEconomicsProofGuard();

console.log('== Release Discipline Cert Flow ==');
console.log(`cert flow version: ${CERT_FLOW_VERSION}`);
console.log(`canonical public branch: ${CANONICAL_PUBLIC_BRANCH}`);
console.log(`run branch: ${gitBranch}`);
console.log(`run commit: ${gitCommit}`);
console.log(`worktree clean: ${worktreeClean ? 'yes' : 'no'}`);

const results = steps.map(([name, [command, args]]) => runStep(name, command, args));
const failed = results.filter((result) => result.code !== 0);
const flowPass = failed.length === 0;
const branchPass = gitBranch === CANONICAL_PUBLIC_BRANCH;
const economicsProofPass = economicsProofGuard.pass;
const certPass = flowPass && branchPass && worktreeClean && economicsProofPass;

const blockers = [];
if (!flowPass) blockers.push('step-failures');
if (!branchPass) blockers.push(`non-canonical-branch:${gitBranch}`);
if (!worktreeClean) blockers.push('dirty-worktree');
if (!economicsProofPass) blockers.push('one-fifth-claim-without-certified-proof');

console.log('\n== cert:a-plus:fresh summary ==');
for (const result of results) {
  console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}  ${result.name}${result.code === 0 ? '' : ` (exit ${result.code})`}`);
}

console.log('\n== literal certificate ==');
console.log(`CERT_FLOW_VERSION=${CERT_FLOW_VERSION}`);
console.log(`CERT_FLOW_FINGERPRINT_SHA256=${flowFingerprint}`);
console.log(`CANONICAL_PUBLIC_BRANCH=${CANONICAL_PUBLIC_BRANCH}`);
console.log(`RUN_BRANCH=${gitBranch}`);
console.log(`RUN_COMMIT=${gitCommit}`);
console.log(`WORKTREE_CLEAN=${worktreeClean ? 'true' : 'false'}`);
console.log(`ECONOMICS_1_5TH_CLAIM_PRESENT=${economicsProofGuard.claim_present ? 'true' : 'false'}`);
console.log(`ECONOMICS_1_5TH_PROOF_PASS=${economicsProofPass ? 'true' : 'false'}`);
console.log(`ECONOMICS_1_5TH_PROOF_REASON=${economicsProofGuard.reason}`);
console.log(`ECONOMICS_1_5TH_PROOF_SUMMARY=${economicsProofGuard.latest_summary_path || 'none'}`);
console.log(`ECONOMICS_1_5TH_CERT_RESULT=${economicsProofGuard.latest_summary_economics_result || 'none'}`);
for (const result of results) {
  console.log(`STEP_${sanitizeStepName(result.name)}=${result.code === 0 ? 'PASS' : 'FAIL'}`);
}
console.log(`CERT_FLOW_RESULT=${flowPass ? 'PASS' : 'FAIL'}`);
console.log(`PUBLIC_RELEASE_GRADE=${certPass ? 'A+' : 'NOT_A+'}`);
console.log(`BLOCKERS=${blockers.length === 0 ? 'none' : blockers.join(',')}`);
console.log(`REPORT_PATH=${relative(process.cwd(), REPORT_PATH)}`);

const report = {
  cert_flow_version: CERT_FLOW_VERSION,
  cert_flow_fingerprint_sha256: flowFingerprint,
  canonical_public_branch: CANONICAL_PUBLIC_BRANCH,
  run_branch: gitBranch,
  run_commit: gitCommit,
  worktree_clean: worktreeClean,
  cert_flow_result: flowPass ? 'PASS' : 'FAIL',
  public_release_grade: certPass ? 'A+' : 'NOT_A+',
  blockers,
  economics_proof_guard: economicsProofGuard,
  steps: results.map((result) => ({
    name: result.name,
    command: result.command,
    args: result.args,
    result: result.code === 0 ? 'PASS' : 'FAIL',
    exit_code: result.code,
  })),
};
mkdirSync(resolve(process.cwd(), 'reports'), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (certPass) {
  console.log('\nA+ release-discipline certification passed.');
  process.exit(0);
}

console.error('\nA+ release-discipline certification failed.');
process.exit(1);
