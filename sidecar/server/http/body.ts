const ROUTE_BODY_LIMITS: Array<{ rx: RegExp; limit: number }> = [
  { rx: /^\/native\/probe$/, limit: 1024 },
  { rx: /^\/maintenance\//, limit: 4096 },
  { rx: /^\/diagnostics\//, limit: 4096 },
  { rx: /^\/repair\//, limit: 4096 },
  { rx: /^\/checkpoints\//, limit: 4096 },
  { rx: /^\/backups\//, limit: 4096 },
  { rx: /^\/health\//, limit: 4096 },
  { rx: /^\/dispatch$/, limit: 65536 },
  { rx: /^\/teams\/[^/]+\/actions\//, limit: 65536 },
  { rx: /^\/teams\/[^/]+\/batch-triage$/, limit: 65536 },
  { rx: /^\/native\/actions\//, limit: 65536 },
];

export function bodyLimitForRoute(pathname: string): number {
  for (const { rx, limit } of ROUTE_BODY_LIMITS) {
    if (rx.test(pathname)) return limit;
  }
  return 256 * 1024;
}

export async function readBody(req: any, { limitBytes = 256 * 1024 } = {}): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', (chunk: any) => {
      raw += chunk;
      if (raw.length > limitBytes) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return resolve({ __parse_error: 'payload_too_large' });
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({ __parse_error: 'invalid_json' }); }
    });
    req.on('error', () => resolve(tooLarge ? { __parse_error: 'payload_too_large' } : {}));
  });
}
