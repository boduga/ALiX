// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A3 — Governance Decision Store Contract.
 *
 * Append-only storage for GovernanceDecision records. Follows the same
 * pattern as VerificationEvidenceLedger from A2.4: async methods, deep
 * copy returns, append-once-with-ID invariant.
 *
 * @module decision-store-contract
 */

import type { GovernanceDecision } from "./decision-contract.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when attempting to retrieve a decision by an ID that does not exist.
 */
export class DecisionNotFoundError extends Error {
  readonly kind = "DecisionNotFoundError" as const;
  readonly decisionId: string;

  constructor(decisionId: string) {
    super(`Governance decision not found: ${decisionId}`);
    this.name = "DecisionNotFoundError";
    this.decisionId = decisionId;
  }
}

/**
 * Thrown when attempting to store a decision with a duplicate decisionId
 * (append-only invariant violation).
 */
export class DuplicateDecisionError extends Error {
  readonly kind = "DuplicateDecisionError" as const;
  readonly decisionId: string;

  constructor(decisionId: string) {
    super(
      `Governance decision ${decisionId} already exists (append-only invariant)`,
    );
    this.name = "DuplicateDecisionError";
    this.decisionId = decisionId;
  }
}

// ---------------------------------------------------------------------------
// GovernanceDecisionStore
// ---------------------------------------------------------------------------

/**
 * Append-only store for governance decisions.
 *
 * @invariant Once stored, a decision is never modified or deleted.
 * @invariant get() returns a defensive deep copy of the stored decision.
 */
export interface GovernanceDecisionStore {
  /**
   * Store a governance decision.
   *
   * Rejects duplicate decisionId (append-only invariant).
   * Returns a defensive deep copy of the stored decision.
   */
  store(decision: GovernanceDecision): Promise<GovernanceDecision>;

  /**
   * Retrieve a decision by ID.
   *
   * Returns a defensive deep copy.
   * Throws DecisionNotFoundError if the ID does not exist.
   */
  get(decisionId: string): Promise<GovernanceDecision>;

  /**
   * List all decisions for a given proposal.
   *
   * Returns defensive deep copies.
   * Returns an empty array if no decisions exist for the proposal.
   */
  listByProposal(proposalId: string): Promise<GovernanceDecision[]>;

  /**
   * List all decisions for a given evolution.
   *
   * Returns defensive deep copies.
   * Returns an empty array if no decisions exist for the evolution.
   */
  listByEvolution(evolutionId: string): Promise<GovernanceDecision[]>;
}
