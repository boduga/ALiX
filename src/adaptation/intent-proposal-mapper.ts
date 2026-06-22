/**
 * P7.5c — Intent → Proposal Mapper.
 *
 * Bridges the gap between ExecutionIntent capture (P7.5b) and the proposal
 * pipeline (P5-P6).  Creates an AdaptationProposal from an ExecutionIntent
 * but does NOT approve or apply it.
 *
 * Key boundaries:
 *   Intent ≠ Proposal.  Proposal ≠ Approval.  Approval ≠ Apply.
 *
 * The mapper:
 *   1. Validates that the intent has proposedAction + proposedTarget
 *   2. Validates that the intent status is "captured" (not already proposed)
 *   3. Creates a pending AdaptationProposal
 *   4. Saves to ProposalStore
 *   5. Marks the intent status as "proposed" (append-only IntentStore)
 *
 * @module
 */

import type { ExecutionIntent } from "./execution-intent-types.js";
import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalStore } from "./proposal-store.js";
import type { IntentStore } from "./intent-store.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ProposalMappingResult {
  success: boolean;
  proposal?: AdaptationProposal;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export class IntentProposalMapper {
  constructor(private readonly proposalStore: ProposalStore) {}

  /**
   * Map an ExecutionIntent to an AdaptationProposal.
   *
   * Does NOT approve or apply the proposal.  The caller is responsible for
   * routing the proposal through the approval gate and applier pipeline.
   *
   * On success, the intent's status is updated to "proposed" via the
   * append-only IntentStore.
   */
  async mapToProposal(
    intent: ExecutionIntent,
    intentStore: IntentStore,
    options?: { generatedAt?: string },
  ): Promise<ProposalMappingResult> {
    // ---- Validate: must have proposedAction ----
    if (!intent.proposedAction) {
      return {
        success: false,
        errors: [
          "ExecutionIntent has no proposedAction — cannot map to proposal",
        ],
        warnings: [],
      };
    }

    // ---- Validate: must have proposedTarget ----
    if (!intent.proposedTarget) {
      return {
        success: false,
        errors: [
          "ExecutionIntent has no proposedTarget — cannot map to proposal",
        ],
        warnings: [],
      };
    }

    // ---- Validate: intent must be in "captured" state ----
    if (intent.status !== "captured") {
      return {
        success: false,
        errors: [
          `Intent ${intent.id} status is "${intent.status}" — only "captured" intents can be proposed`,
        ],
        warnings: [],
      };
    }

    // ---- Create the proposal ----
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const proposal: AdaptationProposal = {
      id: `prop-${generatedAt.slice(0, 10)}-${Date.now().toString(36)}`,
      createdAt: generatedAt,
      status: "pending",
      action: intent.proposedAction,
      target: intent.proposedTarget,
      payload: {},
      sourceRecommendationType: `intent:${intent.source}`,
      sourceConfidence: intent.confidence,
      evidenceFingerprints: [`intent:${intent.id}`],
      reason:
        intent.rationale ||
        `Proposal from ${intent.source}: ${intent.skillId || intent.agentId || intent.recipeId || "unknown"}`,
      provenance: "manual",
    };

    // ---- Persist ----
    await this.proposalStore.save(proposal);

    // ---- Mark intent as proposed (append-only store) ----
    intent.status = "proposed";
    await intentStore.append(intent);

    return {
      success: true,
      proposal,
      errors: [],
      warnings: [],
    };
  }
}
