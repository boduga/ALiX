/**
 * A8 engine end-to-end integration test (T8).
 *
 * Wires the locked 4-adapter LearningEngine, runs every detector scenario
 * via the engine (NOT direct detector calls), feeds the resulting
 * LearningProposal through the A2.5 bridge, then feeds the bridge output
 * through A3 generateDecision.
 *
 * T8 brief-vs-actual adaptations (locked per task-8-brief + T1-T7 reports):
 *   1. Engine constructor takes 4 adapters + options (proposalEvents,
 *      measurementEvents, enrichedProposals, recommendations). Brief's
 *      3-adapter constructor is wrong; this test passes 4 stubs.
 *   2. ProposalGovernanceRecord has NO `recommendation` field. The
 *      recommendation lives on the separate `RecommendationRecord[]` fed
 *      through the 4th adapter.
 *   3. `LearningProposal` lives in `learning-contract.js`;
 *      `GovernanceRecommendation` lives in
 *      `verification/contracts/recommendation-contract.js`.
 *      Both import paths corrected.
 *   4. `generateDecision` signature is
 *      `(evidence: VerificationEvidence, recommendation?, options?)`,
 *      NOT `(confidenceProfile, recommendation)`. We construct a
 *      minimal evidence object here.
 */

import { describe, it, expect } from "vitest";
import { LearningEngine } from "../../src/evolution/learning/learning-engine.js";
import { buildGovernanceRecommendation } from "../../src/evolution/learning/governance-bridge.js";
import { generateDecision } from "../../src/evolution/governance/decision-engine.js";
import type {
  EnrichedProposalRecord,
  MeasurementOutcomeRecord,
  ProposalGovernanceRecord,
  RecommendationRecord,
} from "../../src/evolution/learning/contracts/learning-contract.js";
import type { LearningProposal } from "../../src/evolution/learning/contracts/learning-contract.js";
import type { GovernanceRecommendation } from "../../src/evolution/verification/contracts/recommendation-contract.js";
import type { VerificationEvidence } from "../../src/evolution/verification/contracts/verification-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOW = "2026-08-14T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers — stub adapters + record factories
// ---------------------------------------------------------------------------

interface StubAdapter<T> {
  readonly name: string;
  list: () => Promise<ReadonlyArray<T>>;
}

function stubProposalEvents(recs: ReadonlyArray<ProposalGovernanceRecord>): StubAdapter<ProposalGovernanceRecord> {
  return { name: "proposal-events", list: async () => recs };
}
function stubMeasurementEvents(recs: ReadonlyArray<MeasurementOutcomeRecord>): StubAdapter<MeasurementOutcomeRecord> {
  return { name: "measurement-events", list: async () => recs };
}
function stubEnrichedProposals(recs: ReadonlyArray<EnrichedProposalRecord>): StubAdapter<EnrichedProposalRecord> {
  return { name: "enriched-proposals", list: async () => recs };
}
function stubRecommendations(recs: ReadonlyArray<RecommendationRecord>): StubAdapter<RecommendationRecord> {
  return { name: "recommendations", list: async () => recs };
}

function makeProposalRecord(
  overrides: Partial<ProposalGovernanceRecord> & { proposalId: string },
): ProposalGovernanceRecord {
  return {
    proposalId: overrides.proposalId,
    capabilityId: overrides.capabilityId ?? "",
    kind: overrides.kind ?? "proposal.submitted",
    recordedAt: overrides.recordedAt ?? NOW,
    eventId: overrides.eventId ?? `evt-${overrides.proposalId}`,
    ...(overrides.operatorId !== undefined ? { operatorId: overrides.operatorId } : {}),
    ...(overrides.operatorReason !== undefined ? { operatorReason: overrides.operatorReason } : {}),
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
  };
}

function makeMeasurementRecord(
  overrides: Partial<MeasurementOutcomeRecord> & { capabilityId: string },
): MeasurementOutcomeRecord {
  return {
    capabilityId: overrides.capabilityId,
    outcome: overrides.outcome ?? "ineffective",
    recordedAt: overrides.recordedAt ?? "2026-08-10T00:00:00.000Z",
    eventId: overrides.eventId ?? `meas-${overrides.capabilityId}-${Math.random().toString(36).slice(2, 6)}`,
  };
}

function makeRecommendationRecord(
  overrides: Partial<RecommendationRecord> & { proposalId: string },
): RecommendationRecord {
  return {
    recordId: overrides.recordId ?? `rec-${overrides.proposalId}`,
    proposalId: overrides.proposalId,
    kind: overrides.kind ?? "MONITOR",
    confidence: overrides.confidence ?? 0.5,
    ...(overrides.reasoning !== undefined ? { reasoning: overrides.reasoning } : {}),
    evidenceRefs: overrides.evidenceRefs ?? [],
    recordedAt: overrides.recordedAt ?? NOW,
  };
}

