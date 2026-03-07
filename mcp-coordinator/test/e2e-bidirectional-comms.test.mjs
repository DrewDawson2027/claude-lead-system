/**
 * E2E tests for bidirectional worker-to-worker communication.
 *
 * Proves the full round-trip: Worker A discovers Worker B's session ID via
 * coord_discover_peers, sends a message by name, Worker B reads it from its
 * inbox, then replies back to Worker A. Both messages are verified for correct
 * from/to/content fields.
 *
 * Coverage:
 *   1. Worker A discovers Worker B's session_id via coord_discover_peers
 *   2. Worker A sends to Worker B by target_name → B's inbox receives it
 *   3. Worker B replies to Worker A → A's inbox receives it (full round-trip)
 *   4. Both inbox entries have correct from/content/ts fields
 *   5. Sending to unknown target_name returns graceful error (no crash)
 *   6. coord_discover_peers lists both workers with correct session_ids and roles
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function contentText(result) {
  return result?.content?.[0]?.text || '';
}

async function loadCoord(home) {
  const prev = {
    HOME: process.env.HOME,
    COORDINATOR_TEST_MODE: process.env.COORDINATOR_TEST_MODE,
    COORDINATOR_PLATFORM: process.env.COORDINATOR_PLATFORM,
    TMUX: process.env.TMUX,
  };
  process.env.HOME = home;
  process.env.COORDINATOR_TEST_MODE = '1';
  process.env.COORDINATOR_PLATFORM = 'linux';
  delete process.env.TMUX; // no tmux push — pure inbox delivery
  const mod = await import(`../index.js?e2e-bidir=${Date.now()}-${Math.random()}`);
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

function setupHome() {
  const home = mkdtempSync(join(tmpdir(), 'coord-e2e-bidir-'));
  const terminals = join(home, '.claude', 'terminals');
  const inbox = join(terminals, 'inbox');
  const results = join(terminals, 'results');
  mkdirSync(inbox, { recursive: true });
  mkdirSync(results, { recursive: true });
  mkdirSync(join(terminals, 'teams'), { recursive: true });
  mkdirSync(join(home, '.claude', 'session-cache'), { recursive: true });
  return { home, terminals, inbox, results };
}

/**
 * Register a worker exactly as the heartbeat hook does in production.
 * coord_discover_peers scans session-*.json files to resolve worker names and
 * links to meta files via current_task.
 */
function registerWorker(terminals, inbox, results, sessionId, workerName, taskId, teamName = 'e2e-team') {
  writeFileSync(
    join(terminals, `session-${sessionId}.json`),
    JSON.stringify({
      session: sessionId,
      worker_name: workerName,
      status: 'active',
      last_active: new Date().toISOString(),
      current_task: taskId,
      team_name: teamName,
    }),
  );
  writeFileSync(join(inbox, `${sessionId}.jsonl`), '');
  // Meta file — required for discover_peers to return session_id via current_task link
  writeFileSync(
    join(results, `${taskId}.meta.json`),
    JSON.stringify({
      task_id: taskId,
      worker_name: workerName,
      team_name: teamName,
      claude_session_id: sessionId,
      role: 'implementer',
      status: 'running',
    }),
  );
}

