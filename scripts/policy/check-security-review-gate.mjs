#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const checklist = resolve(process.cwd(), 'docs/SECURITY_REVIEW_CHECKLIST.md');
const src = readFileSync(checklist, 'utf8');

const unchecked = src.split('\n').filter((l) => /^\s*-\s*\[\s\]/.test(l));
if (unchecked.length) {
  console.error('security review gate failed: unchecked items remain in docs/SECURITY_REVIEW_CHECKLIST.md');
  unchecked.slice(0, 20).forEach((l) => console.error(`  ${l.trim()}`));
  process.exit(1);
}

console.log('security review gate passed');
