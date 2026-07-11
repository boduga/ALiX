/**
 * X3a — Governance Execution Types.
 *
 * Bridge types that map X2 ExecutionEvidence into governance-consumable form.
 * Each interface is deliberately minimal — it does NOT expose artifacts, logs,
 * runtime metrics, or verification details beyond the governance-relevant
 * verificationPassed boolean on ComplianceExecutionSummary.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// ExecutionRef
// ---------------------------------------------------------------------------

/**
 * Minimal immutable execution identity.
 *
 * Governed operations reference executions through this narrow contract.
 * Does NOT expose: artifacts, logs, runtime metrics, verification details.
 */
export interface ExecutionRef {
  /** Unique identifier for the execution evidence. */
  readonly evidenceId: string;
  /** Unique identifier for the execution intent. */
  readonly intentId: string;
  /** Execution outcome classification. */
  readonly outcome:
    | "SUCCESS"
    | "FAILED"
    | "PARTIAL";
  /** ISO-8601 timestamp when the execution completed. */
  readonly completedAt: string;
  /** Cryptographic hash of the execution evidence. */
  readonly evidenceHash: string;
}

// ---------------------------------------------------------------------------
// ExecutionLineageRef
// ---------------------------------------------------------------------------

/**
 * Explicit governance-to-execution relationship.
 *
 * Links a governance candidate back through its intent to the execution
 * evidence that produced it. All three identifiers are required — the
 * relationship is not valid without the full chain.
 */
export interface ExecutionLineageRef {
  /** Unique identifier for the governance candidate. */
  readonly candidateId: string;
  /** Unique identifier for the execution intent. */
  readonly intentId: string;
  /** Unique identifier for the execution evidence. */
  readonly evidenceId: string;
}

// ---------------------------------------------------------------------------
// ComplianceExecutionSummary
// ---------------------------------------------------------------------------

/**
 * Compliance-oriented summary of an execution.
 *
 * Includes only the fields relevant to compliance and governance reporting.
 * The summary field is a free-text description; verificationPassed indicates
 * whether the execution satisfied its compliance criteria.
 */
export interface ComplianceExecutionSummary {
  /** Unique identifier for the execution evidence. */
  readonly evidenceId: string;
  /** Unique identifier for the execution intent. */
  readonly intentId: string;
  /** Execution outcome classification. */
  readonly outcome:
    | "SUCCESS"
    | "FAILED"
    | "PARTIAL";
  /** ISO-8601 timestamp when the execution completed. */
  readonly completedAt: string;
  /** Whether the execution passed verification checks. */
  readonly verificationPassed: boolean;
  /** Free-text summary of the execution for compliance contexts. */
  readonly summary: string;
}
