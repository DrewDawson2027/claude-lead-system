import { legacyDeprecationHeaders, getRouteMeta } from "./versioning.js";

export function sameOriginAllowed(
  req: any,
  allowedOrigin: string | null = null,
  allowedOrigins: string[] = [],
): boolean {
  const origin = String(req?.headers?.origin || "");
  if (!origin) return true;
  try {
    const normalizedOrigin = new URL(origin).origin;
    if (allowedOrigin && normalizedOrigin === allowedOrigin) return true;
    if (allowedOrigins.length && allowedOrigins.includes(normalizedOrigin))
      return true;
    return false;
  } catch {
    return false;
  }
}

export function createBaseHeaders(
  req: any = null,
  allowedOrigin: string | null = null,
  allowedOrigins: string[] = [],
): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  };
  if (req?.__requestId) {
    headers["X-Request-Id"] = req.__requestId;
  }
  const origin = String(req?.headers?.origin || "");
  if (origin && sameOriginAllowed(req, allowedOrigin, allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Authorization, X-Sidecar-CSRF, X-Sidecar-Nonce";
    headers["Access-Control-Allow-Methods"] =
      "GET, POST, OPTIONS, PUT, PATCH, DELETE";
  }
  Object.assign(
    headers,
    legacyDeprecationHeaders(getRouteMeta(req)) as Record<string, string>,
  );
  return headers;
}

export function sendJson(
  baseHeaders: (req?: any) => Record<string, string>,
  res: any,
  status: number,
  payload: unknown,
  req: any = null,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...baseHeaders(req),
  });
  res.end(JSON.stringify(payload));
}

export function sendText(
  baseHeaders: (req?: any) => Record<string, string>,
  res: any,
  status: number,
  body: string,
  req: any = null,
): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...baseHeaders(req),
  });
  res.end(body);
}

export function sendHtml(
  baseHeaders: (req?: any) => Record<string, string>,
  res: any,
  status: number,
  body: string,
  req: any = null,
): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    ...baseHeaders(req),
  });
  res.end(body);
}

export function sendJs(
  baseHeaders: (req?: any) => Record<string, string>,
  res: any,
  status: number,
  body: string,
  req: any = null,
): void {
  res.writeHead(status, {
    "Content-Type": "application/javascript; charset=utf-8",
    ...baseHeaders(req),
  });
  res.end(body);
}

export function sendError(
  baseHeaders: (req?: any) => Record<string, string>,
  res: any,
  status: number,
  errorCode: string,
  message: string,
  req: any = null,
  details?: unknown,
): void {
  const payload: Record<string, unknown> = { error_code: errorCode, message };
  if (details !== undefined) payload.details = details;
  if (req?.__requestId) payload.request_id = req.__requestId;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...baseHeaders(req),
  });
  res.end(JSON.stringify(payload));
}

export function sseBroadcast(
  clients: Set<any>,
  event: string,
  data: unknown,
): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {}
  }
}
