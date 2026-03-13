#!/usr/bin/env bash
set -euo pipefail

exec bash bench/workloads/ab-path-runner.sh lead_overlay AB_LEAD_OVERLAY_WORKFLOW_CMD
