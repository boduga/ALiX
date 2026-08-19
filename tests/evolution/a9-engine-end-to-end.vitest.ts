/**
 * A9 Slice 5 — full pre-execution end-to-end path (Phase 26).
 *
 * Exercises the COMPLETE path from raw evidence to a binding A3 decision:
 *
 *   raw adapters → detectors → Forecast → forecast JSONL (A9-owned store)
 *     → A9 bridge → A2.5 GovernanceRecommendation → A3 generateDecision()
 *
 * Paths pinned:
 *   high/critical: Forecast → RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE → UNDER_REVIEW
 *   low/medium:    Forecast → MONITOR        → MONITOR (existing A3 MONITOR path)
 *   no finding:    null/empty → no recommendation → no A3 call
 *
 * @module a9-engine-end-to-end
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent } from "../../src/events/types.js";
import type { EnrichedProposal } from "../../src/adaptation/intelligence-types.js";
import type { Forecast } from "../../src/evolution/forecast/contracts/contract.js";
import { ForecastEngine } from "../../src/evolution/forecast/forecast-engine.js";
import { ProposalEventsAdapter } from "../../src/evolution/forecast/adapters/proposal-events-adapter.js";
import { EnrichedProposalsAdapter } from "../../src/evolution/forecast/adapters/enriched-proposals-adapter.js";
import { ForecastsStore } from "../../src/evolution/forecast/forecasts-store.js";
import { buildGovernanceRecommendation } from "../../src/evolution/forecast/bridge.js";
import {
  generateDecision,
  decisionKindToTargetState,
} from "../../src/evolution/governance/index.js";
import type { GovernanceDecisionKind } from "../../src/evolution/governance/contracts/decision-contract.js";
import { createVerificationEvidence } from "../../src/evolution/verification/index.js";
import type {
  VerificationEvidenceInput,
  ConfidenceProfile,
} from "../../src/evolution/verification/index.js";
import type { GovernanceRecommendation } from "../../src/evolution/verification/contracts/recommendation-contract.js";

const NOW = "2026-08-14T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fake EventLog whose readAll() returns the supplied events. */
function fakeEventLog(events: ReadonlyArray<AlixEvent>): EventLog {
  return { readAll: vi.fn(async () => events) } as unknown as EventLog;
}

function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  overrides: Partial<AlixEvent> = {},
): AlixEvent {
  return {
    id: overrides.id ?? `evt-${type.split(".").pop()}-${Math.random().toString(36).slice(2, 8)}`,
    seq: overrides.seq ?? 1,
    version: 1,
    sessionId: "s1",
    timestamp: overrides.timestamp ?? NOW,
    type,
    actor: "system",
    payload,
    ...overrides,
  } as AlixEvent;
}

/** Canonical proposal.submitted payload (ProposalStore shape: proposalId in payload). */
function submittedPayload(
  proposalId: string,
  targetId: string,
  candidate: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    proposalId,
    candidate: {
      candidateId: `c-${proposalId}`,
      sourcePatternId: "gap",
      confidence: 0.8,
      target: { kind: "capability", id: targetId },
      riskClass: "high",
      evidenceIds: ["ev-1"],
      description: "d",
      expectedEffect: "e",
      ...candidate,
    },
    signalIds: [],
    sourceVersion: null,
  };
}

function submittedEvent(
  proposalId: string,
  targetId: string,
  candidate: Record<string, unknown> = {},
  timestamp = "2026-08-10T00:00:00.000Z",
): AlixEvent {
  return makeEvent(
    "capability.governance.proposal.submitted",
    submittedPayload(proposalId, targetId, candidate),
    { seq: 1, timestamp },
  );
}

function executedEvent(proposalId: string, timestamp = "2026-08-12T00:00:00.000Z"): AlixEvent {
  return makeEvent(
    "capability.governance.proposal.executed",
    { proposalId },
    { seq: 2, timestamp },
  );
}

/** A minimal EnrichedProposal fixture (adapter reads proposal + wrapper fields). */
function enrichedProposal(
  overrides: Partial<EnrichedProposal["proposal"]> = {},
  wrapper: Partial<Record<"effectivenessReport" | "revertProposalId" | "timeToApprovalHours" | "timeToApplyHours", unknown>> = {},
): EnrichedProposal {
  return {
    proposal: {
      id: "prop-1",
      action: "governance_change",
      target: { kind: "capability", capability: "cap-1" },
      status: "pending",
      createdAt: NOW,
      ...overrides,
    },
    effectivenessReport: wrapper.effectivenessReport ?? null,
    revertProposalId: wrapper.revertProposalId ?? null,
    timeToApprovalHours: wrapper.timeToApprovalHours ?? null,
    timeToApplyHours: wrapper.timeToApplyHours ?? null,
  } as unknown as EnrichedProposal;
}

