import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const mergeScript = join(repoRoot, 'bin', 'merge-settings.mjs');
const fullTemplate = readFileSync(join(repoRoot, 'templates', 'settings.full.json'), 'utf-8');
const liteTemplate = readFileSync(join(repoRoot, 'templates', 'settings.local.json'), 'utf-8');

test('merge-settings preserves existing hooks while wiring the blessed coordinator path', () => {
  const home = mkdtempSync(join(tmpdir(), 'merge-settings-'));
  const claudeDir = join(home, '.claude');
  const sidecarDir = join(claudeDir, 'lead-sidecar');
  mkdirSync(join(sidecarDir, 'templates'), { recursive: true });
  writeFileSync(join(sidecarDir, 'templates', 'settings.full.json'), fullTemplate);
  writeFileSync(join(sidecarDir, 'templates', 'settings.local.json'), liteTemplate);

  const settingsPath = join(claudeDir, 'settings.local.json');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        permissions: {
          allow: ['Read'],
          deny: ['DangerousThing'],
        },
        hooks: {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: '~/.claude/hooks/custom-preflight.sh',
                  timeout: 250,
                },
              ],
            },
          ],
        },
        mcpServers: {
          coordinator: {
            command: 'node',
            args: ['/tmp/old-coordinator.js'],
            transport: 'stdio',
          },
        },
      },
      null,
      2,
    ),
  );

  execFileSync(process.execPath, [mergeScript, '--mode', 'full'], {
    env: { ...process.env, HOME: home },
    stdio: 'pipe',
  });

  const merged = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  const allow = new Set(merged.permissions.allow || []);
  const preToolUse = merged.hooks?.PreToolUse || [];
  const wildcardHooks = preToolUse.find((entry) => entry.matcher === '*')?.hooks || [];
  const taskHooks = preToolUse.find((entry) => entry.matcher === 'Task')?.hooks || [];

  assert.equal(allow.has('Read'), true);
  assert.equal(allow.has('Grep'), true);
  assert.equal(allow.has('Glob'), true);
  assert.equal(allow.has('AskUserQuestion'), true);
  assert.equal(allow.has('mcp__coordinator__coord_boot_snapshot'), true);
  assert.equal(allow.has('mcp__coordinator__coord_team_status_compact'), true);
  assert.equal(allow.has('mcp__coordinator__coord_sidecar_status'), true);
  assert.deepEqual(merged.permissions.deny, ['DangerousThing']);

  assert.equal(
    wildcardHooks.some((hook) => hook.command === '~/.claude/hooks/custom-preflight.sh'),
    true,
  );
  assert.equal(
    wildcardHooks.some((hook) => String(hook.command || '').includes('check-inbox.sh')),
    true,
  );
  assert.equal(
    taskHooks.some((hook) => String(hook.command || '').includes('token-guard.py')),
    true,
  );

  assert.equal(merged.mcpServers.coordinator.command, 'node');
  assert.deepEqual(merged.mcpServers.coordinator.args, [join(home, '.claude', 'mcp-coordinator', 'index.js')]);
  assert.equal(merged.mcpServers.coordinator.transport, 'stdio');
});
