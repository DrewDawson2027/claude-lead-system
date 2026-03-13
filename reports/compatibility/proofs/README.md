# Compatibility Proof Artifacts

This directory stores machine-generated cross-platform proof artifacts.

- `runs/<platform>/<run-id>/proof.json`: full proof report for one run.
- `runs/<platform>/<run-id>/*.log`: per-capability command logs.
- `latest/<platform>.json`: latest committed proof for each platform.

Supported platform IDs:

- `macos`
- `linux`
- `windows`

Proof capabilities:

- install
- launch
- lead_boot
- message_delivery
- task_dispatch
- conflict_detection
- resume
- sidecar_health

Rules:

- Platform maturity claims must come from `latest/*.json` artifacts.
- No artifact means no maturity upgrade.
- Missing or failed checks must remain explicit in the compatibility matrix.
