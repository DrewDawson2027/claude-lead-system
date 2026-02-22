/**
 * Schema versioning + migration framework for sidecar state.
 */

export const CURRENT_SCHEMA_VERSION = 3;

const migrations = [
  {
    from: 1,
    to: 2,
    description: 'Add quality_gates, acceptance_criteria, audit_trail_summary to tasks; add auto_rebalance to policy',
    migrate(bundle) {
      const tasks = bundle.snapshot?.tasks || [];
      for (const t of tasks) {
        if (!t.quality_gates) t.quality_gates = [];
        if (!t.acceptance_criteria) t.acceptance_criteria = [];
        if (!t.audit_trail_summary) t.audit_trail_summary = [];
      }
      for (const team of (bundle.snapshot?.teams || [])) {
        if (!team.policy) team.policy = {};
        if (!team.policy.auto_rebalance) {
          team.policy.auto_rebalance = { enabled: false, cooldown_ms: 60000, triggers: {} };
        }
      }
      bundle.schema_version = 2;
      return bundle;
    },
  },
  {
    from: 2,
    to: 3,
    description: 'Phase E: add checkpoint_version and recovery_metadata to teams',
    migrate(bundle) {
      if (bundle.snapshot) {
        if (!bundle.snapshot.checkpoint_version) bundle.snapshot.checkpoint_version = 0;
      }
      for (const team of (bundle.snapshot?.teams || [])) {
        if (!team.recovery_metadata) {
          team.recovery_metadata = { last_checkpoint: null, last_repair: null };
        }
      }
      bundle.schema_version = 3;
      return bundle;
    },
  },
];

export function migrateBundle(bundle) {
  if (!bundle) return bundle;
  let version = bundle.schema_version || 1;
  const applied = [];

  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.find(m => m.from === version);
    if (!migration) break;
    migration.migrate(bundle);
    applied.push({ from: migration.from, to: migration.to, description: migration.description });
    version = migration.to;
  }

  bundle.schema_version = version;
  return { bundle, applied, final_version: version };
}

export function validateSchemaVersion(bundle) {
  const version = bundle?.schema_version || 1;
  return {
    valid: version === CURRENT_SCHEMA_VERSION,
    version,
    current: CURRENT_SCHEMA_VERSION,
    needs_migration: version < CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Dry-run migration — shows what would change without mutating.
 * @param {object} bundle
 * @returns {{ would_apply: Array<{ from: number, to: number, description: string }>, current_version: number, target_version: number }}
 */
export function dryRunMigration(bundle) {
  const version = bundle?.schema_version || 1;
  const wouldApply = [];
  let v = version;
  while (v < CURRENT_SCHEMA_VERSION) {
    const m = migrations.find(x => x.from === v);
    if (!m) break;
    wouldApply.push({ from: m.from, to: m.to, description: m.description });
    v = m.to;
  }
  return { would_apply: wouldApply, current_version: version, target_version: CURRENT_SCHEMA_VERSION };
}

/** Export migrations list for introspection */
export { migrations };
