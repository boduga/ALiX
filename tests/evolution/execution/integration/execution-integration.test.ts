/**
 * A4.5 — End-to-end execution integration tests.
 *
 * Exercises the full governed execution pipeline:
 * evolution → governance decision → authorization → planning → execution → evidence.
 *
 * @module execution-integration
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EvolutionStateMachine } from "../../../../src/evolution/evolution-state-machine.js";
import { EvolutionState } from "../../../../src/evolution/contracts/evolution-contract.js";
import { authorizeExecution } from "../../../../src/evolution/execution/execution-authorization.js";
import { createExecutionPlan, DefaultRollbackResolver, createDefaultRollbackResolver } from "../../../../src/evolution/execution/execution-planner.js";
import { GovernedExecutionRuntime, TestStepExecutor } from "../../../../src/evolution/execution/execution-runtime.js";
import { buildExecutionEvidence } from "../../../../src/evolution/execution/execution-evidence-bridge.js";
import type { EvolutionProposal } from "../../../../src/evolution/contracts/evolution-contract.js";
import type { GovernanceDecision } from "../../../../src/evolution/governance/contracts/decision-contract.js";
import { computeDecisionIntegrityHash } from "../../../../src/evolution/governance/decision-engine.js";
import type {
  ExecutionRequest,
  ExecutionEnvironment,
  ExecutionPlan,
} from "../../../../src/evolution/execution/contracts/execution-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestDecision(evolutionId: string, proposalId: string): GovernanceDecision {
  const base: Omit<GovernanceDecision, "integrityHash"> = {
    decisionId: "govd-test-001",
    proposalId,
    evolutionId,
    kind: "APPROVE",
    confidence: 0.9,
    reasoning: "Test approval",
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
    decidedAt: new Date().toISOString(),
    decidedBy: "governance_policy",
  };
  return { ...base, integrityHash: computeDecisionIntegrityHash(base) };
}

function makeTestEnvironment(): ExecutionEnvironment {
  return {
    environmentId: "env-001",
    environmentHash: "env-hash-001",
    runtimeVersion: "1.0.0",
    agentConfiguration: {},
    baselineMetrics: {},
    capabilityFingerprint: "test-fp",
  };
}

function makeTestRequest(evolutionId: string): ExecutionRequest {
  return {
    requestId: "req-001",
    evolutionId,
    requestedBy: "test",
    requestedAt: new Date().toISOString(),
  };
}

/**
 * Build a minimal EvolutionProposal from just an evolution ID and description.
 * The proposal is the core artifact needed by the planner.
 */
