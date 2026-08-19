import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent } from "../../src/events/types.js";
import type { EnrichedProposal } from "../../src/adaptation/intelligence-types.js";
import { ProposalEventsAdapter } from "../../src/evolution/forecast/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../../src/evolution/forecast/adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "../../src/evolution/forecast/adapters/enriched-proposals-adapter.js";

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
  payload: Record<string, unknown> = {},
  proposalId?: string,
): AlixEvent {
  // Mirror ProposalStore.append() (proposal-store.ts:175-180): the proposal id
  // is embedded IN THE PAYLOAD (`payload: { proposalId, ...payload }`), not
  // attached at the event top level.
  const effectivePayload = proposalId !== undefined ? { proposalId, ...payload } : payload;
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
    seq: overrides.seq ?? 1,
    version: 1,
    sessionId: overrides.sessionId ?? "s1",
    timestamp: overrides.timestamp ?? "2026-08-14T00:00:00.000Z",
    type,
    actor: overrides.actor ?? "system",
    payload: effectivePayload,
    ...overrides,
  } as AlixEvent;
}

/** A canonical proposal.submitted payload carrying candidate.target.id. */
function submittedPayload(targetId: string, extraCandidate: Record<string, unknown> = {}) {
  return {
    candidate: { target: { kind: "capability", id: targetId }, ...extraCandidate },
    signalIds: ["sig-1"],
    sourceVersion: null,
  };
}

// ---------------------------------------------------------------------------
// ProposalEventsAdapter — RAW evidence preserved
// ---------------------------------------------------------------------------

