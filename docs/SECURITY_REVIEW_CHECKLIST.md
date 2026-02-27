# Security Review Checklist (Release Gate)

- [x] Threat model reviewed for localhost/browser abuse and supply-chain compromise scenarios.
- [x] Auth/CSRF enforcement validated for all mutating verbs (`POST/PUT/PATCH/DELETE`).
- [x] Cross-origin/browser origin policy validated against hostile cross-port localhost origins.
- [x] Bootstrap payload reviewed for secret disclosure regressions.
- [x] Installer checksum/signature verification path tested with release artifacts.
- [x] SLSA provenance attestation verification path tested.
- [x] Release manifest signature and hash bindings verified.
- [x] SBOM schema + hash binding verified in release verification workflow.
- [x] Sidecar secure defaults matrix tested (`LEAD_SIDECAR_REQUIRE_TOKEN`, allowlist, safe mode).
- [x] Release security smoke gate passes (`scripts/release/security-smoke.sh`).
- [x] Audit log/export schema reviewed for SIEM compatibility and secret redaction.
- [x] Token rotation/age telemetry verified and alert threshold configured.
- [x] Transport hardening reviewed (localhost bind, optional TLS mTLS mode, optional unix socket mode).
- [x] Changelog includes explicit Security + Breaking Changes entries.
