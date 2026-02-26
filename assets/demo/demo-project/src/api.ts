/**
 * API routes for demo application.
 * Used to demonstrate multi-agent orchestration with Claude Lead System.
 */

import { login, register } from "./auth";

interface Request {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface Response {
  status: number;
  body: Record<string, unknown>;
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "POST" && req.path === "/api/login") {
    const { email, password } = req.body as { email: string; password: string };
    const result = await login(email, password);
    return result.success
      ? { status: 200, body: { token: result.token } }
      : { status: 401, body: { error: result.error } };
  }

  if (req.method === "POST" && req.path === "/api/register") {
    const { email, password } = req.body as { email: string; password: string };
    const result = await register(email, password);
    return result.success
      ? { status: 201, body: { token: result.token } }
      : { status: 409, body: { error: result.error } };
  }

  if (req.method === "GET" && req.path === "/api/health") {
    return { status: 200, body: { status: "ok", uptime: process.uptime() } };
  }

  return { status: 404, body: { error: "Not found" } };
}
