// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A3 — InMemoryGovernanceDecisionStore.
 *
 * In-memory implementation of the GovernanceDecisionStore interface.
 * Follows the same pattern as InMemoryVerificationEvidenceLedger from A2.4
 * (async methods, structuredClone for deep copies, Map-based storage).
 *
 * @module decision-store
 */

import type { GovernanceDecision } from "./contracts/decision-contract.js";
import type { GovernanceDecisionStore } from "./contracts/decision-store-contract.js";
import {
  DecisionNotFoundError,
  DuplicateDecisionError,
} from "./contracts/decision-store-contract.js";

// ---------------------------------------------------------------------------
// InMemoryGovernanceDecisionStore
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of the governance decision store.
 *
 * Uses a Map for storage. Suitable for testing and initial deployment;
 * swap for a persistent implementation when available.
 *
 * @invariant Once stored, a decision is never modified or deleted.
 * @invariant get() returns a defensive deep copy of the stored decision.
 */
export class InMemoryGovernanceDecisionStore implements GovernanceDecisionStore {
  private readonly decisions = new Map<string, GovernanceDecision>();

  async store(decision: GovernanceDecision): Promise<GovernanceDecision> {
    // Append-only: reject duplicate decisionId
    if (this.decisions.has(decision.decisionId)) {
      throw new DuplicateDecisionError(decision.decisionId);
    }

    // Store a defensive deep copy
    const stored = structuredClone(decision);
    this.decisions.set(decision.decisionId, stored);
    return structuredClone(decision);
  }

  async get(decisionId: string): Promise<GovernanceDecision> {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    return structuredClone(decision);
  }

  async listByProposal(proposalId: string): Promise<GovernanceDecision[]> {
    const results: GovernanceDecision[] = [];

    for (const decision of this.decisions.values()) {
      if (decision.proposalId !== proposalId) continue;
      results.push(structuredClone(decision));
    }

    return results;
  }

  async listByEvolution(evolutionId: string): Promise<GovernanceDecision[]> {
    const results: GovernanceDecision[] = [];

    for (const decision of this.decisions.values()) {
      if (decision.evolutionId !== evolutionId) continue;
      results.push(structuredClone(decision));
    }

    return results;
  }
}
