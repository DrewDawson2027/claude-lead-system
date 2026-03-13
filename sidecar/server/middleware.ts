/**
 * Request-level middleware chain for the sidecar server.
 *
 * Extracts the inline "if mutating, check rate-limit → auth → csrf → replay → safe-mode"
 * block from create-server into a testable, typed module.
 */

import type http from "http";
import type {
    SendErrorFn,
    RateLimiter,
    ReplayProtector,
    MiddlewareVerdict,
} from "./types.js";
import type { SecurityAuditLog } from "./http/audit.js";

// ---------------------------------------------------------------------------
// Config for the middleware stack
// ---------------------------------------------------------------------------

export interface MiddlewareConfig {
    /** Rate limit max header value */
    rateLimitMax: number;
    /** Is safe-mode enabled? */
    safeMode: boolean;
    /** Bound helpers */
    requireSameOrigin: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
    requireApiAuth: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
    requireCsrf: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
    rateLimiter: RateLimiter;
    replayProtector: ReplayProtector;
    securityAuditLog: SecurityAuditLog;
    sendError: SendErrorFn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string | undefined): boolean {
    return MUTATING_METHODS.has(String(method || "").toUpperCase());
}

const SAFE_MODE_BLOCKED_ROUTES: RegExp[] = [
    /^\/dispatch$/,
    /^\/teams\/[^/]+\/actions\//,
    /^\/teams\/[^/]+\/batch-triage$/,
    /^\/teams\/[^/]+\/rebalance$/,
    /^\/native\/actions\//,
    /^\/native\/bridge\/ensure$/,
    /^\/native\/probe$/,
    /^\/maintenance\/run$/,
];

// ---------------------------------------------------------------------------
// The middleware itself
// ---------------------------------------------------------------------------

/**
 * Runs the full pre-route security middleware chain.
 *
 * Returns `"handled"` if the response was already sent (short-circuit),
 * or `"continue"` if the request should proceed to route dispatch.
 */
export function runRequestMiddleware(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    config: MiddlewareConfig,
): MiddlewareVerdict {
    // OPTIONS is handled outside this chain (before it's called)
    // Same-origin check is always first
    if (!config.requireSameOrigin(req, res)) return "handled";

    // Non-mutating requests skip everything else
    if (!isMutatingMethod(req.method)) return "continue";

    // ----- Rate limit -----
    const rlKey = `${(req.socket as { remoteAddress?: string })?.remoteAddress || "local"}:${url.pathname}`;
    const rl = config.rateLimiter.check(rlKey);
    if (!rl.ok) {
        config.securityAuditLog.log({
            type: "rate_limit",
            ip: (req.socket as { remoteAddress?: string })?.remoteAddress || "unknown",
            path: req.url || "",
        });
        res.setHeader(
            "Retry-After",
            String(Math.ceil((rl.retry_after_ms || 0) / 1000)),
        );
        config.sendError(res, 429, "RATE_LIMITED", "Rate limit exceeded", req, {
            retry_after_ms: rl.retry_after_ms,
        });
        return "handled";
    }
    res.setHeader("X-RateLimit-Limit", String(config.rateLimitMax));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining ?? 0));

    // ----- Auth -----
    if (!config.requireApiAuth(req, res)) return "handled";

    // ----- CSRF -----
    if (!config.requireCsrf(req, res)) return "handled";

    // ----- Replay protection -----
    const replayCheck = config.replayProtector.check(req, url.pathname);
    if (!replayCheck.ok) {
        config.sendError(
            res,
            409,
            "REPLAY_DETECTED",
            replayCheck.error || "Nonce already used",
            req,
        );
        return "handled";
    }

    // ----- Safe-mode block -----
    if (config.safeMode) {
        const method = String(req.method || "").toUpperCase();
        const isBlockedPost =
            method === "POST" &&
            SAFE_MODE_BLOCKED_ROUTES.some((rx) => rx.test(url.pathname));
        const isBlockedMutation = method !== "POST";
        if (isBlockedPost || isBlockedMutation) {
            config.sendError(
                res,
                503,
                "SAFE_MODE_ACTIVE",
                "Server is in safe mode — mutation endpoints disabled",
                req,
            );
            return "handled";
        }
    }

    return "continue";
}
