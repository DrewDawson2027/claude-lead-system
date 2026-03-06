#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8');

const unreleasedMatch = changelog.match(/## \[Unreleased\]([\s\S]*?)(?:\n## \[|$)/);
if (!unreleasedMatch) {
  console.error('changelog check failed: missing [Unreleased] section');
  process.exit(1);
}
const unreleased = unreleasedMatch[1];

function hasNonEmptySection(name) {
  const rx = new RegExp(`### ${name}([\\s\\S]*?)(?:\\n### |$)`);
  const m = unreleased.match(rx);
  if (!m) return false;
  return /(^|\n)-\s+\S/.test(m[1]);
}

if (!/### Breaking Changes/.test(unreleased)) {
  console.error('changelog check failed: missing "### Breaking Changes" under Unreleased');
  process.exit(1);
}
if (!/### Security/.test(unreleased)) {
  console.error('changelog check failed: missing "### Security" under Unreleased');
  process.exit(1);
}

if (!hasNonEmptySection('Breaking Changes') && !hasNonEmptySection('Security')) {
  console.error('changelog check failed: Unreleased must include at least one bullet in Breaking Changes or Security');
  process.exit(1);
}

console.log('changelog consistency check passed');
