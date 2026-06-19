/**
 * P5.2c — AutomaticProposalGenerator.
 *
 * Proposal-only. Composes P5.1c RecommendationToProposal.convert for the
 * reflection path; emits manual-action proposals for the effectiveness-revert
 * path. All output proposals carry provenance="auto" and status="pending".
 * NEVER imports ApprovalGate, AgentCardApplier, or SkillApplier.
 *
 * @module
 */
import type { AdaptationProposal } from "./adaptation-types.js";
import type { ProposalStore } from "./proposal-store.js";
import { RecommendationToProposal } from "./recommendation-to-proposal.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type { ReflectionReport } from "../reflection/reflection-types.js";
import type { ProposalEffectivenessReport } from "./effectiveness-types.js";

/** Default minimum source-recommendation confidence for auto-generation. */
export const DEFAULT_MIN_REFLECTION_CONFIDENCE = 0.7;

/** Per-method options. Reserved for future tuning; currently only `minConfidence`. */
export interface GenerateOptions {
  minConfidence?: number;
}

/** Per-method result. */
export interface GenerateResult {
  generated: number;
  skipped: number;
  proposals: AdaptationProposal[];
}

export class AutomaticProposalGenerator {
  constructor(
    private readonly store: ProposalStore,
    private readonly writer: EvidenceEventWriter,
  ) {}

  async generateFromReflection(
    _report: ReflectionReport,
    _opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    // Imported here for future use in Task 3 (P5.2c.3 — reflection path).
    // Keeping the value import so Task 3 only needs to add the body, not
    // change imports.
    void RecommendationToProposal;
    // implemented in Task 3
    throw new Error("not yet implemented");
  }

  async generateFromEffectiveness(
    _report: ProposalEffectivenessReport,
    _opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    // implemented in Task 4
    throw new Error("not yet implemented");
  }

  async generateFromAllEffectiveness(
    reports: ProposalEffectivenessReport[],
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    let total: GenerateResult = { generated: 0, skipped: 0, proposals: [] };
    for (const r of reports) {
      const res = await this.generateFromEffectiveness(r, opts);
      total = {
        generated: total.generated + res.generated,
        skipped: total.skipped + res.skipped,
        proposals: [...total.proposals, ...res.proposals],
      };
    }
    return total;
  }
}
