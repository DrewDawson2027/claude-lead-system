# Sidecar HTTP API

The sidecar HTTP API uses a canonical versioned path prefix:

- Canonical: `/v1/*`
- Legacy alias (temporary): `/*`

Legacy aliases return deprecation headers:

- `Deprecation: true`
- `Sunset: <RFC1123 date>`
- `Link: </v1/...>; rel="successor-version"`

## Legacy Alias Sunset Policy (Exact)

- Default deprecation window: **90 days** from the time the response is served
- The `Sunset` header is computed per response as `now + 90 days`
- Override (for staged rollouts/testing): `LEAD_SIDECAR_LEGACY_SUNSET_MS`

Removal policy:

- New clients should adopt `/v1/*` immediately
- Legacy aliases should not be used for new integrations
- Legacy aliases may be removed in a future release after the deprecation window and release notes announcement

Client migration guidance:

1. Update all client request paths from `/<route>` to `/v1/<route>`
2. Keep response parsing unchanged (payloads are parity-compatible during the deprecation window)
3. Treat `Deprecation`/`Sunset` headers on legacy routes as migration deadlines
4. Prefer `/v1/schema/version` for capability/version discovery
5. The bundled sidecar web UI and TUI have already migrated to `/v1/*`; legacy aliases are retained for external clients during the deprecation window

## Version Discovery

- `GET /v1/schema/version`
- Legacy alias: `GET /schema/version`

Returns:

- `api_version`
- `server_version`
- `compat_aliases_enabled`
- `sunset_date`
- schema validation/version metadata

## Endpoint Families (Canonical Prefix)

### System / Diagnostics

- `/v1/health`
- `/v1/metrics.json`
- `/v1/metrics/history`
- `/v1/metrics/diff`
- `/v1/schema/version`
- `/v1/schema/migrations`
- `/v1/reports/*`
- `/v1/snapshots/diff`
- `/v1/timeline/replay`
- `/v1/diagnostics/*`

### Teams / Tasking

- `/v1/teams`
- `/v1/teams/:team`
- `/v1/teams/:team/interrupts`
- `/v1/teams/:team/approvals`
- `/v1/teams/:team/interrupt-priorities`
- `/v1/teams/:team/actions/:action`
- `/v1/teams/:team/rebalance`
- `/v1/teams/:team/rebalance-explain`
- `/v1/teams/:team/tasks/:taskId/*`
- `/v1/teams/:team/batch-triage`

### Native Bridge / Native Actions

- `/v1/native/status`
- `/v1/native/probe`
- `/v1/native/actions/:action`
- `/v1/native/bridge/status`
- `/v1/native/bridge/ensure`
- `/v1/native/bridge/validate`
- `/v1/native/bridge/validation`

### Action Queue / Routing

- `/v1/actions`
- `/v1/actions/:id`
- `/v1/actions/:id/retry`
- `/v1/actions/:id/fallback`
- `/v1/dispatch`
- `/v1/route/simulate`

### UI / Maintenance / Recovery

- `/v1/ui/bootstrap.json`
- `/v1/ui/preferences`
- `/v1/open-dashboard`
- `/v1/maintenance/run`
- `/v1/checkpoints/*`
- `/v1/events/*`
- `/v1/repair/*`
- `/v1/health/*`
- `/v1/backups/*`

## Compatibility Notes

- Repo-maintained UI/TUI clients now use canonical `/v1/*` routes.
- Legacy unversioned aliases remain compatibility shims for external clients during the deprecation window.
- New integrations should use `/v1/*` exclusively.