describe("ProposalEventsAdapter (A9)", () => {
  let eventLog: EventLog;

  beforeEach(() => {
    eventLog = fakeEventLog([]);
  });

  it("returns empty list for an empty source", async () => {
    const result = await new ProposalEventsAdapter(eventLog).list();
    expect(result).toEqual([]);
  });

  it("preserves the raw payload so proposal.submitted.payload.candidate.target.id remains available", async () => {
    const payload = submittedPayload("cap-1");
    eventLog = fakeEventLog([
      makeEvent("capability.governance.proposal.submitted", { seq: 10 }, payload, "prop-1"),
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec).toBeDefined();
    expect(rec!.proposalId).toBe("prop-1");
    expect(rec!.kind).toBe("proposal.submitted");
    expect(rec!.capabilityId).toBe("cap-1");
    expect(rec!.recordedAt).toBe("2026-08-14T00:00:00.000Z");
    // RAW payload — the two-hop bridge anchor is intact.
    const rawCandidate = (rec!.payload["candidate"] as { target?: { id?: string } } | undefined);
    expect(rawCandidate?.target?.id).toBe("cap-1");
    // payload is preserved verbatim (same values, not normalized away) —
    // including the proposalId that ProposalStore embeds in the payload.
    expect(rec!.payload).toEqual({ proposalId: "prop-1", ...payload });
  });

  it("reads proposalId from the payload (canonical ProposalStore location)", async () => {
    // ProposalStore.append() writes `payload: { proposalId, ...payload }`; the
    // adapter must read from there — a top-level `proposalId` never exists on
    // persisted EventLog events (EventLog.append adds only id/seq/version/timestamp).
    eventLog = fakeEventLog([
      makeEvent(
        "capability.governance.proposal.submitted",
        { seq: 11 },
        {
          candidate: { target: { kind: "capability", id: "cap-9" } },
          signalIds: [],
          sourceVersion: null,
        },
        "prop-payload",
      ),
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec!.proposalId).toBe("prop-payload");
    expect(rec!.capabilityId).toBe("cap-9");
  });

  it("falls back to a top-level proposalId when the payload lacks one", async () => {
    // Robustness for any writer that attaches proposalId on the event itself
    // (the A8 adapter's shape) rather than in the payload.
    eventLog = fakeEventLog([
      {
        ...makeEvent(
          "capability.governance.proposal.submitted",
          { seq: 12 },
          {
            candidate: { target: { kind: "capability", id: "cap-8" } },
            signalIds: [],
            sourceVersion: null,
          },
        ),
        proposalId: "prop-top",
      } as unknown as AlixEvent,
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec!.proposalId).toBe("prop-top");
    expect(rec!.capabilityId).toBe("cap-8");
  });

  it("carries empty capabilityId for non-submitted kinds (candidate only lives on submitted)", async () => {
    eventLog = fakeEventLog([
      makeEvent(
        "capability.governance.proposal.execution_failed",
        { seq: 14 },
        { error: "boom", partialState: "not_committed" },
        "prop-5",
      ),
    ]);
    const [rec] = await new ProposalEventsAdapter(eventLog).list();
    expect(rec!.capabilityId).toBe("");
    expect(rec!.kind).toBe("proposal.execution_failed");
    expect(rec!.proposalId).toBe("prop-5");
    expect(rec!.payload).toEqual({
      proposalId: "prop-5",
      error: "boom",
      partialState: "not_committed",
    });
  });

  it("filters out non-governance events", async () => {
    eventLog = fakeEventLog([
      makeEvent("tool.started", { seq: 1 }, { toolCallId: "t1" }),
      makeEvent(
        "capability.governance.proposal.submitted",
        { seq: 3 },
        submittedPayload("cap-2"),
        "prop-only",
      ),
    ]);
    const result = await new ProposalEventsAdapter(eventLog).list();
    expect(result).toHaveLength(1);
    expect(result[0]!.proposalId).toBe("prop-only");
  });

  it("exposes a read-only surface with no mutation operations", async () => {
    const adapter = new ProposalEventsAdapter(eventLog);
    expect(adapter.name).toBe("a9-proposal-events");
    expect(typeof adapter.list).toBe("function");
    expect(Object.keys(adapter).sort()).toEqual(["eventLog", "name"]);
    for (const key of ["append", "write", "commit", "save"]) {
      expect((adapter as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// MeasurementEventsAdapter — Q8: no proposal linkage
// ---------------------------------------------------------------------------

describe("MeasurementEventsAdapter (A9)", () => {
  let eventLog: EventLog;

  beforeEach(() => {
    eventLog = fakeEventLog([]);
  });

  it("returns empty list for an empty source", async () => {
    const result = await new MeasurementEventsAdapter(eventLog).list();
    expect(result).toEqual([]);
  });

  it("extracts canonical measurement information only (measurementId, capabilityId, outcome)", async () => {
    eventLog = fakeEventLog([
      makeEvent(
        "capability.governance.measurement.measured",
        { seq: 20, id: "evt-20" },
        {
          measurement: { capabilityId: "cap-X" },
          post: { observationId: "obs-1", takenAt: "2026-08-14T00:00:00.000Z", status: "success", confidence: 0.9 },
          outcome: { kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] },
        },
      ),
    ]);
    const [rec] = await new MeasurementEventsAdapter(eventLog).list();
    expect(rec).toEqual({
      measurementId: "evt-20",
      capabilityId: "cap-X",
      outcome: "effective",
      recordedAt: "2026-08-14T00:00:00.000Z",
      eventId: "20",
    });
  });

  it("exposes NO proposal linkage on the emitted record (Q8 locked ruling)", async () => {
    eventLog = fakeEventLog([
      makeEvent(
        "capability.governance.measurement.measured",
        { seq: 20, id: "evt-20" },
        {
          measurement: { capabilityId: "cap-X" },
          post: { observationId: "obs-1", takenAt: "2026-08-14T00:00:00.000Z", status: "success", confidence: 0.9 },
          outcome: { kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] },
        },
      ),
    ]);
    const [rec] = await new MeasurementEventsAdapter(eventLog).list();
    const forbidden = ["proposalId", "sourceProposalIds", "forecastId", "correlationId"] as const;
    for (const key of forbidden) {
      expect(Object.keys(rec!)).not.toContain(key);
      expect((rec as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
  });

  it("skips signals_unpublished events (sink-failure, no measurement outcome)", async () => {
    eventLog = fakeEventLog([
      makeEvent(
        "capability.governance.measurement.measured",
        { seq: 21, id: "evt-21" },
        {
          measurement: { capabilityId: "cap-keep" },
          post: { observationId: "obs-1", takenAt: "2026-08-14T00:00:00.000Z", status: "success", confidence: 0.9 },
          outcome: { kind: "ineffective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] },
        },
      ),
      makeEvent(
        "capability.governance.measurement.signals_unpublished",
        { seq: 22 },
        { measurementEventId: "evt-21", signalCount: 3, signalIds: ["s1"], failure: { classification: "sink_threw", cause: "down" }, occurredAt: "2026-08-14T00:01:00.000Z", actor: { kind: "system", component: "CapabilityMeasurement" } },
      ),
    ]);
    const result = await new MeasurementEventsAdapter(eventLog).list();
    expect(result).toHaveLength(1);
    expect(result[0]!.capabilityId).toBe("cap-keep");
  });

  it("defaults outcome to inconclusive when outcome.kind is missing", async () => {
    eventLog = fakeEventLog([
      makeEvent(
        "capability.governance.measurement.measured",
        { seq: 23 },
        { measurement: { capabilityId: "cap-Z" }, post: {}, outcome: {} },
      ),
    ]);
    const [rec] = await new MeasurementEventsAdapter(eventLog).list();
    expect(rec!.outcome).toBe("inconclusive");
    expect(rec!.capabilityId).toBe("cap-Z");
  });

  it("exposes a read-only surface with no mutation operations", async () => {
    const adapter = new MeasurementEventsAdapter(eventLog);
    expect(adapter.name).toBe("a9-measurement-events");
    expect(Object.keys(adapter).sort()).toEqual(["eventLog", "name"]);
    for (const key of ["append", "publish", "write"]) {
      expect((adapter as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// EnrichedProposalsAdapter — read-only over raw EnrichedProposal[]
// ---------------------------------------------------------------------------

describe("EnrichedProposalsAdapter (A9)", () => {
  function makeEnriched(
    proposalId: string,
    targetKind: "capability" | "agent_card" = "capability",
    capability?: string,
  ): EnrichedProposal {
    const target =
      targetKind === "capability"
        ? { kind: "capability" as const, capability: capability ?? "cap-A" }
        : { kind: "agent_card" as const, id: "agent-1" };
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
        evidenceFingerprints: ["fp-1", "fp-2"],
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

  it("returns empty list for an empty source", async () => {
    const result = await new EnrichedProposalsAdapter([]).list();
    expect(result).toEqual([]);
  });

  it("accepts a lazy source function (composition-root default; no I/O until list)", async () => {
    const enriched = makeEnriched("ep-1", "capability", "cap-abc");
    const supplier = vi.fn(async () => [enriched]);
    const adapter = new EnrichedProposalsAdapter(supplier);
    // Construction must not invoke the supplier — only list() does.
    expect(supplier).not.toHaveBeenCalled();
    const [rec] = await adapter.list();
    expect(supplier).toHaveBeenCalledTimes(1);
    expect(rec!.proposalId).toBe("ep-1");
  });

  it("reads enrichedFields directly and exposes population + source signals", async () => {
    const enriched = makeEnriched("ep-1", "capability", "cap-abc");
    const [rec] = await new EnrichedProposalsAdapter([enriched]).list();
    expect(rec!.proposalId).toBe("ep-1");
    expect(rec!.capabilityId).toBe("cap-abc");
    expect(rec!.enrichedFields).toEqual([
      "proposal",
      "effectivenessReport",
      "wasReverted",
      "revertProposalId",
      "outcome",
      "timeToApprovalHours",
      "timeToApplyHours",
    ]);
    expect(rec!.recordedAt).toBe("2026-08-13T00:00:00.000Z");
    expect(rec!.sourceConfidence).toBe(0.8);
    expect(rec!.evidenceFingerprints).toEqual(["fp-1", "fp-2"]);
    // Population flags reflect the fixture: report null, revert null, timeToApply null.
    expect(rec!.assessment).toEqual({
      hasEffectivenessReport: false,
      hasRevertDecision: false,
      hasTimeToApproval: true,
      hasTimeToApply: false,
    });
  });

  it("returns empty capabilityId for non-capability targets", async () => {
    const enriched = makeEnriched("ep-2", "agent_card");
    const [rec] = await new EnrichedProposalsAdapter([enriched]).list();
    expect(rec!.capabilityId).toBe("");
    expect(rec!.proposalId).toBe("ep-2");
  });

  it("falls back to epoch ISO when proposal.createdAt is nullish", async () => {
    const enriched = {
      ...makeEnriched("ep-3", "capability", "cap-1"),
      proposal: { ...makeEnriched("ep-3", "capability", "cap-1").proposal, createdAt: undefined },
    } as unknown as EnrichedProposal;
    const [rec] = await new EnrichedProposalsAdapter([enriched]).list();
    expect(rec!.recordedAt).toBe(new Date(0).toISOString());
  });

  it("exposes a read-only surface with no mutation operations", async () => {
    const adapter = new EnrichedProposalsAdapter([]);
    expect(adapter.name).toBe("a9-enriched-proposals");
    expect(Object.keys(adapter).sort()).toEqual(["name", "source"]);
    for (const key of ["append", "save", "write"]) {
      expect((adapter as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});
