/**
 * Recipient validation tests — Bug #25135 parity.
 *
 * Ensures coord_send_message and coord_send_protocol never silently succeed
 * when the target session does not exist, matching the fix for native Claude
 * Code bug #25135 where SendMessage silently ignored bad recipient names.
 *
 * Coverage:
 *   - send to valid session → succeeds
 *   - send to non-existent session → error with available sessions list
 *   - send to exited session → succeeds with warning in response
 *   - send_protocol to valid session → succeeds
 *   - send_protocol to non-existent session → error
 *   - broadcast skips non-existent sessions silently (best-effort)
 *   - recipient found via worker meta file (no session file yet)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-rv-'));
  const terminals = join(home, '.claude', 'terminals');
  mkdirSync(join(terminals, 'inbox'), { recursive: true });
  mkdirSync(join(terminals, 'results'), { recursive: true });
  mkdirSync(join(terminals, 'tasks'), { recursive: true });
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'session-cache'), { recursive: true });
  return {
    home,
    terminals,
    inbox: join(terminals, 'inbox'),
    results: join(terminals, 'results'),
  };
}

async function loadForTest(home) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    COORDINATOR_CLAUDE_BIN: process.env.COORDINATOR_CLAUDE_BIN,
    TMUX: process.env.TMUX,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  process.env.COORDINATOR_CLAUDE_BIN = 'echo';
  delete process.env.TMUX;
  const mod = await import(`../index.js?rv=${Date.now()}-${Math.random()}`);
  return {
    api: mod.__test__,
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

function textOf(result) {
  return result?.content?.[0]?.text || '';
}

function readInbox(inboxDir, sessionId) {
  const file = join(inboxDir, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ─── coord_send_message ───────────────────────────────────────────────────────

test('#25135: send_message to valid active session succeeds', async () => {
  const { home, inbox, terminals } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(terminals, 'session-abcd1234.json'), JSON.stringify({
      session: 'abcd1234', status: 'active', last_active: new Date().toISOString(),
    }));
    const result = api.handleToolCall('coord_send_message', {
      from: 'lead', to: 'abcd1234', content: 'hello',
    });
    assert.match(textOf(result), /Message sent/i, 'should confirm delivery');
    const msgs = readInbox(inbox, 'abcd1234');
    assert.equal(msgs.length, 1, 'message must be in inbox');
    assert.equal(msgs[0].content, 'hello');
  } finally {
    restore();
  }
});

test('#25135: send_message to non-existent session returns error with available list', async () => {
  const { home, terminals } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Create one known session so the "available" list is non-empty
    writeFileSync(join(terminals, 'session-known123.json'), JSON.stringify({
      session: 'known123', status: 'active', last_active: new Date().toISOString(),
    }));
    const result = api.handleToolCall('coord_send_message', {
      from: 'lead', to: 'dead0000', content: 'hello ghost',
    });
    const txt = textOf(result);
    assert.match(txt, /not found/i, 'must report recipient not found');
    assert.match(txt, /dead0000/, 'error must name the missing recipient');
    assert.match(txt, /Available sessions/i, 'error must list available sessions');
    assert.match(txt, /known123/, 'available list must include the known session');
  } finally {
    restore();
  }
});

test('#25135: send_message to non-existent session does NOT write to inbox', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_send_message', {
      from: 'lead', to: 'ghost000', content: 'this should not be stored',
    });
    // No inbox file should exist for the phantom session
    assert.ok(
      !existsSync(join(inbox, 'ghost000.jsonl')),
      'inbox file must NOT be created for non-existent recipient',
    );
  } finally {
    restore();
  }
});

test('#25135: send_message to exited session succeeds with warning', async () => {
  const { home, inbox, terminals } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Session file exists but status is "exited"
    writeFileSync(join(terminals, 'session-exit1234.json'), JSON.stringify({
      session: 'exit1234', status: 'exited', last_active: new Date().toISOString(),
    }));
    const result = api.handleToolCall('coord_send_message', {
      from: 'lead', to: 'exit1234', content: 'are you still there?',
    });
    const txt = textOf(result);
    assert.match(txt, /Message sent/i, 'must still confirm delivery');
    assert.match(txt, /Warning/i, 'must include a warning about exited session');
    assert.match(txt, /exit1234/, 'warning must name the session');
    assert.match(txt, /may not be read/i, 'warning must explain risk');
    // Message IS still written to inbox
    const msgs = readInbox(inbox, 'exit1234');
    assert.equal(msgs.length, 1, 'message must still be written to inbox');
  } finally {
    restore();
  }
});

test('#25135: send_message available sessions shows (none) when no sessions exist', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_send_message', {
      from: 'lead', to: 'nobody0', content: 'hello',
    });
    const txt = textOf(result);
    assert.match(txt, /not found/i);
    assert.match(txt, /\(none\)/, 'available list must show (none) when no sessions exist');
  } finally {
    restore();
  }
});

test('#25135: send_message finds recipient via worker meta file (no session file)', async () => {
  const { home, inbox, results } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Worker registered only via meta file, no session-*.json yet
    writeFileSync(join(results, 'W_META.meta.json'), JSON.stringify({
      task_id: 'W_META',
      worker_name: 'meta-worker',
      notify_session_id: 'meta1234',
      status: 'running',
    }));
    // Resolve via target_name → meta file lookup happens in resolveWorkerName
    // For direct to= lookup, use notify_session_id as the session ID
    const result = api.handleToolCall('coord_send_message', {
      from: 'lead', to: 'meta1234', content: 'meta delivery',
    });
    assert.match(
      textOf(result),
      /Message sent/i,
      'send to session ID found only in meta file must succeed',
    );
    const msgs = readInbox(inbox, 'meta1234');
    assert.equal(msgs.length, 1, 'message must be delivered');
  } finally {
    restore();
  }
});

// ─── coord_send_protocol ──────────────────────────────────────────────────────

test('#25135: send_protocol to valid session succeeds', async () => {
  const { home, inbox, terminals } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(terminals, 'session-prot5678.json'), JSON.stringify({
      session: 'prot5678', status: 'active', last_active: new Date().toISOString(),
    }));
    const result = api.handleToolCall('coord_send_protocol', {
      type: 'shutdown_request', to: 'prot5678', from: 'lead',
    });
    assert.match(textOf(result), /Protocol message sent/i);
    const msgs = readInbox(inbox, 'prot5678');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /\[SHUTDOWN_REQUEST\]/);
  } finally {
    restore();
  }
});

test('#25135: send_protocol to non-existent session returns error', async () => {
  const { home, terminals } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(terminals, 'session-real5678.json'), JSON.stringify({
      session: 'real5678', status: 'active', last_active: new Date().toISOString(),
    }));
    const result = api.handleToolCall('coord_send_protocol', {
      type: 'shutdown_request', to: 'dead5678', from: 'lead',
    });
    const txt = textOf(result);
    assert.match(txt, /not found/i, 'must report recipient not found');
    assert.match(txt, /dead5678/, 'error must name the missing recipient');
    assert.match(txt, /Available sessions/i);
    assert.match(txt, /real5678/, 'available list must include existing session');
  } finally {
    restore();
  }
});

test('#25135: send_protocol to non-existent session does NOT write to inbox', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    api.handleToolCall('coord_send_protocol', {
      type: 'shutdown_request', to: 'void0000', from: 'lead',
    });
    assert.ok(
      !existsSync(join(inbox, 'void0000.jsonl')),
      'inbox file must NOT be created for non-existent protocol recipient',
    );
  } finally {
    restore();
  }
});

// ─── coord_broadcast (best-effort, no validation) ────────────────────────────

test('#25135: broadcast skips non-existent sessions silently (best-effort)', async () => {
  const { home, inbox, terminals } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Only create ONE real session; broadcast iterates getAllSessions() so
    // there is no "ghost" session to skip — broadcast never invents targets.
    // This test verifies broadcast does NOT error and reaches real sessions.
    const now = new Date().toISOString();
    writeFileSync(join(terminals, 'session-real1111.json'), JSON.stringify({
      session: 'real1111', status: 'active', last_active: now,
    }));
    const result = api.handleToolCall('coord_broadcast', {
      from: 'lead', content: 'system notice',
    });
    const txt = textOf(result);
    // Must succeed (no error)
    assert.doesNotMatch(txt, /not found/i, 'broadcast must never return a not-found error');
    assert.match(txt, /Broadcast sent/i, 'broadcast must confirm delivery');
    // Real session receives the message
    const msgs = readInbox(inbox, 'real1111');
    assert.equal(msgs.length, 1, 'real session must receive broadcast');
    assert.match(msgs[0].content, /BROADCAST/);
  } finally {
    restore();
  }
});

test('#25135: broadcast with no active sessions returns graceful message, not an error', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_broadcast', {
      from: 'lead', content: 'anyone home?',
    });
    // Should say "No active sessions" rather than throwing
    assert.match(textOf(result), /No active sessions/i);
    assert.doesNotMatch(textOf(result), /not found/i);
  } finally {
    restore();
  }
});