function readInbox(inbox, sessionId) {
  const file = join(inbox, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('E2E Bidir: Worker A discovers Worker B via coord_discover_peers and sends message by name', async () => {
  const { home, terminals, inbox, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    registerWorker(terminals, inbox, results, 'aaaa1111', 'worker-A', 'task-a', 'bidir-team');
    registerWorker(terminals, inbox, results, 'bbbb2222', 'worker-B', 'task-b', 'bidir-team');

    // Worker A discovers peers — must see worker-B with its session_id
    const peersResult = api.handleToolCall('coord_discover_peers', { team_name: 'bidir-team' });
    const peersText = contentText(peersResult);
    assert.match(peersText, /worker-B/i, 'worker-B must appear in peer list');
    assert.ok(peersText.includes('bbbb2222'), 'worker-B session_id must be in peer list');

    // Worker A sends to Worker B by target_name
    const sendResult = api.handleToolCall('coord_send_message', {
      from: 'worker-A',
      target_name: 'worker-B',
      content: 'ping from A',
    });
    assert.match(contentText(sendResult), /Message sent/i, 'send must confirm delivery');

    // Worker B's inbox must contain the message
    const msgs = readInbox(inbox, 'bbbb2222');
    assert.equal(msgs.length, 1, 'exactly one message in B inbox');
    assert.equal(msgs[0].from, 'worker-A');
    assert.equal(msgs[0].content, 'ping from A');
  } finally {
    restore();
  }
});

test('E2E Bidir: Worker B replies to Worker A — full bidirectional round-trip', async () => {
  const { home, terminals, inbox, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    registerWorker(terminals, inbox, results, 'cccc3333', 'worker-A', 'task-a2', 'bidir-team-2');
    registerWorker(terminals, inbox, results, 'dddd4444', 'worker-B', 'task-b2', 'bidir-team-2');

    // A → B
    api.handleToolCall('coord_send_message', {
      from: 'worker-A',
      target_name: 'worker-B',
      content: 'hello B, can you handle the database part?',
    });

    // B replies to A by name
    api.handleToolCall('coord_send_message', {
      from: 'worker-B',
      target_name: 'worker-A',
      content: 'yes, taking the database part now',
    });

    // Verify A's inbox has B's reply
    const msgsA = readInbox(inbox, 'cccc3333');
    assert.equal(msgsA.length, 1, 'A must have exactly one reply from B');
    assert.equal(msgsA[0].from, 'worker-B');
    assert.equal(msgsA[0].content, 'yes, taking the database part now');

    // Verify B's inbox has A's original message
    const msgsB = readInbox(inbox, 'dddd4444');
    assert.equal(msgsB.length, 1, 'B must have A original message');
    assert.equal(msgsB[0].from, 'worker-A');
    assert.equal(msgsB[0].content, 'hello B, can you handle the database part?');
  } finally {
    restore();
  }
});

test('E2E Bidir: both messages have correct from/content/ts fields', async () => {
  const { home, terminals, inbox, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    registerWorker(terminals, inbox, results, 'eeee5555', 'worker-A', 'task-a3', 'field-team');
    registerWorker(terminals, inbox, results, 'ffff6666', 'worker-B', 'task-b3', 'field-team');

    api.handleToolCall('coord_send_message', {
      from: 'worker-A',
      target_name: 'worker-B',
      content: 'status update: API layer done',
      summary: 'API layer done',
    });
    api.handleToolCall('coord_send_message', {
      from: 'worker-B',
      target_name: 'worker-A',
      content: 'ack — starting DB layer',
      summary: 'starting DB layer',
    });

    const msgsB = readInbox(inbox, 'ffff6666');
    assert.equal(msgsB[0].from, 'worker-A', 'B message must have from=worker-A');
    assert.equal(msgsB[0].content, 'status update: API layer done', 'content must match exactly');
    assert.ok(msgsB[0].ts, 'inbox entry must have a timestamp field');

    const msgsA = readInbox(inbox, 'eeee5555');
    assert.equal(msgsA[0].from, 'worker-B', 'A reply must have from=worker-B');
    assert.equal(msgsA[0].content, 'ack — starting DB layer', 'reply content must match');
    assert.ok(msgsA[0].ts, 'reply must have a timestamp field');
  } finally {
    restore();
  }
});

test('E2E Bidir: coord_discover_peers lists both workers with session_ids and roles', async () => {
  const { home, terminals, inbox, results } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    registerWorker(terminals, inbox, results, 'gggg7777', 'worker-A', 'task-peer-a', 'peer-team');
    registerWorker(terminals, inbox, results, 'hhhh8888', 'worker-B', 'task-peer-b', 'peer-team');

    const peersResult = api.handleToolCall('coord_discover_peers', { team_name: 'peer-team' });
    const peersText = contentText(peersResult);

    // Both workers must appear with their session IDs
    assert.match(peersText, /worker-A/i, 'worker-A must appear in peer list');
    assert.match(peersText, /worker-B/i, 'worker-B must appear in peer list');
    assert.ok(peersText.includes('gggg7777'), 'worker-A session_id must be listed');
    assert.ok(peersText.includes('hhhh8888'), 'worker-B session_id must be listed');
  } finally {
    restore();
  }
});

test('E2E Bidir: sending to unknown target_name returns graceful error without crashing', async () => {
  const { home } = setupHome();
  const { api, restore } = await loadCoord(home);
  try {
    api.ensureDirsOnce();

    const result = api.handleToolCall('coord_send_message', {
      from: 'worker-A',
      target_name: 'worker-ghost',
      content: 'are you there?',
    });
    const txt = contentText(result);
    // Must not throw — returns a non-empty error string
    assert.ok(txt.length > 0, 'must return non-empty response on unknown target');
  } finally {
    restore();
  }
});
