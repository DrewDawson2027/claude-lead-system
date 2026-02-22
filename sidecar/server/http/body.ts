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
