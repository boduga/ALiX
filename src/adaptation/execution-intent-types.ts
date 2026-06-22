/**
 * P7.5b — ExecutionIntent types for the execution intent capture system.
 *
 * ExecutionIntent is a lightweight bridge artifact that captures what a skill
 * produced without creating a proposal or mutating state.
 *
 * Key boundary: ExecutionIntent ≠ Proposal. Intent captured ≠ approval.
 * Skill output ≠ mutation.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { ProposalAction, ProposalTarget } from "./adaptation-types.js";

// ---------------------------------------------------------------------------
// Intent source kind
// ---------------------------------------------------------------------------

export type IntentSource = "cli_run" | "skill_run" | "agent" | "recipe";

// ---------------------------------------------------------------------------
// Intent lifecycle status
// ---------------------------------------------------------------------------

export type IntentStatus = "captured" | "proposed" | "discarded";

// ---------------------------------------------------------------------------
// ExecutionIntent
// ---------------------------------------------------------------------------

/**
 * A lightweight bridge artifact capturing what a skill or tool produced.
 *
 * Extends DecisionArtifact so it participates in the P6/P7 decision
 * framework without being a full proposal.  The `outcome` field carries
 * the status as a string; `status` is the canonical lifecycle state.
 */
export interface ExecutionIntent extends DecisionArtifact {
  /** Where the intent came from. */
  source: IntentSource;

  /** The raw input that was given to the skill/tool/agent/recipe. */
  input: string;

  /** First ~200 chars of the rendered output (a human-readable summary). */
  outputSummary: string;

  /** Path or reference to the full persisted output, if any. */
  outputRef?: string;

  /** Skill ID when `source` is `"skill_run"`. */
  skillId?: string;

  /** Agent ID when `source` is `"agent"`. */
  agentId?: string;

  /** Recipe ID when `source` is `"recipe"`. */
  recipeId?: string;

  /** If the intent leads to a proposal, the proposed action (optional). */
  proposedAction?: ProposalAction;

  /** If the intent leads to a proposal, the proposed target (optional). */
  proposedTarget?: ProposalTarget;

  /** Lifecycle state — "captured" by default. */
  status: IntentStatus;

  /** Human-readable explanation of what the skill produced and why. */
  rationale: string;

  /** Provenance — what artifacts were consumed to produce this intent. */
  sourceArtifacts: SourceArtifact[];
}