// ---------------------------------------------------------------------------
// A3 decision evidence helpers (mirror the a9-governance suite)
// ---------------------------------------------------------------------------

function makeProfile(overall: number): ConfidenceProfile {
  return {
    replayFidelity: 0.95,
    coverage: 0.9,
    determinism: 1.0,
    historicalSimilarity: 0.9,
    overallConfidence: overall,
  };
}

function makeEvidence(
  overallConfidence: number,
  overrides: Partial<VerificationEvidenceInput> = {},
): ReturnType<typeof createVerificationEvidence> {
  return createVerificationEvidence({
    verificationId: "ver-e2e-001",
    proposalId: "prop-1",
    replayDatasetId: "ds-001",
    proposalSnapshotHash: "hash-prop",
    environmentHash: "hash-env",
    baselineMetrics: { m: 1 },
    candidateMetrics: { m: 2 },
    metricDeltas: { m: 1 },
    behavioralChanges: [],
    confidenceProfile: makeProfile(overallConfidence),
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: NOW,
    expiresAt: "2099-12-31T00:00:00.000Z",
    ...overrides,
  });
}

function evidenceForDecision(kind: GovernanceDecisionKind): ReturnType<typeof createVerificationEvidence> {
  switch (kind) {
    case "APPROVE":
      return makeEvidence(0.9);
    case "MONITOR":
      return makeEvidence(0.6);
    case "REJECT":
      return makeEvidence(0.2);
    case "REQUEST_MORE_EVIDENCE":
      return makeEvidence(0.9, { reproducibilityLevel: 1 });
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — the pre-execution flow under test (mirrors the CLI flow)
// ---------------------------------------------------------------------------

interface PreExecutionResult {
  forecasts: ReadonlyArray<Forecast>;
  recommendation: GovernanceRecommendation | null;
  decision: ReturnType<typeof generateDecision> | null;
}

async function orchestratePreExecution(opts: {
  events: ReadonlyArray<AlixEvent>;
  enriched: ReadonlyArray<EnrichedProposal>;
  storeDir: string;
  now?: string;
}): Promise<PreExecutionResult> {
  const engine = new ForecastEngine({
    proposalEvents: new ProposalEventsAdapter(fakeEventLog(opts.events)),
    enrichedProposals: new EnrichedProposalsAdapter(opts.enriched),
  });
  const forecasts = await engine.forecast(opts.now ?? NOW);

  const store = new ForecastsStore(opts.storeDir);
  if (forecasts.length === 0) {
    return { forecasts: [], recommendation: null, decision: null };
  }
  for (const f of forecasts) await store.append(f);
  const recommendation = buildGovernanceRecommendation(forecasts[0]!);
  // A3 call happens ONLY when a recommendation exists — a no-finding run never
  // reaches generateDecision.
  const decision = generateDecision(
    evidenceForDecision(
      recommendation.kind === "RISK_GATED_REVIEW" ? "REQUEST_MORE_EVIDENCE" : "MONITOR",
    ),
    recommendation,
  );
  return { forecasts, recommendation, decision };
}

// ---------------------------------------------------------------------------
// High/critical path
// ---------------------------------------------------------------------------

describe("A9 pre-execution path — high/critical → RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE → UNDER_REVIEW", () => {
  it("runs the full path and lands on UNDER_REVIEW", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-e2e-high-"));
    const result = await orchestratePreExecution({
      // riskClass high + absorbedCapabilityIds → trust-velocity scores high (0.85+ → critical)
      events: [
        submittedEvent("prop-1", "cap-1", {
          riskClass: "high",
          absorbedCapabilityIds: ["cap-2"],
          proposedPatch: { kind: "capability" },
        }),
        executedEvent("prop-1"),
      ],
      enriched: [],
      storeDir: dir,
    });

    expect(result.forecasts).toHaveLength(1);
    const forecast = result.forecasts[0]!;
    expect(forecast.subject).toBe("prop-1");
    // trust-velocity 0.7 + consolidation 0.15 + patch 0.1 = 0.95 → critical
    expect(forecast.prediction.band).toBe("critical");

    // persisted to A9-owned JSONL
    const store = new ForecastsStore(dir);
    const stored = await store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.forecastId).toBe(forecast.forecastId);

    expect(result.recommendation).not.toBeNull();
    expect(result.recommendation!.kind).toBe("RISK_GATED_REVIEW");

    expect(result.decision).not.toBeNull();
    expect(result.decision!.kind).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.decision!.followedRecommendation).toBe(true);
    expect(decisionKindToTargetState(result.decision!.kind)).toBe("UNDER_REVIEW");
  });

  it("high band (not critical) also routes through RISK_GATED_REVIEW → UNDER_REVIEW", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-e2e-high2-"));
    const result = await orchestratePreExecution({
      events: [
        submittedEvent("prop-1", "cap-1", { riskClass: "high" }),
        executedEvent("prop-1"),
      ],
      enriched: [],
      storeDir: dir,
    });
    expect(result.forecasts[0]!.prediction.band).toBe("high");
    expect(result.recommendation!.kind).toBe("RISK_GATED_REVIEW");
    expect(result.decision!.kind).toBe("REQUEST_MORE_EVIDENCE");
    expect(decisionKindToTargetState(result.decision!.kind)).toBe("UNDER_REVIEW");
  });
});

