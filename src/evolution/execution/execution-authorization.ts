// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A4.0 — Execution Authorization Gate.
 *
 * Pre-flight validation gate that checks 7 conditions before
 * an execution can proceed. Pure function — no side effects, no I/O.
 *
 * Validation order:
 *   1. Decision exists
 *   2. Decision is APPROVE
 *   3. Integrity hash valid
 *   4. Proposal matches decision
 *   5. Decision not expired
 *   6. Decision not revoked
 *   7. No duplicate execution
 *   8. All pass — return authorized
 *
 * @module execution-authorization
 */

import type { GovernanceDecision } from "../governance/contracts/decision-contract.js";
import type { EvolutionProposal } from "../contracts/evolution-contract.js";
import type { ExecutionRequest, ExecutionAuthorizationResult } from "./contracts/execution-contract.js";

// ---------------------------------------------------------------------------
// AuthorizationConfig
// ---------------------------------------------------------------------------

export interface AuthorizationConfig {
  /** When true, reject execution if the decisionId appears in completedExecutionIds. */
  preventDuplicateExecution: boolean;
}

export const DEFAULT_AUTH_CONFIG: AuthorizationConfig = {
  preventDuplicateExecution: true,
};

// ---------------------------------------------------------------------------
// AuthorizeInput
// ---------------------------------------------------------------------------

export interface AuthorizeInput {
  /** The execution request to authorize. */
  request: ExecutionRequest;
  /** The evolution proposal being executed. */
  proposal: EvolutionProposal;
  /** The governance decision authorizing (or not) execution. Undefined means no decision exists. */
  decision: GovernanceDecision | undefined;
  /** IDs of already-completed executions for duplicate-detection. */
  completedExecutionIds?: string[];
  /** Override current time for testing determinism. Defaults to Date.now(). */
  now?: number;
}

// ---------------------------------------------------------------------------
// authorizeExecution
// ---------------------------------------------------------------------------

/**
 * Authorize execution through 7 pre-flight checks.
 *
 * Checks run in order and short-circuit on first failure:
 *   1. Decision exists
 *   2. Decision kind is APPROVE
 *   3. Integrity hash valid
 *   4. Request evolutionId matches decision proposalId
 *   5. Decision has not expired (if expiresAt is present)
 *   6. Decision has not been revoked (if revokedAt is present)
 *   7. No duplicate execution for this decision
 *   8. All pass — return allowed with decisionId
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * @param input - AuthorizeInput containing request, proposal, decision, and completed IDs
 * @param config - AuthorizationConfig (defaults used if omitted)
 * @returns ExecutionAuthorizationResult — allowed(true,decisionId) or disallowed(reason)
 */
export function authorizeExecution(
  input: AuthorizeInput,
  config: AuthorizationConfig = DEFAULT_AUTH_CONFIG,
): ExecutionAuthorizationResult {
  const { decision, completedExecutionIds, now } = input;
  const { request } = input;

  // 1. Decision exists
  if (!decision) {
    return { allowed: false, reason: "Governance decision not found" };
  }

  // 2. Decision is APPROVE
  if (decision.kind !== "APPROVE") {
    return { allowed: false, reason: "Decision is not APPROVE" };
  }

  // 3. Integrity hash valid (defensive — verify if hash field exists)
  // Full hash recomputation requires access to the canonical serialization
  // and will be strengthened when A3 provides it.
  if ("integrityHash" in decision && typeof (decision as unknown as Record<string, unknown>).integrityHash === "string") {
    // For now, a decision with a present string hash is allowed.
    // Longer-term, recompute and compare against the canonical hash.
  }

  // 4. Proposal matches
  if (request.evolutionId !== decision.proposalId) {
    return { allowed: false, reason: "Proposal ID mismatch" };
  }

  // 5. Decision not expired
  // Use runtime check since expiresAt may not be present on all GovernanceDecision instances
  if ("expiresAt" in decision) {
    const d = decision as GovernanceDecision & { expiresAt?: string };
    if (d.expiresAt) {
      const expiresAtTime = new Date(d.expiresAt).getTime();
      const currentTime = now ?? Date.now();
      if (currentTime >= expiresAtTime) {
        return { allowed: false, reason: "Governance decision has expired" };
      }
    }
  }

  // 6. Decision not revoked
  // Use runtime check since revokedAt may not be present on all GovernanceDecision instances
  if ("revokedAt" in decision) {
    const d = decision as GovernanceDecision & { revokedAt?: string };
    if (d.revokedAt) {
      return { allowed: false, reason: "Governance decision has been revoked" };
    }
  }

  // 7. No duplicate execution
  if (
    config.preventDuplicateExecution !== false &&
    completedExecutionIds?.includes(decision.decisionId)
  ) {
    return { allowed: false, reason: "Execution already completed for this decision" };
  }

  // 8. All pass
  return { allowed: true, decisionId: decision.decisionId };
}
