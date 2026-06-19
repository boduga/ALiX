import { describe, it, expect } from "vitest";
import { RECOMMENDATION_METRIC_MAP } from "../../src/adaptation/effectiveness-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";

describe("effectiveness types", () => {
  it("maps capability proposals unresolvedCapabilities (lower is better)", () => {
    expect(RECOMMENDATION_METRIC_MAP.capability_gap).toEqual({
      metric: "unresolvedCapabilities",
      direction: "lower_is_better",
    });
    expect(RECOMMENDATION_METRIC_MAP.agent_card_update?.metric).toBe(
      "unresolvedCapabilities",
    );
  });

  it("maps skill revisions workflowsAborted", () => {
    expect(RECOMMENDATION_METRIC_MAP.skill_revision).toEqual({
      metric: "workflowsAborted",
      direction: "lower_is_better",
    });
  });

  it("maps manual-action process_change null (investigate)", () => {
    expect(RECOMMENDATION_METRIC_MAP.process_change).toBeNull();
  });

  it("constructs valid report shape", () => {
    const r: ProposalEffectivenessReport = {
      proposalId: "prop-1",
      assessedAt: "2026-06-19T00:00:00.000Z",
      appliedAt: "2026-06-12T00:00:00.000Z",
      windowDays: 7,
      metricsBefore: {
        workflowsCompleted: 10,
        workflowsBlocked: 2,
        workflowsAborted: 3,
        capabilitiesRequested: 5,
        unresolvedCapabilities: 4,
        reviewApprovalRate: 0.7,
      },
      metricsAfter: {
        workflowsCompleted: 14,
        workflowsBlocked: 1,
        workflowsAborted: 1,
        capabilitiesRequested: 6,
        unresolvedCapabilities: 2,
        reviewApprovalRate: 0.85,
      },
      primary: {
        metric: "unresolvedCapabilities",
        direction: "lower_is_better",
        before: 4,
        after: 2,
        absoluteDelta: -2,
        relativeDelta: -0.5,
      },
      dataSufficient: true,
      recommendation: "keep",
      reason: "unresolvedCapabilities dropped 50% (4→2).",
    };
    expect(r.primary?.metric).toBe("unresolvedCapabilities");
    expect(r.recommendation).toBe("keep");
    expect(r.dataSufficient).toBe(true);
  });
});
