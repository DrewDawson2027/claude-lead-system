# Release Checklist (A+ Standard)

Use this for every public release to keep quality and attribution verifiable.

## One-Time Setup (Authorship + Signing)

1. Enable branch protection on `main`:
- Require PR reviews
- Require status checks to pass
- Restrict force-pushes

2. Enable signed commits in local git:

```bash
git config --global commit.gpgsign true
git config --global tag.gpgSign true
```

3. Confirm your GitHub account shows verified signatures.

## Per-Release Process

1. Start from clean `main`:

```bash
git checkout main
git pull --ff-only
git status --short
```

2. Run strict preflight:

```bash
bash scripts/release/preflight.sh
```

3. Choose release version:
- Stable: `vX.Y.Z`
- Pre-release: `vX.Y.Z-rc.1`

4. Create signed tag:

```bash
VERSION=v1.1.0
git tag -s "$VERSION" -m "$VERSION"
git push origin "$VERSION"
```

5. Publish GitHub release (triggers supply-chain workflow):

```bash
gh release create "$VERSION" \
  --repo DrewDawson2027/claude-lead-system \
  --generate-notes \
  --latest
```

6. Wait for workflow completion:
- `.github/workflows/ci.yml`
- `.github/workflows/supply-chain.yml`

7. Verify release artifacts publicly:

```bash
bash scripts/release/verify-release.sh "$VERSION" DrewDawson2027/claude-lead-system
```

## Artifacts That Must Exist

- `claude-lead-system.tar.gz`
- `claude-lead-system.tar.gz.sig`
- `claude-lead-system.tar.gz.pem`
- `sbom.spdx.json`
- GitHub build attestation from `actions/attest-build-provenance`

## GitHub Release Copy (Template)

```markdown
## Claude Lead System {{VERSION}}

Canonical repo: https://github.com/DrewDawson2027/claude-lead-system  
Author: Drew Dawson (@DrewDawson2027)

### Verification
This release includes:
- Signed bundle (`claude-lead-system.tar.gz.sig` + `.pem`)
- SPDX SBOM (`sbom.spdx.json`)
- GitHub build provenance attestation

Verify locally:
```bash
bash scripts/release/verify-release.sh {{VERSION}} DrewDawson2027/claude-lead-system
```

Provenance details: `docs/PROVENANCE.md`
```

## X/Twitter Post Copy (Template)

```text
Shipped: Claude Lead System {{VERSION}}
By @DrewDawson2027

Repo: https://github.com/DrewDawson2027/claude-lead-system

Release includes verifiable provenance:
- cosign signature + cert
- SPDX SBOM
- GitHub build attestation

Verify it yourself:
bash scripts/release/verify-release.sh {{VERSION}} DrewDawson2027/claude-lead-system
```
