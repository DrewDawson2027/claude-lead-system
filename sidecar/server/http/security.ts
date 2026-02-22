import { sameOriginAllowed } from './response.js';

export function requireApiAuth(sendJson: any, req: any, res: any, apiToken: string): boolean {
  if (process.env.LEAD_SIDECAR_REQUIRE_TOKEN !== '1') return true;
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${apiToken}`) return true;
  sendJson(res, 401, { error: 'Unauthorized' }, req);
  return false;
}

export function requireSameOrigin(sendJson: any, req: any, res: any): boolean {
  if (sameOriginAllowed(req)) return true;
  sendJson(res, 403, { error: 'Origin not allowed' }, req);
  return false;
}

export function requireCsrf(sendJson: any, req: any, res: any, csrfToken: string): boolean {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const auth = String(req.headers.authorization || '');
  if (auth) return true;
  const csrf = String(req.headers['x-sidecar-csrf'] || '');
  if (csrf && csrf === csrfToken) return true;
  sendJson(res, 403, { error: 'CSRF validation failed' }, req);
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
