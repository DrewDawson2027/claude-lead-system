# Signed Releases and Provenance

## Summary

Release bundles are signed and attested via GitHub Actions OIDC keyless signing (Sigstore/Cosign).

## Workflows

- `.github/workflows/release-bundle.yml` builds release tarballs + checksums and uploads to GitHub Releases.
- `.github/workflows/supply-chain.yml` generates SBOM, signs the release bundle, verifies the signature, and attests provenance.

## Artifacts

- `claude-lead-system.tar.gz`
- `SHA256SUMS.txt`
- `*.sig` (Cosign signature)
- `*.pem` (certificate)
- `sbom.spdx.json`

## Verification (Operator)

1. Download release bundle, signature, and certificate.
2. Verify SHA256 checksum.
3. Run `cosign verify-blob` using the published cert/sig and GitHub OIDC issuer constraints.
4. Review provenance attestation in release artifacts or GitHub attestations UI.
