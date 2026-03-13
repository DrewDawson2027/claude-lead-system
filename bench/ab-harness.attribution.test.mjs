import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseTokenMeasurement,
  computeDataQuality,
  isolateAttributedDocs,
  parseUsageFromTranscriptDoc,
  sumUsage,
} from './ab-harness.mjs';

const EXPECTED = {
  run_id: 'run-active',
  trial: 1,
  path_id: 'native',
};

test('unrelated telemetry is ignored when tags point to another run', () => {
  const docs = [
    {
      run_id: 'run-active',
      trial: 1,
      path_id: 'native',
      value: 1,
    },
    {
      run_id: 'run-other',
      trial: 1,
      path_id: 'native',
      value: 999,
    },
  ];

  const isolation = isolateAttributedDocs(docs, EXPECTED, 'activity');
  assert.equal(isolation.attributed_docs, 1);
  assert.equal(isolation.other_run_docs, 1);
  assert.equal(isolation.unattributed_docs, 0);
  assert.equal(isolation.available, true);
});

test('only tagged current-run token telemetry is counted', () => {
  const transcriptDocs = [
    {
      run_id: 'run-active',
      trial: 1,
      path_id: 'native',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
    {
      run_id: 'run-other',
      trial: 1,
      path_id: 'native',
      message: {
        usage: {
          input_tokens: 900,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ];

  const transcriptIsolation = isolateAttributedDocs(transcriptDocs, EXPECTED, 'transcript');
  const transcriptUsage = sumUsage(
    transcriptIsolation.docs.map((doc) => parseUsageFromTranscriptDoc(doc)).filter(Boolean)
  );

  const tokenMeasurement = chooseTokenMeasurement({
    transcriptUsage,
    agentUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 0,
    },
    transcriptIsolation,
    agentIsolation: {
      unattributed_docs: 0,
      attribution_safe: true,
    },
  });

  assert.equal(transcriptUsage.total_tokens, 120);
  assert.equal(tokenMeasurement.available, true);
  assert.equal(tokenMeasurement.source_used, 'transcript_jsonl');
  assert.equal(tokenMeasurement.total_tokens_used, 120);
});

test('incomplete attribution disables claim readiness', () => {
  const dataset = [
    {
      path_id: 'native',
      tokens: {
        total_tokens_used: 100,
      },
      telemetry: {
        event_records: 1,
        attribution: {
          token_metric: { available: false },
          activity: { available: true },
          conflicts: { available: true },
          transcript: { available: true },
          resume: { available: true },
          events: { available: true },
        },
      },
    },
  ];

  const manifest = {
    trials: 1,
    active_paths: [{ path_id: 'native' }],
  };

  const quality = computeDataQuality(dataset, manifest);
  assert.equal(quality.claim_ready_for_savings, false);
  assert.match(
    quality.claim_readiness_issues.join(' | '),
    /attribution incomplete for token_metric/
  );
});

test('untagged token records make token metric unavailable', () => {
  const transcriptDocs = [
    {
      run_id: 'run-active',
      trial: 1,
      path_id: 'native',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
    {
      message: {
        usage: {
          input_tokens: 999,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ];

  const transcriptIsolation = isolateAttributedDocs(transcriptDocs, EXPECTED, 'transcript');
  const transcriptUsage = sumUsage(
    transcriptIsolation.docs.map((doc) => parseUsageFromTranscriptDoc(doc)).filter(Boolean)
  );

  const tokenMeasurement = chooseTokenMeasurement({
    transcriptUsage,
    agentUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 0,
    },
    transcriptIsolation,
    agentIsolation: {
      unattributed_docs: 0,
      attribution_safe: true,
    },
  });

  assert.equal(transcriptIsolation.unattributed_docs, 1);
  assert.equal(tokenMeasurement.available, false);
  assert.match(String(tokenMeasurement.reason || ''), /untagged records/i);
});
