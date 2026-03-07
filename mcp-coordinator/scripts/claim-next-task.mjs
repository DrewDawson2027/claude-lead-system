#!/usr/bin/env node

import { __test__ } from "../index.js";

const raw = process.env.CLAUDE_AUTOCLAIM_ARGS_B64 || "";
if (!raw) process.exit(0);

let args = null;
try {
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  args = JSON.parse(decoded);
} catch {
  process.exit(0);
}

try {
  __test__.ensureDirsOnce();
  __test__.handleClaimNextTask(args);
} catch {
  process.exit(0);
}
