#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const canonical = 'claude-lead-system.tar.gz';
const files = [
  '.github/workflows/release-bundle.yml',
  '.github/workflows/supply-chain.yml',
  'README.md',
  'docs/RELEASE_CHECKLIST.md',
  'docs/REPRODUCIBILITY.md',
  'docs/TOKEN_MANAGEMENT_SIGNED_RELEASES.md',
  'docs/UPGRADE_GUIDE.md',
  'docs/ROLLBACK_PLAN.md',
  'docs/CLAIM_PROVENANCE.md',
  'scripts/release/verify-release.sh',
  'scripts/release/generate-manifest.sh',
  'scripts/release/build-installer-assets.sh',
];

const disallowedPatterns = [
  /claude-lead-system-\$\{TAG\}\.tar\.gz/g,
  /claude-lead-system-\*\.tar\.gz/g,
  /claude-lead-system-v[0-9]+\.[0-9]+\.[0-9]+(?:[-\w.]*)?\.tar\.gz/g,
  /claude-lead-system-\{tag\}\.tar\.gz/g,
  /claude-lead-system-<tag>\.tar\.gz/g,
];

let failures = 0;
for (const rel of files) {
  const p = resolve(root, rel);
  const txt = readFileSync(p, 'utf8');
  for (const rx of disallowedPatterns) {
    if (rx.test(txt)) {
      console.error(`artifact-contract: disallowed tarball naming in ${rel}: ${rx}`);
      failures += 1;
      break;
    }
  }
}

const releaseBundle = readFileSync(resolve(root, '.github/workflows/release-bundle.yml'), 'utf8');
if (!releaseBundle.includes(canonical)) {
  console.error(`artifact-contract: release-bundle workflow missing canonical ${canonical}`);
  failures += 1;
}

if (failures > 0) process.exit(1);
console.log(`artifact-contract check passed (canonical=${canonical})`);
