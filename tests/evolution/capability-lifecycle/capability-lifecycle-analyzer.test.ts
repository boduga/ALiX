// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeCapabilityLifecycle } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-analyzer.js";
import type { CapabilitySignalInputs } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function emptyInputs(): CapabilitySignalInputs {
  return { health: [], gaps: [], overlap: [], drift: [], adoption: {}, outcome: [], patterns: [] };
}

describe("analyzeCapabilityLifecycle", () => {
  it("emits a register candidate for each gap with a suggestedCapability", () => {
    const inputs = emptyInputs();
    inputs.gaps = [
      { suggestedCapability: "core.search", evidence: ["gap a"], signalStrength: 2, confidence: "high" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "register");
    assert.equal(candidates[0].target.capabilityId, "core.search");
    assert.equal(candidates[0].proposedLifecycleState, "emerging");
    assert.equal(candidates[0].confidence, 2 / 3);
  });

  it("promotes an active capability adoption, proposing next tier", () => {
    const inputs = emptyInputs();
    inputs.health = [
      { capability: "core.session.list", lifecycleState: "active", agentCount: 1, resolutionCount: 10, resolutionCountRecent: 5, resolutionCountPrior: 3, proposalCountRecent: 1, proposalCountPrior: 0, demandScore: 0.5, keepRate: null, revertRate: null, proposalCount: 1, rationale: "well used" },
    ];
    inputs.adoption = { "core.session.list": { invocationCount: 7, successRate: 0.9 } };
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "promote");
    assert.equal(candidates[0].proposedLifecycleState, "mature");
    assert.equal(candidates[0].observedLifecycleState, "active");
  });

  it("does not promote without adoption telemetry", () => {
    const inputs = emptyInputs();
    inputs.health = [
      { capability: "core.session.list", lifecycleState: "active", agentCount: 1, resolutionCount: 10, resolutionCountRecent: 5, resolutionCountPrior: 3, proposalCountRecent: 1, proposalCountPrior: 0, demandScore: 0.5, keepRate: null, revertRate: null, proposalCount: 1, rationale: "well used" },
    ];
    assert.deepEqual(analyzeCapabilityLifecycle(inputs), []);
  });

  it("deprecates declining stagnant capability", () => {
    const inputs = emptyInputs();
    inputs.health = [
      { capability: "core.old", lifecycleState: "stagnant", agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0, resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 2, demandScore: 0.1, keepRate: 0.2, revertRate: 0.4, proposalCount: 2, rationale: "no recent use" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "deprecate");
    assert.equal(candidates[0].proposedLifecycleState, "deprecated");
  });

  it("consolidates an overlap consolidationCandidate with multi-target identity", () => {
    const inputs = emptyInputs();
    inputs.overlap = [
      { capabilityA: "core.a", capabilityB: "core.b", overlapScore: 0.85, coverageAtoB: 0.8, coverageBtoA: 0.9, asymmetry: 0.1, sharedSignalCount: 3, consolidationCandidate: true },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "consolidate");
    assert.equal(candidates[0].target.capabilityId, "core.a");
    assert.deepEqual(candidates[0].target.relatedCapabilityIds, ["core.b"]);
    assert.equal(candidates[0].confidence, 0.85);
  });

  it("proposes a modify for a drift splitCandidate", () => {
    const inputs = emptyInputs();
    inputs.drift = [
      { capability: "core.mixed", originalScope: "x", currentScope: "y", driftMagnitude: 0.7, splitCandidate: true },
    ];
    inputs.health = [
      { capability: "core.mixed", lifecycleState: "active", agentCount: 1, resolutionCount: 5, resolutionCountRecent: 2, resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 1, demandScore: 0.4, keepRate: null, revertRate: null, proposalCount: 1, rationale: "scope grew" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "modify");
    assert.equal(candidates[0].proposedLifecycleState, "active");
    assert.equal(candidates[0].confidence, 0.7);
  });

  it("returns candidates in deterministic (capabilityId, intent) order", () => {
    const inputs = emptyInputs();
    inputs.gaps = [
      { suggestedCapability: "core.b", evidence: ["1"], signalStrength: 1, confidence: "low" },
      { suggestedCapability: "core.a", evidence: ["2"], signalStrength: 1, confidence: "low" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.deepEqual(candidates.map((c) => c.target.capabilityId), ["core.a", "core.b"]);
  });

  it("returns no candidates empty signals (zero-candidate invariant)", () => {
    assert.deepEqual(analyzeCapabilityLifecycle(emptyInputs()), []);
  });

  it("does not mutate its inputs (purity)", () => {
    const inputs = emptyInputs();
    inputs.gaps = [{ suggestedCapability: "core.a", evidence: ["e"], signalStrength: 1, confidence: "low" }];
    const snapshot = JSON.stringify(inputs);
    analyzeCapabilityLifecycle(inputs);
    assert.equal(JSON.stringify(inputs), snapshot);
  });

  it("does not attach A6 pattern evidence to candidates", () => {
    const inputs = emptyInputs();
    inputs.gaps = [
      { suggestedCapability: "core.search", evidence: ["gap a"], signalStrength: 2, confidence: "high" },
    ];
    inputs.patterns = [
      { patternId: "pat-1", category: "governance_gap", frequency: 3, confidence: 0.9, evidenceIds: ["ev-x"], description: "pattern", firstObserved: "2026-08-01T00:00:00.000Z", lastObserved: "2026-08-10T00:00:00.000Z" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0].evidenceRefs, []);
  });

  it("unrelated patterns never affect candidate contents or ordering", () => {
    const gapInput = emptyInputs();
    gapInput.gaps = [
      { suggestedCapability: "core.b", evidence: ["1"], signalStrength: 1, confidence: "low" },
      { suggestedCapability: "core.a", evidence: ["2"], signalStrength: 1, confidence: "low" },
    ];
    const pattern = {
      patternId: "pat-1",
      category: "governance_gap" as const,
      frequency: 3,
      confidence: 0.9,
      evidenceIds: ["ev-x"],
      description: "pattern",
      firstObserved: "2026-08-01T00:00:00.000Z",
      lastObserved: "2026-08-10T00:00:00.000Z",
    };
    const withPatterns = analyzeCapabilityLifecycle({ ...gapInput, patterns: [pattern] });
    const withoutPatterns = analyzeCapabilityLifecycle({ ...gapInput, patterns: [] });
    assert.deepEqual(withPatterns, withoutPatterns);
  });
});
