/**
 * HTTP middleware unit tests — tests pure utility modules directly (no live server):
 *   - audit.ts: SecurityAuditLog, RequestAuditLog
 *   - body.ts: bodyLimitForRoute, readBody
 *   - logger.ts: createLogger (text + json formats)
 *   - middleware.ts: isMutatingMethod, runRequestMiddleware
 *   - response.ts: createBaseHeaders, sendJson, sendError, sseBroadcast
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { SecurityAuditLog, RequestAuditLog } from '../server/http/audit.ts';
import { bodyLimitForRoute, readBody } from '../server/http/body.ts';
import { createLogger } from '../server/http/logger.ts';
import { isMutatingMethod, runRequestMiddleware } from '../server/middleware.ts';
import {
  createBaseHeaders,
  sendJson,
  sendError,
  sseBroadcast,
  sameOriginAllowed,
} from '../server/http/response.ts';

// ── SecurityAuditLog ─────────────────────────────────────────────────────────

test('SecurityAuditLog.log() appends entries and entries() returns them', () => {
  const log = new SecurityAuditLog();
  log.log({ type: 'auth_failure', ip: '1.2.3.4', path: '/secret' });
  log.log({ type: 'origin_reject', ip: '1.2.3.4', path: '/api' });
  const entries = log.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'auth_failure');
  assert.equal(entries[1].type, 'origin_reject');
  assert.ok(entries[0].ts, 'ts field should be set');
});

test('SecurityAuditLog.snapshot() returns by_type counts', () => {
  const log = new SecurityAuditLog();
  log.log({ type: 'auth_failure', ip: '1.1.1.1', path: '/a' });
  log.log({ type: 'auth_failure', ip: '1.1.1.1', path: '/b' });
  log.log({ type: 'rate_limit', ip: '1.1.1.1', path: '/c' });
  const snap = log.snapshot();
  assert.equal(snap.total, 3);
  assert.equal(snap.by_type.auth_failure, 2);
  assert.equal(snap.by_type.rate_limit, 1);
});

test('SecurityAuditLog — rate-limits logging at maxPerSec', () => {
  const log = new SecurityAuditLog({ maxPerSec: 3 });
  for (let i = 0; i < 10; i++) {
    log.log({ type: 'auth_failure', ip: '1.1.1.1', path: `/p${i}` });
  }
  const entries = log.entries();
  assert.ok(entries.length <= 3, `expected <= 3 entries, got ${entries.length}`);
});

test('SecurityAuditLog.entries(limit) respects limit argument', () => {
  const log = new SecurityAuditLog({ maxPerSec: 100 });
  for (let i = 0; i < 10; i++) {
    log.log({ type: 'csrf_failure', ip: '1.1.1.1', path: `/p${i}` });
  }
  const limited = log.entries(3);
  assert.equal(limited.length, 3);
});

// ── RequestAuditLog ───────────────────────────────────────────────────────────

test('RequestAuditLog.log() includes POST but ignores GET by default', () => {
  const log = new RequestAuditLog();
  log.log({ method: 'GET', path: '/health', status: 200, request_id: 'r1', ip: '127.0.0.1', duration_ms: 5 });
  log.log({ method: 'POST', path: '/dispatch', status: 200, request_id: 'r2', ip: '127.0.0.1', duration_ms: 10 });
  const entries = log.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].method, 'POST');
});

test('RequestAuditLog with auditAll=true includes GET requests', () => {
  const log = new RequestAuditLog({ auditAll: true });
  log.log({ method: 'GET', path: '/health', status: 200, request_id: 'r1', ip: '127.0.0.1', duration_ms: 5 });
  log.log({ method: 'POST', path: '/dispatch', status: 200, request_id: 'r2', ip: '127.0.0.1', duration_ms: 10 });
  const entries = log.entries();
  assert.equal(entries.length, 2);
});

test('RequestAuditLog.snapshot() returns by_method and by_status', () => {
  const log = new RequestAuditLog({ auditAll: true });
  log.log({ method: 'POST', path: '/a', status: 200, request_id: 'r1', ip: '127.0.0.1', duration_ms: 1 });
  log.log({ method: 'POST', path: '/b', status: 400, request_id: 'r2', ip: '127.0.0.1', duration_ms: 1 });
  log.log({ method: 'DELETE', path: '/c', status: 204, request_id: 'r3', ip: '127.0.0.1', duration_ms: 1 });
  const snap = log.snapshot();
  assert.equal(snap.by_method.POST, 2);
  assert.equal(snap.by_method.DELETE, 1);
  assert.equal(snap.by_status['2xx'], 2);
  assert.equal(snap.by_status['4xx'], 1);
});

// ── bodyLimitForRoute ─────────────────────────────────────────────────────────

test('bodyLimitForRoute returns 1024 for /native/probe', () => {
  assert.equal(bodyLimitForRoute('/native/probe'), 1024);
});

test('bodyLimitForRoute returns 65536 for /dispatch', () => {
  assert.equal(bodyLimitForRoute('/dispatch'), 65536);
});

test('bodyLimitForRoute returns 65536 for /teams/:name/actions/:action', () => {
  assert.equal(bodyLimitForRoute('/teams/alpha/actions/task'), 65536);
});

test('bodyLimitForRoute returns 4096 for /maintenance/ routes', () => {
  assert.equal(bodyLimitForRoute('/maintenance/run'), 4096);
});

test('bodyLimitForRoute returns default 256*1024 for unknown routes', () => {
  assert.equal(bodyLimitForRoute('/unknown-route'), 256 * 1024);
});

// ── readBody ──────────────────────────────────────────────────────────────────

function makeReq(jsonBody) {
  const em = new EventEmitter();
  process.nextTick(() => {
    if (jsonBody !== null) em.emit('data', Buffer.from(JSON.stringify(jsonBody)));
    em.emit('end');
  });
  return em;
}

function makeRawReq(rawStr) {
  const em = new EventEmitter();
  process.nextTick(() => {
    if (rawStr) em.emit('data', Buffer.from(rawStr));
    em.emit('end');
  });
  return em;
}

test('readBody — valid JSON is parsed', async () => {
  const req = makeReq({ foo: 'bar', n: 42 });
  const body = await readBody(req);
  assert.deepEqual(body, { foo: 'bar', n: 42 });
});

test('readBody — empty body returns {}', async () => {
  const em = new EventEmitter();
  process.nextTick(() => em.emit('end'));
  const body = await readBody(em);
  assert.deepEqual(body, {});
});

test('readBody — invalid JSON returns __parse_error: invalid_json', async () => {
  const req = makeRawReq('not json {{{');
  const body = await readBody(req);
  assert.equal(body.__parse_error, 'invalid_json');
});

test('readBody — oversized payload returns __parse_error: payload_too_large', async () => {
  const em = new EventEmitter();
  const bigChunk = Buffer.alloc(200);
  process.nextTick(() => {
    em.emit('data', bigChunk);
    em.emit('end');
  });
  // suppress the unhandled error from req.destroy() by adding an error listener
  em.destroy = () => { em.emit('error', new Error('destroyed')); };
  em.on('error', () => {});
  const body = await readBody(em, { limitBytes: 100 });
  assert.equal(body.__parse_error, 'payload_too_large');
});

// ── createLogger ──────────────────────────────────────────────────────────────

test('createLogger text format emits message to stdout (no crash)', () => {
  const log = createLogger({ format: 'text' });
  // Just verify no exception is thrown — output goes to console
  assert.doesNotThrow(() => {
    log.info('test info message', { key: 'value' });
    log.warn('test warn message');
  });
});

test('createLogger json format produces valid JSON lines', () => {
  const lines = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (data) => { lines.push(String(data)); return true; };
  try {
    const log = createLogger({ format: 'json' });
    log.info('hello world', { x: 1 });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.ok(lines.length > 0, 'expected at least one output line');
  const parsed = JSON.parse(lines[0].trim());
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'hello world');
  assert.ok(parsed.ts, 'ts field should be set');
  assert.equal(parsed.fields.x, 1);
});

test('createLogger request() logs HTTP request line', () => {
  const log = createLogger({ format: 'text' });
  assert.doesNotThrow(() => {
    log.request(
      { method: 'GET', url: '/health', socket: { remoteAddress: '127.0.0.1' } },
      200,
      Date.now() - 10,
    );
  });
});

// ── isMutatingMethod ──────────────────────────────────────────────────────────

test('isMutatingMethod — POST, PUT, PATCH, DELETE return true', () => {
  assert.equal(isMutatingMethod('POST'), true);
  assert.equal(isMutatingMethod('PUT'), true);
  assert.equal(isMutatingMethod('PATCH'), true);
  assert.equal(isMutatingMethod('DELETE'), true);
});

test('isMutatingMethod — GET, HEAD return false', () => {
  assert.equal(isMutatingMethod('GET'), false);
  assert.equal(isMutatingMethod('HEAD'), false);
  assert.equal(isMutatingMethod(undefined), false);
});

test('isMutatingMethod — is case-insensitive', () => {
  assert.equal(isMutatingMethod('post'), true);
  assert.equal(isMutatingMethod('get'), false);
});

// ── runRequestMiddleware ──────────────────────────────────────────────────────

function mockRes() {
  return { __headers: {}, setHeader(k, v) { this.__headers[k] = v; } };
}

function mockReq(method = 'GET', path = '/health') {
  return { method, url: path, socket: { remoteAddress: '127.0.0.1' }, headers: {} };
}

function makeConfig(overrides = {}) {
  return {
    rateLimitMax: 100,
    safeMode: false,
    requireSameOrigin: () => true,
    requireApiAuth: () => true,
    requireCsrf: () => true,
    rateLimiter: { check: () => ({ ok: true, remaining: 99 }) },
    replayProtector: { check: () => ({ ok: true }) },
    securityAuditLog: { log: () => {} },
    sendError: (res, status, code, msg) => { res.__error = { status, code }; },
    ...overrides,
  };
}

test('runRequestMiddleware — GET request returns "continue" without hitting auth', () => {
  const req = mockReq('GET', '/health');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/health');
  const config = makeConfig({ requireApiAuth: () => { throw new Error('should not be called'); } });
  const verdict = runRequestMiddleware(req, res, url, config);
  assert.equal(verdict, 'continue');
});

test('runRequestMiddleware — origin rejection returns "handled"', () => {
  const req = mockReq('GET', '/health');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/health');
  const config = makeConfig({ requireSameOrigin: () => false });
  const verdict = runRequestMiddleware(req, res, url, config);
  assert.equal(verdict, 'handled');
});

test('runRequestMiddleware — rate limit exceeded returns "handled" with 429', () => {
  const req = mockReq('POST', '/dispatch');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/dispatch');
  const config = makeConfig({
    rateLimiter: { check: () => ({ ok: false, retry_after_ms: 5000 }) },
  });
  const verdict = runRequestMiddleware(req, res, url, config);
  assert.equal(verdict, 'handled');
  assert.equal(res.__error.status, 429);
  assert.equal(res.__error.code, 'RATE_LIMITED');
});

test('runRequestMiddleware — auth failure returns "handled"', () => {
  const req = mockReq('POST', '/dispatch');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/dispatch');
  const config = makeConfig({ requireApiAuth: () => false });
  const verdict = runRequestMiddleware(req, res, url, config);
  assert.equal(verdict, 'handled');
});

test('runRequestMiddleware — safe mode blocks POST /dispatch', () => {
  const req = mockReq('POST', '/dispatch');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/dispatch');
  const config = makeConfig({ safeMode: true });
  const verdict = runRequestMiddleware(req, res, url, config);
  assert.equal(verdict, 'handled');
  assert.equal(res.__error.code, 'SAFE_MODE_ACTIVE');
  assert.equal(res.__error.status, 503);
});

test('runRequestMiddleware — safe mode allows POST /reports/comparison (not in blocked list)', () => {
  const req = mockReq('POST', '/reports/comparison');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/reports/comparison');
  const config = makeConfig({ safeMode: true });
  const verdict = runRequestMiddleware(req, res, url, config);
  // /reports/comparison is not in the safe mode blocked list
  assert.equal(verdict, 'continue');
});

test('runRequestMiddleware — safe mode blocks PATCH (non-POST mutation)', () => {
  const req = mockReq('PATCH', '/teams/alpha/interrupt-priorities');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/teams/alpha/interrupt-priorities');
  const config = makeConfig({ safeMode: true });
  const verdict = runRequestMiddleware(req, res, url, config);
  assert.equal(verdict, 'handled');
  assert.equal(res.__error.status, 503);
});

test('runRequestMiddleware — successful POST returns "continue"', () => {
  const req = mockReq('POST', '/checkpoints/create');
  const res = mockRes();
  const url = new URL('http://127.0.0.1/checkpoints/create');
  const config = makeConfig();
  const verdict = runRequestMiddleware(req, res, url, config);
  assert.equal(verdict, 'continue');
});

// ── createBaseHeaders + sameOriginAllowed ─────────────────────────────────────

test('createBaseHeaders includes required security headers', () => {
  const headers = createBaseHeaders(null, null, []);
  assert.ok(headers['Cache-Control'], 'Cache-Control missing');
  assert.ok(headers['X-Frame-Options'], 'X-Frame-Options missing');
  assert.ok(headers['X-Content-Type-Options'], 'X-Content-Type-Options missing');
  assert.ok(headers['Content-Security-Policy'], 'CSP missing');
});

test('createBaseHeaders adds CORS headers for same-origin request', () => {
  const req = { headers: { origin: 'http://127.0.0.1:3000' }, __requestId: 'abc' };
  const headers = createBaseHeaders(req, 'http://127.0.0.1:3000', []);
  assert.equal(headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:3000');
  assert.ok(headers['Access-Control-Allow-Headers']);
  assert.equal(headers['X-Request-Id'], 'abc');
});

test('createBaseHeaders omits CORS headers for cross-origin request', () => {
  const req = { headers: { origin: 'http://evil.example' } };
  const headers = createBaseHeaders(req, 'http://127.0.0.1:3000', []);
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
});

test('sameOriginAllowed — returns true when no origin header', () => {
  const req = { headers: {} };
  assert.equal(sameOriginAllowed(req, 'http://127.0.0.1:3000'), true);
});

test('sameOriginAllowed — returns true for matching allowedOrigin', () => {
  const req = { headers: { origin: 'http://127.0.0.1:3000' } };
  assert.equal(sameOriginAllowed(req, 'http://127.0.0.1:3000'), true);
});

test('sameOriginAllowed — returns false for cross-origin', () => {
  const req = { headers: { origin: 'http://attacker.example' } };
  assert.equal(sameOriginAllowed(req, 'http://127.0.0.1:3000'), false);
});

// ── sendJson + sendError ───────────────────────────────────────────────────────

function mockHttpRes() {
  const r = {
    __status: null,
    __headers: {},
    __body: null,
    writeHead(status, headers) { this.__status = status; this.__headers = headers; },
    end(body) { this.__body = body; },
  };
  return r;
}

test('sendJson writes correct status and Content-Type', () => {
  const res = mockHttpRes();
  sendJson(() => ({}), res, 200, { ok: true });
  assert.equal(res.__status, 200);
  assert.ok(res.__headers['Content-Type']?.includes('application/json'));
  assert.deepEqual(JSON.parse(res.__body), { ok: true });
});

test('sendError includes error_code and message in body', () => {
  const res = mockHttpRes();
  sendError(() => ({}), res, 400, 'VALIDATION_ERROR', 'bad input', null, { field: 'x' });
  assert.equal(res.__status, 400);
  const body = JSON.parse(res.__body);
  assert.equal(body.error_code, 'VALIDATION_ERROR');
  assert.equal(body.message, 'bad input');
  assert.deepEqual(body.details, { field: 'x' });
});

test('sendError includes request_id when present on req', () => {
  const res = mockHttpRes();
  const req = { __requestId: 'test-req-id' };
  sendError(() => ({}), res, 401, 'AUTH_FAIL', 'unauthorized', req);
  const body = JSON.parse(res.__body);
  assert.equal(body.request_id, 'test-req-id');
});

// ── sseBroadcast ──────────────────────────────────────────────────────────────

test('sseBroadcast sends event+data to all clients', () => {
  const received = [];
  const client1 = { write: (d) => received.push({ client: 1, data: d }) };
  const client2 = { write: (d) => received.push({ client: 2, data: d }) };
  const clients = new Set([client1, client2]);
  sseBroadcast(clients, 'update', { foo: 'bar' });
  assert.equal(received.length, 2);
  assert.ok(received[0].data.includes('event: update'));
  assert.ok(received[0].data.includes('"foo":"bar"'));
});

test('sseBroadcast handles client write errors gracefully', () => {
  const badClient = { write: () => { throw new Error('write failed'); } };
  const goodClient = { write: (d) => { goodClient.__received = d; } };
  const clients = new Set([badClient, goodClient]);
  assert.doesNotThrow(() => sseBroadcast(clients, 'ping', {}));
  assert.ok(goodClient.__received, 'good client should still receive the message');
});
