// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.2 — EvolutionProposalGenerator
 *
 * Maps evolution candidates to A0 EvolutionProposal artifacts and
 * EvolutionProposalDraft records. Provides the bridge between
 * pattern discovery output and governance intake.
 *
 * The generator is stateless — given a candidate it produces the
 * corresponding proposal and draft deterministically (modulo
 * generated IDs and timestamps).
 *
 * @module evolution-proposal-generator
 */

import type {
  EvolutionCandidate,
  EvolutionProposalDraft,
  PatternObservation,
  PatternCategory,
} from "../contracts/pattern-discovery-contract.js";
import type { EvolutionProposal, EvolutionRiskClass, EvolutionTargetKind } from "../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

/**
 * Generate a v4 UUID for proposal, evolution, and candidate IDs.
 *
 * Available in Node.js 19+ — we target ES2024 which includes it.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate the current ISO-8601 timestamp.
 */
function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Risk Class Helpers
// ---------------------------------------------------------------------------

/**
 * Default risk mapping for each pattern category when generating candidates.
 *
 * Higher-risk categories default to "medium" or "high"; informational
 * or policy-level categories default to "low".
 */
const CATEGORY_RISK_MAP: Record<PatternCategory, EvolutionRiskClass> = {
  execution_failure: "medium",
  approval_friction: "low",
  performance_degradation: "medium",
  policy_ineffectiveness: "low",
  governance_gap: "medium",
  agent_misbehavior: "high",
};

/**
 * Default expected-effect text for each pattern category.
 */
const CATEGORY_EFFECT_MAP: Record<PatternCategory, string> = {
  execution_failure: "Reduce execution failure rate through targeted adjustments",
  approval_friction: "Reduce approval friction and streamline governance workflows",
  performance_degradation: "Improve execution performance and resource utilization",
  policy_ineffectiveness: "Improve policy effectiveness and alignment with desired outcomes",
  governance_gap: "Close governance gaps and improve oversight coverage",
  agent_misbehavior: "Correct agent behavior patterns and enforce operational boundaries",
};

/**
 * Default target kind for each pattern category.
 */
const CATEGORY_TARGET_KIND_MAP: Record<PatternCategory, EvolutionTargetKind> = {
  execution_failure: "workflow",
  approval_friction: "governance_rule",
  performance_degradation: "runtime_config",
  policy_ineffectiveness: "policy",
  governance_gap: "governance_rule",
  agent_misbehavior: "agent_behavior",
};

// ---------------------------------------------------------------------------
// Candidate Generation
// ---------------------------------------------------------------------------

/**
 * Generate evolution candidates from discovered pattern observations.
 *
 * Maps each pattern to a candidate with a default risk class derived
 * from the pattern's category, and a target derived from the pattern's
 * category-to-kind mapping.
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * @param patterns - Discovered pattern observations.
 * @returns Array of evolution candidates.
 */
export function generateCandidates(
  patterns: readonly PatternObservation[],
): EvolutionCandidate[] {
  return patterns.map((pattern) => ({
    candidateId: `cand-${generateId()}`,
    sourcePatternId: pattern.patternId,
    confidence: pattern.confidence,
    target: {
      kind: CATEGORY_TARGET_KIND_MAP[pattern.category],
      id: pattern.patternId,
    },
    description: pattern.description,
    expectedEffect: CATEGORY_EFFECT_MAP[pattern.category],
    riskClass: CATEGORY_RISK_MAP[pattern.category],
    evidenceIds: [...pattern.evidenceIds],
  }));
}

// ---------------------------------------------------------------------------
// EvolutionProposalGenerator Interface
// ---------------------------------------------------------------------------

/**
 * Result of generating proposal artifacts from a candidate.
 */
export interface GenerateProposalResult {
  /** Full A0 EvolutionProposal artifact. */
  proposal: EvolutionProposal;
  /** Intermediate EvolutionProposalDraft record. */
  draft: EvolutionProposalDraft;
}

/**
 * Generates A0 EvolutionProposal artifacts from evolution candidates.
 *
 * Each call produces both a full proposal and a draft record. The draft
 * is the lighter-weight artifact carried in DiscoveryResult; the proposal
 * is the formal A0 lifecycle artifact consumed by governance intake (A1.4).
 *
 * @invariant Stateless — no mutable state between calls.
 * @invariant No store access — pure mapping from candidate to proposal.
 * @invariant Never calls EvolutionStateMachine.transition().
 */
