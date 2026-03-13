#!/usr/bin/env node

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function usageAndExit() {
  console.error('Usage: node bench/ab-log-event.mjs --type <event_type> [--count <n>] [--detail <text>] [--file <path>]');
  process.exit(2);
}

const args = process.argv.slice(2);
let type = null;
let count = 1;
let detail = '';
let file = process.env.AB_HARNESS_EVENTS_JSONL || '';

for (let i = 0; i < args.length; i += 1) {
  const token = args[i];
  const next = args[i + 1];
  if (token === '--type' && next) {
    type = String(next);
    i += 1;
    continue;
  }
  if (token === '--count' && next) {
    count = Number(next);
    i += 1;
    continue;
  }
  if (token === '--detail' && next) {
    detail = String(next);
    i += 1;
    continue;
  }
  if (token === '--file' && next) {
    file = String(next);
    i += 1;
    continue;
  }
  if (token === '--help' || token === '-h') {
    usageAndExit();
  }
  usageAndExit();
}

if (!type || !file) usageAndExit();
if (!Number.isFinite(count) || count < 0) usageAndExit();

const record = {
  ts: new Date().toISOString(),
  type,
  count,
  detail,
  run_id: process.env.AB_HARNESS_RUN_ID || null,
  trial: process.env.AB_HARNESS_TRIAL || null,
  path_id: process.env.AB_HARNESS_PATH || null,
  workload_id: process.env.AB_HARNESS_WORKLOAD_ID || null,
};

mkdirSync(dirname(file), { recursive: true });
appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
