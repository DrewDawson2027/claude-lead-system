import { readFileSync, existsSync } from "fs";

/**
 * Sanitize an identifier for safe use in file paths or shell arguments.
 * Only allows alphanumeric characters, hyphens, underscores, and dots.
 * Explicitly rejects consecutive dots (`..`) to prevent path traversal.
 * Max 128 characters. Returns null if the value is invalid.
 */
export function sanitizeId(value) {
  if (!value || typeof value !== "string") return null;
  if (value.includes("..")) return null;
  return /^[a-zA-Z0-9_\-\.]{1,128}$/.test(value) ? value : null;
}

/**
 * Sanitize a model name for use in shell commands.
 * Falls back to "sonnet" if the value is missing or invalid.
 */
export function sanitizeModel(model) {
  return sanitizeId(model || "sonnet") || "sonnet";
}

export function readJSON(path) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

export function readJSONL(path) {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

export function getSessionStatus(session) {
  if (session.status === "closed") return "closed";
  if (session.status === "stale") return "stale";
  if (!session.last_active) return "unknown";
  const age = (Date.now() - new Date(session.last_active).getTime()) / 1000;
  if (age < 180) return "active";
  if (age < 600) return "idle";
  return "stale";
}

export function timeAgo(ts) {
  if (!ts) return "unknown";
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
