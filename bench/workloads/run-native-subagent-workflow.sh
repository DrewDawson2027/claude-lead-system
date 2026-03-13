#!/usr/bin/env bash
set -euo pipefail

exec bash bench/workloads/ab-path-runner.sh native AB_NATIVE_SUBAGENT_WORKFLOW_CMD
