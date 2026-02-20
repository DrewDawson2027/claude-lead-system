import { execFileSync } from 'node:child_process';

const MIN_SPEEDUP = Number(process.env.COORD_PERF_MIN_SPEEDUP || 50);
const MAX_SESSION_P95_MS = Number(process.env.COORD_PERF_MAX_SESSION_P95_MS || 2.0);
const MAX_TRANSCRIPT_P95_MS = Number(process.env.COORD_PERF_MAX_TRANSCRIPT_P95_MS || 30.0);
const RUNS = Math.max(1, Number(process.env.COORD_PERF_RUNS || 3));

function runOnce() {
  const raw = execFileSync('node', ['bench/coord-benchmark.mjs'], { encoding: 'utf-8' });
  return JSON.parse(raw);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const samples = Array.from({ length: RUNS }, () => runOnce());
const parsed = {
  speedup_ratio_avg: median(samples.map((s) => Number(s.speedup_ratio_avg))),
  session_json_read: {
    p95_ms: median(samples.map((s) => Number(s.session_json_read?.p95_ms))),
  },
  transcript_scan: {
    p95_ms: median(samples.map((s) => Number(s.transcript_scan?.p95_ms))),
  },
};

const failures = [];
if (Number(parsed.speedup_ratio_avg) < MIN_SPEEDUP) {
  failures.push(`speedup_ratio_avg ${parsed.speedup_ratio_avg} < ${MIN_SPEEDUP}`);
}
if (Number(parsed.session_json_read?.p95_ms) > MAX_SESSION_P95_MS) {
  failures.push(`session_json_read.p95_ms ${parsed.session_json_read?.p95_ms} > ${MAX_SESSION_P95_MS}`);
}
if (Number(parsed.transcript_scan?.p95_ms) > MAX_TRANSCRIPT_P95_MS) {
  failures.push(`transcript_scan.p95_ms ${parsed.transcript_scan?.p95_ms} > ${MAX_TRANSCRIPT_P95_MS}`);
}

if (failures.length > 0) {
  console.error('Performance gate failed:');
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}

console.log('Performance gate passed.');
