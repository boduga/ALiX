/**
 * P20.2 — Evidence Capture Contract.
 *
 * Defines required evidence refs and validation for completed manual
 * actions. Pure in-memory validation — no store reads or writes.
 */

export interface HandoffCaptureEvidence {
  ref: string;
  capturedAt: string;
  capturedBy: string;
  description: string;
  payload: Record<string, unknown>;
}

export interface HandoffEvidenceValidation {
  handoffId: string;
  totalRequired: number;
  totalCaptured: number;
  missingRefs: string[];
  valid: boolean;
}

export class HandoffEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffEvidenceError";
  }
}

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateHandoffEvidence(
  requiredRefs: string[],
  evidence: Record<string, HandoffCaptureEvidence>,
): HandoffEvidenceValidation {
  const missingRefs: string[] = [];

  for (const ref of requiredRefs) {
    const capture = evidence[ref];
    if (!capture) {
      missingRefs.push(ref);
      continue;
    }
    if (
      !ISO_TIMESTAMP_PATTERN.test(capture.capturedAt) ||
      Number.isNaN(Date.parse(capture.capturedAt))
    ) {
      throw new HandoffEvidenceError(
        `evidence "${ref}" has invalid capturedAt: "${capture.capturedAt}"`,
      );
    }
    if (
      typeof capture.capturedBy !== "string" ||
      capture.capturedBy.trim().length === 0
    ) {
      throw new HandoffEvidenceError(
        `evidence "${ref}" has empty or missing capturedBy`,
      );
    }
  }

  const valid = missingRefs.length === 0;
  return {
    handoffId: "",
    totalRequired: requiredRefs.length,
    totalCaptured: requiredRefs.length - missingRefs.length,
    missingRefs,
    valid,
  };
}
