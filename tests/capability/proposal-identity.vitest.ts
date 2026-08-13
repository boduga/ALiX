import { describe, it, expect } from "vitest";
import { computeProposalId, isValidProposalId } from "../../src/capability/governance/proposal-identity.js";
import type { CapabilityEvolutionCandidate } from "../../src/adaptation/capability-evolution-types.js";

function mkCandidate(): CapabilityEvolutionCandidate {
  return {
    candidateId: "c-1",
    sourcePatternId: "p-gap-1",
    confidence: 0.85,
    target: { kind: "capability", id: "tool.file.read" },
    description: "Add capability to read files",
    expectedEffect: "Improved file workflow",
    riskClass: "low",
    evidenceIds: ["e-1", "e-2"],
  };
}

describe("computeProposalId (CAP-9 ruling #18)", () => {
  it("returns 64-character lowercase hex", () => {
    const id = computeProposalId(mkCandidate());
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same body → same id", () => {
    const a = computeProposalId(mkCandidate());
    const b = computeProposalId(mkCandidate());
    expect(a).toBe(b);
  });

  it("normalizes key order — reordered keys produce same id", () => {
    const reordered: CapabilityEvolutionCandidate = {
      evidenceIds: ["e-1", "e-2"],
      riskClass: "low",
      expectedEffect: "Improved file workflow",
      description: "Add capability to read files",
      target: { kind: "capability", id: "tool.file.read" },
      confidence: 0.85,
      sourcePatternId: "p-gap-1",
      candidateId: "c-1",
    };
    expect(computeProposalId(reordered)).toBe(computeProposalId(mkCandidate()));
  });

  it("different body → different id", () => {
    const c1 = mkCandidate();
    const c2: CapabilityEvolutionCandidate = { ...c1, candidateId: "c-2" };
    expect(computeProposalId(c1)).not.toBe(computeProposalId(c2));
  });
});

describe("isValidProposalId", () => {
  it("accepts 64 lowercase hex chars", () => {
    const id = computeProposalId(mkCandidate());
    expect(isValidProposalId(id)).toBe(true);
  });

  it("rejects uppercase hex", () => {
    expect(isValidProposalId("A".repeat(64))).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidProposalId("abc")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isValidProposalId(123)).toBe(false);
    expect(isValidProposalId(null)).toBe(false);
  });
});
