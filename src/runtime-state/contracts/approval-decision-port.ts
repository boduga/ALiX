// src/runtime-state/contracts/approval-decision-port.ts
//
// R1 boundary freeze — ApprovalDecisionPort.
// Decisions carry actor + source provenance. No silent inference.

import type { ApprovalStatus } from "../../governance/approvals/approval-types.js";
import type { AuthorizationSource } from "./authorized-execution-port.js";

/** The approval statuses a decision record can carry — a subset of the
 *  canonical `ApprovalStatus` (reused, not redeclared). */
export type ApprovalDecisionValue = Extract<
  ApprovalStatus,
  "approved" | "denied" | "pending" | "expired"
>;

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
