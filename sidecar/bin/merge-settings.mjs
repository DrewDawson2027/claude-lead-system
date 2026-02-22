#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function parseArgs(argv) {
  const out = { mode: 'lite', write: true, verbose: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode' && argv[i + 1]) out.mode = argv[++i];
    else if (a === '--print') out.write = false;
    else if (a === '--quiet') out.verbose = false;
  }
  if (!['lite', 'hybrid', 'full'].includes(out.mode)) out.mode = 'lite';
  return out;
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function mergeAllow(existing, extras) {
  const current = Array.isArray(existing) ? existing : [];
  return uniq([...current, ...extras]);
}

function mergeHooks(existingHooks = {}, fullTemplateHooks = {}, mode = 'lite') {
  const out = { ...(existingHooks || {}) };
  if (mode === 'lite') return out;

  const copyHook = (hookName) => {
    if (fullTemplateHooks?.[hookName]) out[hookName] = fullTemplateHooks[hookName];
  };

  if (mode === 'hybrid') {
    copyHook('SessionStart');
    copyHook('SessionEnd');
    copyHook('TeammateIdle');
    copyHook('TaskCompleted');
    // Minimal usefulness hooks for sidecar/live UX.
    copyHook('PreToolUse');
    copyHook('PostToolUse');
    return out;
  }

  // full mode = full template hooks override into existing
  for (const [k, v] of Object.entries(fullTemplateHooks || {})) out[k] = v;
  return out;
}

function main() {
  const { mode, write, verbose } = parseArgs(process.argv.slice(2));
  const home = process.env.HOME || homedir();
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
  out.permissions.allow = mergeAllow(out.permissions.allow, liteTemplate.permissions?.allow || []);
  if (!Array.isArray(out.permissions.deny)) out.permissions.deny = Array.isArray(existing.permissions?.deny) ? existing.permissions.deny : [];

  out.mcpServers = out.mcpServers || {};
  out.mcpServers.coordinator = {
    command: 'node',
    args: [join(home, '.claude', 'mcp-coordinator', 'index.js')],
  };

  out.hooks = mergeHooks(out.hooks || {}, fullTemplate.hooks || {}, mode);

  // Preserve common top-level defaults if missing from older files.
  if (!out.model && fullTemplate.model) out.model = fullTemplate.model;
  if (out.thinkingEnabled === undefined && fullTemplate.thinkingEnabled !== undefined) out.thinkingEnabled = fullTemplate.thinkingEnabled;

  if (!write) {
    process.stdout.write(JSON.stringify(out, null, 2));
    return;
  }

  if (existsSync(settingsPath)) {
    const backup = `${settingsPath}.backup.${Date.now()}`;
    copyFileSync(settingsPath, backup);
    if (verbose) console.log(`Backed up settings to ${backup}`);
  }

  writeFileSync(settingsPath, JSON.stringify(out, null, 2));
  if (verbose) console.log(`Merged settings.local.json (${mode} mode)`);
}

main();
