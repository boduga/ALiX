/**
 * X3a — Evidence to Governance Adapter.
 *
 * Canonical pure mapping functions that convert X2 ExecutionEvidence
 * into governance-consumable types (ExecutionRef, ComplianceExecutionSummary).
 *
 * These are the single canonical mapping for ALL governance consumers.
 * They must be pure, deterministic, and field-accurate.
 *
 * @module
 */

import { type ExecutionEvidence } from "../runtime/contracts/execution-intent-contract.js";
import {
  type ExecutionRef,
  type ComplianceExecutionSummary,
} from "./governance-execution-types.js";

// ---------------------------------------------------------------------------
// Adapter Functions
// ---------------------------------------------------------------------------

/**
 * Convert an ExecutionEvidence to a minimal ExecutionRef.
 *
 * Selects only the identity and outcome fields — deliberately excludes
 * artifacts, logs, runtime metrics, and verification details.
 *
 * @param evidence - The execution evidence to convert.
 * @returns A minimal ExecutionRef suitable for governance identity tracking.
 */
export function toExecutionRef(evidence: ExecutionEvidence): ExecutionRef {
  return {
    evidenceId: evidence.evidenceId,
    intentId: evidence.intentId,
    outcome: evidence.outcome,
    completedAt: evidence.completedAt,
    evidenceHash: evidence.evidenceHash,
  };
}

/**
 * Convert an ExecutionEvidence to a ComplianceExecutionSummary.
 *
 * Includes compliance-relevant fields: identity, outcome, timing,
 * verification status, and free-text summary. Does NOT expose
 * artifacts, logs, or runtime metrics.
 *
 * @param evidence - The execution evidence to convert.
 * @returns A ComplianceExecutionSummary suitable for compliance reporting.
 */
export function toComplianceExecutionSummary(
  evidence: ExecutionEvidence,
): ComplianceExecutionSummary {
  return {
    evidenceId: evidence.evidenceId,
    intentId: evidence.intentId,
    outcome: evidence.outcome,
    completedAt: evidence.completedAt,
    verificationPassed: evidence.verificationPassed,
    summary: evidence.summary,
  };
}
