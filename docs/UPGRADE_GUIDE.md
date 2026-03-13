# Upgrade Guide

How to upgrade the claude-lead-system to a newer version.

## From Any Version to Latest

The installer is idempotent. Re-running it upgrades in place:

```bash
VERSION=vX.Y.Z
gh release download "$VERSION" -R DrewDawson2027/claude-lead-system \
  -p install.sh \
  -p checksums.txt \
  -p checksums.txt.sig \
  -p checksums.txt.pem \
  -p release.json \
  -p release.json.sig \
  -p release.json.pem \
  -p claude-lead-system.tar.gz
bash install.sh --version "$VERSION" \
  --checksum-file checksums.txt \
  --checksum-signature checksums.txt.sig \
  --checksum-cert checksums.txt.pem \
  --release-manifest release.json \
  --release-manifest-signature release.json.sig \
  --release-manifest-cert release.json.pem \
  --source-tarball claude-lead-system.tar.gz
```

### What happens during upgrade
1. Existing hooks are backed up to `~/.claude/hooks.backup.{timestamp}/`
2. New hooks, agents, modes, and reference cards are installed
3. `settings.local.json` is merged (user customizations preserved)
4. MCP coordinator dependencies are reinstalled (`npm install`)
5. Sidecar is replaced with the new version
6. Health check runs to validate the install

### Post-upgrade verification

```bash
# Verify hooks and dependencies
bash ~/.claude/hooks/health-check.sh

# Verify sidecar
curl http://127.0.0.1:7199/health

# Check schema version
curl http://127.0.0.1:7199/v1/schema/version
```

## From git clone to Release Install

If you previously installed by cloning the repository:

1. Switch from `--ref main` to `--version vX.Y.Z` for stability:
   ```bash
   bash install.sh --version v1.2.0 \
     --checksum-file checksums.txt \
     --checksum-signature checksums.txt.sig \
     --checksum-cert checksums.txt.pem \
     --release-manifest release.json \
     --release-manifest-signature release.json.sig \
     --release-manifest-cert release.json.pem \
     --source-tarball claude-lead-system.tar.gz
   ```

2. Verify with checksums for integrity:
   ```bash
   gh release download v1.2.0 -R DrewDawson2027/claude-lead-system \
     -p checksums.txt \
     -p checksums.txt.sig \
     -p checksums.txt.pem \
     -p release.json \
     -p release.json.sig \
     -p release.json.pem \
     -p claude-lead-system.tar.gz
   ```

3. Optionally verify cosign signatures (see `docs/TAG_VERIFICATION.md`)

## Breaking Changes by Version

### Unreleased (post-1.0.0)

**API error schema change:**
- Error responses now use `{ error_code, message, request_id }` instead of `{ error: string }`
- If you have custom scripts or integrations that parse sidecar error responses, update them to use `error_code` and `message` fields
- The `request_id` field is included for debugging and correlation

**Action required:** Update any custom API clients that parse error responses.

## Manual Upgrade Checklist

If you prefer manual control:

1. Pull or download the new release:
   ```bash
   gh release download vX.Y.Z -R DrewDawson2027/claude-lead-system
   ```

2. Run the installer:
   ```bash
   bash install.sh --version vX.Y.Z \
     --checksum-file checksums.txt \
     --checksum-signature checksums.txt.sig \
     --checksum-cert checksums.txt.pem \
     --release-manifest release.json \
     --release-manifest-signature release.json.sig \
     --release-manifest-cert release.json.pem \
     --source-tarball claude-lead-system.tar.gz
   ```

3. Verify hooks:
   ```bash
   bash ~/.claude/hooks/health-check.sh
   ```

4. Verify sidecar:
   ```bash
   curl http://127.0.0.1:7199/v1/health
   ```

## Rollback

If an upgrade causes issues, rollback to the previous version:

```bash
bash install.sh --version vPREVIOUS \
  --checksum-file checksums.txt \
  --checksum-signature checksums.txt.sig \
  --checksum-cert checksums.txt.pem \
  --release-manifest release.json \
  --release-manifest-signature release.json.sig \
  --release-manifest-cert release.json.pem \
  --source-tarball claude-lead-system.tar.gz
```

Or restore from the automatic backup:

```bash
# List backups
ls ~/.claude/hooks.backup.*

# Restore hooks
cp -r ~/.claude/hooks.backup.YYYYMMDDHHMMSS/* ~/.claude/hooks/

# Restore settings
cp ~/.claude/settings.local.json.backup ~/.claude/settings.local.json
```

See `docs/ROLLBACK_PLAN.md` for the full rollback process.

## References

- `install.sh` — Installer with strict release verification (`--version` + signed metadata + tarball)
- `docs/ROLLBACK_PLAN.md` — Rollback procedures
- `docs/TAG_VERIFICATION.md` — Release verification
- `CHANGELOG.md` — Version history and breaking changes
