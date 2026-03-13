/**
 * Phase 3 gap parity tests.
 *
 * Gap 1: Push Message Delivery — inbox fallback (no tmux), summary field
 *   in inbox, broadcast reaches all active sessions.
 *
 * Gap 5: Instant Idle Detection — reduced thresholds (30s/60s), exit trap
 *   in worker script, idle detector spawned when leadPaneId + sessionId known.
 *
 * Gap 3: Peer-to-Peer DMs — coord_send_protocol all 3 types written to inbox
 *   with correct content, invalid type rejected, discover_peers output format.
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
import { __test__ } from '../index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-p3-'));
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

async function loadForTest(home, envOverrides = {}) {
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
  delete process.env.TMUX; // no tmux push in inbox-fallback tests
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  const mod = await import(`../index.js?p3=${Date.now()}-${Math.random()}`);
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

/** Read all JSONL lines from an inbox file */
function readInbox(inboxDir, sessionId) {
  const file = join(inboxDir, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ─── Gap 1: Push Message Delivery ────────────────────────────────────────────

test('Gap 1: handleSendMessage writes to inbox file when no tmux (fallback path)', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Create target session file so send doesn't need wake
    writeFileSync(join(home, '.claude', 'terminals', 'session-targ5678.json'), JSON.stringify({
      session: 'targ5678', status: 'active', last_active: new Date().toISOString(),
    }));
    const result = api.handleToolCall('coord_send_message', {
      from: 'lead',
      to: 'targ5678',
      content: 'hello worker',
    });
    assert.match(textOf(result), /Message sent/i, 'send_message must confirm delivery');
    const msgs = readInbox(inbox, 'targ5678');
    assert.equal(msgs.length, 1, 'exactly one message must be in inbox');
    assert.equal(msgs[0].from, 'lead');
    assert.equal(msgs[0].content, 'hello worker');
  } finally {
    restore();
  }
});

test('Gap 1: handleSendMessage stores summary field in inbox entry', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(home, '.claude', 'terminals', 'session-sum05678.json'), JSON.stringify({
      session: 'sum05678', status: 'active', last_active: new Date().toISOString(),
    }));
    api.handleToolCall('coord_send_message', {
      from: 'worker-1',
      to: 'sum05678',
      content: 'I finished the refactor of the auth module and tests pass',
      summary: 'auth refactor done',
    });
    const msgs = readInbox(inbox, 'sum05678');
    assert.equal(msgs.length, 1);
    assert.ok(msgs[0].summary, 'inbox entry must contain the summary field');
    assert.equal(msgs[0].summary, 'auth refactor done');
  } finally {
    restore();
  }
});

test('Gap 1: handleBroadcast reaches all active sessions', async () => {
  const { home, inbox, terminals } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    // Create two active sessions
    const now = new Date().toISOString();
    writeFileSync(join(terminals, 'session-brd01234.json'), JSON.stringify({
      session: 'brd01234', status: 'active', last_active: now,
    }));
    writeFileSync(join(terminals, 'session-brd05678.json'), JSON.stringify({
      session: 'brd05678', status: 'active', last_active: now,
    }));
    const result = api.handleToolCall('coord_broadcast', {
      from: 'lead',
      content: 'all hands meeting',
    });
    const txt = textOf(result);
    assert.match(txt, /Broadcast sent to 2 session/, 'broadcast must reach both sessions');
    // Both inboxes should have the message
    const msgs1 = readInbox(inbox, 'brd01234');
    const msgs2 = readInbox(inbox, 'brd05678');
    assert.equal(msgs1.length, 1, 'session 1 inbox must have message');
    assert.equal(msgs2.length, 1, 'session 2 inbox must have message');
    assert.match(msgs1[0].content, /BROADCAST/, 'message must be prefixed with [BROADCAST]');
  } finally {
    restore();
  }
});

test('Gap 1: handleBroadcast returns zero-sessions message when no active sessions', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_broadcast', {
      from: 'lead',
      content: 'hello everyone',
    });
    assert.match(textOf(result), /No active sessions/i);
  } finally {
    restore();
  }
});

// ─── Gap 5: Instant Idle Detection ───────────────────────────────────────────

