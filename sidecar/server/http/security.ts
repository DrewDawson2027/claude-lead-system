import { sameOriginAllowed } from './response.js';
import type { SecurityAuditLog } from './audit.js';

export function requireApiAuth(sendJson: any, req: any, res: any, apiToken: string, allowedOrigin: string | null = null, allowedOrigins: string[] = [], auditLog?: SecurityAuditLog): boolean {
  if (process.env.LEAD_SIDECAR_REQUIRE_TOKEN !== '1') return true;
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${apiToken}`) return true;
  const origin = String(req.headers.origin || '');
  auditLog?.log({ type: 'auth_failure', ip: req.socket?.remoteAddress || 'unknown', path: req.url || '', origin: origin || undefined });
  const payload: Record<string, unknown> = { error_code: 'AUTH_REQUIRED', message: 'Unauthorized' };
  if (req?.__requestId) payload.request_id = req.__requestId;
  sendJson(res, 401, payload, req);
  return false;
}

export function requireSameOrigin(sendJson: any, req: any, res: any, allowedOrigin: string | null = null, allowedOrigins: string[] = [], auditLog?: SecurityAuditLog): boolean {
  if (sameOriginAllowed(req, allowedOrigin, allowedOrigins)) return true;
  const origin = String(req.headers.origin || '');
  auditLog?.log({ type: 'origin_reject', ip: req.socket?.remoteAddress || 'unknown', path: req.url || '', origin: origin || undefined });
  const payload: Record<string, unknown> = { error_code: 'ORIGIN_REJECTED', message: 'Origin not allowed' };
  if (req?.__requestId) payload.request_id = req.__requestId;
  sendJson(res, 403, payload, req);
  return false;
}

export function requireCsrf(sendJson: any, req: any, res: any, csrfToken: string, auditLog?: SecurityAuditLog): boolean {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const csrf = String(req.headers['x-sidecar-csrf'] || '');
  if (csrf && csrf === csrfToken) return true;
  auditLog?.log({ type: 'csrf_failure', ip: req.socket?.remoteAddress || 'unknown', path: req.url || '', origin: origin || undefined });
  const csrfPayload: Record<string, unknown> = { error_code: 'CSRF_REQUIRED', message: 'CSRF validation failed' };
  if (req?.__requestId) csrfPayload.request_id = req.__requestId;
  sendJson(res, 403, csrfPayload, req);
  return false;
}

export function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const buckets = new Map<string, { start: number; count: number }>();
  return {
    check(key: string) {
      const now = Date.now();
      const b = buckets.get(key);
      if (!b || now - b.start > windowMs) {
        buckets.set(key, { start: now, count: 1 });
        return { ok: true, remaining: max - 1 };
      }
      b.count += 1;
      if (b.count > max) {
        return { ok: false, retry_after_ms: Math.max(0, windowMs - (now - b.start)) };
      }
      return { ok: true, remaining: max - b.count };
    },
    gc() {
      const now = Date.now();
      for (const [k, v] of buckets.entries()) {
        if (now - v.start > windowMs * 2) buckets.delete(k);
      }
    },
  };
}

const REPLAY_PROTECTED_ROUTES = [/^\/dispatch$/, /^\/teams\/[^/]+\/actions\//, /^\/maintenance\/rotate-api-token$/];

export function createReplayProtector({ windowMs = 300_000, maxNonces = 5000 } = {}) {
  const seen = new Map<string, number>();
  return {
    check(req: any, pathname: string): { ok: true } | { ok: false; error: string } {
      if (process.env.LEAD_SIDECAR_REPLAY_PROTECTION !== '1') return { ok: true };
      const nonce = String(req.headers['x-sidecar-nonce'] || '');
      if (!nonce) return { ok: true };
      if (!REPLAY_PROTECTED_ROUTES.some((rx) => rx.test(pathname))) return { ok: true };
      const now = Date.now();
      // GC expired nonces
      if (seen.size > maxNonces) {
        for (const [k, ts] of seen.entries()) {
          if (now - ts > windowMs) seen.delete(k);
        }
      }
      if (seen.has(nonce)) return { ok: false, error: 'Nonce already used (replay detected)' };
      seen.set(nonce, now);
      return { ok: true };
    },
    gc() {
      const now = Date.now();
      for (const [k, ts] of seen.entries()) {
        if (now - ts > windowMs) seen.delete(k);
      }
    },
  };
}
