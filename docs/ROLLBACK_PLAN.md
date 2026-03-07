# Rollback Plan

Step-by-step process for rolling back a bad release.

## Decision Criteria

Rollback when any of these apply:

- **Broken installer**: `install.sh` fails on supported platforms
- **Security vulnerability**: Discovered post-release
- **Data corruption**: Release causes state file corruption or loss
- **Breaking regression**: Core functionality (hooks, coordinator, sidecar) broken

## Rollback Steps

### 1. Mark release as pre-release (immediate)

```bash
gh release edit v1.2.0 --prerelease -R DrewDawson2027/claude-lead-system
```

This hides the release from the "latest" designation for GitHub release consumers and surfaces the previous stable release as the recommended version.

### 2. Post advisory in release notes

```bash
gh release edit v1.2.0 --notes "**RETRACTED** — see v1.1.0 for stable release. Issue: [description]" \
  -R DrewDawson2027/claude-lead-system
```

### 3. If critical: delete release assets

Delete the artifacts but **keep the git tag** for audit trail:

```bash
# Remove downloadable assets only
gh release delete-asset v1.2.0 claude-lead-system.tar.gz -R DrewDawson2027/claude-lead-system
gh release delete-asset v1.2.0 SHA256SUMS.txt -R DrewDawson2027/claude-lead-system
```

**Never delete git tags** — this breaks the provenance chain and cosign verification.

### 4. Create hotfix branch

```bash
# Branch from last known-good tag
git checkout -b hotfix/v1.2.1 v1.1.0

# Apply targeted fix
# ...

git push origin hotfix/v1.2.1
```

### 5. Fast-track hotfix through CI

The hotfix goes through the same CI gates:

- All lint, test, coverage, perf-gate jobs must pass
- Smoke install test must pass
- Supply chain workflow generates new signed artifacts

### 6. Tag and release hotfix

```bash
VERSION=v1.2.1
git tag -s "$VERSION" -m "$VERSION — hotfix for v1.2.0 regression"
git push origin "$VERSION"

gh release create "$VERSION" \
  --repo DrewDawson2027/claude-lead-system \
  --notes "Hotfix for v1.2.0. See CHANGELOG.md for details." \
  --latest
```

## User-Side Rollback

### Re-install a specific version

```bash
bash install.sh --version v1.1.0 \
  --checksum-file checksums.txt \
  --checksum-signature checksums.txt.sig \
  --checksum-cert checksums.txt.pem \
  --release-manifest release.json \
  --release-manifest-signature release.json.sig \
  --release-manifest-cert release.json.pem \
  --source-tarball claude-lead-system.tar.gz
```

The installer is idempotent — it backs up existing hooks before overwriting.

### Sidecar rollback

If the sidecar state is corrupted:

```bash
# Use built-in checkpoint restore
curl -X POST http://127.0.0.1:7199/checkpoints/restore \
  -H 'Content-Type: application/json' \
  -d '{"file": "path-to-checkpoint.json"}'

# Or use sidecarctl
sidecarctl restore --latest
```

### Manual file restore

```bash
# Hooks backup (created automatically by installer)
ls ~/.claude/hooks.backup.*
cp -r ~/.claude/hooks.backup.YYYYMMDDHHMMSS/* ~/.claude/hooks/

# Settings backup (created by merge-settings.mjs)
ls ~/.claude/settings.local.json.backup*
cp ~/.claude/settings.local.json.backup ~/.claude/settings.local.json
```

## CHANGELOG Entry for Retracted Release

Add to `CHANGELOG.md`:

```markdown
## [1.2.0] — RETRACTED

> **This release has been retracted.** Use v1.2.1 instead.
> Reason: [brief description of the issue]
```

## Communication Checklist

- [ ] Mark release as pre-release on GitHub
- [ ] Add retraction note to release description
- [ ] Update CHANGELOG.md with retraction notice
- [ ] Post on relevant channels (if applicable)
- [ ] Tag and release hotfix
- [ ] Verify hotfix artifacts are signed and pass CI

## References

- `docs/RELEASE_CHECKLIST.md` — Standard release process
- `docs/TAG_VERIFICATION.md` — Signature verification
- `install.sh` — Supports strict signed release installs by version
