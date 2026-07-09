/**
 * P20.3 — Post-Handoff Recording Preparation.
 *
 * Returns a P17-compatible GovernanceExecutionAttempt object from
 * validated handoff evidence. Does not call .append() or persist.
 * The caller decides whether to persist through the P17 recorder/store path.
 */

import type {
  GovernanceExecutionAttempt,
  GovernanceExecutionActionResult,
} from "./execution-recorder.js";
import type { HandoffPackage } from "./handoff-builder.js";
import type { HandoffCaptureEvidence } from "./handoff-evidence.js";
import { validateHandoffEvidence } from "./handoff-evidence.js";

export class HandoffRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffRecordError";
  }
}

export function prepareHandoffRecord(
  handoff: HandoffPackage,
  evidence: Record<string, HandoffCaptureEvidence>,
  options: { now?: string; recordedBy?: string } = {},
): GovernanceExecutionAttempt {
  // Validate evidence first
  const requiredRefs = handoff.evidence
    .filter((e) => e.required)
    .map((e) => e.ref);
  const validation = validateHandoffEvidence(requiredRefs, evidence);

  if (!validation.valid) {
    throw new HandoffRecordError(
      `handoff "${handoff.handoffId}" has missing evidence: ${validation.missingRefs.join(", ")}`,
    );
  }

  const now = options.now ?? new Date().toISOString();
  const actionResults: GovernanceExecutionActionResult[] = Object.entries(evidence).map(([ref, capture]) => ({
    actionId: ref.replace(/^handoff\//, "").replace(/\/evidence$/, ""),
    status: "succeeded",
    summary: capture.description,
    evidenceRefs: [ref],
  }));

  return {
    attemptId: `handoff-${handoff.handoffId}`,
    planId: handoff.planId,
    remediationId: handoff.remediationId,
    approvalId: handoff.approvalId,
    status: "succeeded",
    startedAt: now,
    completedAt: now,
    executedBy: options.recordedBy ?? "operator",
    actionResults,
    failureReason: null,
    revertAttemptId: null,
    auditRefs: [],
  };
}
