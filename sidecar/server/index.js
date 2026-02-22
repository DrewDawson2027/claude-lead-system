#!/usr/bin/env node
import { startSidecarServer } from './create-server.ts';

export { startSidecarServer } from './create-server.ts';

const isDirect = Boolean(process.argv[1] && /(^|[\\/])server[\\/]index\\.js$/.test(process.argv[1]));
if (isDirect) {
  startSidecarServer().catch((err) => {
    console.error('lead-sidecar failed:', err);
    process.exit(1);
  });
}
