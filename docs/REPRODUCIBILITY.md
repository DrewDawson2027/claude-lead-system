# Reproducibility Notes

How release artifacts are built and what guarantees exist around determinism.

## How the Tarball Is Built

The release tarball is created in `.github/workflows/release-bundle.yml`:

```bash
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner --exclude .git --exclude node_modules -czf claude-lead-system.tar.gz .
```

### What's excluded
- `.git/` directory (history, refs, objects)
- `node_modules/` (installed at user side via `npm install`)

### What's included
- All source code, hooks, agents, modes, reference cards
- `install.sh`, settings templates, MCP coordinator
- Sidecar server and dashboard assets
- Documentation and scripts

## Determinism Guarantees

### What IS reproducible
- **Source tree content**: Identical to the git commit SHA tagged for release
- **Dependency lockfiles**: `package-lock.json` and `mcp-coordinator/package-lock.json` pin exact versions
- **File contents**: Byte-identical to the repository at the tagged commit

### What is NOT fully byte-reproducible
- **Toolchain variance**: Different `tar` implementations can still differ in edge metadata
- **Compression implementation drift**: gzip versions may produce small binary differences across environments

### Why exact reproducibility is not targeted
For a local development tool, provenance + integrity verification (cosign signatures + checksums) provides stronger guarantees than byte-reproducibility. The SBOM provides a content inventory, and cosign ties each artifact to a specific GitHub Actions workflow run.

## How to Verify a Release

### Quick verification (checksums only)
```bash
# Download release assets
gh release download v1.2.0 -R DrewDawson2027/claude-lead-system

# Verify tarball checksum
sha256sum -c SHA256SUMS.txt
```

### Full verification (checksums + signatures)
```bash
bash scripts/release/verify-release.sh v1.2.0 DrewDawson2027/claude-lead-system
```

### Manual content comparison
```bash
# Extract tarball
mkdir /tmp/release-check && cd /tmp/release-check
tar -xzf claude-lead-system.tar.gz

# Clone the same tag
git clone --depth 1 --branch v1.2.0 https://github.com/DrewDawson2027/claude-lead-system.git ref-checkout

# Compare (excluding .git)
diff -rq claude-lead-system/ ref-checkout/ --exclude=.git
```

## Artifact Inventory

Each release includes:

| Artifact | Purpose |
|----------|---------|
| `claude-lead-system.tar.gz` | Source archive |
| `SHA256SUMS.txt` | Checksum file for all artifacts |
| `checksums.txt.sig` | Cosign signature for checksums |
| `checksums.txt.pem` | Cosign certificate (Fulcio keyless) |
| `sbom.spdx.json` | SPDX Software Bill of Materials |
| `release.json` | Machine-readable manifest with all hashes |

The `release.json` manifest provides a single file for automated tools to discover and verify all release artifacts.

## References

- `docs/TAG_VERIFICATION.md` — Tag signature verification
- `docs/PROVENANCE.md` — Authorship + cosign instructions
- `.github/workflows/release-bundle.yml` — Tarball build workflow
- `.github/workflows/supply-chain.yml` — SBOM + signing workflow
