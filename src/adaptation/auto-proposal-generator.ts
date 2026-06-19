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
    report: ReflectionReport,
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const minConfidence =
      opts.minConfidence ?? DEFAULT_MIN_REFLECTION_CONFIDENCE;

    let generated = 0;
    let skipped = 0;
    const proposals: AdaptationProposal[] = [];

    for (const rec of report.recommendations) {
      // P5.2c governance filter 1: routing_adjustment is user-deferred.
      if (rec.type === "routing_adjustment") {
        skipped += 1;
        continue;
      }

      // P5.2c governance filter 2: confidence must meet threshold.
      if (rec.confidence < minConfidence) {
        skipped += 1;
        continue;
      }

      // Reuse P5.1c's pure converter (do not duplicate action/target/payload
      // derivation). null means unknown recommendation type — skip.
      const base = RecommendationToProposal.convert(rec);
      if (base === null) {
        skipped += 1;
        continue;
      }

      // Tag provenance as auto so downstream evidence and lifecycle events
      // distinguish auto-generated proposals from manual ones.
      const proposal: AdaptationProposal = { ...base, provenance: "auto" };

      await this.store.save(proposal);
      await this.writer.recordAdaptationProposed(proposal.id, {
        createdAt: proposal.createdAt,
        action: proposal.action,
        target: proposal.target as unknown as Record<string, unknown>,
        sourceRecommendationType: proposal.sourceRecommendationType,
        sourceConfidence: proposal.sourceConfidence,
        provenance: "auto",
      });

      proposals.push(proposal);
      generated += 1;
    }

    return { generated, skipped, proposals };
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
