// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.4 — GovernanceIntakeAdapter
 *
 * Bridges pattern discovery output into the A0 evolution lifecycle.
 * Consumes EvolutionCandidate arrays (from DiscoveryResult.candidates),
 * generates formal EvolutionProposal artifacts, and registers them
 * in the EvolutionStateMachine at the PROPOSED state.
 *
 * This is the only component that may convert discovery output into
 * lifecycle artifacts. It enforces the invariant that A1 is proposal-only
 * by calling createEvolution() (creation), never transition() (mutation).
 *
 * @module governance-intake-adapter
 */

import { EvolutionState } from "../contracts/evolution-contract.js";
import type { EvolutionProposal } from "../contracts/evolution-contract.js";
import type { EvolutionCandidate } from "../contracts/pattern-discovery-contract.js";
import type { EvolutionStateMachine } from "../evolution-state-machine.js";
import type { EvolutionProposalGenerator } from "./evolution-proposal-generator.js";

// ---------------------------------------------------------------------------
// IntakeResult
// ---------------------------------------------------------------------------

/**
 * Result of a governance intake operation.
 *
 * @property registered - Proposals successfully registered in the state machine.
 * @property failed - Candidates that could not be registered, with reasons.
 */
export interface IntakeResult {
  readonly registered: readonly EvolutionProposal[];
  readonly failed: readonly IntakeFailure[];
}

/**
 * A candidate that failed intake with the reason.
 */
export interface IntakeFailure {
  /** Candidate identifier. */
  readonly candidateId: string;
  /** Human-readable failure reason. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// GovernanceIntakeAdapter Interface
// ---------------------------------------------------------------------------

/**
 * Governance intake adapter interface.
 *
 * Converts discovery candidates into registered lifecycle proposals.
 * Each proposal is registered in the EvolutionStateMachine at PROPOSED
 * state with metadata from the originating candidate.
 *
 * @invariant Never calls EvolutionStateMachine.transition().
 * @invariant Never self-approves proposals.
 * @invariant Best-effort: one failed registration does not block others.
 */
export interface GovernanceIntakeAdapter {
  /**
   * Intake candidates, generating and registering proposals.
   *
   * @param candidates - Candidates from a discovery run.
   * @param stateMachine - The evolution state machine to register in.
   * @returns Intake result with registered proposals and failures.
   */
  intake(
    candidates: readonly EvolutionCandidate[],
    stateMachine: EvolutionStateMachine,
  ): Promise<IntakeResult>;
}

// ---------------------------------------------------------------------------
// DefaultGovernanceIntakeAdapter
// ---------------------------------------------------------------------------

/**
 * Default implementation of GovernanceIntakeAdapter.
 *
 * For each candidate:
 * 1. Generate EvolutionProposal + EvolutionProposalDraft via generator
 * 2. Register in state machine at PROPOSED state with metadata
 * 3. On DuplicateEvolutionError, skip and report as failed
 * 4. On any other error, skip and report as failed
 *
 * @invariant Calls createEvolution() only — never transition().
 * @invariant Per-candidate error isolation — one failure does not block others.
 */
export class DefaultGovernanceIntakeAdapter implements GovernanceIntakeAdapter {
  readonly name = "DefaultGovernanceIntakeAdapter";

  private readonly generator: EvolutionProposalGenerator;

  constructor(generator: EvolutionProposalGenerator) {
    this.generator = generator;
  }

  async intake(
    candidates: readonly EvolutionCandidate[],
    stateMachine: EvolutionStateMachine,
  ): Promise<IntakeResult> {
    const registered: EvolutionProposal[] = [];
    const failed: IntakeFailure[] = [];

    for (const candidate of candidates) {
      try {
        const { proposal } = this.generator.generate(candidate);

        // Register at PROPOSED state with candidate metadata
        stateMachine.createEvolution(
          proposal.evolutionId,
          EvolutionState.PROPOSED,
          {
            targetKind: candidate.target.kind,
            targetId: candidate.target.id,
            origin: "system_observation",
            riskClass: candidate.riskClass,
            createdAt: proposal.createdAt,
            expectedEffect: candidate.expectedEffect,
          },
        );

        registered.push(proposal);
      } catch (err) {
        failed.push({
          candidateId: candidate.candidateId,
          reason: err instanceof Error ? err.message : `Unknown error: ${String(err)}`,
        });
      }
    }

    return { registered, failed };
  }
}
