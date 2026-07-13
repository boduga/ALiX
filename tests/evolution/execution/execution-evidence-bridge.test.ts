/**
 * Tests for A4.3 — Execution Evidence Bridge.
 *
 * Covers evidence construction, deterministic integrity hashing,
 * transient field exclusion, lineage building, and field propagation.
 *
 * @module execution-evidence-bridge
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalStringify } from "../../../src/security/audit/canonical-json.js";
import {
  buildExecutionEvidence,
  buildLineage,
  computeExecutionEvidenceHash,
  type BuildEvidenceInput,
} from "../../../src/evolution/execution/execution-evidence-bridge.js";
import type {
  ExecutionPlan,
  ExecutionReport,
  ExecutionEnvironment,
  ExecutionStep,
  RollbackStep,
  EvolutionExecutionEvidence,
} from "../../../src/evolution/execution/contracts/execution-contract.js";
import type { GovernanceDecision } from "../../../src/evolution/governance/contracts/decision-contract.js";
import type { EvolutionProposal } from "../../../src/evolution/contracts/evolution-contract.js";
import type { LineageRecord } from "../../../src/evolution/verification/contracts/verification-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T = "2026-07-12T00:00:00.000Z";

function makeStep(overrides?: Partial<ExecutionStep>): ExecutionStep {
  return {
    stepId: "step-1",
    operation: "apply_change",
    parameters: { file: "src/config.ts", content: "new content" },
    idempotent: true,
    preconditions: { fileExists: true },
    postconditions: { hashChanged: true },
    ...overrides,
  };
}

function makeRollbackStep(
  overrides?: Partial<RollbackStep>,
): RollbackStep {
  return {
    stepId: "rollback-1",
    forwardStepId: "step-1",
    operation: "revert_change",
    parameters: { file: "src/config.ts" },
    rollbackType: "automatic",
    safe: true,
    ...overrides,
  };
}

function makeExecutionPlan(
  overrides?: Partial<ExecutionPlan>,
): ExecutionPlan {
  const steps: readonly ExecutionStep[] = [makeStep()] as const;
  const rollbackPlan: readonly RollbackStep[] = [makeRollbackStep()] as const;
  const plan: ExecutionPlan = {
    planId: "plan-test-001",
    proposalId: "prop-test-001",
    proposalHash: "abc123def456",
    decisionId: "govd-test-001",
    decisionHash: "def789ghi012",
    environmentHash: "env-hash-001",
    steps,
    rollbackPlan,
    integrityHash: "",
  };
  // Compute integrity hash for the plan
  const hash = createHash("sha256");
  const canonical = canonicalStringify({
    planId: plan.planId,
    proposalId: plan.proposalId,
    decisionId: plan.decisionId,
    steps: plan.steps,
  });
  hash.update(`alix-plan-v1:${canonical}`);
  return { ...plan, integrityHash: hash.digest("hex"), ...overrides };
}

function makeExecutionPlanV2(): ExecutionPlan {
  const steps: readonly ExecutionStep[] = [
    makeStep({ stepId: "step-2", operation: "delete_file" }),
  ] as const;
  const rollbackPlan: readonly RollbackStep[] = [makeRollbackStep()] as const;
  const plan: ExecutionPlan = {
    planId: "plan-test-002",
    proposalId: "prop-test-002",
    proposalHash: "xyz789",
    decisionId: "govd-test-002",
    decisionHash: "jkl012",
    environmentHash: "env-hash-002",
    steps,
    rollbackPlan,
    integrityHash: "",
  };
  const hash = createHash("sha256");
  const canonical = canonicalStringify({
    planId: plan.planId,
    proposalId: plan.proposalId,
    decisionId: plan.decisionId,
    steps: plan.steps,
  });
  hash.update(`alix-plan-v1:${canonical}`);
  return { ...plan, integrityHash: hash.digest("hex") };
}

function makeExecutionReport(
  overrides?: Partial<ExecutionReport>,
): ExecutionReport {
  return {
    reportId: "report-test-001",
    planId: "plan-test-001",
    executionId: "exec-test-001",
    status: "completed",
    stepResults: [
      {
        stepId: "step-1",
        success: true,
        output: { changeApplied: true },
        startedAt: T,
        completedAt: T,
      },
    ],
    startedAt: T,
    completedAt: T,
    rollbackTriggered: false,
    ...overrides,
  };
}

function makeExecutionReportV2(): ExecutionReport {
  return {
    reportId: "report-test-002",
    planId: "plan-test-001",
    executionId: "exec-test-002",
    status: "failed",
    stepResults: [
      {
        stepId: "step-1",
        success: false,
        output: { error: "timeout" },
        startedAt: T,
        completedAt: T,
      },
    ],
    startedAt: T,
    completedAt: T,
    rollbackTriggered: true,
    rollbackResult: {
      success: true,
      stepResults: [
        {
          stepId: "rollback-1",
          success: true,
          output: {},
          startedAt: T,
          completedAt: T,
        },
      ],
      startedAt: T,
      completedAt: T,
    },
  };
}

function makeExecutionEnvironment(): ExecutionEnvironment {
  return {
    environmentId: "env-test-001",
    environmentHash: "env-hash-001",
    runtimeVersion: "1.0.0",
    agentConfiguration: { model: "claude-opus-4" },
    baselineMetrics: { latencyMs: 150, tokensUsed: 5000 },
    capabilityFingerprint: "cap-fp-001",
  };
}

function makeGovernanceDecision(): GovernanceDecision {
  return {
    decisionId: "govd-test-001",
    proposalId: "prop-test-001",
    evolutionId: "evol-test-001",
    kind: "APPROVE",
    confidence: 0.85,
    reasoning: "Approved after verification",
    risks: ["minor regression risk"],
    evidenceId: "evidence-test-001",
    recommendationAvailable: true,
    followedRecommendation: true,
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
    decidedBy: "governance_policy",
    integrityHash: "test-hash",
  };
}

function makeEvolutionProposal(): EvolutionProposal {
  return {
    proposalId: "prop-test-001",
    evolutionId: "evol-test-001",
    title: "Test evolution",
    description: "Test description",
    change: "Change config file",
    beforeHash: null,
    afterHash: null,
    createdAt: T,
  };
}

function makeInput(
  overrides?: Partial<BuildEvidenceInput>,
): BuildEvidenceInput {
  return {
    executionPlan: makeExecutionPlan(),
    executionReport: makeExecutionReport(),
    environment: makeExecutionEnvironment(),
    decision: makeGovernanceDecision(),
    proposal: makeEvolutionProposal(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionEvidenceBridge", () => {
  describe("buildExecutionEvidence", () => {
    it("constructs EvolutionExecutionEvidence from plan + report + environment", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      assert.ok(evidence, "evidence should be produced");
      assert.equal(
        typeof evidence.evidenceId,
        "string",
        "evidenceId should be a string",
      );
      assert.ok(
        evidence.evidenceId.startsWith("eve-"),
        "evidenceId should start with eve-",
      );
      assert.equal(
        evidence.executionPlan.planId,
        "plan-test-001",
        "should carry execution plan",
      );
      assert.equal(
        evidence.executionReport.reportId,
        "report-test-001",
        "should carry execution report",
      );
      assert.equal(
        evidence.environment.environmentId,
        "env-test-001",
        "should carry environment",
      );
    });

    it('evidenceClass is "executed"', () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      assert.equal(evidence.evidenceClass, "executed");
    });

    it("integrity hash is deterministic (same evidence = same hash)", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      const hash1 = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );
      const hash2 = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );

      assert.equal(hash1, hash2);
    });

    it("integrity hash changes when plan changes", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      const evidenceWithDifferentPlan = {
        ...evidence,
        executionPlan: makeExecutionPlanV2(),
      };

      const hash1 = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );
      const hash2 = computeExecutionEvidenceHash(
        evidenceWithDifferentPlan as unknown as Omit<
          EvolutionExecutionEvidence,
          "integrityHash"
        >,
      );

      assert.notEqual(hash1, hash2);
    });

    it("integrity hash changes when report changes", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      const evidenceWithDifferentReport = {
        ...evidence,
        executionReport: makeExecutionReportV2(),
      };

      const hash1 = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );
      const hash2 = computeExecutionEvidenceHash(
        evidenceWithDifferentReport as unknown as Omit<
          EvolutionExecutionEvidence,
          "integrityHash"
        >,
      );

      assert.notEqual(hash1, hash2);
    });

    it("integrity hash excludes transient fields", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      // Compute hash with extra transient fields added at runtime
      const evidenceWithTransient = {
        ...evidence,
        runtimeMetadata: { traceId: "trace-123", spanId: "span-456" },
        lastHeartbeat: "2026-07-12T12:00:00.000Z",
      } as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">;

      const hashWithoutTransient = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );
      const hashWithTransient =
        computeExecutionEvidenceHash(evidenceWithTransient);

      assert.equal(
        hashWithTransient,
        hashWithoutTransient,
        "transient fields should not affect hash",
      );
    });

    it("lineage includes proposal, decision, plan, report", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      assert.equal(evidence.lineage.length, 4, "should have 4 lineage records");

      const steps = evidence.lineage.map((r) => r.step);
      assert.ok(
        steps.includes("evolution_proposal"),
        "should include proposal step",
      );
      assert.ok(
        steps.includes("governance_decision"),
        "should include decision step",
      );
      assert.ok(
        steps.includes("execution_plan"),
        "should include plan step",
      );
      assert.ok(
        steps.includes("execution_report"),
        "should include report step",
      );
    });

    it("evidence carries proposalId from plan", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      assert.equal(
        evidence.proposalId,
        input.executionPlan.proposalId,
        "proposalId should match plan's proposalId",
      );
    });

    it("evidence carries decisionId from plan", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      assert.equal(
        evidence.decisionId,
        input.executionPlan.decisionId,
        "decisionId should match plan's decisionId",
      );
    });

    it("evidence has valid expiresAt", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      assert.ok(
        typeof evidence.expiresAt === "string",
        "expiresAt should be a string",
      );

      const expiresMs = Date.parse(evidence.expiresAt);
      assert.ok(
        !Number.isNaN(expiresMs),
        "expiresAt should be a valid ISO date",
      );

      // Expiry should be in the future (365 days from now, within a generous window)
      const now = Date.now();
      assert.ok(
        expiresMs > now,
        "expiresAt should be in the future",
      );

      // Expiry should be approximately 365 days from now (allow 1 hour tolerance)
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      const diff = expiresMs - now;
      assert.ok(
        diff > yearMs - 3600_000,
        `expiresAt should be ~365 days in the future (got ${diff}ms)`,
      );
    });
  });

  describe("buildLineage", () => {
    it("returns ordered lineage with proposal, decision, plan, report", () => {
      const input = makeInput();
      const lineage = buildLineage(input);

      assert.equal(lineage.length, 4);
      assert.equal(lineage[0].step, "evolution_proposal");
      assert.equal(lineage[0].sourceId, input.proposal.evolutionId);
      assert.equal(lineage[0].sourceType, "proposal");

      assert.equal(lineage[1].step, "governance_decision");
      assert.equal(lineage[1].sourceId, input.decision.decisionId);
      assert.equal(lineage[1].sourceType, "proposal");

      assert.equal(lineage[2].step, "execution_plan");
      assert.equal(lineage[2].sourceId, input.executionPlan.planId);
      assert.equal(lineage[2].sourceType, "run");

      assert.equal(lineage[3].step, "execution_report");
      assert.equal(lineage[3].sourceId, input.executionReport.reportId);
      assert.equal(lineage[3].sourceType, "evaluation");
    });

    it("filters out records with empty sourceId", () => {
      const input = makeInput({
        proposal: makeEvolutionProposal(),
        decision: makeGovernanceDecision(),
      });
      // Force a non-empty sourceId on a different field to keep 4 records
      const lineage = buildLineage(input);
      assert.equal(lineage.length, 4, "all sourceIds should be present");

      // Test with empty evolutionId
      const emptyProposal: EvolutionProposal = {
        ...makeEvolutionProposal(),
        evolutionId: "",
      };
      const lineage2 = buildLineage({
        ...input,
        proposal: emptyProposal,
      });
      assert.equal(lineage2.length, 3, "should exclude proposal with empty sourceId");
    });
  });

  describe("computeExecutionEvidenceHash", () => {
    it("produces deterministic hash", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      const hash1 = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );
      const hash2 = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );

      assert.equal(hash1, hash2);
    });

    it("produces 64-character hex string", () => {
      const input = makeInput();
      const evidence = buildExecutionEvidence(input);

      const hash = computeExecutionEvidenceHash(
        evidence as unknown as Omit<EvolutionExecutionEvidence, "integrityHash">,
      );

      assert.equal(hash.length, 64, "SHA-256 should produce 64 hex chars");
      assert.ok(/^[0-9a-f]{64}$/.test(hash), "should be lowercase hex");
    });
  });
});
