import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function nowMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

function measure(fn, iterations = 25) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = nowMs();
    fn();
    samples.push(nowMs() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { avg_ms: Number(avg.toFixed(3)), p50_ms: Number(p50.toFixed(3)), p95_ms: Number(p95.toFixed(3)) };
}

const temp = mkdtempSync(join(tmpdir(), 'coord-bench-'));
try {
  const transcriptPath = join(temp, 'transcript.txt');
  const sessionPath = join(temp, 'session.json');

  const transcriptChunk = 'Tool call log entry with context and stack traces.\n';
  const transcriptData = transcriptChunk.repeat(150000); // ~7MB
  writeFileSync(transcriptPath, transcriptData);

  const sessionData = {
    session: 'abcd1234',
    status: 'active',
    project: 'demo-project',
    branch: 'main',
    cwd: '/tmp/demo-project',
    tool_counts: { Write: 20, Edit: 15, Bash: 40, Read: 18 },
    files_touched: Array.from({ length: 30 }, (_, i) => `src/file-${i}.ts`),
    recent_ops: Array.from({ length: 10 }, (_, i) => ({ t: new Date().toISOString(), tool: 'Edit', file: `file-${i}.ts` })),
  };
  writeFileSync(sessionPath, JSON.stringify(sessionData));

  const transcriptStats = measure(() => {
    const text = readFileSync(transcriptPath, 'utf-8');
    text.match(/Tool call/g);
  });

  const sessionStats = measure(() => {
    const parsed = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    return parsed.tool_counts?.Write;
  });

  const results = {
    generated_at: new Date().toISOString(),
    dataset: {
      transcript_bytes: transcriptData.length,
      session_json_bytes: JSON.stringify(sessionData).length,
    },
    transcript_scan: transcriptStats,
    session_json_read: sessionStats,
    speedup_ratio_avg: Number((transcriptStats.avg_ms / sessionStats.avg_ms).toFixed(2)),
  };

  console.log(JSON.stringify(results, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
