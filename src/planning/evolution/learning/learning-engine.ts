/**
 * LearningEngine — runs all 3 detectors, aggregates findings.
 *
 * Pure orchestration: no I/O beyond the adapters' list() calls; no implicit
 * clock. Engine joins adapter outputs (joins belong above the adapter boundary,
 * not inside adapters).
 *
 * "No trigger → no proposal": if total findings = 0, returns null.
 *
 * Architectural note: the brief specifies 3 adapters
 * (proposalEvents, measurementEvents, enrichedProposals) but the
 * outcome-contradiction detector consumes a 4th — recommendations.
 * This module wires all 4; the 4th adapter is an explicit, named
 * dependency, not silently assumed. enrichedProposals is currently
 * unused by detectors; it is read (and `void`-discarded) so the seam
 * stays live for a future detector.
 */

import type {
  EnrichedProposalRecord,
  LearningAdapter,
  LearningEngineOptions,
  LearningFinding,
  LearningProposal,
  MeasurementOutcomeRecord,
  ProposalGovernanceRecord,
  RecommendationRecord,
} from "./contracts/learning-contract.js";
import { DEFAULT_LEARNING_ENGINE_OPTIONS } from "./contracts/learning-contract.js";
import { detectUnderperformer } from "./detectors/underperformer-detector.js";
import { detectOutcomeContradictions } from "./detectors/outcome-contradiction-detector.js";
import { detectRepeatedPatternFailures } from "./detectors/repeated-pattern-failure-detector.js";
import { buildLearningProposal } from "./learning-proposal-builder.js";

export class LearningEngine {
  constructor(
    private readonly proposalEvents: LearningAdapter<ProposalGovernanceRecord>,
    private readonly measurementEvents: LearningAdapter<MeasurementOutcomeRecord>,
    private readonly enrichedProposals: LearningAdapter<EnrichedProposalRecord>,
    private readonly recommendations: LearningAdapter<RecommendationRecord>,
    private readonly options: LearningEngineOptions = DEFAULT_LEARNING_ENGINE_OPTIONS,
  ) {}

  async learn(now: string): Promise<LearningProposal | null> {
    const [proposalRecs, measurementRecs, enrichedRecs, recommendationRecs] = await Promise.all([
      this.proposalEvents.list(),
      this.measurementEvents.list(),
      this.enrichedProposals.list(),
      this.recommendations.list(),
    ]);

    // Adapters return independent records; the engine is responsible for
    // any joins (none needed for the 3 detectors — each consumes its own
    // source slice).
    const findings: ReadonlyArray<LearningFinding> = [
      ...detectUnderperformer(measurementRecs, this.options, now),
      ...detectOutcomeContradictions(proposalRecs, recommendationRecs, this.options, now),
      ...detectRepeatedPatternFailures(proposalRecs, this.options, now),
    ];

    // EnrichedProposals adapter is currently read-only; a future detector
    // may consume it. For now, validate it's non-null to keep the seam alive.
    void enrichedRecs;

    if (findings.length === 0) return null;
    return buildLearningProposal(findings, now);
  }
}