/**
 * Construct a minimal VerificationEvidence that drives generateDecision into
 * MONITOR. Default policy has minApproveConfidence=0.8 and
 * minMonitorConfidence=0.5, so we pick overallConfidence=0.6 — strictly
 * above the monitor floor and strictly below the approve floor, no
 * regressions, fresh evidence, perfect reproducibility. All hash fields are
 * placeholder hex strings — generateDecision does not re-verify them.
 */
function makeEvidence(proposalId: string): VerificationEvidence {
  return {
    evidenceId: `ev-${proposalId}`,
    verificationId: `ver-${proposalId}`,
    proposalId,
    replayDatasetId: `replay-${proposalId}`,
    evidenceClass: "projected",
    proposalSnapshotHash: "a".repeat(64),
    environmentHash: "b".repeat(64),
    baselineMetrics: {},
    candidateMetrics: {},
    metricDeltas: {},
    behavioralChanges: [],
    confidenceProfile: {
      replayFidelity: 0.6,
      coverage: 0.6,
      determinism: 0.6,
      historicalSimilarity: 0.6,
      overallConfidence: 0.6,
    },
    reproducibilityLevel: 3,
    lineage: [],
    verifiedAt: NOW,
    expiresAt: "2099-01-01T00:00:00.000Z",
    reverificationRequired: false,
    integrityHash: "c".repeat(64),
  };
}

// ---------------------------------------------------------------------------
// 1. Zero findings across all adapters → engine.learn returns null
// ---------------------------------------------------------------------------