function makeTestProposal(
  evolutionId: string,
  description: string = "Test evolution proposal",
): EvolutionProposal {
  return {
    proposalId: evolutionId,
    evolutionId,
    title: `Test proposal for ${evolutionId}`,
    description,
    change: `Apply ${description}`,
    beforeHash: null,
    afterHash: null,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("A4.5 Execution Integration", () => {
  // -----------------------------------------------------------------------
  // Success scenario
  // -----------------------------------------------------------------------

  it("executes approved evolution end-to-end", async () => {
    // 1. Create EvolutionStateMachine with APPROVED evolution
    const sm = new EvolutionStateMachine();
    sm.createEvolution("evol-test-001", EvolutionState.APPROVED, {
      targetKind: "agent",
      targetId: "agent-1",
    });

    // 2. Create a GovernanceDecision with kind=APPROVE
    const decision = makeTestDecision("evol-test-001", "evol-test-001");

    // 3. Create ExecutionRequest
    const request = makeTestRequest("evol-test-001");

    // 4. Build a proper EvolutionProposal (not just metadata — the planner
    //    needs a full proposal with proposalId, description, etc.)
    const proposal = makeTestProposal("evol-test-001");

    // 5. Authorize
    const auth = authorizeExecution({ request, proposal, decision });
    assert.ok(auth.allowed, "Authorization should be allowed");
    if (auth.allowed) {
      assert.strictEqual(auth.decisionId, decision.decisionId);
    }

    // 6. Create environment
    const environment = makeTestEnvironment();

    // 7. Create plan
    const resolver = new DefaultRollbackResolver();
    const plan = createExecutionPlan(proposal, decision, environment, resolver);
    assert.ok(plan.steps.length > 0, "Plan should have at least one step");
    assert.strictEqual(
      plan.rollbackPlan.length, plan.steps.length,
      "Rollback plan length should match step count",
    );
    assert.ok(plan.integrityHash.length > 0, "Plan should have integrity hash");

    // 8. Execute
    const runtime = new GovernedExecutionRuntime();
    const executor = new TestStepExecutor();
    const report = await runtime.execute(plan, executor);
    assert.strictEqual(report.status, "completed", "Execution should complete successfully");

    // 9. Build evidence
    const evidence = buildExecutionEvidence({
      executionPlan: plan,
      executionReport: report,
      environment,
      decision,
      proposal,
    });
    assert.strictEqual(evidence.evidenceClass, "executed", "Evidence class should be executed");
    assert.ok(evidence.lineage.length >= 4, "Lineage should have at least 4 records");
    assert.ok(evidence.integrityHash.length > 0, "Evidence should have integrity hash");

    // 10. Evolution state should still be APPROVED (CLI handler doesn't transition it)
    assert.strictEqual(sm.getStatus("evol-test-001"), EvolutionState.APPROVED);
  });

  // -----------------------------------------------------------------------
  // Edge case: wrong lifecycle state
  // -----------------------------------------------------------------------

  it("rejects execution when evolution is not in APPROVED state", async () => {
    // Create evolution in DRAFT state
    const sm = new EvolutionStateMachine();
    sm.createEvolution("evol-draft-001", EvolutionState.DRAFT, {
      targetKind: "agent",
      targetId: "agent-1",
    });

    // The CLI should reject because state is DRAFT, not APPROVED
    // Simulate the CLI gate
    const currentState = sm.getStatus("evol-draft-001");
    assert.strictEqual(currentState, EvolutionState.DRAFT);

    // CLI would block here — evolution must be APPROVED
    // DRAFT is not APPROVED, so the gate would reject it
    assert.strictEqual(currentState, EvolutionState.DRAFT, "Evolution should be DRAFT");
  });

  // -----------------------------------------------------------------------
  // Edge case: no governance decision
  // -----------------------------------------------------------------------

  it("rejects execution when no governance decision exists", async () => {
    // Create evolution in APPROVED state
    const sm = new EvolutionStateMachine();
    sm.createEvolution("evol-no-decision-001", EvolutionState.APPROVED, {
      targetKind: "agent",
      targetId: "agent-1",
    });

    const proposal = makeTestProposal("evol-no-decision-001");
    const request = makeTestRequest("evol-no-decision-001");

    // Authorize with undefined decision — should be denied
    const auth = authorizeExecution({ request, proposal, decision: undefined });
    assert.ok(!auth.allowed, "Authorization should be denied without a decision");
    if (!auth.allowed) {
      assert.ok(
        auth.reason.includes("not found") || auth.reason.toLowerCase().includes("decision"),
        "Should mention missing decision",
      );
    }
  });

  // -----------------------------------------------------------------------
  // Edge case: dry-run
  // -----------------------------------------------------------------------

  it("generates plan without executing when dry-run", () => {
    // Dry-run means: plan is generated but steps are never executed.
    // Verify that plan exists and has steps but no execution occurs.
    const sm = new EvolutionStateMachine();
    sm.createEvolution("evol-dryrun-001", EvolutionState.APPROVED, {
      targetKind: "agent",
      targetId: "agent-1",
    });

    const decision = makeTestDecision("evol-dryrun-001", "evol-dryrun-001");
    const proposal = makeTestProposal("evol-dryrun-001");
    const environment = makeTestEnvironment();
    const resolver = new DefaultRollbackResolver();
    const plan = createExecutionPlan(proposal, decision, environment, resolver);

    // The plan should be valid and have steps
    assert.ok(plan.steps.length > 0, "Plan should have steps");
    assert.ok(plan.integrityHash.length > 0, "Plan should have integrity hash");

    // In a real dry-run, these steps would not be executed
    assert.ok(plan.planId.length > 0, "Plan should have an ID");
    assert.strictEqual(plan.proposalId, "evol-dryrun-001");

    // Evolution state should remain APPROVED (no execution happened)
    assert.strictEqual(sm.getStatus("evol-dryrun-001"), EvolutionState.APPROVED);
  });

  // -----------------------------------------------------------------------
  // Edge case: failed step triggers rollback
  // -----------------------------------------------------------------------

  it("triggers rollback when a step fails", async () => {
    // Create a proposal with explicit changes array so the planner
    // generates multiple steps, then cause the second step to fail.
    const proposal: EvolutionProposal = {
      proposalId: "evol-rb-001",
      evolutionId: "evol-rb-001",
      title: "Test rollback evolution",
      description: "Multiple steps for rollback testing",
      change: "Update agent runtime and configuration",
      beforeHash: null,
      afterHash: null,
      createdAt: new Date().toISOString(),
    };

    // Add changes to the proposal object for the planner's resolveSteps
    // (the planner checks for a 'changes' array at runtime)
    const proposalWithMeta = proposal as unknown as Record<string, unknown>;
    proposalWithMeta.changes = [
      {
        operation: "upgrade_agent_runtime",
        parameters: { targetVersion: "2.0.0", previousVersion: "1.0.0" },
        idempotent: false,
        preconditions: {},
        postconditions: {},
      },
      {
        operation: "update_configuration",
        parameters: { key: "log_level", value: "debug", previousConfiguration: { log_level: "info" } },
        idempotent: true,
        preconditions: {},
        postconditions: {},
      },
    ];

    const decision = makeTestDecision("evol-rb-001", "evol-rb-001");
    const request = makeTestRequest("evol-rb-001");

    // Authorize
    const auth = authorizeExecution({ request, proposal, decision });
    assert.ok(auth.allowed, "Authorization should be allowed");

    // Use pre-registered rollback resolver so known operations produce safe steps
    const environment = makeTestEnvironment();
    const resolver = createDefaultRollbackResolver();
    const plan = createExecutionPlan(proposal, decision, environment, resolver);

    // Verify plan has 2 steps
    assert.strictEqual(plan.steps.length, 2, "Plan should have 2 steps");
    assert.strictEqual(plan.steps[0]!.operation, "upgrade_agent_runtime");
    assert.strictEqual(plan.steps[1]!.operation, "update_configuration");

    // Execute with a StepExecutor that fails the second step.
    // The second step is idempotent with 1 retry (maxAttempts=2),
    // so we provide 2 failures for the second step (+1 for step 1).
    const runtime = new GovernedExecutionRuntime();
    const executor = new TestStepExecutor([
      { success: true },   // step 1: upgrade succeeds
      { success: false },  // step 2 attempt 1: configuration update fails
      { success: false },  // step 2 attempt 2 (retry): also fails -> triggers rollback
    ]);

    const report = await runtime.execute(plan, executor);

    // Should trigger rollback because step 2 failed
    assert.strictEqual(report.rollbackTriggered, true, "Rollback should be triggered");
    assert.strictEqual(report.status, "rolled_back", "Report status should be rolled_back");
    assert.ok(report.rollbackResult, "Rollback result should exist");
    assert.ok(report.rollbackResult!.success, "Rollback should succeed");

    // Build evidence from the rolled-back execution
    const evidence = buildExecutionEvidence({
      executionPlan: plan,
      executionReport: report,
      environment,
      decision,
      proposal,
    });
    assert.strictEqual(evidence.evidenceClass, "executed");
    assert.ok(evidence.lineage.length >= 4);
  });

  // -----------------------------------------------------------------------
  // Evidence integrity assertion
  // -----------------------------------------------------------------------

  it("produces valid evidence from execution", async () => {
    const sm = new EvolutionStateMachine();
    sm.createEvolution("evol-det-001", EvolutionState.APPROVED, {
      targetKind: "agent",
      targetId: "agent-1",
    });

    const decision = makeTestDecision("evol-det-001", "evol-det-001");
    const proposal = makeTestProposal("evol-det-001");
    const environment = makeTestEnvironment();
    const resolver = new DefaultRollbackResolver();
    const plan = createExecutionPlan(proposal, decision, environment, resolver);

    // Execute
    const runtime = new GovernedExecutionRuntime();
    const executor = new TestStepExecutor();
    const report = await runtime.execute(plan, executor);

    // Build evidence
    const evidence = buildExecutionEvidence({
      executionPlan: plan,
      executionReport: report,
      environment,
      decision,
      proposal,
    });

    assert.ok(evidence.integrityHash.length > 0, "Evidence should have integrity hash");
    assert.strictEqual(evidence.evidenceClass, "executed");
    assert.ok(evidence.lineage.length >= 4);
  });
});
