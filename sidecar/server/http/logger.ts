export type LogLevel = "info" | "warn" | "error";
export type LogFormat = "text" | "json";

export interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  fields?: Record<string, unknown>;
}

export function createLogger({ format = "text" as LogFormat } = {}) {
  const isJson = format === "json";

  function emit(
    level: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ) {
    if (isJson) {
      const entry: LogEntry = { level, ts: new Date().toISOString(), msg };
      if (fields && Object.keys(fields).length) entry.fields = fields;
      const line = JSON.stringify(entry);
      if (level === "error") process.stderr.write(line + "\n");
      else process.stdout.write(line + "\n");
    } else {
      const prefix = "[lead-sidecar]";
      const fieldsStr =
        fields && Object.keys(fields).length
          ? " " +
            Object.entries(fields)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ")
          : "";
      const line = `${prefix} ${msg}${fieldsStr}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
  }

  return {
    info: (msg: string, fields?: Record<string, unknown>) =>
      emit("info", msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      emit("warn", msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) =>
      emit("error", msg, fields),
    request: (
      req: {
        method?: string;
        url?: string;
        __requestId?: string;
        socket?: { remoteAddress?: string };
      },
      status: number,
      startMs: number,
    ) => {
      const duration_ms = Date.now() - startMs;
      const method = String(req.method || "GET");
      const path = String(req.url || "/");
      const request_id = String((req as any).__requestId || "-");
      const ip = String(req.socket?.remoteAddress || "unknown");
      emit("info", `${method} ${path} ${status} ${duration_ms}ms`, {
        method,
        path,
        status,
        duration_ms,
        request_id,
        ip,
      });
    },
  };
}
