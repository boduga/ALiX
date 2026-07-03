// tests/contracts/proposal-schemas.test.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ProposalStatusSchema,
  ProposalActionSchema,
  ProposalTargetSchema,
  AdaptationProposalSchema,
  ExecutiveSubsystemNameSchema,
} from "../../src/contracts/proposal-schemas.js";

describe("ProposalStatusSchema", () => {
  it("accepts valid statuses", () => {
    assert.doesNotThrow(() => Schema.decodeSync(ProposalStatusSchema)("pending" as any));
    assert.doesNotThrow(() => Schema.decodeSync(ProposalStatusSchema)("approved" as any));
    assert.doesNotThrow(() => Schema.decodeSync(ProposalStatusSchema)("rejected" as any));
    assert.doesNotThrow(() => Schema.decodeSync(ProposalStatusSchema)("applied" as any));
    assert.doesNotThrow(() => Schema.decodeSync(ProposalStatusSchema)("failed" as any));
  });
  it("rejects invalid statuses", () => {
    assert.throws(() => Schema.decodeSync(ProposalStatusSchema)("implemented" as any));
    assert.throws(() => Schema.decodeSync(ProposalStatusSchema)("cancelled" as any));
  });
});

describe("ProposalActionSchema", () => {
  it("accepts governance_change", () => {
    assert.doesNotThrow(() =>
      Schema.decodeSync(ProposalActionSchema)("governance_change" as any)
    );
  });
  it("rejects unknown actions", () => {
    assert.throws(() =>
      Schema.decodeSync(ProposalActionSchema)("unknown_action" as any)
    );
  });
});

describe("ExecutiveSubsystemNameSchema", () => {
  it("accepts memory", () => {
    assert.doesNotThrow(() =>
      Schema.decodeSync(ExecutiveSubsystemNameSchema)("memory" as any)
    );
  });
  it("rejects unknown", () => {
    assert.throws(() =>
      Schema.decodeSync(ExecutiveSubsystemNameSchema)("unknown" as any)
    );
  });
});

describe("ProposalTargetSchema", () => {
  it("decodes an agent_card target", () => {
    const t = Schema.decodeSync(ProposalTargetSchema)({
      kind: "agent_card", id: "card-1",
    } as any);
    assert.strictEqual(t.kind, "agent_card");
  });
  it("decodes a governance target", () => {
    const t = Schema.decodeSync(ProposalTargetSchema)({
      kind: "governance", recommendationId: "rec-1",
    } as any);
    assert.strictEqual(t.kind, "governance");
  });
  it("decodes an executive_remediation target", () => {
    const t = Schema.decodeSync(ProposalTargetSchema)({
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "step-1",
      objectiveId: "obj-1",
      subsystem: "memory",
    } as any);
    assert.strictEqual(t.kind, "executive_remediation");
  });
  it("rejects unknown target kind", () => {
    assert.throws(() =>
      Schema.decodeSync(ProposalTargetSchema)({ kind: "unknown", id: "x" } as any)
    );
  });
  it("rejects executive_remediation with invalid subsystem", () => {
    assert.throws(() =>
      Schema.decodeSync(ProposalTargetSchema)({
        kind: "executive_remediation",
        planId: "p",
        stepId: "s",
        objectiveId: "o",
        subsystem: "unknown",
      } as any)
    );
  });
});

describe("AdaptationProposalSchema", () => {
  it("decodes a minimal valid proposal", () => {
    const p = Schema.decodeSync(AdaptationProposalSchema)({
      id: "prop-1",
      createdAt: "2026-07-03T00:00:00.000Z",
      status: "pending",
      action: "governance_change",
      target: { kind: "governance", recommendationId: "rec-1" },
      payload: { key: "value" },
      sourceRecommendationType: "health_dashboard",
      sourceConfidence: 0.85,
      evidenceFingerprints: ["fp-1", "fp-2"],
      reason: "System health degraded",
    } as any);
    assert.strictEqual(p.id, "prop-1");
    assert.strictEqual(p.status, "pending");
    assert.strictEqual(p.action, "governance_change");
  });

  it("decodes a proposal with optional fields", () => {
    const p = Schema.decodeSync(AdaptationProposalSchema)({
      id: "prop-2",
      createdAt: "2026-07-03T00:00:00.000Z",
      status: "approved",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "Fix memory leak" },
      payload: { labels: ["bug"] },
      sourceRecommendationType: "trend_analysis",
      sourceConfidence: 0.7,
      evidenceFingerprints: [],
      reason: "Memory usage growing",
      approvedBy: "bot",
      approvedAt: "2026-07-03T01:00:00.000Z",
      provenance: "auto",
    } as any);
    assert.strictEqual(p.approvedBy, "bot");
    assert.strictEqual(p.provenance, "auto");
  });

  it("rejects missing required fields", () => {
    assert.throws(() =>
      Schema.decodeSync(AdaptationProposalSchema)({ id: "prop-3" } as any)
    );
  });
});
