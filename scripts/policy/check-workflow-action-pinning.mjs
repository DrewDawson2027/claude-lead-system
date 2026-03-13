#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const wfDir = resolve(root, '.github/workflows');
const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml'));

// First-party Anthropic actions are allowed to use official tags (e.g. @beta)
// without SHA pinning. SHA-pinning first-party actions would break on every
// Anthropic release and provides minimal supply-chain benefit for the repo owner.
const ANTHROPIC_ACTION_PREFIX = 'anthropics/';

const unpinned = [];
for (const f of files) {
  const txt = readFileSync(resolve(wfDir, f), 'utf8');
  const lines = txt.split('\n');
  lines.forEach((line, idx) => {
    const m = line.match(/uses:\s*([^\s#]+)/);
    if (!m) return;
    const ref = m[1];
    // Allow first-party Anthropic actions to use their official tag refs.
    if (ref.startsWith(ANTHROPIC_ACTION_PREFIX)) return;
    const at = ref.lastIndexOf('@');
    if (at < 0) {
      unpinned.push(`${f}:${idx + 1} missing @ref -> ${ref}`);
      return;
    }
    const pin = ref.slice(at + 1);
    if (!/^[a-f0-9]{40}$/.test(pin)) {
      unpinned.push(`${f}:${idx + 1} not SHA-pinned -> ${ref}`);
    }
  });
}

if (unpinned.length) {
  console.error('workflow pinning check failed:');
  for (const u of unpinned) console.error(`  - ${u}`);
  process.exit(1);
}

console.log(`workflow pinning check passed (${files.length} workflows)`);
