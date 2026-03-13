# Threat Model: Local Browser + Hostile Origin

## Scope
- Sidecar HTTP control plane on localhost.
- Browser clients (dashboard) and non-browser local clients (CLI/scripts).
- Local hostile web origins (for example `http://localhost:3000`), malicious extensions, and compromised local dev servers.

## Security Objectives
- Prevent cross-origin data exfiltration of sidecar bootstrap/auth material.
- Enforce auth/CSRF on all mutating methods.
- Keep non-browser clients functional without weakening browser protections.
- Preserve forensic visibility through structured request/security audit logs.

## Assumptions
- Host OS account is trusted by default; full local root compromise is out of scope.
- TLS termination is local-only unless explicitly configured.
- Browser-origin requests include `Origin`; non-browser tools usually do not.

## Primary Threats
1. Cross-port localhost origin reads bootstrap + mutates control plane.
2. CSRF against browser-open dashboard session.
3. Replay attempts on nonce-protected endpoints.
4. Supply-chain tampering of release installer or bundle assets.

## Mitigations
- Exact origin enforcement (`scheme + host + port`) for browser requests.
- Mutating verb guard for `POST/PUT/PATCH/DELETE` with auth + CSRF.
- `X-Sidecar-Nonce` replay protection on protected mutation routes.
- Signed checksums + signed `release.json` + SLSA attestation verification path.
- Security/request audit endpoints with schema-versioned export for SIEM.

## Explicit Non-Goals
- Defending against privileged local adversary (root/admin with filesystem access).
- Browser extension compromise.
- Network exposure hardening beyond localhost/unix-socket unless explicitly enabled.

## Hostile Local Process Model

### In-Scope Guarantees
- Local processes that can send arbitrary HTTP headers must still satisfy mutating-route auth policy when `LEAD_SIDECAR_REQUIRE_TOKEN=1`.
- Browser-style requests with forged `Origin` headers are not treated as authenticated by origin alone.
- Path-based route guards must reject sibling-prefix bypass attempts (for example `diagnostics-evil` vs `diagnostics`).

### Non-Goals
- Protecting token material from a same-user process that can read `~/.claude` files directly.
- Defending against full local account compromise or root-level tampering of runtime files.

## Operational Guidance
- Prefer unix-socket mode for local automation where browser UI is not required.
- Use mTLS mode when exposing sidecar behind a local TLS endpoint.
- Set `LEAD_SIDECAR_API_TOKEN_MAX_AGE_HOURS` for token age health alerts.
