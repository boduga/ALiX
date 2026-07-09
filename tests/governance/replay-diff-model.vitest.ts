/**
 * P23.3 — Replay Diff Model tests.
 *
 * Tests that computeReplayDiff:
 * - detects all 8 diff categories
 * - sorts details deterministically
 * - never mutates input objects
 * - produces read-only output
 */

import { describe, it, expect } from "vitest";

import { computeReplayDiff } from "../../src/governance/replay/replay-diff-model.js";
import type {
  ReplayOriginalOutcome,
  ReplayCounterfactualOutcome,
} from "../../src/governance/replay/types.js";

// ---------------------------------------------------------------------------
// Outcome builders
// ---------------------------------------------------------------------------

function original(overrides: Partial<ReplayOriginalOutcome> = {}): ReplayOriginalOutcome {
  return {
    readinessLevel: "dry_run_capable",
    evidenceCompleteness: "full",
    handoffReadiness: "ready",
    closureDecision: "accepted",
    closureRiskLevel: "low",
    qualitySignalCount: 0,
    requiresAttention: false,
    ...overrides,
  };
}

function counterfactual(overrides: Partial<ReplayCounterfactualOutcome> = {}): ReplayCounterfactualOutcome {
  return {
    readinessLevel: "dry_run_capable",
    evidenceCompleteness: "full",
    handoffReadiness: "ready",
    closureDecision: "accepted",
    closureRiskLevel: "low",
    qualitySignalCount: 0,
    requiresAttention: false,
    blocked: false,
    blockedReasons: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("replay-diff-model", () => {
  it("returns unchanged when outcomes are identical", () => {
    const o = original();
    const cf = counterfactual();

    const diff = computeReplayDiff(o, cf);

    expect(diff.category).toBe("unchanged");
    expect(diff.details).toHaveLength(0);
  });

  it("detects readiness_changed", () => {
    const diff = computeReplayDiff(
      original({ readinessLevel: "dry_run_capable" }),
      counterfactual({ readinessLevel: "manual_only" }),
    );

    expect(diff.category).toBe("readiness_changed");
    expect(diff.details.length).toBeGreaterThanOrEqual(1);
    expect(diff.details[0].category).toBe("readiness_changed");
  });

  it("detects evidence_gap_changed", () => {
    const diff = computeReplayDiff(
      original({ evidenceCompleteness: "full" }),
      counterfactual({ evidenceCompleteness: "none" }),
    );

    expect(diff.details.some((d) => d.category === "evidence_gap_changed")).toBe(true);
  });

  it("detects handoff_quality_changed", () => {
    const diff = computeReplayDiff(
      original({ handoffReadiness: "ready" }),
      counterfactual({ handoffReadiness: "not_ready" }),
    );

    expect(diff.details.some((d) => d.category === "handoff_quality_changed")).toBe(true);
  });

  it("detects closure_risk_changed", () => {
    const diff = computeReplayDiff(
      original({ closureRiskLevel: "low" }),
      counterfactual({ closureRiskLevel: "high" }),
    );

    expect(diff.details.some((d) => d.category === "closure_risk_changed")).toBe(true);
  });

  it("detects review_path_changed", () => {
    const diff = computeReplayDiff(
      original({ closureDecision: "accepted" }),
      counterfactual({ closureDecision: "incomplete" }),
    );

    expect(diff.details.some((d) => d.category === "review_path_changed")).toBe(true);
  });

  it("detects blocked_in_counterfactual", () => {
    const diff = computeReplayDiff(
      original({ requiresAttention: false }),
      counterfactual({ blocked: true, blockedReasons: ["Gate active"], requiresAttention: true }),
    );

    expect(diff.details.some((d) => d.category === "blocked_in_counterfactual")).toBe(true);
  });

  it("does not report blocked_in_counterfactual when original already required attention", () => {
    const diff = computeReplayDiff(
      original({ requiresAttention: true }),
      counterfactual({ blocked: true, blockedReasons: ["Gate active"], requiresAttention: true }),
    );

    // Both are equally stuck — blocked_in_counterfactual would be a false positive
    expect(diff.details.some((d) => d.category === "blocked_in_counterfactual")).toBe(false);
  });

  it("does not report advanced_in_counterfactual when counterfactual still requires attention", () => {
    const diff = computeReplayDiff(
      original({ requiresAttention: true }),
      counterfactual({ blocked: false, requiresAttention: true }),
    );

    // Counterfactual still requires attention — no advancement
    expect(diff.details.some((d) => d.category === "advanced_in_counterfactual")).toBe(false);
  });

  it("detects advanced_in_counterfactual when readiness improves", () => {
    const diff = computeReplayDiff(
      original({ readinessLevel: "manual_only" }),
      counterfactual({ readinessLevel: "dry_run_capable" }),
    );

    expect(diff.details.some((d) => d.category === "advanced_in_counterfactual")).toBe(true);
  });

  it("detects advanced_in_counterfactual when risk decreases", () => {
    const diff = computeReplayDiff(
      original({ closureRiskLevel: "high" }),
      counterfactual({ closureRiskLevel: "low" }),
    );

    expect(diff.details.some((d) => d.category === "advanced_in_counterfactual")).toBe(true);
  });

  it("detects advanced_in_counterfactual when handoff readiness improves", () => {
    const diff = computeReplayDiff(
      original({ handoffReadiness: "not_ready" }),
      counterfactual({ handoffReadiness: "ready" }),
    );

    expect(diff.details.some((d) => d.category === "advanced_in_counterfactual")).toBe(true);
  });

  it("detects advanced_in_counterfactual when evidence completeness improves", () => {
    const diff = computeReplayDiff(
      original({ evidenceCompleteness: "none" }),
      counterfactual({ evidenceCompleteness: "full" }),
    );

    expect(diff.details.some((d) => d.category === "advanced_in_counterfactual")).toBe(true);
  });

  it("detects advanced_in_counterfactual when attention was required but no longer blocked", () => {
    const diff = computeReplayDiff(
      original({ requiresAttention: true }),
      counterfactual({ blocked: false, requiresAttention: false }),
    );

    expect(diff.details.some((d) => d.category === "advanced_in_counterfactual")).toBe(true);
  });

  it("sorts details deterministically by category then sourceId", () => {
    // Create outcomes that trigger multiple categories in non-deterministic order
    const o = original({
      readinessLevel: "manual_only",
      evidenceCompleteness: "none",
      handoffReadiness: "not_ready",
      closureRiskLevel: "high",
      closureDecision: "incomplete",
    });
    const cf = counterfactual({
      readinessLevel: "dry_run_capable",  // readiness_changed + advanced_in_counterfactual
      evidenceCompleteness: "full",        // evidence_gap_changed + advanced_in_counterfactual
      handoffReadiness: "ready",           // handoff_quality_changed + advanced_in_counterfactual
      closureRiskLevel: "low",             // closure_risk_changed
      closureDecision: "accepted",         // review_path_changed
    });

    const diff = computeReplayDiff(o, cf);

    // Verify sorted: categories should be in alphabetical order
    for (let i = 1; i < diff.details.length; i++) {
      const prev = diff.details[i - 1].category;
      const curr = diff.details[i].category;
      expect(prev <= curr).toBe(true);
    }
  });

  it("does not mutate input objects", () => {
    const o = original();
    const cf = counterfactual();
    const originalReadiness = o.readinessLevel;
    const cfReadiness = cf.readinessLevel;

    computeReplayDiff(o, cf);

    expect(o.readinessLevel).toBe(originalReadiness);
    expect(cf.readinessLevel).toBe(cfReadiness);
  });

  it("returns frozen details array", () => {
    const diff = computeReplayDiff(
      original({ readinessLevel: "dry_run_capable" }),
      counterfactual({ readinessLevel: "manual_only" }),
    );

    expect(Object.isFrozen(diff.details)).toBe(true);
  });

  it("returns unchanged for empty identities with null fields", () => {
    const o = original({
      readinessLevel: null,
      closureDecision: null,
      closureRiskLevel: null,
    });
    const cf = counterfactual({
      readinessLevel: null,
      closureDecision: null,
      closureRiskLevel: null,
    });

    const diff = computeReplayDiff(o, cf);

    expect(diff.category).toBe("unchanged");
  });
});
