# Deprecation Policy

How features, endpoints, and configuration are deprecated and removed.

## General Principle

Nothing is removed without warning. Every deprecation follows: **announce → warn → remove**.

## API Endpoints

| Phase | Duration | What Happens |
|-------|----------|-------------|
| Announce | Release N | Endpoint added to CHANGELOG under "Deprecated". `Deprecation: true` and `Sunset: <date>` headers added to responses. |
| Warn | Release N+1 | Same headers. Endpoint still functional. Reminder in CHANGELOG. |
| Remove | Release N+2 | Endpoint returns `410 Gone` with migration instructions in the response body. |

The existing `/v1/` versioned endpoint system supports this pattern. Legacy bare-path aliases already emit `Deprecation` and `Sunset` headers via `legacyDeprecationHeaders()`.

## Installer Flags

| Phase | Duration | What Happens |
|-------|----------|-------------|
| Announce | Release N | Deprecated flag prints warning to stderr: `"WARNING: --flag is deprecated, use --new-flag instead"`. Added to CHANGELOG. |
| Warn | Release N+1 | Same warning. Flag still works. |
| Remove | Release N+2 | Flag removed. Using it prints error with migration instructions and exits non-zero. |

## Hook Interfaces

| Phase | Duration | What Happens |
|-------|----------|-------------|
| Announce | Release N | New hook event format documented. Old format still emitted. CHANGELOG entry. |
| Dual-emit | Release N+1 | Both old and new formats emitted. Migration guide published. |
| Remove | Release N+2 | Only new format emitted. Old format documented as removed. |

## Configuration / Environment Variables

| Phase | Duration | What Happens |
|-------|----------|-------------|
| Announce | Release N | Deprecated env var prints warning to stderr on startup. New env var documented. |
| Warn | Release N+1 | Same warning. Old var still works, new var takes precedence if both set. |
| Remove | Release N+2 | Old var ignored. Warning upgraded to error if detected. |

## Process

1. **File a deprecation issue** with the `deprecation` label
2. **Add CHANGELOG entry** under `### Deprecated`
3. **Implement warning** in the relevant code path
4. **Update docs** to show the new recommended approach
5. **Track the sunset date** in the deprecation issue
6. **Remove after sunset** — close the issue, add CHANGELOG entry under `### Removed`

## Currently Deprecated

| Item | Deprecated In | Sunset Date | Replacement |
|------|--------------|-------------|-------------|
| Bare-path API routes (e.g., `/health`) | v1.0.0 | v2.0.0 | Use `/v1/health` prefix |

## References

- `sidecar/server/http/versioning.ts` — API versioning and deprecation headers
- `CHANGELOG.md` — Deprecation announcements
- `docs/UPGRADE_GUIDE.md` — Migration instructions
