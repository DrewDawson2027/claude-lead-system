#!/usr/bin/env node

/**
 * Measured A/B harness for workflow parity + economics evidence.
 *
 * Runs the same workload command across path adapters:
 * - native
 * - lead_coordinator
 * - lead_overlay (optional)
 *
 * Captures measured outcomes:
 * - token usage (agent-metrics JSONL + transcript JSONL deltas)
 * - latency
 * - completion rate
 * - human intervention count
 * - conflict incidents
 * - resume success
 * - throughput per usage window
 *
 * Outputs:
 * - raw dataset JSONL
 * - reproducible run manifest
 * - markdown report with confidence bounds
 * - claim-safe summary (no savings claims unless supported by measured data)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  appendFileSync,
} from 'node:fs';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED_PATHS = ['native', 'lead_coordinator'];
const OPTIONAL_PATHS = ['lead_overlay'];
const DEFAULT_TIMEOUT_SECONDS = 1800;
const DEFAULT_TIMEOUT_GRACE_SECONDS = 15;
const DEFAULT_TRIALS = 5;
const DEFAULT_CONFIDENCE = 0.95;
const DEFAULT_BOOTSTRAP_ITERS = 5000;
const DEFAULT_MIN_TRIALS_FOR_SAVINGS = 5;
const DEFAULT_TARGET_PRICE_RATIO_MAX = 0.2;
const DEFAULT_COMPLETION_NON_INFERIORITY_MARGIN = 0.05;
const DEFAULT_RESUME_SUCCESS_NON_INFERIORITY_MARGIN = 0.05;
const DEFAULT_HUMAN_INTERVENTION_DELTA_MAX = 0.25;
const DEFAULT_FAILURE_COST_DELTA_MAX = 0.25;
const EVIDENCE_TIERS = new Set(['production_measured', 'synthetic_measured']);
const DEFAULT_EVIDENCE_TIER = 'synthetic_measured';

function nowIso() {
  return new Date().toISOString();
}

function fatal(message) {
  console.error(`ab-harness failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    config: null,
    outRoot: null,
    runId: null,
    trials: null,
    seed: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--config' && next) {
      args.config = next;
      i += 1;
      continue;
    }
    if (token === '--out-root' && next) {
      args.outRoot = next;
      i += 1;
      continue;
    }
    if (token === '--run-id' && next) {
      args.runId = next;
      i += 1;
      continue;
    }
    if (token === '--trials' && next) {
      args.trials = Number(next);
      i += 1;
      continue;
    }
    if (token === '--seed' && next) {
      args.seed = Number(next);
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
    fatal(`unknown argument: ${token}`);
  }

  if (!args.config) {
    fatal('missing --config <path>');
  }
  return args;
}

function printUsage() {
  console.log([
    'Usage: node bench/ab-harness.mjs --config <path> [--out-root <dir>] [--run-id <id>] [--trials <n>] [--seed <n>]',
    '',
    'Config defines workload command + path adapters + telemetry files.',
    'Required paths: native, lead_coordinator.',
    'Optional path: lead_overlay.',
  ].join('\n'));
}

function expandPath(input, baseDir = process.cwd()) {
  if (!input || typeof input !== 'string') return input;
  if (input.startsWith('~/')) {
    return resolve(homedir(), input.slice(2));
  }
  if (input === '~') {
    return homedir();
  }
  return resolve(baseDir, input);
}

function readJsonFile(pathValue) {
  try {
    return JSON.parse(readFileSync(pathValue, 'utf8'));
  } catch (err) {
    fatal(`could not parse ${pathValue}: ${err.message}`);
  }
}

function ensureDir(pathValue) {
  mkdirSync(pathValue, { recursive: true });
}

function createRunId(prefix = 'ab') {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${prefix}-${ts}`;
}

function makeRng(seedInput) {
  let state = Math.floor(Number(seedInput) || 1) >>> 0;
  if (state === 0) state = 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle(items, rng) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseJsonlLines(lines) {
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const doc = JSON.parse(trimmed);
      if (doc && typeof doc === 'object') out.push(doc);
    } catch {
      // Ignore malformed lines in observability lanes.
    }
  }
  return out;
}

function normalizeTrialValue(value) {
  if (Number.isFinite(Number(value))) {
    const n = Math.floor(Number(value));
    return n > 0 ? n : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const trialMatch = trimmed.match(/trial[-_]?(\d+)/i);
  if (trialMatch) return Number(trialMatch[1]);
  return null;
}

function firstNonEmptyString(candidates) {
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized.length > 0) return normalized;
  }
  return null;
}

function extractAttributionFromTagArray(tags) {
  if (!Array.isArray(tags)) return null;
  const parsed = {};
  for (const item of tags) {
    if (typeof item !== 'string') continue;
    const match = item.match(/^(run_id|trial|path_id)\s*[:=]\s*(.+)$/i);
    if (!match) continue;
    const key = String(match[1]).toLowerCase();
    parsed[key] = String(match[2]).trim();
  }
  if (!parsed.run_id || !parsed.trial || !parsed.path_id) return null;
  return {
    run_id: parsed.run_id,
    trial: normalizeTrialValue(parsed.trial),
    path_id: parsed.path_id,
  };
}

function attributionFromContainer(container) {
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    return null;
  }

  const runId = firstNonEmptyString([
    container.run_id,
    container.runId,
    container.ab_harness_run_id,
    container.abHarnessRunId,
  ]);
  const trial = normalizeTrialValue(
    container.trial ?? container.trial_id ?? container.trialId ?? container.ab_harness_trial
  );
  const pathId = firstNonEmptyString([
    container.path_id,
    container.pathId,
    container.ab_harness_path,
    container.abHarnessPath,
  ]);

  if (!runId || !Number.isFinite(trial) || !pathId) return null;
  return {
    run_id: runId,
    trial,
    path_id: pathId,
  };
}

function extractRecordAttribution(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const containers = [
    doc,
    doc.meta,
    doc.metadata,
    doc.context,
    doc.harness,
    doc.ab_harness,
    doc.labels,
    doc.message,
    doc.message?.meta,
    doc.message?.metadata,
    doc.message?.context,
  ];

  for (const container of containers) {
    const attributed = attributionFromContainer(container);
    if (attributed) return attributed;
  }

  return extractAttributionFromTagArray(doc.tags);
}

function evaluateAttributionTriplet(attribution, expected) {
  if (!attribution) {
    return {
      state: 'missing',
      match: false,
      reason: 'missing run_id/trial/path_id attribution tags',
    };
  }

  if (String(attribution.run_id) !== String(expected.run_id)) {
    return {
      state: 'other_run',
      match: false,
      reason: `run_id mismatch (${attribution.run_id} != ${expected.run_id})`,
    };
  }

  if (Number(attribution.trial) !== Number(expected.trial)) {
    return {
      state: 'other_run',
      match: false,
      reason: `trial mismatch (${attribution.trial} != ${expected.trial})`,
    };
  }

  if (String(attribution.path_id) !== String(expected.path_id)) {
    return {
      state: 'other_run',
      match: false,
      reason: `path_id mismatch (${attribution.path_id} != ${expected.path_id})`,
    };
  }

  return {
    state: 'match',
    match: true,
    reason: null,
  };
}

function isolateAttributedDocs(docs, expectedAttribution, laneId) {
  const attributedDocs = [];
  let otherRunDocs = 0;
  let unattributedDocs = 0;

  for (const doc of docs) {
    const attribution = extractRecordAttribution(doc);
    const verdict = evaluateAttributionTriplet(attribution, expectedAttribution);
    if (verdict.match) {
      attributedDocs.push(doc);
    } else if (verdict.state === 'other_run') {
      otherRunDocs += 1;
    } else {
      unattributedDocs += 1;
    }
  }

  const available = unattributedDocs === 0;
  return {
    lane_id: laneId,
    docs_total: docs.length,
    attributed_docs: attributedDocs.length,
    other_run_docs: otherRunDocs,
    unattributed_docs: unattributedDocs,
    attribution_safe: available,
    available,
    reason: available
      ? null
      : `${laneId} contains ${unattributedDocs} untagged record(s); run attribution is incomplete`,
    docs: attributedDocs,
  };
}

function summarizeIsolation(isolation) {
  return {
    available: isolation.available,
    attribution_safe: isolation.attribution_safe,
    reason: isolation.reason,
    docs_total: isolation.docs_total,
    attributed_docs: isolation.attributed_docs,
    other_run_docs: isolation.other_run_docs,
    unattributed_docs: isolation.unattributed_docs,
  };
}

function readFileSlice(pathValue, startByte = 0) {
  if (!existsSync(pathValue)) {
    return { size: 0, content: '' };
  }
  const buf = readFileSync(pathValue);
  const size = buf.length;
  if (startByte >= size) {
    return { size, content: '' };
  }
  const content = buf.subarray(startByte).toString('utf8');
  return { size, content };
}

function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').filter((line) => line.trim().length > 0).length;
}

function collectJsonlDelta(pathValue, beforeSize = 0) {
  const { size, content } = readFileSlice(pathValue, beforeSize);
  const lines = content ? content.split('\n') : [];
  const docs = parseJsonlLines(lines);
  return {
    sizeAfter: size,
    linesAdded: lineCount(content),
    docs,
  };
}

function parseUsageFromTranscriptDoc(doc) {
  const usage = doc?.message?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const cacheCreate = Number(usage.cache_creation_input_tokens || 0);
  if (![input, output, cacheRead, cacheCreate].some((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
    cache_read_tokens: Number.isFinite(cacheRead) ? cacheRead : 0,
    cache_creation_tokens: Number.isFinite(cacheCreate) ? cacheCreate : 0,
    total_tokens: (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0),
  };
}

function parseUsageFromAgentMetricDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.record_type && doc.record_type !== 'usage') return null;
  const input = Number(doc.input_tokens || 0);
  const output = Number(doc.output_tokens || 0);
  const cacheRead = Number(doc.cache_read_tokens || 0);
  const cacheCreate = Number(doc.cache_creation_tokens || 0);
  const total = Number(doc.total_tokens || input + output || 0);
  if (![input, output, cacheRead, cacheCreate, total].some((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
    cache_read_tokens: Number.isFinite(cacheRead) ? cacheRead : 0,
    cache_creation_tokens: Number.isFinite(cacheCreate) ? cacheCreate : 0,
    total_tokens: Number.isFinite(total) ? total : 0,
  };
}

function sumUsage(records) {
  return records.reduce(
    (acc, row) => {
      acc.input_tokens += Number(row.input_tokens || 0);
      acc.output_tokens += Number(row.output_tokens || 0);
      acc.cache_read_tokens += Number(row.cache_read_tokens || 0);
      acc.cache_creation_tokens += Number(row.cache_creation_tokens || 0);
      acc.total_tokens += Number(row.total_tokens || 0);
      return acc;
    },
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 0,
    }
  );
}

function listFilesRecursive(root, opts = {}) {
  const out = [];
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 8;
  const includeRegex = opts.includeRegex || /transcript.*\.jsonl$/i;

  function walk(dir, depth) {
    if (!existsSync(dir) || depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (includeRegex.test(entry.name)) {
        out.push(full);
      }
    }
  }

  walk(root, 0);
  return out;
}

function snapshotFiles(paths) {
  const snap = new Map();
  for (const pathValue of paths) {
    if (!existsSync(pathValue)) continue;
    try {
      const st = statSync(pathValue);
      snap.set(pathValue, st.size);
    } catch {
      // Ignore unreadable files.
    }
  }
  return snap;
}

function loadResumeCounts(resultsDir) {
  const counts = new Map();
  if (!resultsDir || !existsSync(resultsDir)) return counts;
  let files = [];
  try {
    files = readdirSync(resultsDir);
  } catch {
    return counts;
  }
  for (const file of files) {
    if (!file.endsWith('.meta.json')) continue;
    const full = join(resultsDir, file);
    try {
      const doc = JSON.parse(readFileSync(full, 'utf8'));
      const taskId = String(doc.task_id || basename(file, '.meta.json'));
      const resumeCount = Number(doc.resume_count || 0);
      const resumedFromSession = doc.resumed_from_session || null;
      counts.set(taskId, {
        resume_count: Number.isFinite(resumeCount) ? resumeCount : 0,
        resumed_from_session: resumedFromSession,
        attribution: extractRecordAttribution(doc),
      });
    } catch {
      // ignore malformed meta docs
    }
  }
  return counts;
}

function diffResumeCounts(beforeMap, afterMap, expectedAttribution) {
  let attempts = 0;
  let successes = 0;
  let deltaRecords = 0;
  let attributedRecords = 0;
  let unattributedAttempts = 0;
  let otherRunAttempts = 0;

  for (const [taskId, after] of afterMap.entries()) {
    const before = beforeMap.get(taskId) || {
      resume_count: 0,
      resumed_from_session: null,
      attribution: null,
    };
    const delta = Math.max(0, Number(after.resume_count || 0) - Number(before.resume_count || 0));
    if (delta <= 0) continue;
    deltaRecords += 1;

    const verdict = evaluateAttributionTriplet(after.attribution || null, expectedAttribution);
    if (verdict.match) {
      attributedRecords += 1;
      attempts += delta;
      if (after.resumed_from_session) {
        successes += delta;
      }
      continue;
    }

    if (verdict.state === 'other_run') {
      otherRunAttempts += delta;
    } else {
      unattributedAttempts += delta;
    }
  }

  const attributionSafe = unattributedAttempts === 0;
  return {
    attempts,
    successes,
    delta_records: deltaRecords,
    attributed_records: attributedRecords,
    unattributed_attempts: unattributedAttempts,
    other_run_attempts: otherRunAttempts,
    attribution_safe: attributionSafe,
    attribution_issue: attributionSafe
      ? null
      : `resume records contain ${unattributedAttempts} untagged attempt(s); run attribution is incomplete`,
  };
}

function chooseTokenMeasurement(params) {
  const {
    transcriptUsage,
    agentUsage,
    transcriptIsolation,
    agentIsolation,
  } = params;

  const tokenAttributionGap =
    Number(transcriptIsolation.unattributed_docs || 0) > 0
    || Number(agentIsolation.unattributed_docs || 0) > 0;

  if (tokenAttributionGap) {
    return {
      available: false,
      source_used: 'none',
      total_tokens_used: null,
      reason: 'token telemetry contains untagged records; metric is unavailable',
    };
  }

  const candidates = [
    {
      source: 'transcript_jsonl',
      usage: transcriptUsage,
      isolation: transcriptIsolation,
    },
    {
      source: 'agent_metrics_jsonl',
      usage: agentUsage,
      isolation: agentIsolation,
    },
  ];

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.usage.total_tokens) || candidate.usage.total_tokens <= 0) continue;
    if (!candidate.isolation.attribution_safe) continue;
    return {
      available: true,
      source_used: candidate.source,
      total_tokens_used: candidate.usage.total_tokens,
      reason: null,
    };
  }

  return {
    available: false,
    source_used: 'none',
    total_tokens_used: null,
    reason: 'no attributable token usage records for the active run',
  };
}

function classifyPath(pathId) {
  if (pathId === 'native') return 'native_claude';
  if (pathId === 'lead_coordinator') return 'lead_coordinator';
  return 'lead_overlay';
}

function wilsonInterval(k, n, confidence = DEFAULT_CONFIDENCE) {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0) {
    return { low: null, high: null, center: null };
  }
  const z = confidence >= 0.99 ? 2.5758293035489004 : 1.959963984540054;
  const phat = k / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    center,
  };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((acc, n) => acc + n, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, n) => acc + ((n - m) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  if (q <= 0) return sortedValues[0];
  if (q >= 1) return sortedValues[sortedValues.length - 1];
  const idx = (sortedValues.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const weight = idx - lo;
  return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight;
}

function bootstrapMeanCI(values, rng, confidence = DEFAULT_CONFIDENCE, iterations = DEFAULT_BOOTSTRAP_ITERS) {
  if (!values.length) {
    return { mean: null, ci_low: null, ci_high: null, n: 0, stddev: null };
  }
  if (values.length === 1) {
    return {
      mean: values[0],
      ci_low: values[0],
      ci_high: values[0],
      n: 1,
      stddev: 0,
    };
  }

  const n = values.length;
  const means = [];
  for (let i = 0; i < iterations; i += 1) {
    let total = 0;
    for (let j = 0; j < n; j += 1) {
      const pick = values[Math.floor(rng() * n)];
      total += pick;
    }
    means.push(total / n);
  }
  means.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  return {
    mean: mean(values),
    ci_low: quantile(means, alpha / 2),
    ci_high: quantile(means, 1 - alpha / 2),
    n,
    stddev: stddev(values),
  };
}

function bootstrapDiffCI(valuesA, valuesB, rng, confidence = DEFAULT_CONFIDENCE, iterations = DEFAULT_BOOTSTRAP_ITERS) {
  if (!valuesA.length || !valuesB.length) {
    return {
      mean_diff: null,
      ci_low: null,
      ci_high: null,
      n_a: valuesA.length,
      n_b: valuesB.length,
    };
  }

  const nA = valuesA.length;
  const nB = valuesB.length;
  const diffs = [];
  for (let i = 0; i < iterations; i += 1) {
    let sumA = 0;
    let sumB = 0;
    for (let j = 0; j < nA; j += 1) sumA += valuesA[Math.floor(rng() * nA)];
    for (let j = 0; j < nB; j += 1) sumB += valuesB[Math.floor(rng() * nB)];
    diffs.push(sumA / nA - sumB / nB);
  }
  diffs.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  return {
    mean_diff: mean(valuesA) - mean(valuesB),
    ci_low: quantile(diffs, alpha / 2),
    ci_high: quantile(diffs, 1 - alpha / 2),
    n_a: nA,
    n_b: nB,
  };
}

function bootstrapRatioCI(valuesA, valuesB, rng, confidence = DEFAULT_CONFIDENCE, iterations = DEFAULT_BOOTSTRAP_ITERS) {
  if (!valuesA.length || !valuesB.length) {
    return {
      mean_ratio: null,
      ci_low: null,
      ci_high: null,
      n_a: valuesA.length,
      n_b: valuesB.length,
    };
  }

  const nA = valuesA.length;
  const nB = valuesB.length;
  const sampleRatios = [];

  for (let i = 0; i < iterations; i += 1) {
    let sumA = 0;
    let sumB = 0;
    for (let j = 0; j < nA; j += 1) sumA += valuesA[Math.floor(rng() * nA)];
    for (let j = 0; j < nB; j += 1) sumB += valuesB[Math.floor(rng() * nB)];
    const meanB = sumB / nB;
    if (!Number.isFinite(meanB) || meanB <= 0) continue;
    sampleRatios.push((sumA / nA) / meanB);
  }

  if (sampleRatios.length === 0) {
    return {
      mean_ratio: null,
      ci_low: null,
      ci_high: null,
      n_a: nA,
      n_b: nB,
    };
  }

  sampleRatios.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  const baselineMean = mean(valuesB);

  return {
    mean_ratio: Number.isFinite(baselineMean) && baselineMean > 0
      ? mean(valuesA) / baselineMean
      : null,
    ci_low: quantile(sampleRatios, alpha / 2),
    ci_high: quantile(sampleRatios, 1 - alpha / 2),
    n_a: nA,
    n_b: nB,
  };
}

function cleanNumber(value, digits = 6) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function stdoutInterventionHits(stdout, stderr) {
  const text = `${stdout || ''}\n${stderr || ''}`;
  const hits = text.match(/\[HUMAN_INTERVENTION\]/g);
  return hits ? hits.length : 0;
}

function parseHarnessEvents(pathValue) {
  if (!existsSync(pathValue)) return [];
  const lines = readFileSync(pathValue, 'utf8').split('\n');
  return parseJsonlLines(lines);
}

function sumEventCount(events, type) {
  let total = 0;
  for (const event of events) {
    if (String(event.type || '') !== type) continue;
    const count = Number(event.count || 1);
    total += Number.isFinite(count) ? count : 1;
  }
  return total;
}

function completionUnitsFromEvents(events, exitCode) {
  const explicit = sumEventCount(events, 'workload_completed');
  if (explicit > 0) return explicit;
  return exitCode === 0 ? 1 : 0;
}

function computeDataQuality(dataset, manifest) {
  const countsByPath = Object.fromEntries(
    manifest.active_paths.map((entry) => [entry.path_id, 0])
  );
  let tokenObservedRuns = 0;
  let eventObservedRuns = 0;
  const attributionUnavailableRuns = {
    token_metric: 0,
    activity: 0,
    conflicts: 0,
    transcript: 0,
    resume: 0,
    events: 0,
  };

  for (const row of dataset) {
    if (Object.hasOwn(countsByPath, row.path_id)) {
      countsByPath[row.path_id] += 1;
    }
    if (
      row?.telemetry?.attribution?.token_metric?.available === true
      && Number(row?.tokens?.total_tokens_used || 0) > 0
    ) {
      tokenObservedRuns += 1;
    }
    if (
      row?.telemetry?.attribution?.events?.available === true
      && Number(row?.telemetry?.event_records || 0) > 0
    ) {
      eventObservedRuns += 1;
    }

    for (const lane of Object.keys(attributionUnavailableRuns)) {
      if (row?.telemetry?.attribution?.[lane]?.available !== true) {
        attributionUnavailableRuns[lane] += 1;
      }
    }
  }

  const totalRuns = dataset.length;
  const expectedTotalRuns = manifest.trials * manifest.active_paths.length;
  const pathBalance = Object.entries(countsByPath).map(([pathId, observed]) => ({
    path_id: pathId,
    expected_runs: manifest.trials,
    observed_runs: observed,
    balanced: observed === manifest.trials,
  }));
  const balancedTrialMatrix = pathBalance.every((row) => row.balanced);

  const tokenCoverageRatio = totalRuns > 0 ? tokenObservedRuns / totalRuns : 0;
  const eventCoverageRatio = totalRuns > 0 ? eventObservedRuns / totalRuns : 0;

  const claimReadinessIssues = [];
  if (totalRuns !== expectedTotalRuns) {
    claimReadinessIssues.push('missing or extra trial rows relative to trial*path matrix');
  }
  if (!balancedTrialMatrix) {
    claimReadinessIssues.push('trial matrix is not balanced across enabled paths');
  }
  if (tokenCoverageRatio < 0.95) {
    claimReadinessIssues.push('token telemetry coverage below 95%');
  }
  if (eventCoverageRatio < 0.95) {
    claimReadinessIssues.push('event coverage below 95%');
  }
  for (const [lane, unavailableCount] of Object.entries(attributionUnavailableRuns)) {
    if (unavailableCount > 0) {
      claimReadinessIssues.push(`attribution incomplete for ${lane} in ${unavailableCount}/${totalRuns} run(s)`);
    }
  }

  return {
    total_runs: totalRuns,
    expected_total_runs: expectedTotalRuns,
    path_balance: pathBalance,
    balanced_trial_matrix: balancedTrialMatrix,
    token_observed_runs: tokenObservedRuns,
    token_coverage_ratio: cleanNumber(tokenCoverageRatio),
    event_observed_runs: eventObservedRuns,
    event_coverage_ratio: cleanNumber(eventCoverageRatio),
    attribution_unavailable_runs: attributionUnavailableRuns,
    attribution_integrity_pass: Object.values(attributionUnavailableRuns).every((n) => n === 0),
    claim_ready_for_savings: claimReadinessIssues.length === 0,
    claim_readiness_issues: claimReadinessIssues,
  };
}

function summarizeByPath(dataset, opts) {
  const byPath = {};
  const confidence = opts.confidence;
  const bootstrapIterations = opts.bootstrapIterations;

  const allPathIds = [...new Set(dataset.map((row) => row.path_id))];
  for (const pathId of allPathIds) {
    const rows = dataset.filter((row) => row.path_id === pathId);
    const rng = makeRng(opts.seed + pathId.length * 13 + rows.length);

    const numeric = (selector) => rows.map(selector).filter((n) => Number.isFinite(n));

    const completions = rows.map((r) => Number(r.completion.completed ? 1 : 0));
    const completionSuccesses = completions.reduce((a, b) => a + b, 0);
    const completionRate = completionSuccesses / Math.max(1, completions.length);
    const completionWilson = wilsonInterval(completionSuccesses, completions.length, confidence);

    const resumeAttempts = rows.reduce((acc, row) => acc + Number(row.resume.attempts || 0), 0);
    const resumeSuccesses = rows.reduce((acc, row) => acc + Number(row.resume.successes || 0), 0);
    const resumeWilson = wilsonInterval(resumeSuccesses, resumeAttempts, confidence);

    byPath[pathId] = {
      classification: classifyPath(pathId),
      runs: rows.length,
      completion_rate: {
        mean: cleanNumber(completionRate),
        ci_low: cleanNumber(completionWilson.low),
        ci_high: cleanNumber(completionWilson.high),
        successes: completionSuccesses,
        total: completions.length,
      },
      latency_ms: bootstrapMeanCI(numeric((r) => r.latency_ms), rng, confidence, bootstrapIterations),
      tokens_total: bootstrapMeanCI(numeric((r) => r.tokens.total_tokens_used), rng, confidence, bootstrapIterations),
      human_interventions: bootstrapMeanCI(numeric((r) => r.human_intervention_count), rng, confidence, bootstrapIterations),
      conflict_incidents: bootstrapMeanCI(numeric((r) => r.conflict_incidents), rng, confidence, bootstrapIterations),
      throughput_per_usage_window: bootstrapMeanCI(numeric((r) => r.throughput.per_usage_window), rng, confidence, bootstrapIterations),
      resume: {
        attempts: resumeAttempts,
        successes: resumeSuccesses,
        success_rate_mean: cleanNumber(resumeAttempts > 0 ? resumeSuccesses / resumeAttempts : 0),
        success_rate_ci_low: cleanNumber(resumeWilson.low),
        success_rate_ci_high: cleanNumber(resumeWilson.high),
      },
    };

    for (const key of ['latency_ms', 'tokens_total', 'human_interventions', 'conflict_incidents', 'throughput_per_usage_window']) {
      const metric = byPath[pathId][key];
      metric.mean = cleanNumber(metric.mean);
      metric.ci_low = cleanNumber(metric.ci_low);
      metric.ci_high = cleanNumber(metric.ci_high);
      metric.stddev = cleanNumber(metric.stddev);
    }
  }

  return byPath;
}

function summarizeComparisons(dataset, baselinePath, opts) {
  const allPathIds = [...new Set(dataset.map((row) => row.path_id))];
  const out = {};
  const confidence = opts.confidence;
  const bootstrapIterations = opts.bootstrapIterations;

  const baselineRows = dataset.filter((row) => row.path_id === baselinePath);
  for (const pathId of allPathIds) {
    if (pathId === baselinePath) continue;
    const candidateRows = dataset.filter((row) => row.path_id === pathId);
    const rng = makeRng(opts.seed + pathId.length * 97 + baselinePath.length * 31);

    const pick = (rows, selector) => rows.map(selector).filter((n) => Number.isFinite(n));

    const tokensDiff = bootstrapDiffCI(
      pick(candidateRows, (r) => r.tokens.total_tokens_used),
      pick(baselineRows, (r) => r.tokens.total_tokens_used),
      rng,
      confidence,
      bootstrapIterations
    );

    const latencyDiff = bootstrapDiffCI(
      pick(candidateRows, (r) => r.latency_ms),
      pick(baselineRows, (r) => r.latency_ms),
      rng,
      confidence,
      bootstrapIterations
    );

    const throughputDiff = bootstrapDiffCI(
      pick(candidateRows, (r) => r.throughput.per_usage_window),
      pick(baselineRows, (r) => r.throughput.per_usage_window),
      rng,
      confidence,
      bootstrapIterations
    );

    const interventionDiff = bootstrapDiffCI(
      pick(candidateRows, (r) => r.human_intervention_count),
      pick(baselineRows, (r) => r.human_intervention_count),
      rng,
      confidence,
      bootstrapIterations
    );

    const failureCostDiff = bootstrapDiffCI(
      pick(candidateRows, (r) => r.conflict_incidents),
      pick(baselineRows, (r) => r.conflict_incidents),
      rng,
      confidence,
      bootstrapIterations
    );

    const tokenRatio = bootstrapRatioCI(
      pick(candidateRows, (r) => r.tokens.total_tokens_used),
      pick(baselineRows, (r) => r.tokens.total_tokens_used),
      rng,
      confidence,
      bootstrapIterations
    );

    out[pathId] = {
      tokens_total_minus_baseline: {
        mean_diff: cleanNumber(tokensDiff.mean_diff),
        ci_low: cleanNumber(tokensDiff.ci_low),
        ci_high: cleanNumber(tokensDiff.ci_high),
        n_a: tokensDiff.n_a,
        n_b: tokensDiff.n_b,
      },
      latency_ms_minus_baseline: {
        mean_diff: cleanNumber(latencyDiff.mean_diff),
        ci_low: cleanNumber(latencyDiff.ci_low),
        ci_high: cleanNumber(latencyDiff.ci_high),
        n_a: latencyDiff.n_a,
        n_b: latencyDiff.n_b,
      },
      throughput_per_window_minus_baseline: {
        mean_diff: cleanNumber(throughputDiff.mean_diff),
        ci_low: cleanNumber(throughputDiff.ci_low),
        ci_high: cleanNumber(throughputDiff.ci_high),
        n_a: throughputDiff.n_a,
        n_b: throughputDiff.n_b,
      },
      human_interventions_minus_baseline: {
        mean_diff: cleanNumber(interventionDiff.mean_diff),
        ci_low: cleanNumber(interventionDiff.ci_low),
        ci_high: cleanNumber(interventionDiff.ci_high),
        n_a: interventionDiff.n_a,
        n_b: interventionDiff.n_b,
      },
      failure_cost_minus_baseline: {
        mean_diff: cleanNumber(failureCostDiff.mean_diff),
        ci_low: cleanNumber(failureCostDiff.ci_low),
        ci_high: cleanNumber(failureCostDiff.ci_high),
        n_a: failureCostDiff.n_a,
        n_b: failureCostDiff.n_b,
      },
      tokens_total_ratio_to_baseline: {
        mean_ratio: cleanNumber(tokenRatio.mean_ratio),
        ci_low: cleanNumber(tokenRatio.ci_low),
        ci_high: cleanNumber(tokenRatio.ci_high),
        n_a: tokenRatio.n_a,
        n_b: tokenRatio.n_b,
      },
    };
  }

  return out;
}

function isFiniteMetricBound(metric, key) {
  return Number.isFinite(Number(metric?.[key]));
}

function certifyEconomicsTarget(perPath, comparisons, opts) {
  const {
    baselinePath,
    minTrialsForSavingsClaim,
    confidence,
    evidenceTier,
    dataQuality,
    comparisonTarget,
    targetPriceRatioMax,
    completionNonInferiorityMargin,
    resumeSuccessNonInferiorityMargin,
    humanInterventionDeltaMax,
    failureCostDeltaMax,
  } = opts;

  const confidencePercent = Math.round(Number(confidence || DEFAULT_CONFIDENCE) * 100);
  const comparedPathIds = Object.keys(perPath).filter((pathId) => pathId !== baselinePath);
  const sharedEvidenceIssues = [];

  if (!comparisonTarget || String(comparisonTarget).trim().length === 0 || comparisonTarget === 'unspecified') {
    sharedEvidenceIssues.push('comparison_target is unspecified');
  }
  if (evidenceTier !== 'production_measured') {
    sharedEvidenceIssues.push(`evidence tier is ${evidenceTier}; production_measured is required`);
  }
  if (!dataQuality?.balanced_trial_matrix) {
    sharedEvidenceIssues.push('trial matrix is not balanced across enabled paths');
  }
  if (Number(dataQuality?.total_runs || 0) !== Number(dataQuality?.expected_total_runs || 0)) {
    sharedEvidenceIssues.push('trial/path run count matrix is incomplete');
  }
  if (!dataQuality?.claim_ready_for_savings) {
    const issueText = Array.isArray(dataQuality?.claim_readiness_issues)
      ? dataQuality.claim_readiness_issues.join('; ')
      : '';
    sharedEvidenceIssues.push(`claim-readiness gate failed${issueText ? `: ${issueText}` : ''}`);
  }
  if (!dataQuality?.attribution_integrity_pass) {
    sharedEvidenceIssues.push('attribution integrity failed for one or more metric lanes');
  }
  if (comparedPathIds.length === 0) {
    sharedEvidenceIssues.push('no compared lead path rows found in summary');
  }

  const baselineCompletion = perPath?.[baselinePath]?.completion_rate || null;
  const baselineResume = perPath?.[baselinePath]?.resume || null;

  const perPathResult = {};
  for (const pathId of comparedPathIds) {
    const cmp = comparisons?.[pathId] || {};
    const pathSummary = perPath?.[pathId] || {};
    const issues = [...sharedEvidenceIssues];

    const completionGateReady = isFiniteMetricBound(pathSummary.completion_rate, 'ci_low')
      && isFiniteMetricBound(baselineCompletion, 'ci_high');
    const completionGatePass = completionGateReady
      && Number(pathSummary.completion_rate.ci_low)
        >= Number(baselineCompletion.ci_high) - Number(completionNonInferiorityMargin);
    if (!completionGateReady) {
      issues.push('completion non-inferiority metric bounds are unavailable');
    }

    const resumeGateReady = isFiniteMetricBound(pathSummary.resume, 'success_rate_ci_low')
      && isFiniteMetricBound(baselineResume, 'success_rate_ci_high');
    const resumeGatePass = resumeGateReady
      && Number(pathSummary.resume.success_rate_ci_low)
        >= Number(baselineResume.success_rate_ci_high) - Number(resumeSuccessNonInferiorityMargin);
    if (!resumeGateReady) {
      issues.push('resume success non-inferiority bounds are unavailable');
    }

    const interventionGateReady = isFiniteMetricBound(cmp.human_interventions_minus_baseline, 'ci_high');
    const interventionGatePass = interventionGateReady
      && Number(cmp.human_interventions_minus_baseline.ci_high) <= Number(humanInterventionDeltaMax);
    if (!interventionGateReady) {
      issues.push('human intervention delta bounds are unavailable');
    }

    const failureCostGateReady = isFiniteMetricBound(cmp.failure_cost_minus_baseline, 'ci_high');
    const failureCostGatePass = failureCostGateReady
      && Number(cmp.failure_cost_minus_baseline.ci_high) <= Number(failureCostDeltaMax);
    if (!failureCostGateReady) {
      issues.push('failure-cost delta bounds are unavailable');
    }

    const ratioMetric = cmp.tokens_total_ratio_to_baseline;
    const tokenRatioGateReady = isFiniteMetricBound(ratioMetric, 'ci_high')
      && Number(ratioMetric?.n_a || 0) >= Number(minTrialsForSavingsClaim)
      && Number(ratioMetric?.n_b || 0) >= Number(minTrialsForSavingsClaim);
    const tokenRatioGatePass = tokenRatioGateReady
      && Number(ratioMetric.ci_high) <= Number(targetPriceRatioMax);
    if (!tokenRatioGateReady) {
      issues.push('token ratio confidence bounds or minimum trial counts are unavailable');
    }

    const interventionFailurePass = interventionGatePass && failureCostGatePass && resumeGatePass;
    const allMetricGatesPass = completionGatePass && interventionFailurePass && tokenRatioGatePass;

    let result = 'not_certified';
    let summaryReason = `one or more certification gates failed at ${confidencePercent}% confidence`;
    if (issues.length > 0) {
      result = 'blocked_by_evidence_quality';
      summaryReason = issues.join('; ');
    } else if (allMetricGatesPass) {
      result = 'certified';
      summaryReason = `all economics gates passed at ${confidencePercent}% confidence`;
    }

    perPathResult[pathId] = {
      result,
      summary_reason: summaryReason,
      gates: {
        same_workload_comparison_valid: {
          pass: sharedEvidenceIssues.length === 0,
          evidence_issues: sharedEvidenceIssues,
        },
        completion_quality_non_inferior: {
          pass: completionGatePass,
          margin_allowed: completionNonInferiorityMargin,
          candidate_ci_low: pathSummary.completion_rate?.ci_low ?? null,
          baseline_ci_high: baselineCompletion?.ci_high ?? null,
        },
        intervention_failure_cost_not_materially_worse: {
          pass: interventionFailurePass,
          human_interventions_ci_high_delta: cmp.human_interventions_minus_baseline?.ci_high ?? null,
          human_interventions_delta_max: humanInterventionDeltaMax,
          failure_cost_ci_high_delta: cmp.failure_cost_minus_baseline?.ci_high ?? null,
          failure_cost_delta_max: failureCostDeltaMax,
          resume_candidate_ci_low: pathSummary.resume?.success_rate_ci_low ?? null,
          resume_baseline_ci_high: baselineResume?.success_rate_ci_high ?? null,
          resume_margin_allowed: resumeSuccessNonInferiorityMargin,
        },
        token_cost_reduction_supports_target_threshold: {
          pass: tokenRatioGatePass,
          target_ratio_max: targetPriceRatioMax,
          measured_ratio_mean: ratioMetric?.mean_ratio ?? null,
          measured_ratio_ci_low: ratioMetric?.ci_low ?? null,
          measured_ratio_ci_high: ratioMetric?.ci_high ?? null,
          min_trials_required_per_arm: minTrialsForSavingsClaim,
          n_candidate: ratioMetric?.n_a ?? null,
          n_baseline: ratioMetric?.n_b ?? null,
        },
      },
      comparisons: {
        tokens_total_minus_baseline: cmp.tokens_total_minus_baseline || null,
        tokens_total_ratio_to_baseline: cmp.tokens_total_ratio_to_baseline || null,
        completion_rate: pathSummary.completion_rate || null,
        baseline_completion_rate: baselineCompletion || null,
      },
    };
  }

  let overallResult = 'blocked_by_evidence_quality';
  let overallReason = sharedEvidenceIssues.join('; ') || 'economics evidence unavailable';
  if (comparedPathIds.length > 0) {
    const results = comparedPathIds.map((pathId) => perPathResult[pathId]?.result);
    if (results.every((result) => result === 'certified')) {
      overallResult = 'certified';
      overallReason = 'all compared paths satisfied every economics certification gate';
    } else if (results.some((result) => result === 'blocked_by_evidence_quality')) {
      overallResult = 'blocked_by_evidence_quality';
      const blockedPaths = comparedPathIds
        .filter((pathId) => perPathResult[pathId]?.result === 'blocked_by_evidence_quality')
        .join(', ');
      overallReason = `evidence quality blocked certification for: ${blockedPaths}`;
    } else {
      overallResult = 'not_certified';
      overallReason = 'measured evidence failed one or more economics certification gates';
    }
  }

  return {
    target_claim: 'essentially_same_workload_at_1_5th_price',
    target_price_ratio_max: cleanNumber(targetPriceRatioMax),
    confidence_level: confidence,
    baseline_path: baselinePath,
    comparison_target: comparisonTarget,
    evidence_tier: evidenceTier,
    overall_result: overallResult,
    overall_reason: overallReason,
    per_path: perPathResult,
  };
}

function claimSafety(perPath, comparisons, opts) {
  const {
    baselinePath,
    evidenceTier,
    economicsCertification,
  } = opts;
  const statements = [];
  const policy = [];

  statements.push('Claims are restricted to measured A/B outcomes from this harness run.');
  statements.push(`Evidence tier for this run: ${evidenceTier}.`);
  statements.push(`Economics certification result: ${economicsCertification.overall_result}.`);
  statements.push('The 1/5th-price claim is allowed only when all certification gates pass.');

  for (const [pathId] of Object.entries(perPath)) {
    if (pathId === baselinePath) continue;
    const cmp = comparisons[pathId];
    const pathCert = economicsCertification?.per_path?.[pathId];
    const oneFifthAllowed = pathCert?.result === 'certified';
    const reason = pathCert?.summary_reason || 'economics certification evidence missing';

    policy.push({
      path_id: pathId,
      savings_claim_allowed: oneFifthAllowed,
      one_fifth_price_claim_allowed: oneFifthAllowed,
      economics_certification_result: pathCert?.result || 'blocked_by_evidence_quality',
      reason,
      comparison_tokens_total_minus_baseline: cmp?.tokens_total_minus_baseline || null,
      comparison_tokens_total_ratio_to_baseline: cmp?.tokens_total_ratio_to_baseline || null,
    });

    if (oneFifthAllowed) {
      statements.push(
        `${pathId}: certified for same-workload 1/5th-price claim under this run evidence.`
      );
    } else {
      statements.push(`${pathId}: 1/5th-price claim not allowed (${reason}).`);
    }
  }

  return { statements, policy };
}

function formatMetricCell(metric) {
  if (!metric || metric.mean === null) return 'n/a';
  return `${metric.mean} [${metric.ci_low}, ${metric.ci_high}]`;
}

function writeMarkdownReport(reportPath, payload) {
  const lines = [];
  lines.push(`# Measured A/B Parity + Economics Report (${payload.run_id})`);
  lines.push('');
  lines.push(`Generated: ${payload.generated_at}`);
  lines.push(`Workload: ${payload.workload.id}`);
  lines.push(`Comparison target: ${payload.workload.comparison_target}`);
  lines.push(`Evidence tier: ${payload.workload.evidence_tier}`);
  lines.push(`Trials: ${payload.trials}`);
  lines.push(`Baseline path: ${payload.baseline_path}`);
  lines.push(`Confidence level: ${payload.confidence}`);
  lines.push('');

  lines.push('## Run quality checks');
  lines.push('');
  lines.push(`- Balanced trial matrix: ${payload.data_quality.balanced_trial_matrix ? 'pass' : 'fail'}`);
  lines.push(`- Token coverage ratio: ${payload.data_quality.token_coverage_ratio}`);
  lines.push(`- Event coverage ratio: ${payload.data_quality.event_coverage_ratio}`);
  lines.push(`- Attribution integrity: ${payload.data_quality.attribution_integrity_pass ? 'pass' : 'fail'}`);
  lines.push(`- Claim readiness for savings: ${payload.data_quality.claim_ready_for_savings ? 'pass' : 'fail'}`);
  if (payload.data_quality.claim_readiness_issues.length > 0) {
    lines.push('- Claim readiness issues:');
    for (const issue of payload.data_quality.claim_readiness_issues) {
      lines.push(`  - ${issue}`);
    }
  }
  lines.push('');

  lines.push('## Claim-safe summary');
  lines.push('');
  for (const statement of payload.claim_safe_summary.statements) {
    lines.push(`- ${statement}`);
  }
  lines.push('');

  lines.push('## Economics certification');
  lines.push('');
  lines.push(`- Target claim: \`${payload.economics_certification.target_claim}\``);
  lines.push(`- Overall result: \`${payload.economics_certification.overall_result}\``);
  lines.push(`- Overall reason: ${payload.economics_certification.overall_reason}`);
  lines.push(`- Target ratio max (candidate/baseline): ${payload.economics_certification.target_price_ratio_max}`);
  lines.push('');
  lines.push('| Path | Result | Same-workload valid | Completion non-inferior | Intervention/failure not worse | Token ratio gate |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const [pathId, cert] of Object.entries(payload.economics_certification.per_path || {})) {
    const gates = cert.gates || {};
    lines.push(
      `| ${pathId} | ${cert.result} | ${gates.same_workload_comparison_valid?.pass ? 'pass' : 'fail'} | ${gates.completion_quality_non_inferior?.pass ? 'pass' : 'fail'} | ${gates.intervention_failure_cost_not_materially_worse?.pass ? 'pass' : 'fail'} | ${gates.token_cost_reduction_supports_target_threshold?.pass ? 'pass' : 'fail'} |`
    );
  }
  lines.push('');

  lines.push('## Path metrics (mean with confidence interval)');
  lines.push('');
  lines.push('| Path | Completion rate | Latency ms | Tokens | Human interventions | Conflict incidents | Throughput / usage window | Resume success rate |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [pathId, summary] of Object.entries(payload.summary.per_path)) {
    const completion = summary.completion_rate;
    const completionText = completion && completion.mean !== null
      ? `${completion.mean} [${completion.ci_low}, ${completion.ci_high}] (${completion.successes}/${completion.total})`
      : 'n/a';
    const resumeText = summary.resume && summary.resume.success_rate_mean !== null
      ? `${summary.resume.success_rate_mean} [${summary.resume.success_rate_ci_low}, ${summary.resume.success_rate_ci_high}] (${summary.resume.successes}/${summary.resume.attempts})`
      : 'n/a';

    lines.push(
      `| ${pathId} | ${completionText} | ${formatMetricCell(summary.latency_ms)} | ${formatMetricCell(summary.tokens_total)} | ${formatMetricCell(summary.human_interventions)} | ${formatMetricCell(summary.conflict_incidents)} | ${formatMetricCell(summary.throughput_per_usage_window)} | ${resumeText} |`
    );
  }
  lines.push('');

  lines.push(`## Comparisons vs baseline (${payload.baseline_path})`);
  lines.push('');
  lines.push('| Path | Tokens diff | Latency diff | Throughput diff |');
  lines.push('| --- | --- | --- | --- |');
  for (const [pathId, cmp] of Object.entries(payload.summary.comparisons_vs_baseline)) {
    const tokenDiff = cmp.tokens_total_minus_baseline;
    const latencyDiff = cmp.latency_ms_minus_baseline;
    const throughputDiff = cmp.throughput_per_window_minus_baseline;
    const fmt = (m) => (m && m.mean_diff !== null ? `${m.mean_diff} [${m.ci_low}, ${m.ci_high}]` : 'n/a');
    lines.push(`| ${pathId} | ${fmt(tokenDiff)} | ${fmt(latencyDiff)} | ${fmt(throughputDiff)} |`);
  }
  lines.push('');

  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- Raw dataset: \`${payload.artifacts.raw_dataset_jsonl}\``);
  lines.push(`- Summary JSON: \`${payload.artifacts.summary_json}\``);
  lines.push(`- Run manifest: \`${payload.artifacts.manifest_json}\``);
  lines.push(`- Run status: \`${payload.artifacts.run_status_json}\``);
  lines.push('');

  lines.push('## Guardrail');
  lines.push('');
  lines.push('- No savings claim should be published unless `savings_claim_allowed` is true for the compared path in this run output.');
  lines.push('');

  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
}

function buildRunManifest(args) {
  const configPath = expandPath(args.config, process.cwd());
  const configDir = dirname(configPath);
  const config = readJsonFile(configPath);

  if (!config || typeof config !== 'object') {
    fatal('config must be a JSON object');
  }

  const trials = Number.isFinite(args.trials) && args.trials > 0
    ? Math.floor(args.trials)
    : Math.max(1, Math.floor(Number(config.trials || DEFAULT_TRIALS)));

  const confidence = Number.isFinite(Number(config.confidence_level))
    ? Number(config.confidence_level)
    : DEFAULT_CONFIDENCE;

  const bootstrapIterations = Number.isFinite(Number(config.bootstrap_iterations))
    ? Math.max(200, Math.floor(Number(config.bootstrap_iterations)))
    : DEFAULT_BOOTSTRAP_ITERS;

  const seed = Number.isFinite(args.seed)
    ? Math.floor(args.seed)
    : Number.isFinite(Number(config.seed))
      ? Math.floor(Number(config.seed))
      : 424242;

  const timeoutSeconds = Number.isFinite(Number(config.timeout_seconds))
    ? Math.max(1, Math.floor(Number(config.timeout_seconds)))
    : DEFAULT_TIMEOUT_SECONDS;
  const timeoutGraceSeconds = Number.isFinite(Number(config.timeout_grace_seconds))
    ? Math.max(1, Math.floor(Number(config.timeout_grace_seconds)))
    : DEFAULT_TIMEOUT_GRACE_SECONDS;

  const usageWindowTokens = Number.isFinite(Number(config.usage_window_tokens))
    ? Math.max(1, Math.floor(Number(config.usage_window_tokens)))
    : 220000;

  const claimPolicy = config.claim_policy || {};
  const minTrialsForSavingsClaim = Number.isFinite(Number(claimPolicy.min_trials_for_savings_claim))
    ? Math.max(1, Math.floor(Number(claimPolicy.min_trials_for_savings_claim)))
    : DEFAULT_MIN_TRIALS_FOR_SAVINGS;
  const targetPriceRatioMax = Number.isFinite(Number(claimPolicy.target_price_ratio_max))
    ? Math.max(0.01, Number(claimPolicy.target_price_ratio_max))
    : DEFAULT_TARGET_PRICE_RATIO_MAX;
  const completionNonInferiorityMargin = Number.isFinite(Number(claimPolicy.completion_non_inferiority_margin))
    ? Math.max(0, Number(claimPolicy.completion_non_inferiority_margin))
    : DEFAULT_COMPLETION_NON_INFERIORITY_MARGIN;
  const resumeSuccessNonInferiorityMargin = Number.isFinite(Number(claimPolicy.resume_success_non_inferiority_margin))
    ? Math.max(0, Number(claimPolicy.resume_success_non_inferiority_margin))
    : DEFAULT_RESUME_SUCCESS_NON_INFERIORITY_MARGIN;
  const humanInterventionDeltaMax = Number.isFinite(Number(claimPolicy.human_intervention_delta_max))
    ? Math.max(0, Number(claimPolicy.human_intervention_delta_max))
    : DEFAULT_HUMAN_INTERVENTION_DELTA_MAX;
  const failureCostDeltaMax = Number.isFinite(Number(claimPolicy.failure_cost_delta_max))
    ? Math.max(0, Number(claimPolicy.failure_cost_delta_max))
    : DEFAULT_FAILURE_COST_DELTA_MAX;

  const runId = args.runId || createRunId('ab');
  const defaultOutRoot = resolve(configDir, '..', 'reports', 'ab-harness');
  const outRoot = expandPath(args.outRoot || config.output_root || defaultOutRoot, configDir);
  const runDir = resolve(outRoot, runId);

  const telemetry = config.telemetry || {};
  const telemetryResolved = {
    agent_metrics_jsonl: expandPath(telemetry.agent_metrics_jsonl || '~/.claude/hooks/session-state/agent-metrics.jsonl', configDir),
    activity_jsonl: expandPath(telemetry.activity_jsonl || '~/.claude/terminals/activity.jsonl', configDir),
    conflicts_jsonl: expandPath(telemetry.conflicts_jsonl || '~/.claude/terminals/conflicts.jsonl', configDir),
    results_dir: expandPath(telemetry.results_dir || '~/.claude/terminals/results', configDir),
    transcript_roots: Array.isArray(telemetry.transcript_roots)
      ? telemetry.transcript_roots.map((p) => expandPath(p, configDir))
      : [],
    transcript_include_regex: telemetry.transcript_include_regex || 'transcript.*\\.jsonl$',
    transcript_max_depth: Number.isFinite(Number(telemetry.transcript_max_depth))
      ? Math.max(1, Math.floor(Number(telemetry.transcript_max_depth)))
      : 8,
    attribution_policy: telemetry.attribution_policy
      ? String(telemetry.attribution_policy)
      : 'strict_run_trial_path',
    required_attribution_fields: ['run_id', 'trial', 'path_id'],
  };
  if (telemetryResolved.attribution_policy !== 'strict_run_trial_path') {
    fatal('telemetry.attribution_policy must be "strict_run_trial_path" for attribution-safe economics evidence');
  }

  const paths = config.paths || {};
  for (const required of REQUIRED_PATHS) {
    if (!paths[required] || paths[required].enabled === false) {
      fatal(`config.paths.${required} must exist and be enabled`);
    }
    if (!paths[required].command || typeof paths[required].command !== 'string') {
      fatal(`config.paths.${required}.command must be a shell string`);
    }
  }

  function normalizeExtraEnv(extraEnv, baseDir) {
    const out = {};
    const pathKeyRe = /(PATH|_DIR|_FILE|_JSONL|_ROOT)$/i;
    for (const [key, rawValue] of Object.entries(extraEnv || {})) {
      if (rawValue === null || rawValue === undefined) continue;
      const value = String(rawValue);
      if (pathKeyRe.test(key) && (value.startsWith('~') || value.includes('/') || value.startsWith('.'))) {
        out[String(key)] = expandPath(value, baseDir);
      } else {
        out[String(key)] = value;
      }
    }
    return out;
  }

  const activePaths = [];
  for (const pathId of [...REQUIRED_PATHS, ...OPTIONAL_PATHS]) {
    const entry = paths[pathId];
    if (!entry || entry.enabled === false) continue;
    if (!entry.command || typeof entry.command !== 'string') {
      fatal(`config.paths.${pathId}.command must be a shell string`);
    }
    activePaths.push({
      path_id: pathId,
      command: entry.command,
      extra_env: normalizeExtraEnv(
        entry.extra_env && typeof entry.extra_env === 'object' ? entry.extra_env : {},
        configDir
      ),
    });
  }

  const workloadConfig = config.workload || {};
  const evidenceTierRaw = workloadConfig.evidence_tier
    ? String(workloadConfig.evidence_tier)
    : DEFAULT_EVIDENCE_TIER;
  if (!EVIDENCE_TIERS.has(evidenceTierRaw)) {
    fatal(`config.workload.evidence_tier must be one of: ${[...EVIDENCE_TIERS].join(', ')}`);
  }

  return {
    config_path: configPath,
    config,
    config_dir: configDir,
    run_id: runId,
    run_dir: runDir,
    out_root: outRoot,
    trials,
    confidence,
    bootstrap_iterations: bootstrapIterations,
    timeout_seconds: timeoutSeconds,
    timeout_grace_seconds: timeoutGraceSeconds,
    usage_window_tokens: usageWindowTokens,
    seed,
    min_trials_for_savings_claim: minTrialsForSavingsClaim,
    claim_policy: {
      min_trials_for_savings_claim: minTrialsForSavingsClaim,
      target_price_ratio_max: targetPriceRatioMax,
      completion_non_inferiority_margin: completionNonInferiorityMargin,
      resume_success_non_inferiority_margin: resumeSuccessNonInferiorityMargin,
      human_intervention_delta_max: humanInterventionDeltaMax,
      failure_cost_delta_max: failureCostDeltaMax,
    },
    telemetry: telemetryResolved,
    active_paths: activePaths,
    workload: {
      id: workloadConfig.id ? String(workloadConfig.id) : 'unspecified-workload',
      description: workloadConfig.description ? String(workloadConfig.description) : '',
      prompt_file: workloadConfig.prompt_file ? expandPath(String(workloadConfig.prompt_file), configDir) : null,
      comparison_target: workloadConfig.comparison_target
        ? String(workloadConfig.comparison_target)
        : 'unspecified',
      evidence_tier: evidenceTierRaw,
    },
    baseline_path: 'native',
  };
}

async function runPathCommand(params) {
  const {
    command,
    env,
    timeoutSeconds,
    timeoutGraceSeconds,
    stdoutPath,
    stderrPath,
  } = params;

  ensureDir(dirname(stdoutPath));
  ensureDir(dirname(stderrPath));
  writeFileSync(stdoutPath, '', 'utf8');
  writeFileSync(stderrPath, '', 'utf8');

  const stdoutChunks = [];
  const stderrChunks = [];

  const startMs = Date.now();
  const child = spawn('bash', ['-lc', command], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let timedOut = false;
  let timeoutEscalation = 'none';
  let closeSignal = null;
  let closeCode = 1;
  let childClosed = false;

  const termTimer = setTimeout(() => {
    timedOut = true;
    timeoutEscalation = 'TERM';
    child.kill('SIGTERM');
  }, timeoutSeconds * 1000);

  const killTimer = setTimeout(() => {
    if (childClosed) return;
    timedOut = true;
    timeoutEscalation = 'KILL';
    child.kill('SIGKILL');
  }, (timeoutSeconds + timeoutGraceSeconds) * 1000);

  const timeoutNote = () => {
    if (!timedOut) return '';
    return `\n[AB_HARNESS_TIMEOUT] command exceeded ${timeoutSeconds}s, escalation=${timeoutEscalation}, grace_seconds=${timeoutGraceSeconds}\n`;
  };

  child.stdout.on('data', (chunk) => {
    stdoutChunks.push(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
  });

  const exit = await new Promise((resolvePromise) => {
    child.on('error', (err) => {
      stderrChunks.push(Buffer.from(`\n[AB_HARNESS_SPAWN_ERROR] ${String(err?.message || err)}\n`, 'utf8'));
      resolvePromise({ code: 1, signal: null });
    });
    child.on('close', (code, signal) => {
      resolvePromise({ code: code ?? 1, signal: signal || null });
    });
  });

  childClosed = true;
  closeCode = exit.code;
  closeSignal = exit.signal;
  clearTimeout(termTimer);
  clearTimeout(killTimer);

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = `${Buffer.concat(stderrChunks).toString('utf8')}${timeoutNote()}`;
  writeFileSync(stdoutPath, stdout, 'utf8');
  writeFileSync(stderrPath, stderr, 'utf8');

  return {
    exit_code: closeCode,
    exit_signal: closeSignal,
    timed_out: timedOut,
    timeout_escalation: timeoutEscalation,
    timeout_seconds: timeoutSeconds,
    timeout_grace_seconds: timeoutGraceSeconds,
    latency_ms: Date.now() - startMs,
    stdout,
    stderr,
  };
}

async function executeTrial(manifest, trialNumber, pathEntry, rng) {
  const pathId = pathEntry.path_id;
  const runDir = manifest.run_dir;
  const telemetry = manifest.telemetry;

  const trialLabel = `trial-${String(trialNumber).padStart(3, '0')}`;
  const logsDir = join(runDir, 'logs', pathId);
  const eventsDir = join(runDir, 'events', pathId);
  ensureDir(logsDir);
  ensureDir(eventsDir);

  const stdoutPath = join(logsDir, `${trialLabel}.stdout.log`);
  const stderrPath = join(logsDir, `${trialLabel}.stderr.log`);
  const eventsPath = join(eventsDir, `${trialLabel}.events.jsonl`);

  const transcriptRegex = new RegExp(telemetry.transcript_include_regex, 'i');
  const transcriptFilesBefore = telemetry.transcript_roots.flatMap((root) =>
    listFilesRecursive(root, {
      maxDepth: telemetry.transcript_max_depth,
      includeRegex: transcriptRegex,
    })
  );

  const transcriptSnapshotBefore = snapshotFiles(transcriptFilesBefore);
  const resumeBefore = loadResumeCounts(telemetry.results_dir);

  const agentMetricsBeforeSize = existsSync(telemetry.agent_metrics_jsonl)
    ? statSync(telemetry.agent_metrics_jsonl).size
    : 0;
  const activityBeforeSize = existsSync(telemetry.activity_jsonl)
    ? statSync(telemetry.activity_jsonl).size
    : 0;
  const conflictsBeforeSize = existsSync(telemetry.conflicts_jsonl)
    ? statSync(telemetry.conflicts_jsonl).size
    : 0;

  const startedAt = nowIso();

  const env = {
    ...process.env,
    ...Object.fromEntries(Object.entries(pathEntry.extra_env).map(([k, v]) => [String(k), String(v)])),
    AB_HARNESS_RUN_ID: manifest.run_id,
    AB_HARNESS_TRIAL: String(trialNumber),
    AB_HARNESS_PATH: pathId,
    AB_HARNESS_WORKLOAD_ID: manifest.workload.id,
    AB_HARNESS_WORKLOAD_PROMPT_FILE: manifest.workload.prompt_file || '',
    AB_HARNESS_EVENTS_JSONL: eventsPath,
    AB_HARNESS_SEED: String(Math.floor(rng() * 1_000_000_000)),
  };

  const commandResult = await runPathCommand({
    command: pathEntry.command,
    env,
    timeoutSeconds: manifest.timeout_seconds,
    timeoutGraceSeconds: manifest.timeout_grace_seconds,
    stdoutPath,
    stderrPath,
  });

  const finishedAt = nowIso();
  const expectedAttribution = {
    run_id: manifest.run_id,
    trial: trialNumber,
    path_id: pathId,
  };

  const agentMetricsDelta = collectJsonlDelta(telemetry.agent_metrics_jsonl, agentMetricsBeforeSize);
  const activityDelta = collectJsonlDelta(telemetry.activity_jsonl, activityBeforeSize);
  const conflictsDelta = collectJsonlDelta(telemetry.conflicts_jsonl, conflictsBeforeSize);
  const agentMetricsIsolation = isolateAttributedDocs(
    agentMetricsDelta.docs,
    expectedAttribution,
    'agent_metrics'
  );
  const activityIsolation = isolateAttributedDocs(
    activityDelta.docs,
    expectedAttribution,
    'activity'
  );
  const conflictsIsolation = isolateAttributedDocs(
    conflictsDelta.docs,
    expectedAttribution,
    'conflicts'
  );

  const transcriptFilesAfter = telemetry.transcript_roots.flatMap((root) =>
    listFilesRecursive(root, {
      maxDepth: telemetry.transcript_max_depth,
      includeRegex: transcriptRegex,
    })
  );

  const transcriptSnapshotAfter = snapshotFiles(transcriptFilesAfter);
  const transcriptDocsDelta = [];
  let transcriptLinesAdded = 0;

  for (const [filePath] of transcriptSnapshotAfter.entries()) {
    const beforeSize = transcriptSnapshotBefore.get(filePath) || 0;
    const delta = collectJsonlDelta(filePath, beforeSize);
    transcriptLinesAdded += delta.linesAdded;
    transcriptDocsDelta.push(...delta.docs);
  }
  const transcriptIsolation = isolateAttributedDocs(
    transcriptDocsDelta,
    expectedAttribution,
    'transcript'
  );
  const transcriptUsageRecords = transcriptIsolation.docs
    .map((doc) => parseUsageFromTranscriptDoc(doc))
    .filter(Boolean);

  const resumeAfter = loadResumeCounts(telemetry.results_dir);
  const resumeDiff = diffResumeCounts(resumeBefore, resumeAfter, expectedAttribution);

  const allEvents = parseHarnessEvents(eventsPath);
  const eventIsolation = isolateAttributedDocs(allEvents, expectedAttribution, 'events');
  const events = eventIsolation.docs;

  const agentMetricUsageRecords = agentMetricsIsolation.docs
    .map((doc) => parseUsageFromAgentMetricDoc(doc))
    .filter(Boolean);

  const usageAgentMetrics = sumUsage(agentMetricUsageRecords);
  const usageTranscripts = sumUsage(transcriptUsageRecords);
  const tokenMeasurement = chooseTokenMeasurement({
    transcriptUsage: usageTranscripts,
    agentUsage: usageAgentMetrics,
    transcriptIsolation,
    agentIsolation: agentMetricsIsolation,
  });
  const tokenSourceUsed = tokenMeasurement.source_used;
  const totalTokensUsed = tokenMeasurement.total_tokens_used;

  const interventionEvents = sumEventCount(events, 'human_intervention');
  const interventionFromOutput = stdoutInterventionHits(commandResult.stdout, commandResult.stderr);

  const conflictEventCount = sumEventCount(events, 'conflict_incident');
  const conflictMetricAvailable = conflictsIsolation.attribution_safe && eventIsolation.attribution_safe;
  const conflictIncidentsRaw = Math.max(conflictsIsolation.attributed_docs, conflictEventCount);
  const conflictIncidents = conflictMetricAvailable ? conflictIncidentsRaw : null;
  const conflictMetricReason = conflictMetricAvailable
    ? null
    : [conflictsIsolation.reason, eventIsolation.reason].filter(Boolean).join('; ');

  const resumeAttemptsEvent = sumEventCount(events, 'resume_attempt');
  const resumeSuccessEvent = sumEventCount(events, 'resume_success');
  const resumeMetricAvailable = resumeDiff.attribution_safe && eventIsolation.attribution_safe;
  const resumeAttemptsRaw = Math.max(resumeDiff.attempts, resumeAttemptsEvent);
  const resumeSuccessesRaw = Math.max(resumeDiff.successes, resumeSuccessEvent);
  const resumeAttempts = resumeMetricAvailable ? resumeAttemptsRaw : null;
  const resumeSuccesses = resumeMetricAvailable ? resumeSuccessesRaw : null;
  const resumeMetricReason = resumeMetricAvailable
    ? null
    : [resumeDiff.attribution_issue, eventIsolation.reason].filter(Boolean).join('; ');

  const completionUnits = completionUnitsFromEvents(events, commandResult.exit_code);
  const completed = completionUnits > 0 && commandResult.exit_code === 0;

  const throughputPerUsageWindow = Number.isFinite(totalTokensUsed) && totalTokensUsed > 0
    ? completionUnits * (manifest.usage_window_tokens / totalTokensUsed)
    : null;

  return {
    run_id: manifest.run_id,
    trial: trialNumber,
    trial_label: trialLabel,
    path_id: pathId,
    path_classification: classifyPath(pathId),
    workload_id: manifest.workload.id,
    started_at: startedAt,
    finished_at: finishedAt,
    latency_ms: commandResult.latency_ms,
    command: pathEntry.command,
    exit_code: commandResult.exit_code,
    exit_signal: commandResult.exit_signal,
    timed_out: commandResult.timed_out,
    timeout_escalation: commandResult.timeout_escalation,
    timeout_seconds: commandResult.timeout_seconds,
    timeout_grace_seconds: commandResult.timeout_grace_seconds,
    completion: {
      completed,
      completion_units: completionUnits,
    },
    tokens: {
      available: tokenMeasurement.available,
      unavailable_reason: tokenMeasurement.reason,
      source_used: tokenSourceUsed,
      total_tokens_used: totalTokensUsed,
      from_agent_metrics: usageAgentMetrics,
      from_transcript_jsonl: usageTranscripts,
    },
    human_intervention_count: interventionEvents + interventionFromOutput,
    conflict_incidents: conflictIncidents,
    resume: {
      available: resumeMetricAvailable,
      unavailable_reason: resumeMetricReason,
      attempts: resumeAttempts,
      successes: resumeSuccesses,
      success_rate: Number.isFinite(resumeAttempts) && resumeAttempts > 0
        ? resumeSuccesses / resumeAttempts
        : null,
    },
    throughput: {
      usage_window_tokens: manifest.usage_window_tokens,
      per_usage_window: throughputPerUsageWindow,
    },
    telemetry: {
      agent_metrics_records_raw: agentMetricsDelta.docs.length,
      agent_metrics_records: agentMetricUsageRecords.length,
      transcript_records_raw: transcriptDocsDelta.length,
      transcript_usage_records: transcriptUsageRecords.length,
      transcript_lines_added: transcriptLinesAdded,
      activity_records_raw: activityDelta.docs.length,
      activity_records: activityIsolation.attributed_docs,
      conflict_records_raw: conflictsDelta.docs.length,
      conflict_records: conflictsIsolation.attributed_docs,
      event_records_raw: allEvents.length,
      event_records: events.length,
      attribution: {
        token_metric: {
          available: tokenMeasurement.available,
          reason: tokenMeasurement.reason,
          source_used: tokenMeasurement.source_used,
        },
        agent_metrics: summarizeIsolation(agentMetricsIsolation),
        transcript: summarizeIsolation(transcriptIsolation),
        activity: summarizeIsolation(activityIsolation),
        conflicts: summarizeIsolation(conflictsIsolation),
        events: summarizeIsolation(eventIsolation),
        conflict_metric: {
          available: conflictMetricAvailable,
          reason: conflictMetricReason || null,
        },
        resume: {
          available: resumeMetricAvailable,
          reason: resumeMetricReason || null,
          delta_records: resumeDiff.delta_records,
          attributed_records: resumeDiff.attributed_records,
          attempts_attributed: resumeDiff.attempts,
          attempts_unattributed: resumeDiff.unattributed_attempts,
          attempts_other_run: resumeDiff.other_run_attempts,
        },
      },
    },
    log_files: {
      stdout: stdoutPath,
      stderr: stderrPath,
      events: eventsPath,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = buildRunManifest(args);

  ensureDir(manifest.run_dir);
  ensureDir(join(manifest.run_dir, 'logs'));
  ensureDir(join(manifest.run_dir, 'events'));

  const rng = makeRng(manifest.seed);
  const dataset = [];
  const expectedRuns = manifest.trials * manifest.active_paths.length;
  let executionError = null;

  const manifestPath = join(manifest.run_dir, 'run-manifest.json');
  const rawDatasetPath = join(manifest.run_dir, 'raw-dataset.jsonl');
  const summaryPath = join(manifest.run_dir, 'summary.json');
  const reportPath = join(manifest.run_dir, 'report.md');
  const claimSafePath = join(manifest.run_dir, 'claim-safe-summary.md');
  const runStatusPath = join(manifest.run_dir, 'run-status.json');

  writeFileSync(
    manifestPath,
    JSON.stringify({
      run_id: manifest.run_id,
      generated_at: nowIso(),
      config_path: manifest.config_path,
      trials: manifest.trials,
      timeout_seconds: manifest.timeout_seconds,
      timeout_grace_seconds: manifest.timeout_grace_seconds,
      seed: manifest.seed,
      confidence: manifest.confidence,
      bootstrap_iterations: manifest.bootstrap_iterations,
      usage_window_tokens: manifest.usage_window_tokens,
      workload: manifest.workload,
      baseline_path: manifest.baseline_path,
      active_paths: manifest.active_paths,
      telemetry: manifest.telemetry,
      min_trials_for_savings_claim: manifest.min_trials_for_savings_claim,
      claim_policy: manifest.claim_policy,
      evidence_tier: manifest.workload.evidence_tier,
      comparison_target: manifest.workload.comparison_target,
    }, null, 2),
    'utf8'
  );
  writeFileSync(rawDatasetPath, '', 'utf8');

  const runStatus = {
    run_id: manifest.run_id,
    state: 'running',
    started_at: nowIso(),
    finished_at: null,
    expected_rows: expectedRuns,
    observed_rows: 0,
    fatal_error: null,
    economics_certification_result: null,
    artifacts: {
      raw_dataset_jsonl: rawDatasetPath,
      manifest_json: manifestPath,
      summary_json: summaryPath,
      report_md: reportPath,
      claim_safe_summary_md: claimSafePath,
    },
  };
  const persistRunStatus = () => {
    writeFileSync(runStatusPath, JSON.stringify(runStatus, null, 2), 'utf8');
  };
  persistRunStatus();

  const appendDatasetRow = (row) => {
    dataset.push(row);
    appendFileSync(rawDatasetPath, `${JSON.stringify(row)}\n`, 'utf8');
    runStatus.observed_rows = dataset.length;
    persistRunStatus();
  };

  console.log(`ab-harness run: ${manifest.run_id}`);
  console.log(`output dir: ${manifest.run_dir}`);
  console.log(`paths: ${manifest.active_paths.map((p) => p.path_id).join(', ')}`);
  console.log(`trials: ${manifest.trials}`);

  trialLoop:
  for (let trial = 1; trial <= manifest.trials; trial += 1) {
    const order = shuffle(manifest.active_paths, rng);
    console.log(`trial ${trial}/${manifest.trials} order: ${order.map((p) => p.path_id).join(', ')}`);

    for (const pathEntry of order) {
      console.log(`  running path=${pathEntry.path_id}`);
      try {
        const row = await executeTrial(manifest, trial, pathEntry, rng);
        appendDatasetRow(row);
        console.log(
          `    done exit=${row.exit_code} latency_ms=${row.latency_ms} tokens=${row.tokens.total_tokens_used} completion=${row.completion.completed ? 1 : 0}`
        );
      } catch (err) {
        executionError = err;
        const trialLabel = `trial-${String(trial).padStart(3, '0')}`;
        const logsDir = join(manifest.run_dir, 'logs', pathEntry.path_id);
        const eventsDir = join(manifest.run_dir, 'events', pathEntry.path_id);
        ensureDir(logsDir);
        ensureDir(eventsDir);
        const stdoutPath = join(logsDir, `${trialLabel}.stdout.log`);
        const stderrPath = join(logsDir, `${trialLabel}.stderr.log`);
        const eventsPath = join(eventsDir, `${trialLabel}.events.jsonl`);
        if (!existsSync(stdoutPath)) writeFileSync(stdoutPath, '', 'utf8');
        const errorText = `[AB_HARNESS_EXECUTION_ERROR] ${String(err?.stack || err?.message || err)}\n`;
        writeFileSync(stderrPath, errorText, 'utf8');
        const errorEvent = {
          type: 'harness_execution_error',
          run_id: manifest.run_id,
          trial,
          path_id: pathEntry.path_id,
          recorded_at: nowIso(),
          message: String(err?.message || err || 'unknown execution error'),
        };
        writeFileSync(eventsPath, `${JSON.stringify(errorEvent)}\n`, 'utf8');

        appendDatasetRow({
          run_id: manifest.run_id,
          trial,
          trial_label: trialLabel,
          path_id: pathEntry.path_id,
          path_classification: classifyPath(pathEntry.path_id),
          workload_id: manifest.workload.id,
          started_at: nowIso(),
          finished_at: nowIso(),
          latency_ms: null,
          command: pathEntry.command,
          exit_code: null,
          exit_signal: null,
          timed_out: false,
          timeout_escalation: 'none',
          timeout_seconds: manifest.timeout_seconds,
          timeout_grace_seconds: manifest.timeout_grace_seconds,
          completion: {
            completed: false,
            completion_units: 0,
          },
          tokens: {
            available: false,
            unavailable_reason: 'trial execution failed before telemetry collation completed',
            source_used: 'none',
            total_tokens_used: null,
            from_agent_metrics: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              total_tokens: 0,
            },
            from_transcript_jsonl: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              total_tokens: 0,
            },
          },
          human_intervention_count: null,
          conflict_incidents: null,
          resume: {
            available: false,
            unavailable_reason: 'trial execution failed before telemetry collation completed',
            attempts: null,
            successes: null,
            success_rate: null,
          },
          throughput: {
            usage_window_tokens: manifest.usage_window_tokens,
            per_usage_window: null,
          },
          telemetry: {
            agent_metrics_records_raw: 0,
            agent_metrics_records: 0,
            transcript_records_raw: 0,
            transcript_usage_records: 0,
            transcript_lines_added: 0,
            activity_records_raw: 0,
            activity_records: 0,
            conflict_records_raw: 0,
            conflict_records: 0,
            event_records_raw: 1,
            event_records: 1,
            attribution: {
              token_metric: {
                available: false,
                reason: 'execution error',
                source_used: 'none',
              },
              agent_metrics: {
                available: false,
                attribution_safe: false,
                reason: 'execution error',
                docs_total: 0,
                attributed_docs: 0,
                other_run_docs: 0,
                unattributed_docs: 0,
              },
              transcript: {
                available: false,
                attribution_safe: false,
                reason: 'execution error',
                docs_total: 0,
                attributed_docs: 0,
                other_run_docs: 0,
                unattributed_docs: 0,
              },
              activity: {
                available: false,
                attribution_safe: false,
                reason: 'execution error',
                docs_total: 0,
                attributed_docs: 0,
                other_run_docs: 0,
                unattributed_docs: 0,
              },
              conflicts: {
                available: false,
                attribution_safe: false,
                reason: 'execution error',
                docs_total: 0,
                attributed_docs: 0,
                other_run_docs: 0,
                unattributed_docs: 0,
              },
              events: {
                available: true,
                attribution_safe: true,
                reason: null,
                docs_total: 1,
                attributed_docs: 1,
                other_run_docs: 0,
                unattributed_docs: 0,
              },
              conflict_metric: {
                available: false,
                reason: 'execution error',
              },
              resume: {
                available: false,
                reason: 'execution error',
                delta_records: 0,
                attributed_records: 0,
                attempts_attributed: 0,
                attempts_unattributed: 0,
                attempts_other_run: 0,
              },
            },
          },
          diagnostics: {
            execution_error: {
              message: String(err?.message || err || 'unknown execution error'),
              stack: String(err?.stack || ''),
            },
          },
          log_files: {
            stdout: stdoutPath,
            stderr: stderrPath,
            events: eventsPath,
          },
        });
        console.error(`    failed path=${pathEntry.path_id}: ${String(err?.message || err)}`);
        break trialLoop;
      }
    }
  }

  const summaryPerPath = summarizeByPath(dataset, {
    confidence: manifest.confidence,
    bootstrapIterations: manifest.bootstrap_iterations,
    seed: manifest.seed,
  });

  const comparisons = summarizeComparisons(dataset, manifest.baseline_path, {
    confidence: manifest.confidence,
    bootstrapIterations: manifest.bootstrap_iterations,
    seed: manifest.seed + 17,
  });

  const dataQuality = computeDataQuality(dataset, manifest);

  const economicsCertification = certifyEconomicsTarget(
    summaryPerPath,
    comparisons,
    {
      baselinePath: manifest.baseline_path,
      minTrialsForSavingsClaim: manifest.claim_policy.min_trials_for_savings_claim,
      confidence: manifest.confidence,
      evidenceTier: manifest.workload.evidence_tier,
      dataQuality,
      comparisonTarget: manifest.workload.comparison_target,
      targetPriceRatioMax: manifest.claim_policy.target_price_ratio_max,
      completionNonInferiorityMargin: manifest.claim_policy.completion_non_inferiority_margin,
      resumeSuccessNonInferiorityMargin: manifest.claim_policy.resume_success_non_inferiority_margin,
      humanInterventionDeltaMax: manifest.claim_policy.human_intervention_delta_max,
      failureCostDeltaMax: manifest.claim_policy.failure_cost_delta_max,
    }
  );

  const claimSafe = claimSafety(
    summaryPerPath,
    comparisons,
    {
      baselinePath: manifest.baseline_path,
      evidenceTier: manifest.workload.evidence_tier,
      economicsCertification,
    }
  );

  const summaryPayload = {
    run_id: manifest.run_id,
    generated_at: nowIso(),
    workload: manifest.workload,
    baseline_path: manifest.baseline_path,
    trials: manifest.trials,
    confidence: manifest.confidence,
    bootstrap_iterations: manifest.bootstrap_iterations,
    usage_window_tokens: manifest.usage_window_tokens,
    data_quality: dataQuality,
    economics_certification: economicsCertification,
    summary: {
      per_path: summaryPerPath,
      comparisons_vs_baseline: comparisons,
    },
    claim_safe_summary: claimSafe,
    run_status: {
      state: executionError
        ? 'failed_partial'
        : dataset.length < expectedRuns
          ? 'completed_partial'
          : 'completed',
      expected_rows: expectedRuns,
      observed_rows: dataset.length,
      run_status_json: runStatusPath,
    },
    artifacts: {
      raw_dataset_jsonl: rawDatasetPath,
      manifest_json: manifestPath,
      summary_json: summaryPath,
      report_md: reportPath,
      claim_safe_summary_md: claimSafePath,
      run_status_json: runStatusPath,
    },
  };

  writeFileSync(summaryPath, JSON.stringify(summaryPayload, null, 2), 'utf8');

  writeMarkdownReport(reportPath, summaryPayload);
  writeFileSync(
    claimSafePath,
    `${summaryPayload.claim_safe_summary.statements.map((line) => `- ${line}`).join('\n')}\n`,
    'utf8'
  );

  runStatus.state = executionError
    ? 'failed_partial'
    : dataset.length < expectedRuns
      ? 'completed_partial'
      : 'completed';
  runStatus.finished_at = nowIso();
  runStatus.economics_certification_result = economicsCertification.overall_result;
  runStatus.fatal_error = executionError
    ? {
      message: String(executionError?.message || executionError || 'unknown execution error'),
      stack: String(executionError?.stack || ''),
    }
    : null;
  persistRunStatus();

  console.log('ab-harness completed');
  console.log(`raw dataset: ${summaryPayload.artifacts.raw_dataset_jsonl}`);
  console.log(`report: ${summaryPayload.artifacts.report_md}`);
  console.log(`summary: ${summaryPayload.artifacts.summary_json}`);
  console.log(`economics certification: ${economicsCertification.overall_result}`);

  if (executionError) {
    throw new Error(
      `ab-harness captured a partial failure; diagnostics are in ${runStatusPath}`
    );
  }
}

const isDirectRun = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    fatal(err?.stack || err?.message || String(err));
  });
}

export {
  certifyEconomicsTarget,
  chooseTokenMeasurement,
  computeDataQuality,
  executeTrial,
  isolateAttributedDocs,
  parseUsageFromAgentMetricDoc,
  parseUsageFromTranscriptDoc,
  runPathCommand,
  sumUsage,
};
