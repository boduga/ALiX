import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent } from "../../src/events/types.js";
import type { EnrichedProposal } from "../../src/adaptation/intelligence-types.js";
import type { RecommendationStore } from "../../src/evolution/verification/recommendation/recommendation-store.js";
import { ProposalEventsAdapter } from "../../src/evolution/learning/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../../src/evolution/learning/adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "../../src/evolution/learning/adapters/enriched-proposals-adapter.js";
import { RecommendationsAdapter } from "../../src/evolution/learning/adapters/recommendations-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake EventLog whose readAll() returns the supplied events. */
function fakeEventLog(events: ReadonlyArray<AlixEvent>): EventLog {
  return {
    readAll: vi.fn(async () => events),
  } as unknown as EventLog;
}

function makeEvent(
  type: string,
  overrides: Partial<AlixEvent> = {},
  payload: unknown = {},
  proposalId?: string,
): AlixEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
    seq: overrides.seq ?? 1,
    version: 1,
    sessionId: overrides.sessionId ?? "s1",
    timestamp: overrides.timestamp ?? "2026-08-14T00:00:00.000Z",
    type,
    actor: overrides.actor ?? "system",
    payload,
    ...(proposalId !== undefined ? { proposalId } : {}),
    ...overrides,
  } as AlixEvent;
}

// ---------------------------------------------------------------------------
// ProposalEventsAdapter
// ---------------------------------------------------------------------------