export interface EvolutionProposalGenerator {
  /** Human-readable generator name. */
  readonly name: string;

  /**
   * Generate a full EvolutionProposal and EvolutionProposalDraft from a
   * single evolution candidate.
   *
   * @param candidate - The evolution candidate to convert.
   * @returns The generated proposal and draft records.
   */
  generate(candidate: EvolutionCandidate): GenerateProposalResult;
}

// ---------------------------------------------------------------------------
// DefaultEvolutionProposalGenerator
// ---------------------------------------------------------------------------

/**
 * Default implementation of EvolutionProposalGenerator.
 *
 * Mapping rules (per A1 design spec section 10):
 * | Proposal field   | Source                                   |
 * |------------------|------------------------------------------|
 * | proposalId       | Generated                                |
 * | evolutionId      | Generated                                |
 * | title            | Derived from candidate.description       |
 * | description      | candidate.description                    |
 * | change           | Derived from candidate.target            |
 * | beforeHash       | null                                     |
 * | afterHash        | null                                     |
 * | createdAt        | Current timestamp                        |
 *
 * The draft mirrors the proposal with its own ID and sourcePatternId.
 *
 * @invariant Stateless — no mutable state between calls.
 */
export class DefaultEvolutionProposalGenerator implements EvolutionProposalGenerator {
  readonly name = "DefaultEvolutionProposalGenerator";

  private readonly config: Required<EvolutionProposalGeneratorConfig>;

  constructor(config?: EvolutionProposalGeneratorConfig) {
    this.config = {
      evolutionIdPrefix: config?.evolutionIdPrefix ?? "evol-",
      proposalIdPrefix: config?.proposalIdPrefix ?? "prop-",
      draftIdPrefix: config?.draftIdPrefix ?? "draft-",
    };
  }

  generate(candidate: EvolutionCandidate): GenerateProposalResult {
    const evolutionId = `${this.config.evolutionIdPrefix}${generateId()}`;
    const now = nowIso();

    const proposal: EvolutionProposal = {
      proposalId: `${this.config.proposalIdPrefix}${generateId()}`,
      evolutionId,
      title: this.deriveTitle(candidate.description),
      description: candidate.description,
      change: this.deriveChange(candidate.target),
      beforeHash: null,
      afterHash: null,
      createdAt: now,
    };

    const draft: EvolutionProposalDraft = {
      draftId: `${this.config.draftIdPrefix}${generateId()}`,
      sourcePatternId: candidate.sourcePatternId,
      title: proposal.title,
      description: candidate.description,
      target: { ...candidate.target },
      confidence: candidate.confidence,
      riskClass: candidate.riskClass,
      evidenceIds: [...candidate.evidenceIds],
      createdAt: now,
    };

    return { proposal, draft };
  }

  /**
   * Derive a proposal title from the candidate description.
   *
   * Uses the first `.␣` (period followed by space) or `.\n` sequence
   * as a sentence boundary, avoiding false splits on periods inside
   * URLs, version strings, or abbreviations. Falls back to truncation
   * at 80 characters with word-boundary awareness.
   */
  private deriveTitle(description: string): string {
    // Find the first sentence-ending period (period + space or period + end-of-string)
    const sentenceMatch = description.match(/\.(?:\s|$)/);
    if (sentenceMatch && sentenceMatch.index !== undefined) {
      const end = sentenceMatch.index + 1; // include the period
      if (end > 0 && end <= 81) {
        return description.slice(0, end);
      }
    }
    // Otherwise truncate to 80 characters, breaking at a word boundary
    if (description.length <= 80) return description;
    const truncated = description.slice(0, 80);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > 0 ? `${truncated.slice(0, lastSpace)}…` : `${truncated}…`;
  }

  /**
   * Derive a change description from the evolution target.
   */
  private deriveChange(target: { kind: string; id: string }): string {
    return `Modify ${target.kind}:${target.id}`;
  }
}

// ---------------------------------------------------------------------------
// Generator Config
// ---------------------------------------------------------------------------

/**
 * Configuration for the default proposal generator.
 */
export interface EvolutionProposalGeneratorConfig {
  /** Custom ID prefix for generated evolution IDs (default: "evol-"). */
  evolutionIdPrefix?: string;
  /** Custom ID prefix for generated proposal IDs (default: "prop-"). */
  proposalIdPrefix?: string;
  /** Custom ID prefix for generated draft IDs (default: "draft-"). */
  draftIdPrefix?: string;
}
