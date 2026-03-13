# Release Channels

## Stable

- Immutable semver tags: `vX.Y.Z`
- Requires full CI + supply-chain + security review gate.
- Intended for production/public install flows.

## RC (Release Candidate)

- Immutable prerelease tags: `vX.Y.Z-rc.N`
- Same verification surface as stable, but may include pending UX/docs polish.
- Intended for partner/beta validation.

## Nightly

- Mutable reference: `main`
- Dev-only installer path (`--ref main` / `--allow-unsigned-release`).
- Not suitable for production trust assumptions.

## Trust Levels

1. Stable: signed artifacts + signed manifest + attestation + full gates.
2. RC: same provenance controls, lower behavioral maturity.
3. Nightly: lowest trust, for development and experimentation only.
