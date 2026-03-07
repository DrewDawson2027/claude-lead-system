import { homedir } from "os";
import { join } from "path";

export function sidecarPaths() {
  const home = process.env.HOME || homedir();
  const claudeDir = join(home, ".claude");
  const terminalsDir = join(claudeDir, "terminals");
  const root = join(claudeDir, "lead-sidecar");
  return {
    home,
    claudeDir,
    terminalsDir,
    settingsFile: join(claudeDir, "settings.local.json"),
    teamsDir: join(terminalsDir, "teams"),
    tasksDir: join(terminalsDir, "tasks"),
    resultsDir: join(terminalsDir, "results"),
    inboxDir: join(terminalsDir, "inbox"),
    activityFile: join(terminalsDir, "activity.jsonl"),
    root,
    runtimeDir: join(root, "runtime"),
    nativeRuntimeDir: join(root, "runtime", "native"),
    nativeBridgeRequestDir: join(
      root,
      "runtime",
      "native",
      "bridge.request-queue",
    ),
    nativeBridgeResponseDir: join(
      root,
      "runtime",
      "native",
      "bridge.response-queue",
    ),
    nativeCapabilitiesFile: join(
      root,
      "runtime",
      "native",
      "capabilities.json",
    ),
    nativeBridgeLockFile: join(root, "runtime", "native", "bridge.lock"),
    nativeBridgeStatusFile: join(
      root,
      "runtime",
      "native",
      "bridge.status.json",
    ),
    nativeBridgeHeartbeatFile: join(
      root,
      "runtime",
      "native",
      "bridge.heartbeat.json",
    ),
    nativeBridgeValidationFile: join(
      root,
      "runtime",
      "native",
      "bridge.validation.json",
    ),
    nativeBridgeValidationLogFile: join(
      root,
      "logs",
      "bridge-validation.jsonl",
    ),
    actionsRootDir: join(root, "runtime", "actions"),
    actionsPendingDir: join(root, "runtime", "actions", "pending"),
    actionsInflightDir: join(root, "runtime", "actions", "inflight"),
    actionsDoneDir: join(root, "runtime", "actions", "done"),
    actionsFailedDir: join(root, "runtime", "actions", "failed"),
    apiTokenFile: join(root, "runtime", "api.token"),
    csrfTokenFile: join(root, "runtime", "csrf.token"),
    stateDir: join(root, "state"),
    logsDir: join(root, "logs"),
    diagnosticsDir: join(root, "logs", "diagnostics"),
    lockFile: join(root, "runtime", "sidecar.lock"),
    portFile: join(root, "runtime", "sidecar.port"),
    snapshotFile: join(root, "state", "latest.json"),
    logFile: join(root, "logs", "timeline.jsonl"),
    uiPrefsFile: join(root, "state", "ui-prefs.json"),
    taskTemplatesFile: join(root, "state", "task-templates.json"),
    metricsHistoryDir: join(root, "state", "metrics-history"),
    snapshotHistoryDir: join(root, "state", "snapshot-history"),
    checkpointsDir: join(root, "state", "checkpoints"),
    backupsDir: join(root, "state", "backups"),
    hooksDir: join(claudeDir, "hooks"),
  };
}
