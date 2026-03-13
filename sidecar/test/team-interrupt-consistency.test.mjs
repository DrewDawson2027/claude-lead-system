import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamInterrupts } from "../server/runtime/team-utils.ts";

test("buildTeamInterrupts keeps approval actionable and stale wake consistency", () => {
  const snapshot = {
    teams: [{ team_name: "alpha", policy: {} }],
    teammates: [
      {
        id: "tm-1",
        team_name: "alpha",
        display_name: "Worker One",
        presence: "waiting_for_plan_approval",
        worker_task_id: "W-101",
        risk_flags: [],
        last_active: "2026-03-12T09:00:00.000Z",
      },
      {
        id: "tm-2",
        team_name: "alpha",
        display_name: "Worker Two",
        presence: "waiting_for_plan_approval",
        worker_task_id: null,
        current_task_ref: null,
        risk_flags: [],
        last_active: "2026-03-12T09:01:00.000Z",
      },
      {
        id: "tm-3",
        team_name: "alpha",
        display_name: "Worker Three",
        presence: "stale",
        session_id: null,
        risk_flags: [],
        last_active: "2026-03-12T09:02:00.000Z",
      },
    ],
    alerts: [],
  };
  const interrupts = buildTeamInterrupts({
    snapshot,
    teamName: "alpha",
    teamPolicy: {},
  });
  const actionableApproval = interrupts.find((i) => i.id === "approval:tm-1");
  assert.ok(actionableApproval, "missing actionable approval interrupt");
  assert.equal(actionableApproval.kind, "approval");
  assert.equal(actionableApproval.task_id, "W-101");
  assert.deepEqual(actionableApproval.suggested_actions, [
    "approve-plan",
    "reject-plan",
  ]);

  const missingTaskApproval = interrupts.find(
    (i) => i.id === "approval-missing-task:tm-2",
  );
  assert.ok(missingTaskApproval, "missing approval_task_missing alert");
  assert.equal(missingTaskApproval.kind, "alert");
  assert.equal(missingTaskApproval.code, "approval_task_missing");
  assert.equal(missingTaskApproval.task_id || null, null);
  assert.deepEqual(missingTaskApproval.suggested_actions, [
    "view-detail",
    "directive",
  ]);

  const staleNoSession = interrupts.find((i) => i.id === "stale:tm-3");
  assert.ok(staleNoSession, "missing stale interrupt");
  assert.equal(staleNoSession.kind, "stale");
  assert.equal(staleNoSession.safe_auto, false);
  assert.deepEqual(staleNoSession.suggested_actions, ["directive"]);
});

test("buildTeamInterrupts ranks actionable approval above stale and generic alerts", () => {
  const snapshot = {
    teams: [{ team_name: "alpha", policy: {} }],
    teammates: [
      {
        id: "tm-approval",
        team_name: "alpha",
        display_name: "Approver",
        presence: "waiting_for_plan_approval",
        worker_task_id: "W-201",
        risk_flags: [],
        last_active: "2026-03-12T10:00:00.000Z",
      },
      {
        id: "tm-stale",
        team_name: "alpha",
        display_name: "Stale Worker",
        presence: "stale",
        session_id: "sess-1",
        risk_flags: [],
        last_active: "2026-03-12T10:01:00.000Z",
      },
    ],
    alerts: [
      {
        level: "warn",
        code: "misc_alert",
        message: "misc",
        ts: "2026-03-12T10:02:00.000Z",
      },
    ],
  };
  const interrupts = buildTeamInterrupts({
    snapshot,
    teamName: "alpha",
    teamPolicy: {},
  });
  assert.equal(interrupts[0]?.kind, "approval");
  assert.equal(interrupts[0]?.task_id, "W-201");
  assert.ok(
    (interrupts[0]?.priority_score || 0) >= (interrupts[1]?.priority_score || 0),
  );
});
