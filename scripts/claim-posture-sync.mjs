#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'docs', 'CLAIM_POSTURE_SOURCE.json');

const START_MARKER = '<!-- CLAIM_POSTURE:START -->';
const END_MARKER = '<!-- CLAIM_POSTURE:END -->';

function fail(msg) {
  console.error(`claim-posture-sync failed: ${msg}`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`could not parse ${path.relative(repoRoot, file)}: ${err.message}`);
  }
}

function assertNonEmptyArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${fieldName} must be a non-empty array`);
  }
}

function assertString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${fieldName} must be a non-empty string`);
  }
}

function assertSourceShape(source) {
  assertString(source.version, 'version');
  assertString(source.title, 'title');

  assertNonEmptyArray(source.taxonomy, 'taxonomy');
  for (const [idx, entry] of source.taxonomy.entries()) {
    if (!entry || typeof entry !== 'object') {
      fail(`taxonomy[${idx}] must be an object`);
    }
    assertString(entry.label, `taxonomy[${idx}].label`);
    assertString(entry.definition, `taxonomy[${idx}].definition`);
  }

  assertNonEmptyArray(source.parity_posture, 'parity_posture');
  assertNonEmptyArray(source.native_advantages, 'native_advantages');
  assertNonEmptyArray(source.lead_advantages, 'lead_advantages');
  assertNonEmptyArray(source.economics_posture, 'economics_posture');
  assertNonEmptyArray(source.release_blocker_posture, 'release_blocker_posture');

  const textArrays = [
    ['parity_posture', source.parity_posture],
    ['native_advantages', source.native_advantages],
    ['lead_advantages', source.lead_advantages],
    ['economics_posture', source.economics_posture],
    ['release_blocker_posture', source.release_blocker_posture]
  ];

  for (const [name, values] of textArrays) {
    for (const [idx, value] of values.entries()) {
      assertString(value, `${name}[${idx}]`);
    }
  }

  assertNonEmptyArray(source.economics_verdicts, 'economics_verdicts');
  const taxonomyLabels = new Set(source.taxonomy.map((entry) => entry.label));
  for (const [idx, verdict] of source.economics_verdicts.entries()) {
    if (!verdict || typeof verdict !== 'object') {
      fail(`economics_verdicts[${idx}] must be an object`);
    }
    assertString(verdict.claim, `economics_verdicts[${idx}].claim`);
    assertString(verdict.label, `economics_verdicts[${idx}].label`);
    assertString(verdict.scope, `economics_verdicts[${idx}].scope`);
    if (!taxonomyLabels.has(verdict.label)) {
      fail(
        `economics_verdicts[${idx}].label must match a taxonomy label (${Array.from(taxonomyLabels).join(', ')})`
      );
    }
  }

  assertNonEmptyArray(source.posture_sync_targets, 'posture_sync_targets');
  for (const [idx, target] of source.posture_sync_targets.entries()) {
    assertString(target, `posture_sync_targets[${idx}]`);
  }

  assertNonEmptyArray(source.forbidden_claim_patterns, 'forbidden_claim_patterns');
  for (const [idx, pattern] of source.forbidden_claim_patterns.entries()) {
    if (!pattern || typeof pattern !== 'object') {
      fail(`forbidden_claim_patterns[${idx}] must be an object`);
    }
    assertString(pattern.description, `forbidden_claim_patterns[${idx}].description`);
    assertString(pattern.pattern, `forbidden_claim_patterns[${idx}].pattern`);
  }
}

function toSentence(lines) {
  return lines.join(' ');
}

function renderVerdictSentence(verdicts) {
  return verdicts.map((entry) => `${entry.claim} = ${entry.label}`).join('; ');
}

function renderPostureBlock(source) {
  const labels = source.taxonomy.map((entry) => `\`${entry.label}\``).join(', ');

  return [
    START_MARKER,
    `- Canonical taxonomy: ${labels}`,
    `- Parity posture (canonical): ${toSentence(source.parity_posture)}`,
    `- Native advantages (canonical): ${toSentence(source.native_advantages)}`,
    `- Lead advantages (canonical): ${toSentence(source.lead_advantages)}`,
    `- Economics posture (canonical): ${toSentence(source.economics_posture)}`,
    `- Economics verdicts (canonical): ${renderVerdictSentence(source.economics_verdicts)}.`,
    `- Release blocker posture (canonical): ${toSentence(source.release_blocker_posture)}`,
    '- Canonical source: `docs/CLAIM_POSTURE_SOURCE.json`',
    '- Canonical parity/economics document: `docs/PARITY_ECONOMICS_POSTURE.md`',
    END_MARKER
  ].join('\n');
}