describe("A8 engine end-to-end — empty path", () => {
  it("zero findings across all detectors → null (no proposal emitted)", async () => {
    const engine = new LearningEngine(
      stubProposalEvents([]),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
      stubRecommendations([]),
    );
    const result = await engine.learn(NOW);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Full flow — underperformer detector → proposal → A2.5 → A3
// ---------------------------------------------------------------------------

describe("A8 engine end-to-end — full flow", () => {
  it("underperformer: 3+ ineffective outcomes for one capability → proposal → MONITOR bridge → MONITOR decision", async () => {
    const capabilityId = "core.payments";
    const measurementRecs: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeMeasurementRecord({ capabilityId, recordedAt: "2026-08-05T00:00:00.000Z" }),
      makeMeasurementRecord({ capabilityId, recordedAt: "2026-08-07T00:00:00.000Z" }),
      makeMeasurementRecord({ capabilityId, recordedAt: "2026-08-09T00:00:00.000Z" }),
    ];

    const engine = new LearningEngine(
      stubProposalEvents([]),
      stubMeasurementEvents(measurementRecs),
      stubEnrichedProposals([]),
      stubRecommendations([]),
    );

    const proposal = await engine.learn(NOW);
    expect(proposal).not.toBeNull();
    expect(proposal!.findings).toHaveLength(1);
    expect(proposal!.findings[0]!.kind).toBe("underperformer");
    expect(proposal!.findings[0]!.identityKey).toBe(capabilityId);

    // A2.5 bridge always emits MONITOR
    const recommendation = buildGovernanceRecommendation(proposal!);
    expect(recommendation.kind).toBe("MONITOR");
    expect(recommendation.proposalId).toBe(proposal!.proposalId);

    // A3 generateDecision accepts the bridge output and returns a binding decision
    const evidence = makeEvidence(proposal!.proposalId);
    const decision = generateDecision(evidence, recommendation);
    expect(decision.kind).toBe("MONITOR");
  });

  it("outcome-contradiction: APPROVE recommendation + rejected operator → proposal → MONITOR bridge", async () => {
    const capabilityId = "core.workflow";
    const proposalRecs: ReadonlyArray<ProposalGovernanceRecord> = [
      makeProposalRecord({
        proposalId: "p-1",
        capabilityId,
        kind: "proposal.rejected",
        operatorId: "op-1",
        recordedAt: "2026-08-10T00:00:00.000Z",
      }),
      makeProposalRecord({
        proposalId: "p-2",
        capabilityId,
        kind: "proposal.rejected",
        operatorId: "op-1",
        recordedAt: "2026-08-11T00:00:00.000Z",
      }),
      makeProposalRecord({
        proposalId: "p-3",
        capabilityId,
        kind: "proposal.rejected",
        operatorId: "op-1",
        recordedAt: "2026-08-12T00:00:00.000Z",
      }),
    ];
    const recommendationRecs: ReadonlyArray<RecommendationRecord> = [
      makeRecommendationRecord({ proposalId: "p-1", kind: "APPROVE" }),
      makeRecommendationRecord({ proposalId: "p-2", kind: "APPROVE" }),
      makeRecommendationRecord({ proposalId: "p-3", kind: "APPROVE" }),
    ];

    const engine = new LearningEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
      stubRecommendations(recommendationRecs),
    );

    const proposal = await engine.learn(NOW);
    expect(proposal).not.toBeNull();
    expect(proposal!.findings.some((f) => f.kind === "outcome-contradiction")).toBe(true);

    const recommendation = buildGovernanceRecommendation(proposal!);
    expect(recommendation.kind).toBe("MONITOR");
  });

  it("repeated-pattern-failure: 3+ execution_failed with same fingerprint → proposal → MONITOR bridge", async () => {
    const capabilityId = "core.scheduler";
    const proposalRecs: ReadonlyArray<ProposalGovernanceRecord> = [
      // First emit the proposal.submitted events so the fingerprint join resolves capabilityId
      makeProposalRecord({ proposalId: "p-a", capabilityId, kind: "proposal.submitted" }),
      makeProposalRecord({ proposalId: "p-b", capabilityId, kind: "proposal.submitted" }),
      makeProposalRecord({ proposalId: "p-c", capabilityId, kind: "proposal.submitted" }),
      // Then emit three execution_failed events sharing the same error string
      makeProposalRecord({
        proposalId: "p-a",
        capabilityId,
        kind: "proposal.execution_failed",
        error: "timeout",
        recordedAt: "2026-08-10T00:00:00.000Z",
      }),
      makeProposalRecord({
        proposalId: "p-b",
        capabilityId,
        kind: "proposal.execution_failed",
        error: "timeout",
        recordedAt: "2026-08-11T00:00:00.000Z",
      }),
      makeProposalRecord({
        proposalId: "p-c",
        capabilityId,
        kind: "proposal.execution_failed",
        error: "timeout",
        recordedAt: "2026-08-12T00:00:00.000Z",
      }),
    ];

    const engine = new LearningEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
      stubRecommendations([]),
    );

    const proposal = await engine.learn(NOW);
    expect(proposal).not.toBeNull();
    expect(proposal!.findings.some((f) => f.kind === "repeated-pattern-failure")).toBe(true);

    const recommendation = buildGovernanceRecommendation(proposal!);
    expect(recommendation.kind).toBe("MONITOR");
  });
});

// ---------------------------------------------------------------------------
// 3. Architectural invariants at the integration boundary
// ---------------------------------------------------------------------------

describe("A8 engine end-to-end — architectural boundary", () => {
  it("LearningProposal shape is exactly { proposalId, generatedAt, findings } — no execution fields", async () => {
    const capabilityId = "core.x";
    const measurementRecs: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeMeasurementRecord({ capabilityId, recordedAt: "2026-08-05T00:00:00.000Z" }),
      makeMeasurementRecord({ capabilityId, recordedAt: "2026-08-06T00:00:00.000Z" }),
      makeMeasurementRecord({ capabilityId, recordedAt: "2026-08-07T00:00:00.000Z" }),
    ];

    const engine = new LearningEngine(
      stubProposalEvents([]),
      stubMeasurementEvents(measurementRecs),
      stubEnrichedProposals([]),
      stubRecommendations([]),
    );

    const proposal = (await engine.learn(NOW)) as LearningProposal | null;
    expect(proposal).not.toBeNull();
    // Exact-shape invariant per locked T6 ruling.
    expect(Object.keys(proposal!).sort()).toEqual(["findings", "generatedAt", "proposalId"]);
  });

  it("bridge emits MONITOR regardless of which detector fired (APPROVE-shaped scenario still resolves to MONITOR)", async () => {
    // Even when the proposals look like APPROVE-shape, A2.5 bridge must always emit MONITOR.
    const capabilityId = "core.y";
    const proposalRecs: ReadonlyArray<ProposalGovernanceRecord> = [
      makeProposalRecord({
        proposalId: "p-1",
        capabilityId,
        kind: "proposal.rejected",
        operatorId: "op-1",
        recordedAt: "2026-08-10T00:00:00.000Z",
      }),
      makeProposalRecord({
        proposalId: "p-2",
        capabilityId,
        kind: "proposal.rejected",
        operatorId: "op-1",
        recordedAt: "2026-08-11T00:00:00.000Z",
      }),
      makeProposalRecord({
        proposalId: "p-3",
        capabilityId,
        kind: "proposal.rejected",
        operatorId: "op-1",
        recordedAt: "2026-08-12T00:00:00.000Z",
      }),
    ];
    const recommendationRecs: ReadonlyArray<RecommendationRecord> = [
      makeRecommendationRecord({ proposalId: "p-1", kind: "APPROVE" }),
      makeRecommendationRecord({ proposalId: "p-2", kind: "APPROVE" }),
      makeRecommendationRecord({ proposalId: "p-3", kind: "APPROVE" }),
    ];

    const engine = new LearningEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
      stubRecommendations(recommendationRecs),
    );

    const proposal = (await engine.learn(NOW)) as LearningProposal | null;
    expect(proposal).not.toBeNull();
    const recommendation: GovernanceRecommendation = buildGovernanceRecommendation(proposal!);
    expect(recommendation.kind).not.toBe("APPROVE");
    expect(recommendation.kind).not.toBe("REJECT");
    expect(recommendation.kind).toBe("MONITOR");
  });
});
