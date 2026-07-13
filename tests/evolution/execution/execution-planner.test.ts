/**
 * Tests for A4.1 — Execution Planner.
 *
 * Covers deterministic plan generation, plan ID computation, step
 * resolution, rollback coverage, constraint validation, edge cases,
 * and the DefaultRollbackResolver.
 *
 * @module execution-planner
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createPlanId,
  createExecutionPlan,
  validatePlanConstraints,
  PlannerConfig,
  DEFAULT_PLANNER_CONFIG,
  DefaultRollbackResolver,
  createDefaultRollbackResolver,
  RollbackResolver,
} from "../../../src/evolution/execution/execution-planner.js";
import type { EvolutionProposal } from "../../../src/evolution/contracts/evolution-contract.js";
import type { GovernanceDecision } from "../../../src/evolution/governance/contracts/decision-contract.js";
import type {
  ExecutionPlan,
  ExecutionStep,
  RollbackStep,
  ExecutionEnvironment,
} from "../../../src/evolution/execution/contracts/execution-contract.js";

// ---------------------------------------------------------------------------
// Test data constants
// ---------------------------------------------------------------------------

const T = "2026-07-12T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(overrides?: Partial<EvolutionProposal>): EvolutionProposal {
  return {
    proposalId: "evol-test-001",
    evolutionId: "evol-test-001",
    title: "Test proposal",
    description: "A proposal for testing",
    change: "Change the thing",
    beforeHash: null,
    afterHash: null,
    createdAt: T,
    ...overrides,
  };
}

function makeDecision(overrides?: Partial<GovernanceDecision>): GovernanceDecision {
  return {
    decisionId: "govd-001",
    proposalId: "evol-test-001",
    evolutionId: "evo-001",
    kind: "APPROVE",
    confidence: 0.95,
    reasoning: "Approved for testing",
    risks: [],
    evidenceId: "ev-001",
    recommendationAvailable: false,
    followedRecommendation: false,
    policySnapshot: {
      policyName: "default",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    },
    targetState: "APPROVED",
    decidedAt: T,
    decidedBy: "operator",
    ...overrides,
  };
}

function makeEnvironment(overrides?: Partial<ExecutionEnvironment>): ExecutionEnvironment {
  return {
    environmentId: "env-001",
    environmentHash: "abc123def456",
    runtimeVersion: "1.0.0",
    agentConfiguration: { mode: "test" },
    baselineMetrics: { cpu: 0.5 },
    capabilityFingerprint: "cap-v1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createPlanId
// ---------------------------------------------------------------------------

describe("createPlanId", () => {
  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------

  it("produces deterministic output for same inputs", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const env = makeEnvironment();

    const id1 = createPlanId(proposal, decision, env);
    const id2 = createPlanId(proposal, decision, env);

    assert.strictEqual(id1, id2);
    assert.strictEqual(typeof id1, "string");
  });

  // -------------------------------------------------------------------------
  // Different proposals differ
  // -------------------------------------------------------------------------

  it("produces different output for different proposals", () => {
    const decision = makeDecision();
    const env = makeEnvironment();

    const id1 = createPlanId(makeProposal({ proposalId: "proposal-a" }), decision, env);
    const id2 = createPlanId(makeProposal({ proposalId: "proposal-b" }), decision, env);

    assert.notStrictEqual(id1, id2);
  });

  // -------------------------------------------------------------------------
  // Different environments differ
  // -------------------------------------------------------------------------

  it("produces different output for different environments", () => {
    const proposal = makeProposal();
    const decision = makeDecision();

    const id1 = createPlanId(proposal, decision, makeEnvironment({ environmentId: "env-a" }));
    const id2 = createPlanId(proposal, decision, makeEnvironment({ environmentId: "env-b" }));

    assert.notStrictEqual(id1, id2);
  });

  // -------------------------------------------------------------------------
  // Format
  // -------------------------------------------------------------------------

  it("returns a 64-character hex string", () => {
    const id = createPlanId(makeProposal(), makeDecision(), makeEnvironment());
    assert.strictEqual(id.length, 64);
    assert.match(id, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// createExecutionPlan
// ---------------------------------------------------------------------------

describe("createExecutionPlan", () => {
  // -------------------------------------------------------------------------
  // Creates valid plan from proposal + decision + environment
  // -------------------------------------------------------------------------

  it("creates a valid execution plan from proposal, decision, and environment", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const plan = createExecutionPlan(proposal, decision, env, resolver);

    assert.ok(plan);
    assert.strictEqual(typeof plan.planId, "string");
    assert.strictEqual(plan.proposalId, proposal.proposalId);
    assert.strictEqual(plan.decisionId, decision.decisionId);
    assert.strictEqual(plan.environmentHash, env.environmentHash);
    assert.ok(plan.steps.length >= 1);
    assert.ok(plan.rollbackPlan.length >= 1);
    assert.strictEqual(typeof plan.integrityHash, "string");
  });

  // -------------------------------------------------------------------------
  // Deterministic — same inputs = same plan
  // -------------------------------------------------------------------------

  it("produces identical plan for identical inputs", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const planA = createExecutionPlan(proposal, decision, env, resolver);
    const planB = createExecutionPlan(proposal, decision, env, resolver);

    assert.strictEqual(planA.planId, planB.planId);
    assert.strictEqual(planA.proposalHash, planB.proposalHash);
    assert.strictEqual(planA.decisionHash, planB.decisionHash);
    assert.strictEqual(planA.integrityHash, planB.integrityHash);
    assert.strictEqual(planA.steps.length, planB.steps.length);
    assert.strictEqual(planA.steps[0].operation, planB.steps[0].operation);
  });

  // -------------------------------------------------------------------------
  // Different proposals produce different plans
  // -------------------------------------------------------------------------

  it("produces different planId for different proposals", () => {
    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const planA = createExecutionPlan(makeProposal({ proposalId: "a" }), decision, env, resolver);
    const planB = createExecutionPlan(makeProposal({ proposalId: "b" }), decision, env, resolver);

    assert.notStrictEqual(planA.planId, planB.planId);
  });

  // -------------------------------------------------------------------------
  // Different environments produce different plans
  // -------------------------------------------------------------------------

  it("produces different planId for different environments", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const resolver = createDefaultRollbackResolver();

    const planA = createExecutionPlan(proposal, decision, makeEnvironment({ environmentId: "a" }), resolver);
    const planB = createExecutionPlan(proposal, decision, makeEnvironment({ environmentId: "b" }), resolver);

    assert.notStrictEqual(planA.planId, planB.planId);
  });

  // -------------------------------------------------------------------------
  // proposalHash and decisionHash
  // -------------------------------------------------------------------------

  it("populates proposalHash and decisionHash as canonical strings", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const plan = createExecutionPlan(proposal, decision, env, resolver);

    // Hashes should be deterministic strings (canonical JSON output, not hex)
    assert.strictEqual(typeof plan.proposalHash, "string");
    assert.ok(plan.proposalHash.length > 0);
    assert.strictEqual(typeof plan.decisionHash, "string");
    assert.ok(plan.decisionHash.length > 0);
  });

  // -------------------------------------------------------------------------
  // Each forward step has corresponding rollback step
  // -------------------------------------------------------------------------

  it("generates a rollback step for every forward step", () => {
    const proposal = makeProposal();

    // Add changes array at runtime (EvolutionProposal doesn't carry 'changes', but resolveSteps handles it)
    (proposal as unknown as Record<string, unknown>).changes = [
      { operation: "upgrade_agent_runtime", parameters: { version: "2.0.0", previousVersion: "1.0.0" } },
      { operation: "update_configuration", parameters: { previousConfiguration: { timeout: 30 } } },
    ];

    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const plan = createExecutionPlan(proposal, decision, env, resolver);

    assert.strictEqual(plan.steps.length, 2);
    assert.strictEqual(plan.rollbackPlan.length, 2);
  });

  // -------------------------------------------------------------------------
  // Rollback step IDs use rb- prefix
  // -------------------------------------------------------------------------

  it("rollback step IDs use rb- prefix and reference forward step IDs", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const plan = createExecutionPlan(proposal, decision, env, resolver);

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const rollback = plan.rollbackPlan[i];

      assert.strictEqual(rollback.stepId, `rb-${step.stepId}`);
      assert.strictEqual(rollback.forwardStepId, step.stepId);
    }
  });

  // -------------------------------------------------------------------------
  // Fallback step from proposal description
  // -------------------------------------------------------------------------

  it("creates fallback step when proposal has no changes array", () => {
    const proposal = makeProposal({ description: "Custom proposal description" });
    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const plan = createExecutionPlan(proposal, decision, env, resolver);

    assert.strictEqual(plan.steps.length, 1);
    assert.strictEqual(plan.steps[0].operation, "apply_proposal");
    assert.deepStrictEqual(plan.steps[0].parameters, { description: "Custom proposal description" });
  });

  // -------------------------------------------------------------------------
  // Throws on validation failure
  // -------------------------------------------------------------------------

  it("throws when plan validation fails (empty steps from empty changes)", () => {
    const proposal = makeProposal();
    (proposal as unknown as Record<string, unknown>).changes = [];

    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    assert.throws(
      () => createExecutionPlan(proposal, decision, env, resolver),
      { message: /at least one step/i },
    );
  });

  // -------------------------------------------------------------------------
  // Throws with custom config
  // -------------------------------------------------------------------------

  it("throws when plan exceeds maxSteps from config", () => {
    const proposal = makeProposal();
    (proposal as unknown as Record<string, unknown>).changes = [
      { operation: "step_a" },
      { operation: "step_b" },
    ];

    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();
    const config: PlannerConfig = { maxSteps: 1 };

    assert.throws(
      () => createExecutionPlan(proposal, decision, env, resolver, config),
      { message: /exceeds maximum step count/i },
    );
  });
});

// ---------------------------------------------------------------------------
// DefaultRollbackResolver
// ---------------------------------------------------------------------------

describe("DefaultRollbackResolver", () => {
  // -------------------------------------------------------------------------
  // Manual rollback for unknown operations
  // -------------------------------------------------------------------------

  it("creates manual rollback for unknown operations", () => {
    const resolver = new DefaultRollbackResolver();

    const step: ExecutionStep = {
      stepId: "step-1",
      operation: "unknown_operation",
      parameters: { key: "value" },
      idempotent: false,
      preconditions: {},
      postconditions: {},
    };

    const rollback = resolver.createRollback(step);

    assert.strictEqual(rollback.stepId, "rb-step-1");
    assert.strictEqual(rollback.forwardStepId, "step-1");
    assert.strictEqual(rollback.operation, "manual_recovery:unknown_operation");
    assert.strictEqual(rollback.rollbackType, "manual");
    assert.strictEqual(rollback.safe, false);
    assert.deepStrictEqual(rollback.parameters, { key: "value" });
  });

  // -------------------------------------------------------------------------
  // Registered operations use custom rollback
  // -------------------------------------------------------------------------

  it("uses custom rollback for registered operations", () => {
    const resolver = new DefaultRollbackResolver();

    resolver.registerOperation("deploy_service", (step) => ({
      stepId: `rb-${step.stepId}`,
      forwardStepId: step.stepId,
      operation: "rollback_deploy",
      parameters: { targetVersion: (step.parameters as Record<string, string>).version },
      rollbackType: "automatic" as const,
      safe: true,
    }));

    const step: ExecutionStep = {
      stepId: "step-5",
      operation: "deploy_service",
      parameters: { version: "3.0.0" },
      idempotent: false,
      preconditions: {},
      postconditions: {},
    };

    const rollback = resolver.createRollback(step);

    assert.strictEqual(rollback.stepId, "rb-step-5");
    assert.strictEqual(rollback.forwardStepId, "step-5");
    assert.strictEqual(rollback.operation, "rollback_deploy");
    assert.strictEqual(rollback.rollbackType, "automatic");
    assert.strictEqual(rollback.safe, true);
    assert.deepStrictEqual(rollback.parameters, { targetVersion: "3.0.0" });
  });

  // -------------------------------------------------------------------------
  // registerOperation supports multiple operations
  // -------------------------------------------------------------------------

  it("supports multiple registered operations", () => {
    const resolver = new DefaultRollbackResolver();

    let callOrder: string[] = [];

    resolver.registerOperation("op_a", (step) => {
      callOrder.push("op_a");
      return {
        stepId: `rb-${step.stepId}`,
        forwardStepId: step.stepId,
        operation: "rollback_a",
        parameters: {},
        rollbackType: "automatic" as const,
        safe: true,
      };
    });

    resolver.registerOperation("op_b", (step) => {
      callOrder.push("op_b");
      return {
        stepId: `rb-${step.stepId}`,
        forwardStepId: step.stepId,
        operation: "rollback_b",
        parameters: {},
        rollbackType: "automatic" as const,
        safe: true,
      };
    });

    const stepA: ExecutionStep = {
      stepId: "step-a", operation: "op_a", idempotent: false,
      parameters: {}, preconditions: {}, postconditions: {},
    };

    const stepB: ExecutionStep = {
      stepId: "step-b", operation: "op_b", idempotent: false,
      parameters: {}, preconditions: {}, postconditions: {},
    };

    const rollbackA = resolver.createRollback(stepA);
    const rollbackB = resolver.createRollback(stepB);

    assert.strictEqual(rollbackA.operation, "rollback_a");
    assert.strictEqual(rollbackB.operation, "rollback_b");
    assert.deepStrictEqual(callOrder, ["op_a", "op_b"]);
  });
});

// ---------------------------------------------------------------------------
// createDefaultRollbackResolver
// ---------------------------------------------------------------------------

describe("createDefaultRollbackResolver", () => {
  // -------------------------------------------------------------------------
  // upgrade_agent_runtime
  // -------------------------------------------------------------------------

  it("creates automatic downgrade rollback for upgrade_agent_runtime", () => {
    const resolver = createDefaultRollbackResolver();

    const step: ExecutionStep = {
      stepId: "step-1",
      operation: "upgrade_agent_runtime",
      parameters: { version: "2.0.0", previousVersion: "1.0.0" },
      idempotent: false,
      preconditions: {},
      postconditions: {},
    };

    const rollback = resolver.createRollback(step);

    assert.strictEqual(rollback.operation, "downgrade_agent_runtime");
    assert.strictEqual(rollback.rollbackType, "automatic");
    assert.strictEqual(rollback.safe, true);
    assert.strictEqual(rollback.parameters.targetVersion, "1.0.0");
  });

  // -------------------------------------------------------------------------
  // update_configuration
  // -------------------------------------------------------------------------

  it("creates automatic restore rollback for update_configuration", () => {
    const resolver = createDefaultRollbackResolver();

    const step: ExecutionStep = {
      stepId: "step-2",
      operation: "update_configuration",
      parameters: { previousConfiguration: { timeout: 30, retries: 3 } },
      idempotent: false,
      preconditions: {},
      postconditions: {},
    };

    const rollback = resolver.createRollback(step);

    assert.strictEqual(rollback.operation, "restore_configuration");
    assert.strictEqual(rollback.rollbackType, "automatic");
    assert.strictEqual(rollback.safe, true);
    assert.deepStrictEqual(rollback.parameters.configuration, { timeout: 30, retries: 3 });
  });

  // -------------------------------------------------------------------------
  // Unknown operation with default resolver falls back to manual
  // -------------------------------------------------------------------------

  it("falls back to manual for unknown operations in default resolver", () => {
    const resolver = createDefaultRollbackResolver();

    const step: ExecutionStep = {
      stepId: "step-3",
      operation: "custom_operation",
      parameters: { foo: "bar" },
      idempotent: false,
      preconditions: {},
      postconditions: {},
    };

    const rollback = resolver.createRollback(step);

    assert.strictEqual(rollback.operation, "manual_recovery:custom_operation");
    assert.strictEqual(rollback.rollbackType, "manual");
    assert.strictEqual(rollback.safe, false);
  });
});

// ---------------------------------------------------------------------------
// RollbackResolver — integration with planner
// ---------------------------------------------------------------------------

describe("RollbackResolver integration with createExecutionPlan", () => {
  it("calls resolver for each step in forward order", () => {
    const proposal = makeProposal();
    (proposal as unknown as Record<string, unknown>).changes = [
      { operation: "step_one" },
      { operation: "step_two" },
    ];

    const decision = makeDecision();
    const env = makeEnvironment();

    const callOrder: string[] = [];
    const resolver: RollbackResolver = {
      createRollback: (step: ExecutionStep) => {
        callOrder.push(step.operation);
        return {
          stepId: `rb-${step.stepId}`,
          forwardStepId: step.stepId,
          operation: `rollback_${step.operation}`,
          parameters: {},
          rollbackType: "automatic" as const,
          safe: true,
        };
      },
    };

    const plan = createExecutionPlan(proposal, decision, env, resolver);

    assert.deepStrictEqual(callOrder, ["step_one", "step_two"]);
    assert.strictEqual(plan.rollbackPlan[0].operation, "rollback_step_one");
    assert.strictEqual(plan.rollbackPlan[1].operation, "rollback_step_two");
  });

  it("planner can use a custom RollbackResolver implementation", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const env = makeEnvironment();

    // Custom resolver that always marks rollback as safe with a fixed message
    const resolver: RollbackResolver = {
      createRollback: (step) => ({
        stepId: `rb-${step.stepId}`,
        forwardStepId: step.stepId,
        operation: `custom_undo:${step.operation}`,
        parameters: {},
        rollbackType: "automatic" as const,
        safe: true,
      }),
    };

    const plan = createExecutionPlan(proposal, decision, env, resolver);

    assert.strictEqual(plan.rollbackPlan[0].operation, "custom_undo:apply_proposal");
    assert.strictEqual(plan.rollbackPlan[0].safe, true);
    assert.strictEqual(plan.rollbackPlan[0].rollbackType, "automatic");
  });
});

// ---------------------------------------------------------------------------
// validatePlanConstraints
// ---------------------------------------------------------------------------

describe("validatePlanConstraints", () => {
  // -------------------------------------------------------------------------
  // Empty steps
  // -------------------------------------------------------------------------

  it("reports error for empty steps", () => {
    const plan: ExecutionPlan = {
      planId: "test-id",
      proposalId: "p-1",
      proposalHash: "hash-p",
      decisionId: "d-1",
      decisionHash: "hash-d",
      environmentHash: "hash-e",
      steps: [],
      rollbackPlan: [],
      integrityHash: "hash-int",
    };

    const errors = validatePlanConstraints(plan);

    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => /at least one step/i.test(e)));
  });

  // -------------------------------------------------------------------------
  // Max steps exceeded
  // -------------------------------------------------------------------------

  it("reports error when step count exceeds maxSteps", () => {
    const plan: ExecutionPlan = {
      planId: "test-id",
      proposalId: "p-1",
      proposalHash: "hash-p",
      decisionId: "d-1",
      decisionHash: "hash-d",
      environmentHash: "hash-e",
      steps: [
        { stepId: "s1", operation: "op1", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
        { stepId: "s2", operation: "op2", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
        { stepId: "s3", operation: "op3", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
      ],
      rollbackPlan: [
        { stepId: "rb-s1", forwardStepId: "s1", operation: "rb1", parameters: {}, rollbackType: "automatic", safe: true },
        { stepId: "rb-s2", forwardStepId: "s2", operation: "rb2", parameters: {}, rollbackType: "automatic", safe: true },
        { stepId: "rb-s3", forwardStepId: "s3", operation: "rb3", parameters: {}, rollbackType: "automatic", safe: true },
      ],
      integrityHash: "hash-int",
    };

    const config: PlannerConfig = { maxSteps: 2 };
    const errors = validatePlanConstraints(plan, config);

    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => /exceeds maximum step count/i.test(e)));
  });

  // -------------------------------------------------------------------------
  // Matching rollback count
  // -------------------------------------------------------------------------

  it("reports error when rollback count does not match step count", () => {
    const plan: ExecutionPlan = {
      planId: "test-id",
      proposalId: "p-1",
      proposalHash: "hash-p",
      decisionId: "d-1",
      decisionHash: "hash-d",
      environmentHash: "hash-e",
      steps: [
        { stepId: "s1", operation: "op1", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
      ],
      rollbackPlan: [
        { stepId: "rb-s1", forwardStepId: "s1", operation: "rb1", parameters: {}, rollbackType: "automatic", safe: true },
        { stepId: "rb-s2", forwardStepId: "s2", operation: "rb2", parameters: {}, rollbackType: "automatic", safe: true },
      ],
      integrityHash: "hash-int",
    };

    const errors = validatePlanConstraints(plan);

    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => /rollback plan length/i.test(e)));
  });

  // -------------------------------------------------------------------------
  // Integrity hash mismatch
  // -------------------------------------------------------------------------

  it("reports error when integrity hash is invalid", () => {
    const plan: ExecutionPlan = {
      planId: "test-id",
      proposalId: "p-1",
      proposalHash: "hash-p",
      decisionId: "d-1",
      decisionHash: "hash-d",
      environmentHash: "hash-e",
      steps: [
        { stepId: "s1", operation: "op1", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
      ],
      rollbackPlan: [
        { stepId: "rb-s1", forwardStepId: "s1", operation: "rb1", parameters: {}, rollbackType: "automatic", safe: true },
      ],
      integrityHash: "tampered-hash",
    };

    const errors = validatePlanConstraints(plan);

    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => /integrity hash mismatch/i.test(e)));
  });

  // -------------------------------------------------------------------------
  // Valid plan passes
  // -------------------------------------------------------------------------

  it("returns empty errors for a valid plan", () => {
    const proposal = makeProposal();
    const decision = makeDecision();
    const env = makeEnvironment();
    const resolver = createDefaultRollbackResolver();

    const plan = createExecutionPlan(proposal, decision, env, resolver);
    const errors = validatePlanConstraints(plan);

    assert.deepStrictEqual(errors, []);
  });

  // -------------------------------------------------------------------------
  // Uses default config when omitted
  // -------------------------------------------------------------------------

  it("uses default maxSteps when config is omitted", () => {
    const plan: ExecutionPlan = {
      planId: "test-id",
      proposalId: "p-1",
      proposalHash: "hash-p",
      decisionId: "d-1",
      decisionHash: "hash-d",
      environmentHash: "hash-e",
      steps: [
        { stepId: "s1", operation: "op1", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
      ],
      rollbackPlan: [
        { stepId: "rb-s1", forwardStepId: "s1", operation: "rb1", parameters: {}, rollbackType: "automatic", safe: true },
      ],
      integrityHash: "hello",
    };

    // Without config — should catch integrity hash mismatch and steps/rollback mismatch if any
    const errors = validatePlanConstraints(plan);

    // Default maxSteps is 50, so 1 step is fine
    const maxStepErrors = errors.filter((e) => /exceeds maximum step count/i.test(e));
    assert.strictEqual(maxStepErrors.length, 0);
  });
});