test('Gap 5: SESSION_ACTIVE_SECONDS is 30 (reduced from 180)', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    // 25 seconds ago = active (under 30s threshold)
    const twentyFiveSecAgo = new Date(Date.now() - 25 * 1000).toISOString();
    assert.equal(
      api.getSessionStatus({ last_active: twentyFiveSecAgo }),
      'active',
      '25s ago must be active (threshold is 30s)',
    );
    // 35 seconds ago = idle (over 30s threshold)
    const thirtyFiveSecAgo = new Date(Date.now() - 35 * 1000).toISOString();
    assert.equal(
      api.getSessionStatus({ last_active: thirtyFiveSecAgo }),
      'idle',
      '35s ago must be idle (threshold is 30s)',
    );
  } finally {
    restore();
  }
});

test('Gap 5: SESSION_IDLE_SECONDS is 60 (reduced from 600)', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    // 55 seconds ago = idle (under 60s threshold)
    const fiftyFiveSecAgo = new Date(Date.now() - 55 * 1000).toISOString();
    assert.equal(
      api.getSessionStatus({ last_active: fiftyFiveSecAgo }),
      'idle',
      '55s ago must be idle (threshold is 60s)',
    );
    // 65 seconds ago = stale (over 60s threshold)
    const sixtyFiveSecAgo = new Date(Date.now() - 65 * 1000).toISOString();
    assert.equal(
      api.getSessionStatus({ last_active: sixtyFiveSecAgo }),
      'stale',
      '65s ago must be stale (threshold is 60s)',
    );
  } finally {
    restore();
  }
});

test('Gap 5: buildInteractiveWorkerScript contains EXIT trap for instant completion notification', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_TRAP',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
  });
  assert.match(cmd, /trap '.*' EXIT/, 'worker script must have EXIT trap for instant completion');
  assert.match(cmd, /status.*completed/, 'trap must write completed status to done file');
  assert.match(cmd, /rm -f/, 'trap must clean up PID file on exit');
});

test('Gap 5: EXIT trap notifies lead via inbox delivery when leadSessionId is provided', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_TRAP2',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    leadPaneId: '%4',
    leadSessionId: 'lead5678',
    sessionId: 'aaaabbbb-cccc-dddd-eeee-000011112222',
  });
  // Inbox delivery replaces tmux send-keys — avoids injecting raw text into lead terminal
  assert.match(cmd, /COMPLETED.*W_TRAP2/i, 'trap must include COMPLETED notification');
  assert.match(cmd, /CLAUDE_LEAD_SESSION_ID/, 'trap must use CLAUDE_LEAD_SESSION_ID for inbox path');
});

test('Gap 5: idle detector subprocess is added when leadPaneId and sessionId are both known', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_IDLE',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    leadPaneId: '%4',
    leadSessionId: 'lead5678',
    sessionId: 'aaaabbbb-cccc-dddd-eeee-000011112222',
  });
  assert.match(cmd, /IDLE_SENT/, 'idle detector must use IDLE_SENT flag to avoid repeat notifications');
  assert.match(cmd, /sleep 1/, 'idle detector must poll on a 1-second interval');
  assert.match(cmd, /-gt 30/, 'idle detector must wait 30 seconds before notifying');
  assert.match(cmd, /\[IDLE\]/, 'idle detector must send [IDLE] notification to lead');
  assert.match(cmd, /_IDLE_PID=\$!/, 'idle detector must track its background PID');
});

test('Gap 5: idle detector is absent when leadPaneId is missing', () => {
  const cmd = __test__.buildInteractiveWorkerScript({
    taskId: 'W_NOIDLEDET',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    permissionMode: 'acceptEdits',
    platformName: 'linux',
    // no leadPaneId
    sessionId: 'aaaabbbb-cccc-dddd-eeee-000011112222',
  });
  assert.doesNotMatch(cmd, /IDLE_SENT/, 'no idle detector without a lead pane to notify');
});

// ─── Gap 3: Peer-to-Peer DMs ─────────────────────────────────────────────────

