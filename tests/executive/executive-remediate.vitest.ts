/**
 * P10.9.2b-T1 — Unit tests for executive-remediate.ts
 *
 * Pure types, validation functions, registry, builder, and
 * ExecutiveBridgeRemediator provider. No I/O, no side effects.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  ExecutiveBridgeRemediator,
  RemediatorRegistry,
  validateRemediationParent,
  validateSpecification,
  validatePayload,
  mergeLineagePayload,
  buildRemediationChildDraft,
  RESERVED_PAYLOAD_KEYS,
  createDefaultRegistry,
  type ActionSpec,
  type RemediationSpec,
  type RemediationContext,
  type ChildProposalDraft,
  type RemediationProvider,
} from "../../src/executive/executive-remediate.js";
import type {
  AdaptationProposal,
  ProposalTarget,
} from "../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeParent(
  overrides: Partial<AdaptationProposal> = {},
): AdaptationProposal {
  return {
    id: "prop-parent-1",
    createdAt: "2026-06-30T00:00:00.000Z",
    status: "approved",
    action: "executive_remediation_request",
    target: {
      kind: "executive_remediation",
      planId: "plan-1",
      stepId: "step-1",
      objectiveId: "obj-1",
      subsystem: "workflow",
    } as ProposalTarget,
    payload: {
      source: "executive_bridge",
      requiresHumanSpecification: true,
      planId: "plan-1",
      stepId: "step-1",
      objectiveId: "obj-1",
      subsystem: "workflow",
      recommendationId: "rec-1",
      evaluationId: "eval-1",
      reflectionId: "refl-1",
    },
    sourceRecommendationType: "executive_remediation",
    sourceConfidence: 0.85,
    evidenceFingerprints: ["fp-parent-1", "fp-parent-2"],
    reason: "Parent proposal for testing purposes",
    ...overrides,
  };
}

function makeSpec(
  overrides: Partial<RemediationSpec> = {},
): RemediationSpec {
  return {
    actionName: "adjust_skill_definition",
    targetId: "skill-target-1",
    reason: "This is a valid reason for testing",
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<RemediationContext> = {},
): RemediationContext {
  return {
    actor: "test",
    mode: "noninteractive",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. validateRemediationParent
// ---------------------------------------------------------------------------

describe("validateRemediationParent", () => {
  it("returns NOT_FOUND when proposal is undefined", () => {
    const result = validateRemediationParent(undefined);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("NOT_FOUND");
      expect(result.issue.message).toContain("not found");
    }
  });

  it("returns NOT_APPROVED when status is not approved", () => {
    const parent = makeParent({ status: "pending" });
    const result = validateRemediationParent(parent);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("NOT_APPROVED");
      expect(result.issue.message).toContain("pending");
    }
  });

  it("returns NOT_EXECUTIVE when not an executive bridge proposal", () => {
    const parent = makeParent({
      sourceRecommendationType: "manual",
      payload: {},
    });
    const result = validateRemediationParent(parent);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("NOT_EXECUTIVE");
    }
  });

  it("returns WRONG_READINESS when readiness is not needs_specification", () => {
    // executive bridge proposal with target.kind === "skill" → ready_to_apply
    const parent = makeParent({
      target: { kind: "skill", id: "some-skill" } as ProposalTarget,
    });
    const result = validateRemediationParent(parent);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("WRONG_READINESS");
    }
  });

  it("returns valid for a valid parent", () => {
    const parent = makeParent();
    const result = validateRemediationParent(parent);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. validateSpecification
// ---------------------------------------------------------------------------

describe("validateSpecification", () => {
  const provider = new ExecutiveBridgeRemediator();

  it("rejects unsupported action", () => {
    const spec = makeSpec({ actionName: "invalid_action" });
    const result = validateSpecification(spec, provider);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("UNSUPPORTED_ACTION");
      expect(result.issue.message).toContain("not supported");
    }
  });

  it("rejects empty targetId", () => {
    const spec = makeSpec({ targetId: "" });
    const result = validateSpecification(spec, provider);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("MISSING_TARGET");
      expect(result.issue.message).toContain("targetId");
    }
  });

  it("rejects short reason (< 10 chars)", () => {
    const spec = makeSpec({ reason: "Short" });
    const result = validateSpecification(spec, provider);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("SHORT_REASON");
      expect(result.issue.message).toContain("reason");
    }
  });

  it("accepts a valid specification", () => {
    const spec = makeSpec();
    const result = validateSpecification(spec, provider);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. validatePayload
// ---------------------------------------------------------------------------

describe("validatePayload", () => {
  it("rejects reserved lineage key", () => {
    const result = validatePayload({ parentProposalId: "evil" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issue.code).toBe("RESERVED_KEY");
      expect(result.issue.field).toBe("parentProposalId");
      expect(result.issue.message).toContain("parentProposalId");
    }
  });

  it("accepts empty payload", () => {
    const result = validatePayload({});
    expect(result.valid).toBe(true);
  });

  it("accepts unknown keys", () => {
    const result = validatePayload({ extraField: "some-value", count: 42 });
    expect(result.valid).toBe(true);
  });

  it("rejects all reserved keys", () => {
    for (const key of RESERVED_PAYLOAD_KEYS) {
      const result = validatePayload({ [key]: "test" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.issue.code).toBe("RESERVED_KEY");
        expect(result.issue.field).toBe(key);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. mergeLineagePayload
// ---------------------------------------------------------------------------

describe("mergeLineagePayload", () => {
  it("merges additional payload only", () => {
    const result = mergeLineagePayload({ extra: "value" }, {});
    expect(result).toEqual({ extra: "value" });
  });

  it("merges lineage payload only", () => {
    const result = mergeLineagePayload(
      undefined,
      { parentProposalId: "real", source: "test" },
    );
    expect(result.parentProposalId).toBe("real");
    expect(result.source).toBe("test");
  });

  it("lineage wins over additional on conflict", () => {
    const result = mergeLineagePayload(
      { parentProposalId: "evil", extra: "ok" },
      { parentProposalId: "real", source: "test" },
    );
    expect(result.parentProposalId).toBe("real");
    expect(result.extra).toBe("ok");
  });

  it("handles empty additional payload", () => {
    const result = mergeLineagePayload({}, { parentProposalId: "real" });
    expect(result.parentProposalId).toBe("real");
  });
});

// ---------------------------------------------------------------------------
// 5. buildRemediationChildDraft
// ---------------------------------------------------------------------------

describe("buildRemediationChildDraft", () => {
  it("builds a governance_change draft", () => {
    const parent = makeParent();
    const spec = makeSpec({ actionName: "governance_change" });
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);
    expect(draft.action).toBe("governance_change");
    expect(draft.target.kind).toBe("governance");
    expect((draft.target as Record<string, unknown>).id).toBe("skill-target-1");
  });

  it("builds an update_agent_card draft", () => {
    const parent = makeParent();
    const spec = makeSpec({ actionName: "update_agent_card" });
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);
    expect(draft.action).toBe("update_agent_card");
    expect(draft.target.kind).toBe("agent_card");
  });

  it("builds an update_skill draft", () => {
    const parent = makeParent();
    const spec = makeSpec({ actionName: "adjust_skill_definition" });
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);
    expect(draft.action).toBe("adjust_skill_definition");
    expect(draft.target.kind).toBe("skill");
  });

  it("builds a create_issue draft with correct target shape", () => {
    const parent = makeParent();
    const spec = makeSpec({ actionName: "create_improvement_issue", targetId: "Fix workflow remediation gap" });
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);
    expect(draft.action).toBe("create_improvement_issue");
    expect(draft.target.kind).toBe("issue");
    // Issue targets use `title`, not `id` — regression guard for describeTarget display
    expect((draft.target as Record<string, unknown>).title).toBe("Fix workflow remediation gap");
    expect((draft.target as Record<string, unknown>).id).toBeUndefined();
  });

  it("includes lineage fields in payload", () => {
    const parent = makeParent();
    const spec = makeSpec();
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);

    expect(draft.payload.parentProposalId).toBe(parent.id);
    expect(draft.payload.parentAction).toBe(parent.action);
    expect(draft.payload.source).toBe("executive_remediate");
    expect(draft.payload.derivedFrom).toBe("executive_remediation");
    expect(draft.payload.remediationType).toBe(spec.actionName);
    expect(draft.payload.remediationReason).toBe(spec.reason);
    expect(draft.payload.lineageType).toBe("remediation");
    expect(draft.payload.lineageDepth).toBe(1);
    expect(draft.payload.lineageSchemaVersion).toBe(1);
  });

  it("includes inherited plan context from parent payload", () => {
    const parent = makeParent();
    const spec = makeSpec();
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);

    expect(draft.payload.planId).toBe("plan-1");
    expect(draft.payload.stepId).toBe("step-1");
    expect(draft.payload.objectiveId).toBe("obj-1");
    expect(draft.payload.subsystem).toBe("workflow");
    expect(draft.payload.recommendationId).toBe("rec-1");
  });

  it("includes reserved orchestrationState field as undefined", () => {
    const parent = makeParent();
    const spec = makeSpec();
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);

    expect(draft.payload).toHaveProperty("orchestrationState");
    expect(draft.payload.orchestrationState).toBeUndefined();
  });

  it("inherits sourceRecommendationType and sourceConfidence from parent", () => {
    const parent = makeParent();
    const spec = makeSpec();
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);

    expect(draft.sourceRecommendationType).toBe(parent.sourceRecommendationType);
    expect(draft.sourceConfidence).toBe(parent.sourceConfidence);
  });

  it("uses spec reason as draft reason", () => {
    const parent = makeParent();
    const spec = makeSpec({ reason: "Custom reason for this child" });
    const ctx = makeContext();
    const draft = buildRemediationChildDraft(parent, spec, ctx);

    expect(draft.reason).toBe("Custom reason for this child");
  });

  it("is idempotent — same inputs produce identical outputs", () => {
    const parent = makeParent();
    const spec = makeSpec({ actionName: "adjust_skill_definition" });
    const ctx = makeContext();
    const a = buildRemediationChildDraft(parent, spec, ctx);
    const b = buildRemediationChildDraft(parent, spec, ctx);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 6. RemediatorRegistry
// ---------------------------------------------------------------------------

describe("RemediatorRegistry", () => {
  it("register + find returns the registered provider", () => {
    const registry = new RemediatorRegistry();
    const provider = new ExecutiveBridgeRemediator();
    registry.register(provider);
    const parent = makeParent();
    const found = registry.find(parent);
    expect(found).toBe(provider);
  });

  it("find throws on zero matches", () => {
    const registry = new RemediatorRegistry();
    // register a provider that won't match
    const nonMatchingProvider = {
      id: "non-matching",
      description: "Never matches",
      supportedSources: [],
      priority: 999,
      version: "1.0.0",
      supportedActions: () => [] as readonly ActionSpec[],
      supports: () => false,
      buildDraft: () =>
        ({}) as unknown as ChildProposalDraft,
    };
    registry.register(nonMatchingProvider);

    const parent = makeParent({ sourceRecommendationType: "manual" });
    expect(() => registry.find(parent)).toThrow("No remediator");
  });

  it("find throws on multiple matches", () => {
    const registry = new RemediatorRegistry();
    registry.register(new ExecutiveBridgeRemediator());
    registry.register(new ExecutiveBridgeRemediator()); // duplicate
    expect(() => registry.find(makeParent())).toThrow("Multiple remediators");
  });

  it("list returns a copy of all registered providers", () => {
    const registry = new RemediatorRegistry();
    const provider = new ExecutiveBridgeRemediator();
    registry.register(provider);
    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toBe(provider);
    // Verify it's a copy (mutable cast for assertion)
    const mutable = listed as RemediationProvider[];
    mutable.pop();
    expect(registry.list()).toHaveLength(1);
  });

  it("unregister removes a provider by id", () => {
    const registry = new RemediatorRegistry();
    registry.register(new ExecutiveBridgeRemediator());
    expect(registry.list()).toHaveLength(1);
    registry.unregister("executive-bridge");
    expect(registry.list()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. ExecutiveBridgeRemediator
// ---------------------------------------------------------------------------

describe("ExecutiveBridgeRemediator", () => {
  it("supportedActions returns 4 action mappings", () => {
    const remediator = new ExecutiveBridgeRemediator();
    const actions = remediator.supportedActions();
    expect(actions).toHaveLength(4);
    expect(actions).toEqual([
      { action: "governance_change", targetKind: "governance" },
      { action: "update_agent_card", targetKind: "agent_card" },
      { action: "adjust_skill_definition", targetKind: "skill" },
      { action: "create_improvement_issue", targetKind: "issue" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 8. createDefaultRegistry
// ---------------------------------------------------------------------------

describe("createDefaultRegistry", () => {
  it("returns a registry with ExecutiveBridgeRemediator registered", () => {
    const registry = createDefaultRegistry();
    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toBeInstanceOf(ExecutiveBridgeRemediator);
  });
});