function renderCanonicalDoc(source, postureBlock) {
  const taxonomyRows = source.taxonomy
    .map((entry) => `| \`${entry.label}\` | ${entry.definition} |`)
    .join('\n');

  const parityItems = source.parity_posture.map((line) => `- ${line}`).join('\n');
  const nativeItems = source.native_advantages.map((line) => `- ${line}`).join('\n');
  const leadItems = source.lead_advantages.map((line) => `- ${line}`).join('\n');
  const economicsItems = source.economics_posture.map((line) => `- ${line}`).join('\n');
  const releaseBlockerItems = source.release_blocker_posture.map((line) => `- ${line}`).join('\n');
  const economicsVerdictRows = source.economics_verdicts
    .map((entry) => `| ${entry.claim} | \`${entry.label}\` | ${entry.scope} |`)
    .join('\n');

  const forbiddenItems = source.forbidden_claim_patterns
    .map((entry) => `- ${entry.description}: \`${entry.pattern}\``)
    .join('\n');

  const syncTargets = source.posture_sync_targets
    .map((target) => `- \`${target}\``)
    .join('\n');

  return [
    '# Parity, Economics, And Claim Posture (Canonical)',
    '',
    'Generated from `docs/CLAIM_POSTURE_SOURCE.json` by `scripts/claim-posture-sync.mjs`. Do not hand-edit this file.',
    '',
    `Version: \`${source.version}\``,
    '',
    '## Claim Taxonomy',
    '',
    '| Label | Definition |',
    '| --- | --- |',
    taxonomyRows,
    '',
    '## Parity Posture',
    '',
    parityItems,
    '',
    '## Native Advantages (Canonical)',
    '',
    nativeItems,
    '',
    '## Lead Advantages (Canonical)',
    '',
    leadItems,
    '',
    '## Economics Posture',
    '',
    economicsItems,
    '',
    '## Economics Verdicts (Canonical)',
    '',
    '| Claim | Label | Scope |',
    '| --- | --- | --- |',
    economicsVerdictRows,
    '',
    '## Release Blocker Posture',
    '',
    releaseBlockerItems,
    '',
    '## Posture Sync Targets',
    '',
    syncTargets,
    '',
    '## Required Shared Block',
    '',
    'The following block must appear verbatim in every sync target:',
    '',
    '```md',
    postureBlock,
    '```',
    '',
    '## Forbidden Assertion Patterns',
    '',
    forbiddenItems,
    ''
  ].join('\n');
}

function replaceBlock(content, expectedBlock) {
  const blockRegex = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`, 'm');
  if (!blockRegex.test(content)) {
    return null;
  }
  return content.replace(blockRegex, expectedBlock);
}

function checkForbiddenPatterns(source, targetRelPath, content) {
  const failures = [];
  for (const entry of source.forbidden_claim_patterns) {
    const regex = new RegExp(entry.pattern, 'i');
    if (regex.test(content)) {
      failures.push(`${targetRelPath}: forbidden claim pattern matched (${entry.description})`);
    }
  }
  return failures;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const checkMode = args.has('--check');

  const source = readJson(sourcePath);
  assertSourceShape(source);

  const expectedBlock = renderPostureBlock(source);
  const canonicalDocPath = path.join(repoRoot, 'docs', 'PARITY_ECONOMICS_POSTURE.md');
  const expectedCanonicalDoc = renderCanonicalDoc(source, expectedBlock);

  if (checkMode) {
    if (!fs.existsSync(canonicalDocPath)) {
      fail('docs/PARITY_ECONOMICS_POSTURE.md is missing');
    }

    const currentDoc = fs.readFileSync(canonicalDocPath, 'utf8');
    if (currentDoc !== expectedCanonicalDoc) {
      fail('docs/PARITY_ECONOMICS_POSTURE.md is out of sync; run node scripts/claim-posture-sync.mjs');
    }

    const errors = [];
    for (const relPath of source.posture_sync_targets) {
      const absPath = path.join(repoRoot, relPath);
      if (!fs.existsSync(absPath)) {
        errors.push(`${relPath}: required posture sync target is missing`);
        continue;
      }

      const content = fs.readFileSync(absPath, 'utf8');
      const updated = replaceBlock(content, expectedBlock);
      if (updated === null) {
        errors.push(`${relPath}: missing posture sync block markers`);
      } else if (updated !== content) {
        errors.push(`${relPath}: posture sync block drift detected`);
      }

      errors.push(...checkForbiddenPatterns(source, relPath, content));
    }

    if (errors.length > 0) {
      fail(errors.join('\n'));
    }

    console.log('claim-posture-sync check passed');
    return;
  }

  fs.writeFileSync(canonicalDocPath, expectedCanonicalDoc, 'utf8');

  for (const relPath of source.posture_sync_targets) {
    const absPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(absPath)) {
      fail(`${relPath}: posture sync target file is missing`);
    }

    const content = fs.readFileSync(absPath, 'utf8');
    const updated = replaceBlock(content, expectedBlock);
    if (updated === null) {
      fail(`${relPath}: missing posture sync block markers`);
    }

    if (updated !== content) {
      fs.writeFileSync(absPath, updated, 'utf8');
    }
  }

  console.log('claim-posture-sync write passed');
}

main();
