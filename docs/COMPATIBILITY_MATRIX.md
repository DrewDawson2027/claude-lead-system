<!-- GENERATED FILE: do not edit manually. -->
<!-- Source: scripts/proof/generate-compatibility-matrix.mjs -->

# Compatibility Matrix

Evidence-backed platform matrix derived from committed proof artifacts.

Generated at: 2026-03-16T00:27:34.603Z
Latest artifact completed at: 2026-03-16T00:27:34.603Z
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
| Linux | evidence-backed | [proof](../reports/compatibility/proofs/latest/linux.json) |
| Windows | unproven (no artifact) | none |

## Proof Matrix

| Capability | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Install | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/install.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/install.log)) | ⛔ no artifact |
| Launch | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/launch.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/launch.log)) | ⛔ no artifact |
| Lead boot | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/lead_boot.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/lead_boot.log)) | ⛔ no artifact |
| Message delivery | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/message_delivery.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/message_delivery.log)) | ⛔ no artifact |
| Task dispatch | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/task_dispatch.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/task_dispatch.log)) | ⛔ no artifact |
| Conflict detection | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/conflict_detection.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/conflict_detection.log)) | ⛔ no artifact |
| Resume | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/resume.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/resume.log)) | ⛔ no artifact |
| Sidecar health | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-15T214213923Z-5b214b2/sidecar_health.log)) | ✅ pass ([log](../reports/compatibility/proofs/runs/linux/2026-03-16T002637596Z-91371a9/sidecar_health.log)) | ⛔ no artifact |

## Artifact Inventory

| Platform | Run ID | Completed At (UTC) | Artifact |
| --- | --- | --- | --- |
| macOS | `2026-03-15T214213923Z-5b214b2` | 2026-03-15T21:43:24.881Z | [proof.json](../reports/compatibility/proofs/latest/macos.json) |
| Linux | `2026-03-16T002637596Z-91371a9` | 2026-03-16T00:27:34.603Z | [proof.json](../reports/compatibility/proofs/latest/linux.json) |
| Windows | none | none | n/a |

## Regeneration

```bash
node scripts/proof/generate-compatibility-matrix.mjs
```
