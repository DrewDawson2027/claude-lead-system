# Tag Signature Verification

How to verify the authenticity and integrity of claude-lead-system releases.

## Verifying a Signed Git Tag

All release tags are signed with GPG. To verify:

```bash
git tag -v v1.2.0
```

Expected output includes `Good signature from ...`. If the tag is unsigned, you'll see `error: no signature found`.

### Check if a tag is signed vs unsigned

```bash
# Shows tag type — 'tag' objects are annotated (potentially signed), 'commit' means lightweight
git cat-file -t v1.2.0

# Show full tag metadata including signature block
git cat-file tag v1.2.0
```

## Verifying Cosign Release Signatures

Release artifacts are signed with [cosign](https://github.com/sigstore/cosign) using keyless (Fulcio) signing tied to the GitHub Actions workflow identity.

### Prerequisites

```bash
# Install cosign
go install github.com/sigstore/cosign/v2/cmd/cosign@latest
# or: brew install cosign
```

### Verify checksums.txt signature

```bash
cosign verify-blob \
  --signature checksums.txt.sig \
  --certificate checksums.txt.pem \
  --certificate-identity-regexp "^https://github.com/DrewDawson2027/claude-lead-system/.github/workflows/release-bundle\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+([-.][A-Za-z0-9._-]+)?$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  checksums.txt
```

### Full release verification

Use the provided script for end-to-end verification:

```bash
bash scripts/release/verify-release.sh v1.2.0 DrewDawson2027/claude-lead-system
```

This verifies: tarball checksum, cosign signature, SBOM presence, and GitHub provenance attestation.

## Configuring Local GPG Signing

```bash
# List existing keys
gpg --list-keys

# Generate a key if needed
gpg --full-generate-key

# Configure git to use your key
git config --global user.signingkey YOUR_KEY_ID
git config --global commit.gpgsign true
git config --global tag.gpgSign true

# Export public key for GitHub
gpg --armor --export YOUR_KEY_ID
# Paste into GitHub > Settings > SSH and GPG keys > New GPG key
```

## Enforcement Policy

| Context                | Requirement                     | Enforcement                 |
| ---------------------- | ------------------------------- | --------------------------- |
| Release tags           | MUST be signed (`git tag -s`)   | `tag-policy.yml` CI check   |
| Release tag format     | MUST match `vX.Y.Z` semver      | `tag-policy.yml` CI check   |
| PR commits             | Signed commits advisory         | Not enforced (yet)          |
| Release artifacts      | Cosign keyless signature        | `supply-chain.yml` workflow |
| SBOM                   | Generated per release           | `supply-chain.yml` workflow |
| Provenance attestation | GitHub Actions build provenance | `supply-chain.yml` workflow |

## References

- `docs/PROVENANCE.md` — Authorship and cosign verification
- `docs/RELEASE_CHECKLIST.md` — Per-release process
- `.github/workflows/tag-policy.yml` — Semver + signed tag enforcement
- `.github/workflows/supply-chain.yml` — SBOM + cosign + provenance