// ---------------------------------------------------------------------------
// Low/medium path
// ---------------------------------------------------------------------------

describe("A9 pre-execution path — low/medium → MONITOR → existing A3 MONITOR path", () => {
  it("medium-band forecast → MONITOR → MONITOR decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-e2e-med-"));
    const result = await orchestratePreExecution({
      // trust-velocity below trigger (riskClass low); enriched incomplete but
      // diverse+fresh → evidence-completeness scores population 0.5 + diversity 0
      // (3 fingerprints saturate) → 0.5 → medium.
      events: [submittedEvent("prop-1", "cap-1", { riskClass: "low" })],
      enriched: [
        enrichedProposal({ evidenceFingerprints: ["fp-1", "fp-2", "fp-3"] }, {}),
      ],
      storeDir: dir,
    });
    expect(result.forecasts).toHaveLength(1);
    expect(result.forecasts[0]!.prediction.band).toBe("medium");
    expect(result.recommendation!.kind).toBe("MONITOR");
    expect(result.decision!.kind).toBe("MONITOR");
    expect(result.decision!.followedRecommendation).toBe(true);
  });

  it("a low-band forecast artifact → MONITOR → MONITOR decision (existing A3 MONITOR path)", async () => {
    // The engine cannot emit a low-band forecast (every detector trigger ≥ 0.3),
    // so the low path is exercised from the Forecast artifact down — the
    // bridge + A3 mapping are the lock under test.
    const dir = await mkdtemp(join(tmpdir(), "a9-e2e-low-"));
    const { buildForecast } = await import("../../src/evolution/forecast/forecast-builder.js");
    const forecast = buildForecast(
      [
        {
          subject: "prop-1",
          subjectCapability: "cap-1",
          kind: "trust-velocity",
          internalScore: 0.1,
          confidence: 0.8,
          evidenceRefs: ["ev-1"],
        },
      ],
      "prop-1",
      "cap-1",
      NOW,
    );
    expect(forecast.prediction.band).toBe("low");

    const store = new ForecastsStore(dir);
    await store.append(forecast);
    expect((await store.list())).toHaveLength(1);

    const recommendation = buildGovernanceRecommendation(forecast);
    expect(recommendation.kind).toBe("MONITOR");
    const decision = generateDecision(evidenceForDecision("MONITOR"), recommendation);
    expect(decision.kind).toBe("MONITOR");
    expect(decision.followedRecommendation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No finding path
// ---------------------------------------------------------------------------

describe("A9 pre-execution path — no finding → no recommendation → no A3 call", () => {
  it("empty raw evidence yields no forecast, no persisted artifact, no A3 decision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-e2e-none-"));
    const result = await orchestratePreExecution({
      events: [],
      enriched: [],
      storeDir: dir,
    });
    expect(result.forecasts).toEqual([]);
    expect(result.recommendation).toBeNull();
    expect(result.decision).toBeNull();
    expect(await new ForecastsStore(dir).list()).toEqual([]);
  });

  it("evidence below every detector trigger yields the same silent no-findings result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-e2e-below-"));
    const result = await orchestratePreExecution({
      // riskClass low → trust below trigger; enriched complete+fresh+diverse →
      // completeness below trigger.
      events: [submittedEvent("prop-1", "cap-1", { riskClass: "low" })],
      enriched: [
        enrichedProposal(
          {},
          {
            effectivenessReport: { ok: true },
            revertProposalId: "rev-1",
            timeToApprovalHours: 1,
            timeToApplyHours: 1,
          },
        ),
      ],
      storeDir: dir,
    });
    expect(result.forecasts).toEqual([]);
    expect(result.recommendation).toBeNull();
    expect(result.decision).toBeNull();
    expect(await new ForecastsStore(dir).list()).toEqual([]);
  });
});
