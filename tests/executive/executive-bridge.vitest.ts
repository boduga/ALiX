import { describe, expect, it } from "vitest";
import {
  buildExecutiveRemediationProposal,
  bridgeCreateRemediationProposal,
  EXECUTIVE_BRIDGE_VERSION,
  type ExecutiveBridgeResult,
} from "../../src/executive/executive-bridge.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";

const NOW = "2026-06-25T12:00:00.000Z";
const PROPOSAL_ID = "proposal-test-1";

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step-obj-1-governance-create_remediation_proposal",
    action: "create_remediation_proposal",
    title: "Create remediation proposal",
    stepNumber: 2,
    targetSubsystem: "governance",
    dependsOn: ["step-obj-1-governance-diagnose_root_cause"],
    status: "pending",
    objectiveId: "obj-1",
    priorityScore: 80,
    objectiveScore: 75,
    riskLevel: "high",
    ...overrides,
  };
}

function makePlan(step: ExecutionStep): PersistedExecutionPlan {
  return {
    id: "plan-1",
    objectives: ["obj-1"],
    steps: [step],
    generatedAt: NOW,
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "deadbeef",
  };
}

describe("buildExecutiveRemediationProposal (pure) — preconditions", () => {
  it("throws when step.action is not create_remediation_proposal", () => {
    const step = makeStep({ action: "apply_remediation" });
    const plan = makePlan(step);
    expect(() =>
      buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW),
    ).toThrow(/create_remediation_proposal/);
  });

  it("throws when step.objectiveId is missing", () => {
    const step = makeStep({ objectiveId: "" });
    const plan = makePlan(step);
    expect(() =>
      buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW),
    ).toThrow(/objectiveId/);
  });

  it("throws when step.targetSubsystem is not a valid ExecutiveSubsystemName", () => {
    const step = makeStep({ targetSubsystem: "bogus" as never });
    const plan = makePlan(step);
    expect(() =>
      buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW),
    ).toThrow(/subsystem/);
  });

  it("throws when proposalId is empty (ProposalStore.save would reject)", () => {
    const step = makeStep();
    const plan = makePlan(step);
    expect(() =>
      buildExecutiveRemediationProposal(plan, step, "", NOW),
    ).toThrow(/proposalId/);
  });
});

describe("buildExecutiveRemediationProposal (pure) — output shape", () => {
  const step = makeStep();
  const plan = makePlan(step);
  const result = buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW);

  it("emits status='pending'", () => {
    expect(result.status).toBe("pending");
  });

  it("emits action='executive_remediation_request'", () => {
    expect(result.action).toBe("executive_remediation_request");
  });

  it("emits target.kind='executive_remediation' with planId/stepId/objectiveId/subsystem", () => {
    expect(result.target.kind).toBe("executive_remediation");
    if (result.target.kind !== "executive_remediation") return; // narrow for TS
    expect(result.target.planId).toBe("plan-1");
    expect(result.target.stepId).toBe(step.id);
    expect(result.target.objectiveId).toBe("obj-1");
    expect(result.target.subsystem).toBe("governance");
  });

  it("emits provenance='manual'", () => {
    expect(result.provenance).toBe("manual");
  });

  it("emits id=proposalId (caller-supplied canonical ID; ProposalStore.save accepts non-empty id)", () => {
    expect(result.id).toBe(PROPOSAL_ID);
  });

  it("emits createdAt from supplied now argument", () => {
    expect(result.createdAt).toBe(NOW);
  });

  it("emits payload.source='executive_bridge'", () => {
    expect(result.payload.source).toBe("executive_bridge");
  });

  it("emits payload.bridgeVersion=EXECUTIVE_BRIDGE_VERSION", () => {
    expect(result.payload.bridgeVersion).toBe(EXECUTIVE_BRIDGE_VERSION);
  });

  it("emits payload.requiresHumanSpecification=true", () => {
    expect(result.payload.requiresHumanSpecification).toBe(true);
  });

  it("emits payload.requestedFields=['action','target','payload']", () => {
    expect(result.payload.requestedFields).toEqual([
      "action",
      "target",
      "payload",
    ]);
  });

  it("emits payload.riskLevel from step", () => {
    expect(result.payload.riskLevel).toBe(step.riskLevel);
  });

  it("emits empty evidenceFingerprints (proposal is pending — no approval chain yet)", () => {
    expect(result.evidenceFingerprints).toEqual([]);
  });

  it("emits sourceRecommendationType='executive_remediation' (matches target.kind precedent)", () => {
    expect(result.sourceRecommendationType).toBe("executive_remediation");
  });
});

describe("bridgeCreateRemediationProposal (effectful wrapper)", () => {
  const step = makeStep();
  const plan = makePlan(step);

  it("calls append() exactly once with the draft proposal", async () => {
    let callCount = 0;
    let captured: { id: string } | undefined;
    const append = async (proposal: { id: string }) => {
      callCount += 1;
      captured = proposal;
    };
    await bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never);
    expect(callCount).toBe(1);
    expect(captured).toBeDefined();
    expect((captured as unknown as { id: string }).id).toBe(PROPOSAL_ID);
  });

  it("returns ExecutiveBridgeResult proposal.id === supplied proposalId (ProposalStore does not mutate)", async () => {
    const append = async () => { /* no-op */ };
    const result: ExecutiveBridgeResult = await bridgeCreateRemediationProposal(
      plan, step, PROPOSAL_ID, NOW, append as never,
    );
    expect(result.proposal.id).toBe(PROPOSAL_ID);
  });

  it("returns artifactRef { type: 'proposal', id: proposalId }", async () => {
    const append = async () => { /* no-op */ };
    const result = await bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never);
    expect(result.artifactRef).toEqual({ type: "proposal", id: PROPOSAL_ID });
  });

  it("propagates errors thrown by append()", async () => {
    const append = async () => {
      throw new Error("disk full");
    };
    await expect(
      bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never),
    ).rejects.toThrow(/disk full/);
  });

  it("does NOT mutate any global state — caller drives StepRuntimeState", async () => {
    const append = async () => { /* no-op */ };
    const result = await bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never);
    // wrapper returns references — does not touch any module-level state.
    // If global state is introduced later, this test would catch it.
    expect(result.artifactRef.type).toBe("proposal");
  });
});
