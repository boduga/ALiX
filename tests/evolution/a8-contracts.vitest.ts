import { describe, it, expect } from "vitest";
import {
  DEFAULT_MIN_CARDINALITY,
  DEFAULT_EVIDENCE_WINDOW_DAYS,
  DEFAULT_LEARNING_ENGINE_OPTIONS,
  type LearningProposal,
} from "../../src/evolution/learning/contracts/learning-contract.js";

describe("A8 contract smoke", () => {
  it("default options are populated", () => {
    expect(DEFAULT_MIN_CARDINALITY).toBeGreaterThan(0);
    expect(DEFAULT_EVIDENCE_WINDOW_DAYS).toBeGreaterThan(0);
    expect(DEFAULT_LEARNING_ENGINE_OPTIONS.minCardinality).toBe(DEFAULT_MIN_CARDINALITY);
    expect(DEFAULT_LEARNING_ENGINE_OPTIONS.evidenceWindowDays).toBe(DEFAULT_EVIDENCE_WINDOW_DAYS);
  });

  it("LearningProposal has no mutation fields", () => {
    // Sentinel: architectural non-executability.
    const proposal: LearningProposal = {
      proposalId: "p1",
      generatedAt: "2026-08-14T00:00:00Z",
      findings: [],
    };
    expect(Object.keys(proposal)).toEqual(["proposalId", "generatedAt", "findings"]);
  });
});