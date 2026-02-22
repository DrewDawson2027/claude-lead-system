import { legacyDeprecationHeaders, getRouteMeta } from './versioning.js';

export function sameOriginAllowed(req: any): boolean {
  const origin = String(req?.headers?.origin || '');
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function createBaseHeaders(req: any = null): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  const origin = String(req?.headers?.origin || '');
  if (origin && sameOriginAllowed(req)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Sidecar-CSRF';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, PATCH';
  }
  Object.assign(headers, legacyDeprecationHeaders(getRouteMeta(req)) as Record<string, string>);
  return headers;
}

export function sendJson(baseHeaders: (req?: any) => Record<string, string>, res: any, status: number, payload: unknown, req: any = null): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(JSON.stringify(payload));
}

export function sendText(baseHeaders: (req?: any) => Record<string, string>, res: any, status: number, body: string, req: any = null): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(body);
}

export function sendHtml(baseHeaders: (req?: any) => Record<string, string>, res: any, status: number, body: string, req: any = null): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(body);
}

export function sendJs(baseHeaders: (req?: any) => Record<string, string>, res: any, status: number, body: string, req: any = null): void {
  res.writeHead(status, {
    'Content-Type': 'application/javascript; charset=utf-8',
    ...baseHeaders(req),
  });
  res.end(body);
}

export function sseBroadcast(clients: Set<any>, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch {}
  }
}