describe("ProposalEventsAdapter", () => {
  let readAllMock: ReturnType<typeof vi.fn>;
  let eventLog: EventLog;

  beforeEach(() => {
    readAllMock = vi.fn();
    eventLog = { readAll: readAllMock } as unknown as EventLog;
  });

  it("returns normalized shape for proposal.submitted with capabilityId from candidate.target.id", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.proposal.submitted",
        { seq: 10 },
        {
          candidate: {
            target: { id: "cap-1" },
            // other candidate fields omitted in test fixture
          },
          signalIds: ["sig-1"],
          sourceVersion: null,
        },
        "prop-1",
      ),
    ]);
    const result = await new ProposalEventsAdapter(eventLog).list();
    expect(result).toEqual([
      {
        proposalId: "prop-1",
        capabilityId: "cap-1",
        kind: "proposal.submitted",
        operatorId: undefined,
        operatorReason: undefined,
        recordedAt: "2026-08-14T00:00:00.000Z",
        eventId: "10",
      },
    ]);
  });

  it("populates operatorId from approvedBy on proposal.approved", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.proposal.approved",
        { seq: 11 },
        { approvedBy: "user-1", approvedAt: "2026-08-14T01:00:00.000Z" },
        "prop-2",
      ),
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec).toMatchObject({
      proposalId: "prop-2",
      kind: "proposal.approved",
      capabilityId: "", // no candidate on approved events
      operatorId: "user-1",
      operatorReason: undefined,
    });
  });

  it("populates operatorId from rejectedBy and operatorReason from reason on proposal.rejected", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.proposal.rejected",
        { seq: 12 },
        { rejectedBy: "user-2", reason: "not enough evidence" },
        "prop-3",
      ),
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec).toMatchObject({
      proposalId: "prop-3",
      kind: "proposal.rejected",
      capabilityId: "",
      operatorId: "user-2",
      operatorReason: "not enough evidence",
    });
  });

  it("captures executed event with empty capabilityId and no operator fields", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.proposal.executed",
        { seq: 13 },
        { mutation: { success: true, mutation: {}, artifactId: "art-1" }, artifactId: "art-1" },
        "prop-4",
      ),
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec).toMatchObject({
      proposalId: "prop-4",
      kind: "proposal.executed",
      capabilityId: "",
      operatorId: undefined,
      operatorReason: undefined,
      eventId: "13",
    });
  });

  it("captures execution_failed event with empty capabilityId", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.proposal.execution_failed",
        { seq: 14 },
        { error: "boom", partialState: "not_committed" },
        "prop-5",
      ),
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec).toMatchObject({
      proposalId: "prop-5",
      kind: "proposal.execution_failed",
      capabilityId: "",
      operatorId: undefined,
      operatorReason: undefined,
    });
  });

  it("filters out non-governance events", async () => {
    readAllMock.mockResolvedValue([
      makeEvent("tool.started", { seq: 1 }, { toolCallId: "t1" }),
      makeEvent("agent.message", { seq: 2 }, { content: "hi" }),
      makeEvent(
        "capability.governance.proposal.submitted",
        { seq: 3 },
        { candidate: { target: { id: "cap-2" } }, signalIds: [], sourceVersion: null },
        "prop-only",
      ),
    ]);
    const result = await new ProposalEventsAdapter(eventLog).list();
    expect(result).toHaveLength(1);
    expect(result[0]?.proposalId).toBe("prop-only");
  });

  it("returns empty array when EventLog has no events", async () => {
    readAllMock.mockResolvedValue([]);
    const result = await new ProposalEventsAdapter(eventLog).list();
    expect(result).toEqual([]);
  });

  it("exposes read-only invariant: no mutation surface", () => {
    const adapter = new ProposalEventsAdapter(eventLog);
    // Public API is only `name` and `list()`.
    expect(adapter.name).toBe("proposal-events");
    expect(typeof adapter.list).toBe("function");
    expect(Object.keys(adapter).sort()).toEqual(["eventLog", "name"]);
    // Adapter has no write/append/commit methods.
    expect((adapter as unknown as Record<string, unknown>)["append"]).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>)["write"]).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>)["commit"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MeasurementEventsAdapter
// ---------------------------------------------------------------------------

describe("MeasurementEventsAdapter", () => {
  let readAllMock: ReturnType<typeof vi.fn>;
  let eventLog: EventLog;

  beforeEach(() => {
    readAllMock = vi.fn();
    eventLog = { readAll: readAllMock } as unknown as EventLog;
  });

  it("extracts capabilityId from payload.measurement.capabilityId and outcome.kind", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.measurement.measured",
        { seq: 20 },
        {
          measurement: { capabilityId: "cap-X" },
          post: {},
          outcome: { kind: "effective", confidence: 0.9 },
        },
      ),
    ]);
    const [rec] = await new MeasurementEventsAdapter(eventLog).list();
    expect(rec).toEqual({
      capabilityId: "cap-X",
      outcome: "effective",
      recordedAt: "2026-08-14T00:00:00.000Z",
      eventId: "20",
    });
  });

  it("handles each outcome kind", async () => {
    const outcomes = ["effective", "ineffective", "inconclusive"] as const;
    for (const kind of outcomes) {
      readAllMock.mockResolvedValueOnce([
        makeEvent(
          "capability.governance.measurement.measured",
          { seq: 30 },
          { measurement: { capabilityId: "cap-Y" }, post: {}, outcome: { kind } },
        ),
      ]);
    }
    const results: Array<Awaited<ReturnType<MeasurementEventsAdapter["list"]>>> = [];
    for (let i = 0; i < outcomes.length; i++) {
      results.push(await new MeasurementEventsAdapter(eventLog).list());
    }
    const flattened = results.flat();
    expect(flattened.map((r) => r.outcome)).toEqual(["effective", "ineffective", "inconclusive"]);
  });

  it("skips signals_unpublished events (CAP-10.5 sink-failure sink)", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.measurement.measured",
        { seq: 21 },
        { measurement: { capabilityId: "cap-keep" }, post: {}, outcome: { kind: "effective" } },
      ),
      makeEvent(
        "capability.governance.measurement.signals_unpublished",
        { seq: 22 },
        {
          measurementEventId: "evt-21",
          signalCount: 3,
          signalIds: ["s1", "s2", "s3"],
          failure: { classification: "sink_threw", cause: "down" },
          occurredAt: "2026-08-14T00:01:00.000Z",
          actor: { kind: "system", component: "CapabilityMeasurement" },
        },
      ),
    ]);
    const result = await new MeasurementEventsAdapter(eventLog).list();
    expect(result).toHaveLength(1);
    expect(result[0]?.capabilityId).toBe("cap-keep");
    expect(result[0]?.outcome).toBe("effective");
  });

  it("defaults outcome to inconclusive when outcome.kind is missing", async () => {
    readAllMock.mockResolvedValue([
      makeEvent(
        "capability.governance.measurement.measured",
        { seq: 23 },
        { measurement: { capabilityId: "cap-Z" }, post: {}, outcome: {} },
      ),
    ]);
    const [rec] = await new MeasurementEventsAdapter(eventLog).list();
    expect(rec?.outcome).toBe("inconclusive");
    expect(rec?.capabilityId).toBe("cap-Z");
  });

  it("returns empty array when EventLog has no measurement events", async () => {
    readAllMock.mockResolvedValue([
      makeEvent("tool.completed", { seq: 1 }, { toolCallId: "t" }),
    ]);
    const result = await new MeasurementEventsAdapter(eventLog).list();
    expect(result).toEqual([]);
  });

  it("exposes read-only invariant: no mutation surface", () => {
    const adapter = new MeasurementEventsAdapter(eventLog);
    expect(adapter.name).toBe("measurement-events");
    expect(typeof adapter.list).toBe("function");
    expect((adapter as unknown as Record<string, unknown>)["append"]).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>)["publish"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EnrichedProposalsAdapter
// ---------------------------------------------------------------------------

describe("EnrichedProposalsAdapter", () => {
  function makeEnriched(
    proposalId: string,
    targetKind: "capability" | "agent_card" | "issue" = "agent_card",
    capability?: string,
  ): EnrichedProposal {
    const target =
      targetKind === "capability"
        ? { kind: "capability" as const, capability: capability ?? "cap-A" }
        : targetKind === "agent_card"
          ? { kind: "agent_card" as const, id: "agent-1" }
          : { kind: "issue" as const, title: "fix it" };
    return {
      proposal: {
        id: proposalId,
        createdAt: "2026-08-13T00:00:00.000Z",
        status: "approved",
        action: "update_agent_card",
        target,
        payload: {},
        sourceRecommendationType: "manual",
        sourceConfidence: 0.8,
        evidenceFingerprints: [],
        reason: "test",
      },
      effectivenessReport: null,
      wasReverted: false,
      revertProposalId: null,
      outcome: "approved",
      timeToApprovalHours: 1,
      timeToApplyHours: null,
    };
  }

  it("extracts proposalId, capabilityId (from target.capability), enrichedFields, recordedAt for capability target", async () => {
    const enriched = makeEnriched("ep-1", "capability", "cap-abc");
    const result = await new EnrichedProposalsAdapter([enriched]).list();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      proposalId: "ep-1",
      capabilityId: "cap-abc",
      enrichedFields: [
        "proposal",
        "effectivenessReport",
        "wasReverted",
        "revertProposalId",
        "outcome",
        "timeToApprovalHours",
        "timeToApplyHours",
      ],
      recordedAt: "2026-08-13T00:00:00.000Z",
    });
  });

  it("returns empty capabilityId for non-capability targets", async () => {
    const enriched = makeEnriched("ep-2", "agent_card");
    const result = await new EnrichedProposalsAdapter([enriched]).list();
    expect(result[0]?.capabilityId).toBe("");
    expect(result[0]?.proposalId).toBe("ep-2");
  });

  it("returns empty capabilityId for issue targets", async () => {
    const enriched = makeEnriched("ep-3", "issue");
    const result = await new EnrichedProposalsAdapter([enriched]).list();
    expect(result[0]?.capabilityId).toBe("");
  });

  it("returns empty list for empty source", async () => {
    const result = await new EnrichedProposalsAdapter([]).list();
    expect(result).toEqual([]);
  });

  it("preserves proposalId and recordedAt verbatim when proposal.createdAt is populated", async () => {
    const enriched: EnrichedProposal = {
      proposal: {
        id: "ep-4",
        createdAt: "2026-08-01T00:00:00.000Z",
        status: "pending",
        action: "update_agent_card",
        target: { kind: "agent_card", id: "agent-1" },
        payload: {},
        sourceRecommendationType: "manual",
        sourceConfidence: 0,
        evidenceFingerprints: [],
        reason: "t",
      },
      effectivenessReport: null,
      wasReverted: false,
      revertProposalId: null,
      outcome: "pending",
      timeToApprovalHours: null,
      timeToApplyHours: null,
    };
    const result = await new EnrichedProposalsAdapter([enriched]).list();
    expect(result[0]?.proposalId).toBe("ep-4");
    expect(result[0]?.recordedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("falls back to epoch ISO when proposal.createdAt is nullish", async () => {
    // The contract types createdAt as `string`, but the adapter defends against
    // nullish values from upstream sources (e.g. manually-built fixtures).
    const enriched = {
      proposal: {
        id: "ep-5",
        createdAt: undefined,
        status: "pending",
        action: "update_agent_card",
        target: { kind: "agent_card", id: "agent-1" },
        payload: {},
        sourceRecommendationType: "manual",
        sourceConfidence: 0,
        evidenceFingerprints: [],
        reason: "t",
      },
      effectivenessReport: null,
      wasReverted: false,
      revertProposalId: null,
      outcome: "pending",
      timeToApprovalHours: null,
      timeToApplyHours: null,
    } as unknown as EnrichedProposal;
    const result = await new EnrichedProposalsAdapter([enriched]).list();
    expect(result[0]?.proposalId).toBe("ep-5");
    expect(result[0]?.recordedAt).toBe(new Date(0).toISOString());
  });

  it("exposes read-only invariant: no mutation surface", () => {
    const adapter = new EnrichedProposalsAdapter([]);
    expect(adapter.name).toBe("enriched-proposals");
    expect(typeof adapter.list).toBe("function");
    expect((adapter as unknown as Record<string, unknown>)["append"]).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>)["save"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RecommendationsAdapter (T4, 4-adapter pattern, A8 wayfinder map #517)
// ---------------------------------------------------------------------------

/**
 * Build an A2.5 RecommendationStore stub that returns the fixed A2.5 record
 * list (Q-A8-REC: the adapter reads the A2.5 surface exclusively).
 */
function makeRecStoreStub(
  recs: ReadonlyArray<{
    recommendationId: string;
    evidenceId: string;
    proposalId: string;
    kind:
      | "APPROVE"
      | "MONITOR"
      | "REQUEST_ADDITIONAL_EVIDENCE"
      | "REJECT"
      | "ESCALATE"
      | "RISK_GATED_REVIEW";
    confidence: number;
    reasoning: string;
    supportingEvidence: ReadonlyArray<string>;
    risks: ReadonlyArray<string>;
    createdAt: string;
  }>,
): RecommendationStore {
  return {
    list: vi.fn(async () => recs),
  } as unknown as RecommendationStore;
}

describe("RecommendationsAdapter", () => {
  it("has name='recommendations'", () => {
    const adapter = new RecommendationsAdapter(makeRecStoreStub([]));
    expect(adapter.name).toBe("recommendations");
  });

  it("returns [] when governance-store has no recommendations", async () => {
    const adapter = new RecommendationsAdapter(makeRecStoreStub([]));
    const out = await adapter.list();
    expect(out).toEqual([]);
  });

  it("normalizes GovernanceRecommendation → RecommendationRecord (field mapping)", async () => {
    const recs = [
      {
        recommendationId: "rec-1",
        evidenceId: "ev-1",
        proposalId: "prop-1",
        kind: "APPROVE" as const,
        confidence: 0.85,
        reasoning: "all checks passed",
        supportingEvidence: ["ev-1", "ev-2"],
        risks: [],
        createdAt: "2026-08-10T00:00:00.000Z",
      },
    ];
    const adapter = new RecommendationsAdapter(makeRecStoreStub(recs));
    const out = await adapter.list();
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      recordId: "rec-1", // ← source recommendationId
      proposalId: "prop-1",
      kind: "APPROVE",
      confidence: 0.85,
      reasoning: "all checks passed",
      evidenceRefs: ["ev-1", "ev-2"], // ← source supportingEvidence
      recordedAt: "2026-08-10T00:00:00.000Z", // ← source createdAt
    });
  });

  it("preserves all 6 A2.5 kinds (APPROVE | MONITOR | REQUEST_ADDITIONAL_EVIDENCE | REJECT | ESCALATE | RISK_GATED_REVIEW)", async () => {
    const recs = [
      { recommendationId: "r1", evidenceId: "e1", proposalId: "p1", kind: "APPROVE" as const, confidence: 0.9, reasoning: "ok", supportingEvidence: [], risks: [], createdAt: "2026-08-01T00:00:00.000Z" },
      { recommendationId: "r2", evidenceId: "e2", proposalId: "p2", kind: "MONITOR" as const, confidence: 0.6, reasoning: "watch", supportingEvidence: [], risks: [], createdAt: "2026-08-02T00:00:00.000Z" },
      { recommendationId: "r3", evidenceId: "e3", proposalId: "p3", kind: "REQUEST_ADDITIONAL_EVIDENCE" as const, confidence: 0.4, reasoning: "need more", supportingEvidence: [], risks: [], createdAt: "2026-08-03T00:00:00.000Z" },
      { recommendationId: "r4", evidenceId: "e4", proposalId: "p4", kind: "REJECT" as const, confidence: 0.95, reasoning: "broken", supportingEvidence: [], risks: [], createdAt: "2026-08-04T00:00:00.000Z" },
      { recommendationId: "r5", evidenceId: "e5", proposalId: "p5", kind: "ESCALATE" as const, confidence: 0.3, reasoning: "complex", supportingEvidence: [], risks: [], createdAt: "2026-08-05T00:00:00.000Z" },
      { recommendationId: "r6", evidenceId: "e6", proposalId: "p6", kind: "RISK_GATED_REVIEW" as const, confidence: 0.75, reasoning: "risk forecast", supportingEvidence: [], risks: [], createdAt: "2026-08-06T00:00:00.000Z" },
    ];
    const adapter = new RecommendationsAdapter(makeRecStoreStub(recs));
    const out = await adapter.list();
    expect(out.map((r) => r.kind)).toEqual([
      "APPROVE",
      "MONITOR",
      "REQUEST_ADDITIONAL_EVIDENCE",
      "REJECT",
      "ESCALATE",
      "RISK_GATED_REVIEW",
    ]);
  });

  it("preserves proposalId (no silent default — STOP-AND-SURFACE invariant)", async () => {
    const recs = [
      {
        recommendationId: "r1",
        evidenceId: "e1",
        proposalId: "prop-XYZ",
        kind: "APPROVE" as const,
        confidence: 0.5,
        reasoning: "x",
        supportingEvidence: [],
        risks: [],
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const adapter = new RecommendationsAdapter(makeRecStoreStub(recs));
    const out = await adapter.list();
    expect(out[0]!.proposalId).toBe("prop-XYZ");
    expect(out[0]!.proposalId).not.toBe("");
    expect(out[0]!.proposalId).not.toBeUndefined();
  });

  it("passes empty supportingEvidence → empty evidenceRefs (not [evidenceId])", async () => {
    const recs = [
      {
        recommendationId: "r1",
        evidenceId: "the-evidence-id", // <- not used
        proposalId: "p1",
        kind: "APPROVE" as const,
        confidence: 0.5,
        reasoning: "x",
        supportingEvidence: [], // <- empty
        risks: [],
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const adapter = new RecommendationsAdapter(makeRecStoreStub(recs));
    const out = await adapter.list();
    expect(out[0]!.evidenceRefs).toEqual([]);
    expect(out[0]!.evidenceRefs).not.toContain("the-evidence-id");
  });

  it("reads the A2.5 RecommendationStore.list() once (exclusive read-only path)", async () => {
    const store = makeRecStoreStub([]);
    const adapter = new RecommendationsAdapter(store);
    await adapter.list();
    // Q-A8-REC: the adapter reads the A2.5 store's list() — never
    // GovernanceStore.list("recommendations") (the P9.x report wrapper).
    expect((store.list as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("exposes read-only invariant: no mutation surface", () => {
    const adapter = new RecommendationsAdapter(makeRecStoreStub([]));
    expect(adapter.name).toBe("recommendations");
    expect(typeof adapter.list).toBe("function");
    expect((adapter as unknown as Record<string, unknown>)["append"]).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>)["save"]).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>)["write"]).toBeUndefined();
  });
});

// Suppress unused-import lint warnings for fakeEventLog when the build prunes it.
void fakeEventLog;
