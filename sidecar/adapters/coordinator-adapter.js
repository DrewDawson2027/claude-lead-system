import { handleTeamDispatch } from "../../mcp-coordinator/lib/team-dispatch.js";
import { handleSpawnWorker } from "../../mcp-coordinator/lib/workers.js";
import {
  handleTeamStatusCompact,
  handleTeamQueueTask,
  handleTeamAssignNext,
  handleTeamRebalance,
  buildTeamRebalanceExplainData,
  handleSidecarStatus,
} from "../../mcp-coordinator/lib/team-tasking.js";
import {
  handleSendMessage,
  handleSendDirective,
} from "../../mcp-coordinator/lib/messaging.js";
import {
  handleApprovePlan,
  handleRejectPlan,
} from "../../mcp-coordinator/lib/approval.js";
import { handleWakeSession } from "../../mcp-coordinator/lib/platform/wake.js";
import {
  handleCheckQualityGates,
  handleReassignTask,
} from "../../mcp-coordinator/lib/tasks.js";
import {
  handleGetTeam,
  handleUpdateTeamPolicy,
} from "../../mcp-coordinator/lib/teams.js";

function toText(res) {
  return res?.content?.[0]?.text || "";
}

export class CoordinatorAdapter {
  async health() {
    return {
      ok: true,
      mode: "local-module",
      note: "Coordinator handler modules loaded directly.",
    };
  }

  async getTeam(team_name) {
    return { text: toText(handleGetTeam({ team_name })) };
  }

  async statusCompact(team_name) {
    return { text: toText(handleTeamStatusCompact({ team_name })) };
  }

  async sidecarStatus() {
    return { text: toText(handleSidecarStatus({})) };
  }

  async rebalanceExplain(team_name, payload = {}) {
    return buildTeamRebalanceExplainData({ team_name, ...payload });
  }

  async execute(action, payload = {}) {
    switch (action) {
      case "queue-task":
        return { text: toText(handleTeamQueueTask(payload)) };
      case "assign-next":
        return { text: toText(handleTeamAssignNext(payload)) };
      case "rebalance":
        return { text: toText(handleTeamRebalance(payload)) };
      case "rebalance-explain":
        return this.rebalanceExplain(payload.team_name, payload);
      case "dispatch":
        return { text: toText(handleTeamDispatch(payload)) };
      case "message":
        return { text: toText(handleSendMessage(payload)) };
      case "directive":
        return { text: toText(handleSendDirective(payload)) };
      case "approve-plan":
        return { text: toText(handleApprovePlan(payload)) };
      case "reject-plan":
        return { text: toText(handleRejectPlan(payload)) };
      case "reassign-task":
        return { text: toText(handleReassignTask(payload)) };
      case "gate-check":
        return { text: toText(handleCheckQualityGates(payload)) };
      case "update-team-policy":
        return { text: toText(handleUpdateTeamPolicy(payload)) };
      case "wake":
        return { text: toText(handleWakeSession(payload)) };
      case "spawn-worker-raw":
        return { text: toText(handleSpawnWorker(payload)) };
      default:
        throw new Error(`Unsupported coordinator action: ${action}`);
    }
  }
}
