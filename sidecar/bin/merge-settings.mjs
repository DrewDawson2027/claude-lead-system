#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function parseArgs(argv) {
  const out = { mode: 'full', write: true, verbose: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode' && argv[i + 1]) out.mode = argv[++i];
    else if (a === '--print') out.write = false;
    else if (a === '--quiet') out.verbose = false;
  }
  if (!['lite', 'hybrid', 'full'].includes(out.mode)) out.mode = 'full';
  return out;
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function mergeAllow(existing, extras) {
  const current = Array.isArray(existing) ? existing : [];
  return uniq([...current, ...extras]);
}

function mergeDeny(existing, extras) {
  const current = Array.isArray(existing) ? existing : [];
  const additions = Array.isArray(extras) ? extras : [];
  return uniq([...current, ...additions]);
}

function normalizeHookEntry(entry = {}) {
  return {
    ...entry,
    matcher: entry.matcher || '*',
    hooks: Array.isArray(entry.hooks) ? entry.hooks.filter(Boolean).map((hook) => ({ ...hook })) : [],
  };
}

function hookIdentity(hook = {}) {
  return JSON.stringify({
    type: hook.type || 'command',
    command: hook.command || '',
    timeout: hook.timeout ?? null,
  });
}

function mergeHookEntries(existingEntries = [], templateEntries = []) {
  const out = Array.isArray(existingEntries)
    ? existingEntries.map((entry) => normalizeHookEntry(entry))
    : [];

  for (const templateEntryRaw of Array.isArray(templateEntries) ? templateEntries : []) {
    const templateEntry = normalizeHookEntry(templateEntryRaw);
    const existingIndex = out.findIndex((entry) => entry.matcher === templateEntry.matcher);
    if (existingIndex === -1) {
      out.push(templateEntry);
      continue;
    }

    const existingEntry = out[existingIndex];
    const seen = new Set(existingEntry.hooks.map((hook) => hookIdentity(hook)));
    for (const hook of templateEntry.hooks) {
      const id = hookIdentity(hook);
      if (seen.has(id)) continue;
      existingEntry.hooks.push(hook);
      seen.add(id);
    }
  }

  return out;
}

function mergeHookSections(existingHooks = {}, templateHooks = {}, sections = []) {
  const out = { ...(existingHooks || {}) };
  for (const section of sections) {
    if (!templateHooks?.[section]) continue;
    out[section] = mergeHookEntries(out[section], templateHooks[section]);
  }
  return out;
}

function mergeHooks(existingHooks = {}, fullTemplateHooks = {}, mode = 'lite') {
  const out = { ...(existingHooks || {}) };
  if (mode === 'lite') return out;

  if (mode === 'hybrid') {
    return mergeHookSections(out, fullTemplateHooks, [
      'SessionStart',
      'SessionEnd',
      'TeammateIdle',
      'TaskCompleted',
      'PreToolUse',
      'PostToolUse',
    ]);
  }

  return mergeHookSections(out, fullTemplateHooks, Object.keys(fullTemplateHooks || {}));
}

function main() {
  const { mode, write, verbose } = parseArgs(process.argv.slice(2));
  const home = process.env.HOME || homedir();
  const nodeBin = process.execPath || 'node';
  const claudeDir = join(home, '.claude');
  const sidecarDir = join(claudeDir, 'lead-sidecar');
  const settingsPath = join(claudeDir, 'settings.local.json');
  const liteTemplatePath = join(sidecarDir, 'templates', 'settings.local.json');
  const fullTemplatePath = join(sidecarDir, 'templates', 'settings.full.json');

  mkdirSync(claudeDir, { recursive: true });

  const existing = readJSON(settingsPath) || {};
  const liteTemplate = readJSON(liteTemplatePath) || {};
  const fullTemplate = readJSON(fullTemplatePath) || {};

  const out = { ...existing };
  out.permissions = out.permissions || {};
  const requiredAllow = mode === 'lite'
    ? liteTemplate.permissions?.allow || []
    : mergeAllow(liteTemplate.permissions?.allow || [], fullTemplate.permissions?.allow || []);
  out.permissions.allow = mergeAllow(out.permissions.allow, requiredAllow);
  out.permissions.deny = mergeDeny(existing.permissions?.deny, fullTemplate.permissions?.deny);

  out.mcpServers = out.mcpServers || {};
  const existingCoordinator = out.mcpServers.coordinator || {};
  out.mcpServers.coordinator = {
    ...existingCoordinator,
    command: nodeBin,
    args: [join(home, '.claude', 'mcp-coordinator', 'index.js')],
  };

  out.hooks = mergeHooks(out.hooks || {}, fullTemplate.hooks || {}, mode);

  // Preserve common top-level defaults if missing from older files.
  if (!out.model && fullTemplate.model) out.model = fullTemplate.model;
  if (out.thinkingEnabled === undefined && fullTemplate.thinkingEnabled !== undefined) out.thinkingEnabled = fullTemplate.thinkingEnabled;

  const nextJson = JSON.stringify(out, null, 2);

  if (!write) {
    process.stdout.write(nextJson);
    return;
  }

  const currentJson = existsSync(settingsPath)
    ? readFileSync(settingsPath, 'utf-8')
    : null;

  if (currentJson === nextJson) {
    if (verbose) console.log(`settings.local.json already up to date (${mode} mode)`);
    return;
  }

  if (existsSync(settingsPath)) {
    const backup = `${settingsPath}.backup.${Date.now()}`;
    copyFileSync(settingsPath, backup);
    if (verbose) console.log(`Backed up settings to ${backup}`);
  }

  writeFileSync(settingsPath, nextJson);
  if (verbose) console.log(`Merged settings.local.json (${mode} mode)`);
}

main();
