#!/usr/bin/env bash
set -euo pipefail

exec bash bench/workloads/ab-path-runner.sh lead_coordinator AB_LEAD_COORDINATOR_WORKFLOW_CMD
