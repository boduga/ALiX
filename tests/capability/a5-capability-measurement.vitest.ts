// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10.5 Task 5 — CapabilityMeasurement locked pipeline.
 *
 * Asserts that CapabilityMeasurement:
 *   - uses the new sink-based emission pipeline (ruling #R1, #R2)
 *   - default decider emits `underperformer` for `ineffective` ONLY (ruling #R3)
 *   - records `measured` event BEFORE publishing signals (commit point)
 *   - on sink failure, records `signals_unpublished` event with the failed
 *     signal IDs (ruling #R5)
 *   - never mutates decider-produced signals (ruling #R3)
 *   - returns the outcome regardless of publish failure
 */

import { describe, it, expect } from "vitest";
import { CapabilityMeasurement } from "../../src/evolution/observation/capability-measurement.js";
import type { OutcomeDecider } from "../../src/evolution/observation/capability-measurement.js";
import type { ProposalSignalSink, CapabilityEvolutionSignal } from "../../src/capability/evolution/proposals.js";
import type { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import type { ObservationResult } from "../../src/evolution/observation/contracts/observation-contract.js";
import type { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import type { EventLog } from "../../src/events/event-log.js";

// --- minimal in-memory fakes ---

class FakeCatalog implements Pick<CapabilityCatalog, "get"> {
  get(id: string) {
    return { id, bindings: [{ type: "native" }] } as unknown as ReturnType<CapabilityCatalog["get"]>;
  }
}

class FakeEngine {
  constructor(private readonly post: ObservationResult) {}
  async observe(): Promise<ObservationResult> {
    return this.post;
  }
}

class CollectingSink implements ProposalSignalSink {
  public readonly published: CapabilityEvolutionSignal[] = [];
  public shouldThrow = false;
  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    if (this.shouldThrow) throw new Error("boom");
    this.published.push(signal);
  }
}

class FakeEventLog {
  public readonly events: Record<string, unknown>[] = [];
  async append<TType extends string, TPayload>(event: { type: TType; payload: TPayload }): Promise<{ seq: number }> {
    const seq = this.events.length + 1;
    this.events.push({ ...event, seq });
    return { seq };
  }
}

// --- helpers ---

function buildMeasurement(opts: {
  sink?: CollectingSink;
  eventLog?: FakeEventLog;
  decider?: OutcomeDecider;
  postStatus?: "pass" | "fail" | "error";
}) {
  const post: ObservationResult = {
    observationId: "obs-post",
    status: opts.postStatus ?? "pass",
    confidence: 0.8,
    observedAt: new Date().toISOString(),
    evidence: {},
  };
  const engine = new FakeEngine(post);
  const sink = opts.sink ?? new CollectingSink();
  const eventLog = opts.eventLog ?? new FakeEventLog();
  const m = new CapabilityMeasurement({
    observationEngine: engine as unknown as ObservationEngine,
    signalSink: sink,
    catalog: new FakeCatalog() as unknown as CapabilityCatalog,
    eventLog: eventLog as unknown as EventLog,
    ...(opts.decider ? { outcomeDecider: opts.decider } : {}),
  });
  return { m, sink, eventLog, engine };
}

// --- tests ---

describe("CapabilityMeasurement default decider (CAP-10.5 ruling #R3)", () => {
  it("effective → no signals published", async () => {
    const { m, sink } = buildMeasurement({ postStatus: "pass" });
    const out = await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(out.kind).toBe("effective");
    expect(sink.published).toEqual([]);
  });

  it("ineffective → exactly one underperformer published with locked fields", async () => {
    const { m, sink } = buildMeasurement({ postStatus: "fail" });
    const out = await m.measureCapability({ capabilityId: "cap-x", version: "1.0.0" });
    expect(out.kind).toBe("ineffective");
    expect(sink.published).toHaveLength(1);
    const s = sink.published[0]!;
    expect(s.kind).toBe("underperformer");
    if (s.kind === "underperformer") {
      expect(s.capabilityId).toBe("cap-x@1.0.0");
      expect(s.score).toBeCloseTo(0.8);
      expect(s.evidenceIds).toContain("obs-post");
    }
  });

  it("inconclusive → no signals published", async () => {
    const { m, sink } = buildMeasurement({ postStatus: "error" });
    const out = await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(out.kind).toBe("inconclusive");
    expect(sink.published).toEqual([]);
  });
});

describe("CapabilityMeasurement custom decider (CAP-10.5 ruling #R3)", () => {
  it("decider can emit a gap signal", async () => {
    const gap: CapabilityEvolutionSignal = { kind: "gap", score: 0.7, evidenceIds: [] };
    const { m, sink } = buildMeasurement({
      postStatus: "fail",
      decider: () => ({
        kind: "ineffective",
        evidenceRefs: ["obs-post"],
        confidence: 0.4,
        summary: "x",
        signals: [gap],
      }),
    });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(sink.published).toEqual([gap]);
  });

  it("A5 never modifies decider-produced signals (frozen array)", async () => {
    const sig: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "a@1", score: 0.4, evidenceIds: [] };
    const arr: CapabilityEvolutionSignal[] = [sig];
    Object.freeze(arr);
    const { m, sink } = buildMeasurement({
      postStatus: "fail",
      decider: () => ({
        kind: "ineffective",
        evidenceRefs: ["obs-post"],
        confidence: 0.4,
        summary: "x",
        signals: arr,
      }),
    });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(sink.published).toHaveLength(1);
    expect(arr).toHaveLength(1); // unchanged
  });
});

describe("CapabilityMeasurement locked pipeline (CAP-10.5 ruling #R2)", () => {
  it("measured event appended before publish (commit point is step 3)", async () => {
    const order: string[] = [];
    const sink = new CollectingSink();
    sink.publish = async (s: CapabilityEvolutionSignal) => {
      order.push(`publish:${s.kind}`);
      (sink as CollectingSink).published.push(s);
    };
    const eventLog = new FakeEventLog();
    const originalAppend = eventLog.append.bind(eventLog);
    eventLog.append = async (e: { type: string; payload: unknown }) => {
      order.push("append:measured");
      return originalAppend(e);
    };
    const { m } = buildMeasurement({ sink, eventLog, postStatus: "fail" });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    const appendIdx = order.indexOf("append:measured");
    const publishIdx = order.findIndex((s) => s.startsWith("publish:"));
    expect(appendIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeGreaterThan(appendIdx);
  });

  it("sink throws → records signals_unpublished + returns successful outcome", async () => {
    const sink = new CollectingSink();
    sink.shouldThrow = true;
    const eventLog = new FakeEventLog();
    const { m } = buildMeasurement({ sink, eventLog, postStatus: "fail" });
    const out = await m.measureCapability({ capabilityId: "cap-x", version: "1.0.0" });
    expect(out.kind).toBe("ineffective");
    const unpublished = eventLog.events.find(
      (e: any) => e.type === "capability.governance.measurement.signals_unpublished",
    );
    expect(unpublished).toBeDefined();
    const p = (unpublished as any).payload;
    expect(p.measurementEventId).toBeDefined();
    expect(p.signalCount).toBe(p.signalIds.length);
    expect(p.signalIds).toHaveLength(1);
    expect(p.failure.classification).toBe("sink_threw");
    expect(p.actor).toEqual({ kind: "system", component: "CapabilityMeasurement" });
  });

  it("partial publish failure → signals_unpublished lists only the failed signals", async () => {
    const sink = new CollectingSink();
    const gap: CapabilityEvolutionSignal = { kind: "gap", score: 0.6, evidenceIds: [] };
    const under: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "a@1", score: 0.4, evidenceIds: [] };
    let first = true;
    sink.publish = async (s: CapabilityEvolutionSignal) => {
      if (first && s.kind === "underperformer") {
        first = false;
        throw new Error("boom");
      }
      sink.published.push(s);
    };
    const eventLog = new FakeEventLog();
    const { m } = buildMeasurement({
      sink,
      eventLog,
      postStatus: "fail",
      decider: () => ({
        kind: "ineffective",
        evidenceRefs: ["obs-post"],
        confidence: 0.4,
        summary: "x",
        signals: [gap, under],
      }),
    });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    const unpublished = eventLog.events.find(
      (e: any) => e.type === "capability.governance.measurement.signals_unpublished",
    );
    expect(unpublished).toBeDefined();
    const p = (unpublished as any).payload;
    expect(p.signalIds).toHaveLength(1); // only the underperformer failed
  });

  it("records measured event with outcome.signals on success path", async () => {
    const eventLog = new FakeEventLog();
    const { m } = buildMeasurement({ eventLog, postStatus: "fail" });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    const measured = eventLog.events.find(
      (e: any) => e.type === "capability.governance.measurement.measured",
    );
    expect(measured).toBeDefined();
    const p = (measured as any).payload;
    expect(p.outcome.signals).toHaveLength(1);
    expect(p.outcome.signals[0].kind).toBe("underperformer");
  });
});