test('Gap 3: coord_send_protocol shutdown_request writes [SHUTDOWN_REQUEST] to target inbox', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(home, '.claude', 'terminals', 'session-peer5678.json'), JSON.stringify({ session: 'peer5678', status: 'active', last_active: new Date().toISOString() }));
    const result = api.handleToolCall('coord_send_protocol', {
      type: 'shutdown_request',
      to: 'peer5678',
      from: 'lead',
    });
    const txt = textOf(result);
    assert.match(txt, /Protocol message sent/i, 'must confirm protocol message sent');
    assert.match(txt, /shutdown_request/, 'must mention the protocol type');
    const msgs = readInbox(inbox, 'peer5678');
    assert.equal(msgs.length, 1, 'inbox must have one entry');
    assert.match(msgs[0].content, /\[SHUTDOWN_REQUEST\]/, 'content must be tagged [SHUTDOWN_REQUEST]');
    assert.equal(msgs[0].priority, 'urgent', 'protocol messages must be marked urgent');
    assert.ok(msgs[0].request_id, 'inbox entry must include request_id');
  } finally {
    restore();
  }
});

test('Gap 3: coord_send_protocol shutdown_response approved=true writes SHUTDOWN_RESPONSE approved=true', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(home, '.claude', 'terminals', 'session-lead5678.json'), JSON.stringify({ session: 'lead5678', status: 'active', last_active: new Date().toISOString() }));
    api.handleToolCall('coord_send_protocol', {
      type: 'shutdown_response',
      to: 'lead5678',
      from: 'worker',
      request_id: 'abc12345',
      approve: true,
    });
    const msgs = readInbox(inbox, 'lead5678');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /\[SHUTDOWN_RESPONSE\]/);
    assert.match(msgs[0].content, /approved=true/);
    assert.equal(msgs[0].request_id, 'abc12345', 'must echo back the original request_id');
  } finally {
    restore();
  }
});

test('Gap 3: coord_send_protocol shutdown_response approve=false writes approved=false', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(home, '.claude', 'terminals', 'session-lead5678.json'), JSON.stringify({ session: 'lead5678', status: 'active', last_active: new Date().toISOString() }));
    api.handleToolCall('coord_send_protocol', {
      type: 'shutdown_response',
      to: 'lead5678',
      from: 'worker',
      request_id: 'def67890',
      approve: false,
    });
    const msgs = readInbox(inbox, 'lead5678');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /approved=false/);
  } finally {
    restore();
  }
});

test('Gap 3: coord_send_protocol plan_approval_response approve=true writes [APPROVED]', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(home, '.claude', 'terminals', 'session-work5678.json'), JSON.stringify({ session: 'work5678', status: 'active', last_active: new Date().toISOString() }));
    api.handleToolCall('coord_send_protocol', {
      type: 'plan_approval_response',
      to: 'work5678',
      from: 'lead',
      request_id: 'plan1234',
      approve: true,
      content: 'looks good, proceed',
    });
    const msgs = readInbox(inbox, 'work5678');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /\[APPROVED\]/, 'approved plan must be tagged [APPROVED]');
    assert.match(msgs[0].content, /looks good/, 'feedback must be included in content');
  } finally {
    restore();
  }
});

test('Gap 3: coord_send_protocol plan_approval_response approve=false writes [REVISION]', async () => {
  const { home, inbox } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    writeFileSync(join(home, '.claude', 'terminals', 'session-work5678.json'), JSON.stringify({ session: 'work5678', status: 'active', last_active: new Date().toISOString() }));
    api.handleToolCall('coord_send_protocol', {
      type: 'plan_approval_response',
      to: 'work5678',
      from: 'lead',
      request_id: 'plan5678',
      approve: false,
      content: 'need more test coverage',
    });
    const msgs = readInbox(inbox, 'work5678');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /\[REVISION\]/, 'rejected plan must be tagged [REVISION]');
    assert.match(msgs[0].content, /test coverage/, 'revision feedback must be included');
  } finally {
    restore();
  }
});

test('Gap 3: coord_send_protocol rejects invalid type', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_send_protocol', {
      type: 'arbitrary_hack',
      to: 'peer5678',
    });
    assert.match(textOf(result), /Invalid protocol type/i);
  } finally {
    restore();
  }
});

test('Gap 3: coord_send_protocol requires recipient or to', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadForTest(home);
  try {
    api.ensureDirsOnce();
    const result = api.handleToolCall('coord_send_protocol', {
      type: 'shutdown_request',
      from: 'lead',
      // no 'to' or 'recipient'
    });
    assert.match(textOf(result), /recipient.*to|to.*recipient/i);
  } finally {
    restore();
  }
});
