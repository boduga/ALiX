// src/contracts/approval-decision-port.ts
//
// R1 boundary freeze — ApprovalDecisionPort.
// Decisions carry actor + source provenance. No silent inference.

import type { AuthorizationSource } from "./authorized-execution-port.js";

export type ApprovalDecisionValue = "approved" | "denied" | "pending" | "expired";

export interface ApprovalDecision {
  decision: ApprovalDecisionValue;
  actor: string;
  source: AuthorizationSource;
  reason: string;
  decidedAt?: string;
  evidenceRef?: string;
}

export interface ApprovalDecisionPort {
  decide(request: unknown): Promise<ApprovalDecision>;
  describe(id: string): Promise<ApprovalDecision | null>;
}
