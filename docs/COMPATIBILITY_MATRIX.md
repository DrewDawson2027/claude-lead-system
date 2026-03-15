<!-- GENERATED FILE: do not edit manually. -->
<!-- Source: scripts/proof/generate-compatibility-matrix.mjs -->

# Compatibility Matrix

Evidence-backed platform matrix derived from committed proof artifacts.

Generated at: 2026-03-15T21:43:24.881Z
Latest artifact completed at: 2026-03-15T21:43:24.881Z
Proof root: `reports/compatibility/proofs`

Rule: platform claims must be grounded in in-repo proof artifacts with explicit pass/fail/unproven reasons.

Legend: ✅ pass | ❌ fail | ⚪ not run | 🚫 unsupported | ⛔ no artifact

## Proof Coverage Contract

- `install`: Install
- `launch`: Launch
- `lead_boot`: Lead boot
- `message_delivery`: Message delivery
- `task_dispatch`: Task dispatch
- `conflict_detection`: Conflict detection
- `resume`: Resume
- `sidecar_health`: Sidecar health

## Platform Maturity

| Platform | Maturity | Artifact |
| --- | --- | --- |
| macOS | evidence-backed | [proof](../reports/compatibility/proofs/latest/macos.json) |
| Linux | unproven (no artifact) | none |
| Windows | unproven (no artifact) | none |

## Proof Matrix

| Capability | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Install | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/install.log)) | ⛔ no artifact | ⛔ no artifact |
| Launch | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/launch.log)) | ⛔ no artifact | ⛔ no artifact |
| Lead boot | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/lead_boot.log)) | ⛔ no artifact | ⛔ no artifact |
| Message delivery | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/message_delivery.log)) | ⛔ no artifact | ⛔ no artifact |
| Task dispatch | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/task_dispatch.log)) | ⛔ no artifact | ⛔ no artifact |
| Conflict detection | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/conflict_detection.log)) | ⛔ no artifact | ⛔ no artifact |
| Resume | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/resume.log)) | ⛔ no artifact | ⛔ no artifact |
| Sidecar health | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/sidecar_health.log)) | ⛔ no artifact | ⛔ no artifact |

## Artifact Inventory

| Platform | Run ID | Completed At (UTC) | Artifact |
| --- | --- | --- | --- |
| macOS | `2026-03-15T214213923Z-5b214b2` | 2026-03-15T21:43:24.881Z | [proof.json](../reports/compatibility/proofs/latest/macos.json) |
| Linux | none | none | n/a |
| Windows | none | none | n/a |

## Regeneration

```bash
node scripts/proof/generate-compatibility-matrix.mjs
```
