// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 5 — A7ProposalGenerator (pure, signal-only).
 *
 * Asserts that A7ProposalGenerator:
 *   - emits one candidate per signal (pure transformation signal → candidate)
 *   - gap signal → candidate target.id starts with "new." (new capability)
 *   - underperformer / consolidation_opportunity / deprecation_signal →
 *     candidate target.id === signal.capabilityId
 *   - returns empty array when no signals present
 *   - returns empty array when ProposalSignalSource signals() rejects
 *   - candidate shape conforms to CapabilityEvolutionCandidate interface
 *   - candidateId is deterministic (no Date.now() — ruling #18 spirit)
 *   - description carries the signal score for downstream consumers
 *   - sourcePatternId is the signal kind (which downstream taxonomy keys on)
 *   - target.kind is always "capability" (A7's only supported target)
 *   - A7 module does NOT import from forbidden axes (axis-4 sentinel)
 */

import { describe, it, expect } from "vitest";
import {
  A7ProposalGenerator,
  type CapabilityEvolutionSignal,
  type ProposalSignalSource,
} from "../../src/capability/evolution/a7-proposals.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

class EmptySignalSource implements ProposalSignalSource {
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [];
  }
}

class RejectingSignalSource implements ProposalSignalSource {
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    throw new Error("signal source offline");
  }
}

describe("A7ProposalGenerator — pure proposal intelligence (CAP-9 ruling #5)", () => {
  it("gap signal → create candidate (target.id starts with 'new.')", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "gap",
          capabilityId: undefined,
          score: 0.9,
          evidenceIds: ["e-1"],
        },
      ]),
    });
    const candidates = await gen.generate();
    expect(candidates).toHaveLength(1);
    const [c] = candidates;
    expect(c).toBeDefined();
    expect(c.target.kind).toBe("capability");
    expect(c.target.id).toMatch(/^new\./);
    expect(c.target.id).toBeTruthy();
  });

  it("underperformer signal → update candidate (target.id === signal.capabilityId)", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "underperformer",
          capabilityId: "tool.file.read",
          score: 0.6,
          evidenceIds: [],
        },
      ]),
    });
    const [c] = (await gen.generate()) ?? [];
    expect(c).toBeDefined();
    expect(c.target.kind).toBe("capability");
    expect(c.target.id).toBe("tool.file.read");
  });

  it("consolidation_opportunity → consolidate candidate (target.id === signal.capabilityId)", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "consolidation_opportunity",
          capabilityId: "tool.file.read",
          score: 0.8,
          evidenceIds: [],
        },
      ]),
    });
    const [c] = (await gen.generate()) ?? [];
    expect(c).toBeDefined();
    expect(c.target.kind).toBe("capability");
    expect(c.target.id).toBe("tool.file.read");
  });

  it("deprecation_signal → remove candidate (target.id === signal.capabilityId)", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "deprecation_signal",
          capabilityId: "tool.file.read",
          score: 0.7,
          evidenceIds: [],
        },
      ]),
    });
    const [c] = (await gen.generate()) ?? [];
    expect(c).toBeDefined();
    expect(c.target.kind).toBe("capability");
    expect(c.target.id).toBe("tool.file.read");
  });

  it("empty signal source → empty candidate list", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new EmptySignalSource(),
    });
    const candidates = await gen.generate();
    expect(candidates).toEqual([]);
  });

  it("rejects ProposalSignalSource signals() rejection — propagates", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new RejectingSignalSource(),
    });
    await expect(gen.generate()).rejects.toThrow("signal source offline");
  });

  it("candidateId is deterministic (no Date.now() — ruling #18 spirit)", async () => {
    const signal: CapabilityEvolutionSignal = {
      kind: "underperformer",
      capabilityId: "tool.file.read",
      score: 0.6,
      evidenceIds: [],
    };
    const gen1 = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([signal]),
    });
    const gen2 = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([signal]),
    });
    const [c1] = await gen1.generate();
    const [c2] = await gen2.generate();
    expect(c1.candidateId).toBe(c2.candidateId);
  });

  it("description carries the signal score (downstream consumers read it)", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "underperformer",
          capabilityId: "tool.file.read",
          score: 0.6,
          evidenceIds: [],
        },
      ]),
    });
    const [c] = await gen.generate();
    expect(c.description).toContain("0.6");
  });

  it("sourcePatternId is the signal kind (ruling #18 — taxonomy key)", async () => {
    const signals: CapabilityEvolutionSignal[] = [
      {
        kind: "gap",
        capabilityId: undefined,
        score: 0.9,
        evidenceIds: [],
      },
      {
        kind: "underperformer",
        capabilityId: "tool.file.read",
        score: 0.6,
        evidenceIds: [],
      },
      {
        kind: "consolidation_opportunity",
        capabilityId: "tool.file.read",
        score: 0.8,
        evidenceIds: [],
      },
      {
        kind: "deprecation_signal",
        capabilityId: "tool.file.read",
        score: 0.7,
        evidenceIds: [],
      },
    ];
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource(signals),
    });
    const candidates = await gen.generate();
    expect(candidates).toHaveLength(4);
    expect(candidates.map((c) => c.sourcePatternId)).toEqual([
      "gap",
      "underperformer",
      "consolidation_opportunity",
      "deprecation_signal",
    ]);
  });

  it("confidence tracks signal score", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "gap",
          capabilityId: undefined,
          score: 0.42,
          evidenceIds: [],
        },
      ]),
    });
    const [c] = await gen.generate();
    expect(c.confidence).toBe(0.42);
  });

  it("evidenceIds are propagated to candidate", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "gap",
          capabilityId: undefined,
          score: 0.9,
          evidenceIds: ["ev-1", "ev-2", "ev-3"],
        },
      ]),
    });
    const [c] = await gen.generate();
    expect(c.evidenceIds).toEqual(["ev-1", "ev-2", "ev-3"]);
  });

  it("riskClass is set per signal kind (low/medium/high stratified)", async () => {
    const signals: CapabilityEvolutionSignal[] = [
      {
        kind: "gap",
        capabilityId: undefined,
        score: 0.9,
        evidenceIds: [],
      },
      {
        kind: "underperformer",
        capabilityId: "tool.file.read",
        score: 0.6,
        evidenceIds: [],
      },
      {
        kind: "consolidation_opportunity",
        capabilityId: "tool.file.read",
        score: 0.8,
        evidenceIds: [],
      },
      {
        kind: "deprecation_signal",
        capabilityId: "tool.file.read",
        score: 0.7,
        evidenceIds: [],
      },
    ];
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource(signals),
    });
    const candidates = await gen.generate();
    // gap low risk (new), underperformer medium (in-place update),
    // consolidation + deprecation high (structural change).
    expect(candidates.map((c) => c.riskClass)).toEqual([
      "low",
      "medium",
      "high",
      "high",
    ]);
  });
});
