import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { certifyEconomicsTarget, runPathCommand } from './ab-harness.mjs';

function basePerPath() {
  return {
    native: {
      completion_rate: { ci_low: 0.9, ci_high: 0.95 },
      resume: { success_rate_ci_low: 0.88, success_rate_ci_high: 0.93 },
    },
    lead_coordinator: {
      completion_rate: { ci_low: 0.91, ci_high: 0.96 },
      resume: { success_rate_ci_low: 0.89, success_rate_ci_high: 0.94 },
    },
  };
}

function baseComparisons() {
  return {
    lead_coordinator: {
      tokens_total_minus_baseline: { mean_diff: -8000, ci_low: -9000, ci_high: -7000, n_a: 8, n_b: 8 },
      tokens_total_ratio_to_baseline: { mean_ratio: 0.18, ci_low: 0.16, ci_high: 0.2, n_a: 8, n_b: 8 },
      human_interventions_minus_baseline: { mean_diff: 0, ci_low: -0.1, ci_high: 0.1, n_a: 8, n_b: 8 },
      failure_cost_minus_baseline: { mean_diff: 0, ci_low: -0.1, ci_high: 0.1, n_a: 8, n_b: 8 },
    },
  };
}

function baseOpts(overrides = {}) {
  return {
    baselinePath: 'native',
    minTrialsForSavingsClaim: 5,
    confidence: 0.95,
    evidenceTier: 'production_measured',
    dataQuality: {
      balanced_trial_matrix: true,
      total_runs: 16,
      expected_total_runs: 16,
      claim_ready_for_savings: true,
      attribution_integrity_pass: true,
      claim_readiness_issues: [],
    },
    comparisonTarget: 'claude_agent_teams_subagent_workflow',
    targetPriceRatioMax: 0.2,
    completionNonInferiorityMargin: 0.05,
    resumeSuccessNonInferiorityMargin: 0.05,
    humanInterventionDeltaMax: 0.25,
    failureCostDeltaMax: 0.25,
    ...overrides,
  };
}

test('timeout kill path escalates TERM to KILL and still emits logs', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ab-timeout-'));
  const stdoutPath = join(tempRoot, 'stdout.log');
  const stderrPath = join(tempRoot, 'stderr.log');

  const result = await runPathCommand({
    command: "node -e \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"",
    env: process.env,
    timeoutSeconds: 0.2,
    timeoutGraceSeconds: 0.2,
    stdoutPath,
    stderrPath,
  });

  assert.equal(result.timed_out, true);
  assert.equal(result.timeout_escalation, 'KILL');
  assert.ok(result.exit_signal === 'SIGKILL' || result.exit_code !== 0);
  assert.equal(existsSync(stdoutPath), true);
  assert.equal(existsSync(stderrPath), true);
  assert.match(readFileSync(stderrPath, 'utf8'), /AB_HARNESS_TIMEOUT/);
});

test('partial telemetry quality blocks economics certification', () => {
  const cert = certifyEconomicsTarget(
    basePerPath(),
    baseComparisons(),
    baseOpts({
      dataQuality: {
        balanced_trial_matrix: true,
        total_runs: 16,
        expected_total_runs: 16,
        claim_ready_for_savings: false,
        attribution_integrity_pass: false,
        claim_readiness_issues: ['token telemetry coverage below 95%'],
      },
    })
  );

  assert.equal(cert.overall_result, 'blocked_by_evidence_quality');
  assert.equal(cert.per_path.lead_coordinator.result, 'blocked_by_evidence_quality');
});

test('completion non-inferiority gate must pass', () => {
  const perPath = basePerPath();
  perPath.native.completion_rate = { ci_low: 0.92, ci_high: 0.97 };
  perPath.lead_coordinator.completion_rate = { ci_low: 0.8, ci_high: 0.88 };

  const cert = certifyEconomicsTarget(perPath, baseComparisons(), baseOpts());

  assert.equal(cert.overall_result, 'not_certified');
  assert.equal(cert.per_path.lead_coordinator.gates.completion_quality_non_inferior.pass, false);
});

test('certification fails when 1/5 token threshold is not met', () => {
  const comparisons = baseComparisons();
  comparisons.lead_coordinator.tokens_total_ratio_to_baseline = {
    mean_ratio: 0.32,
    ci_low: 0.29,
    ci_high: 0.35,
    n_a: 8,
    n_b: 8,
  };

  const cert = certifyEconomicsTarget(basePerPath(), comparisons, baseOpts());

  assert.equal(cert.overall_result, 'not_certified');
  assert.equal(
    cert.per_path.lead_coordinator.gates.token_cost_reduction_supports_target_threshold.pass,
    false
  );
});

test('certification succeeds only when all gates pass', () => {
  const cert = certifyEconomicsTarget(basePerPath(), baseComparisons(), baseOpts());

  assert.equal(cert.overall_result, 'certified');
  assert.equal(cert.per_path.lead_coordinator.result, 'certified');
  assert.equal(cert.per_path.lead_coordinator.gates.same_workload_comparison_valid.pass, true);
  assert.equal(cert.per_path.lead_coordinator.gates.completion_quality_non_inferior.pass, true);
  assert.equal(
    cert.per_path.lead_coordinator.gates.intervention_failure_cost_not_materially_worse.pass,
    true
  );
  assert.equal(
    cert.per_path.lead_coordinator.gates.token_cost_reduction_supports_target_threshold.pass,
    true
  );
});
