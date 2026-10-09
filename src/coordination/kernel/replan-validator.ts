/**
 * replan-validator.ts — Structural validation of model-proposed replan drafts.
 *
 * Checks that a PlanRevisionDraft is structurally sound before simulation:
 * - Required fields present
 * - No duplicate draftWorkerIds
 * - All dependency references resolvable
 * - Known trigger kind
 * - Cancel/modify/replace targets exist
 *
 * This is purely structural/DAG validation — no policy or risk analysis.
 * All imports use .js extensions (NodeNext).
 */

import type { PlanTriggerKind } from "./coordination-types.js";
import type {
  PlanRevisionDraft,
  ValidationError,
  ValidationResult,
  ValidationWarning,
} from "./replan-types.js";
import type { WorkerAssignment } from "./coordination-types.js";

/**
 * The canonical set of known trigger kinds for replanning.
 */
const KNOWN_TRIGGER_KINDS: PlanTriggerKind[] = [
  "worker_completed",
  "worker_failed",
  "conflict_detected",
  "finding_published",
  "manual",
];

/**
 * ReplanValidator performs structural validation on a PlanRevisionDraft
 * against the set of existing workers. It checks constraints that must
 * hold before simulation or application can proceed.
 */
export class ReplanValidator {
  /**
   * Validate a PlanRevisionDraft against existing workers.
   *
   * @param draft — The model-proposed draft.
   * @param existingWorkers — The current set of WorkerAssignments.
   * @returns A ValidationResult with errors and warnings.
   */
  static validate(
    draft: PlanRevisionDraft,
    existingWorkers: WorkerAssignment[],
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const existingIds = new Set(existingWorkers.map((w) => w.id));

    // ── 1. Required fields ─────────────────────────────────────────────

    if (draft.triggerKind == null) {
      errors.push({
        field: "triggerKind",
        message: "triggerKind is required",
        code: "missing_trigger_kind",
      });
    }

    if (draft.triggerEvidence == null) {
      errors.push({
        field: "triggerEvidence",
        message: "triggerEvidence is required",
        code: "missing_trigger_evidence",
      });
    }

    // ── 2. Known trigger kind ──────────────────────────────────────────

    if (
      draft.triggerKind != null &&
      !KNOWN_TRIGGER_KINDS.includes(draft.triggerKind)
    ) {
      errors.push({
        field: "triggerKind",
        message: `Unknown trigger kind: "${draft.triggerKind}"`,
        code: "unknown_trigger_kind",
      });
    }

    // ── 3. Collect all draftWorkerIds and check for duplicates ─────────

    const draftIds = new Set<string>();

    for (const w of draft.workersToAdd) {
      if (draftIds.has(w.draftWorkerId)) {
        errors.push({
          field: "workersToAdd",
          message: `Duplicate draftWorkerId in workersToAdd: "${w.draftWorkerId}"`,
          code: "duplicate_draft_id",
        });
      }
      draftIds.add(w.draftWorkerId);
    }

    for (const rs of draft.workersToReplace) {
      const dwId = rs.replacement.draftWorkerId;
      if (draftIds.has(dwId)) {
        errors.push({
          field: "workersToReplace",
          message: `Duplicate draftWorkerId in replacement: "${dwId}"`,
          code: "duplicate_draft_id",
        });
      }
      draftIds.add(dwId);
    }

    // ── 4. Dependency references resolvable ────────────────────────────

    const allValidIds = new Set([...existingIds, ...draftIds]);

    for (const w of draft.workersToAdd) {
      for (const dep of w.dependencies) {
        if (!allValidIds.has(dep)) {
          errors.push({
            field: "workersToAdd",
            message: `Unresolvable dependency "${dep}" in worker "${w.draftWorkerId}"`,
            code: "unresolvable_dependency",
          });
        }
      }
    }

    for (const rs of draft.workersToReplace) {
      for (const dep of rs.replacement.dependencies) {
        if (!allValidIds.has(dep)) {
          errors.push({
            field: "workersToReplace",
            message: `Unresolvable dependency "${dep}" in replacement for "${rs.targetWorkerId}"`,
            code: "unresolvable_dependency",
          });
        }
      }
    }

    // ── 5. workersToCancel reference only existing workers ─────────────

    for (const id of draft.workersToCancel) {
      if (!existingIds.has(id)) {
        errors.push({
          field: "workersToCancel",
          message: `Cannot cancel non-existing worker: "${id}"`,
          code: "invalid_cancel_target",
        });
      }
    }

    // ── 6. workersToModify reference only existing workers ─────────────

    for (const m of draft.workersToModify) {
      if (!existingIds.has(m.workerId)) {
        errors.push({
          field: "workersToModify",
          message: `Cannot modify non-existing worker: "${m.workerId}"`,
          code: "invalid_modify_target",
        });
      }
    }

    // ── 7. workersToReplace targetWorkerId exists ──────────────────────

    for (const rs of draft.workersToReplace) {
      if (!existingIds.has(rs.targetWorkerId)) {
        errors.push({
          field: "workersToReplace",
          message: `Cannot replace non-existing worker: "${rs.targetWorkerId}"`,
          code: "invalid_replace_target",
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}
