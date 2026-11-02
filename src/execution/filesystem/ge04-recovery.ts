/**
 * GE-04 crash-recovery inspection. Read-only by design: a pending consumed
 * approval may belong to a LIVE worker. Restart alone is not proof of death.
 * No automatic replay, mutation, or terminal classification is permitted.
 */
import { ApprovalStore } from "../../governance/approvals/approval-store.js";

export type Ge04UncertainClaim = Readonly<{
  approvalId: string;
  executionOutcome: "pending" | "unverified";
  workerId: string | undefined;
  consumedAt: string | undefined;
  invocationFingerprint: string | undefined;
}>;

/** Reload the durable store before listing unresolved claims. */
export async function inspectGe04UncertainClaims(store: ApprovalStore): Promise<readonly Ge04UncertainClaim[]> {
  if (!(store instanceof ApprovalStore)) throw new Error("GE-04: real approval store required");
  await store.load(); // propagates failures; never claim an empty result on storage error
  return store.listUncertainConsumptions().map(record => ({
    approvalId: record.id,
    executionOutcome: record.executionOutcome as "pending" | "unverified",
    workerId: record.workerId,
    consumedAt: record.consumedAt,
    invocationFingerprint: record.invocationFingerprint,
  }));
}

/**
 * Conservative reconciliation gate. An approval record has a worker ID but
 * does NOT durably bind an execution-owner process identity, process start
 * identity, or native-helper receipt. A PID supplied by the caller cannot
 * fill that gap: it may refer to an unrelated/reused process. Consequently no
 * claim can be automatically finalized by this prototype.
 */
export type Ge04ReconciliationAssessment = Readonly<{
  approvalId: string;
  eligibleForAutomaticTransition: false;
  reason: "missing_trusted_execution_owner_and_native_receipt";
}>;

export function assessGe04Reconciliation(
  claim: Ge04UncertainClaim,
): Ge04ReconciliationAssessment {
  return {
    approvalId: claim.approvalId,
    eligibleForAutomaticTransition: false,
    reason: "missing_trusted_execution_owner_and_native_receipt",
  };
}
