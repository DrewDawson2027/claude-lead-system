import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePresenceFromMember, deriveLoadScore, deriveInterruptibility, deriveDispatchReadiness } from '../core/presence-engine.js';

test('presence engine handles offline and stale states', () => {
  assert.deepEqual(derivePresenceFromMember({}), { presence: 'offline', risk_flags: [] });
  assert.equal(derivePresenceFromMember({ session_id: 'abcd1234', session_status: 'stale' }).presence, 'stale');
  assert.equal(derivePresenceFromMember({ session_id: 'abcd1234', session_status: 'idle' }).presence, 'idle');
});

test('presence engine blocks when current task has open blockers', () => {
  const member = { session_id: 'abcd1234', session_status: 'active', current_task_ref: 'T1', risk_flags: ['conflict_risk'] };
  const allTasks = [{ task_id: 'T1', blocked_by: ['T0'] }];
  const out = derivePresenceFromMember(member, allTasks);
  assert.equal(out.presence, 'blocked_by_dependency');
  assert.deepEqual(out.risk_flags, ['conflict_risk']);
});

test('score helpers clamp values', () => {
  assert.equal(deriveLoadScore({ load_score: 150 }), 100);
  assert.equal(deriveInterruptibility({ interruptibility_score: -5 }), 0);
  assert.equal(deriveDispatchReadiness({ dispatch_readiness: 42 }), 42);
});
