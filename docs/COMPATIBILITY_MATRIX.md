<!-- GENERATED FILE: do not edit manually. -->
<!-- Source: scripts/proof/generate-compatibility-matrix.mjs -->

# Compatibility Matrix

Evidence-backed platform matrix derived from committed proof artifacts.

Generated at: 2026-03-12T03:03:22.885Z
Latest artifact completed at: 2026-03-12T03:03:22.885Z
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

| Platform | Maturity                             | Artifact                                                   |
| -------- | ------------------------------------ | ---------------------------------------------------------- |
| macOS    | artifact-backed with gaps (1 failed) | [proof](../reports/compatibility/proofs/latest/macos.json) |
| Linux    | unproven (no artifact)               | none                                                       |
| Windows  | unproven (no artifact)               | none                                                       |

## Proof Matrix

| Capability         | macOS                                                                                                            | Linux          | Windows        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------- | -------------- |
| Install            | ❌ fail ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/install.log))            | ⛔ no artifact | ⛔ no artifact |
| Launch             | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/launch.log))             | ⛔ no artifact | ⛔ no artifact |
| Lead boot          | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/lead_boot.log))          | ⛔ no artifact | ⛔ no artifact |
| Message delivery   | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/message_delivery.log))   | ⛔ no artifact | ⛔ no artifact |
| Task dispatch      | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/task_dispatch.log))      | ⛔ no artifact | ⛔ no artifact |
| Conflict detection | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/conflict_detection.log)) | ⛔ no artifact | ⛔ no artifact |
| Resume             | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/resume.log))             | ⛔ no artifact | ⛔ no artifact |
| Sidecar health     | ✅ pass ([log](../reports/compatibility/proofs/runs/macos/2026-03-12T030253741Z-a7fa94c/sidecar_health.log))     | ⛔ no artifact | ⛔ no artifact |

## Artifact Inventory

| Platform | Run ID                          | Completed At (UTC)       | Artifact                                                        |
| -------- | ------------------------------- | ------------------------ | --------------------------------------------------------------- |
| macOS    | `2026-03-12T030253741Z-a7fa94c` | 2026-03-12T03:03:22.885Z | [proof.json](../reports/compatibility/proofs/latest/macos.json) |
| Linux    | none                            | none                     | n/a                                                             |
| Windows  | none                            | none                     | n/a                                                             |

## Regeneration

```bash
node scripts/proof/generate-compatibility-matrix.mjs
```
