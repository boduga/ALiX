/**
 * Tests A4.0 — Execution Contract Types.
 *
 * Covers ExecutionState, ExecutionPlan, ExecutionReport,
 * EvolutionExecutionEvidence, ExecutionAuthorizationResult,
 * EvidenceClass extension, and their validators.
 *
 * @module execution-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_ALL_STATES,
  EXECUTION_TERMINAL_STATES,
  isValidExecutionState,
  isExecutionTerminal,
  validateExecutionPlan,
  validateExecutionReport,
  validateEvolutionExecutionEvidence,
  validateExecutionStep,
  validateRollbackStep,
} from "../../../src/evolution/execution/index.js";
import type {
  ExecutionPlan,
  ExecutionReport,
  EvolutionExecutionEvidence,
  ExecutionAuthorizationResult,
} from "../../../src/evolution/execution/index.js";
import { VALID_EVIDENCE_CLASSES } from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// ExecutionState
// ---------------------------------------------------------------------------

describe("ExecutionState", () => {
  it("has 8 valid states", () => {
    assert.strictEqual(EXECUTION_ALL_STATES.length, 8);
    assert.ok(EXECUTION_ALL_STATES.includes("pending"));
    assert.ok(EXECUTION_ALL_STATES.includes("planning"));
    assert.ok(EXECUTION_ALL_STATES.includes("approved"));
    assert.ok(EXECUTION_ALL_STATES.includes("executing"));
    assert.ok(EXECUTION_ALL_STATES.includes("completed"));
    assert.ok(EXECUTION_ALL_STATES.includes("failed"));
    assert.ok(EXECUTION_ALL_STATES.includes("rolling_back"));
    assert.ok(EXECUTION_ALL_STATES.includes("rolled_back"));
  });

  it("has 3 terminal states", () => {
    assert.strictEqual(EXECUTION_TERMINAL_STATES.length, 3);
    assert.ok(EXECUTION_TERMINAL_STATES.includes("completed"));
    assert.ok(EXECUTION_TERMINAL_STATES.includes("failed"));
    assert.ok(EXECUTION_TERMINAL_STATES.includes("rolled_back"));
  });

  it("isValidExecutionState validates correctly", () => {
    assert.ok(isValidExecutionState("pending"));
    assert.ok(isValidExecutionState("completed"));
    assert.ok(isValidExecutionState("rolling_back"));
    assert.ok(!isValidExecutionState("unknown_state"));
    assert.ok(!isValidExecutionState(""));
    assert.ok(!isValidExecutionState("done"));
  });

  it("isExecutionTerminal identifies terminal states", () => {
    assert.ok(isExecutionTerminal("completed"));
    assert.ok(isExecutionTerminal("failed"));
    assert.ok(isExecutionTerminal("rolled_back"));
    assert.ok(!isExecutionTerminal("pending"));
    assert.ok(!isExecutionTerminal("planning"));
    assert.ok(!isExecutionTerminal("approved"));
    assert.ok(!isExecutionTerminal("executing"));
    assert.ok(!isExecutionTerminal("rolling_back"));
  });
});

// ---------------------------------------------------------------------------
// validateExecutionStep
// ---------------------------------------------------------------------------

describe("validateExecutionStep", () => {
  it("accepts a valid step", () => {
    const result = validateExecutionStep({
      stepId: "step-001",
      operation: "apply_change",
      parameters: { file: "src/main.ts" },
      idempotent: true,
      preconditions: { fileExists: true },
      postconditions: { fileModified: true },
    });
    assert.ok(result.valid);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects a non-object", () => {
    const result = validateExecutionStep("not-an-object");
    assert.ok(!result.valid);
    assert.ok(result.errors.length > 0);
  });

  it("rejects a step without stepId", () => {
    const result = validateExecutionStep({
      operation: "apply_change",
      idempotent: true,
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("stepId")));
  });

  it("rejects a step without operation", () => {
    const result = validateExecutionStep({
      stepId: "step-001",
      idempotent: true,
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("operation")));
  });

  it("rejects a step with non-boolean idempotent", () => {
    const result = validateExecutionStep({
      stepId: "step-001",
      operation: "apply_change",
      idempotent: "yes",
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("idempotent")));
  });
});

// ---------------------------------------------------------------------------
// validateRollbackStep
// ---------------------------------------------------------------------------

describe("validateRollbackStep", () => {
  it("accepts a valid rollback step", () => {
    const result = validateRollbackStep({
      stepId: "rb-001",
      forwardStepId: "step-001",
      operation: "revert_change",
      parameters: { file: "src/main.ts" },
      rollbackType: "automatic",
      safe: true,
    });
    assert.ok(result.valid);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects invalid rollbackType", () => {
    const result = validateRollbackStep({
      stepId: "rb-001",
      forwardStepId: "step-001",
      operation: "revert_change",
      parameters: {},
      rollbackType: "unknown",
      safe: true,
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("rollbackType")));
  });

  it("accepts manual and impossible rollback types", () => {
    const manual = validateRollbackStep({
      stepId: "rb-001",
      forwardStepId: "step-001",
      operation: "revert_change",
      parameters: {},
      rollbackType: "manual",
      safe: false,
    });
    assert.ok(manual.valid);

    const impossible = validateRollbackStep({
      stepId: "rb-001",
      forwardStepId: "step-001",
      operation: "revert_change",
      parameters: {},
      rollbackType: "impossible",
      safe: false,
    });
    assert.ok(impossible.valid);
  });
});

// ---------------------------------------------------------------------------
// validateExecutionPlan
// ---------------------------------------------------------------------------

describe("validateExecutionPlan", () => {
  it("accepts a valid plan", () => {
    const plan: ExecutionPlan = {
      planId: "plan-001",
      proposalId: "prop-001",
      proposalHash: "abc123",
      decisionId: "dec-001",
      decisionHash: "def456",
      environmentHash: "env-hash-001",
      steps: [],
      rollbackPlan: [],
      integrityHash: "int-hash-001",
    };
    const result = validateExecutionPlan(plan);
    assert.ok(result.valid);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects a non-object", () => {
    const result = validateExecutionPlan(null);
    assert.ok(!result.valid);
    assert.ok(result.errors.length > 0);
  });

  it("rejects a plan without required fields", () => {
    const result = validateExecutionPlan({});
    assert.ok(!result.valid);
    assert.ok(result.errors.length >= 7); // planId, proposalId, proposalHash, decisionId, decisionHash, environmentHash, integrityHash
  });

  it("rejects a plan with missing steps array", () => {
    const result = validateExecutionPlan({
      planId: "plan-001",
      proposalId: "prop-001",
      proposalHash: "abc",
      decisionId: "dec-001",
      decisionHash: "def",
      environmentHash: "env",
      integrityHash: "int",
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("steps")));
  });

  it("rejects a plan with missing rollbackPlan array", () => {
    const result = validateExecutionPlan({
      planId: "plan-001",
      proposalId: "prop-001",
      proposalHash: "abc",
      decisionId: "dec-001",
      decisionHash: "def",
      environmentHash: "env",
      steps: [],
      integrityHash: "int",
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("rollbackPlan")));
  });
});

// ---------------------------------------------------------------------------
// validateExecutionReport
// ---------------------------------------------------------------------------

describe("validateExecutionReport", () => {
  it("accepts a valid completed report", () => {
    const report: ExecutionReport = {
      reportId: "rpt-001",
      planId: "plan-001",
      executionId: "exec-001",
      status: "completed",
      stepResults: [],
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T01:00:00Z",
      rollbackTriggered: false,
    };
    const result = validateExecutionReport(report);
    assert.ok(result.valid);
    assert.strictEqual(result.errors.length, 0);
  });

  it("accepts a valid failed report with rollback", () => {
    const report: ExecutionReport = {
      reportId: "rpt-002",
      planId: "plan-001",
      executionId: "exec-001",
      status: "rolled_back",
      stepResults: [],
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T01:00:00Z",
      rollbackTriggered: true,
      rollbackResult: {
        success: true,
        stepResults: [],
        startedAt: "2026-01-01T00:30:00Z",
        completedAt: "2026-01-01T01:00:00Z",
      },
    };
    const result = validateExecutionReport(report);
    assert.ok(result.valid);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects a non-object", () => {
    const result = validateExecutionReport(undefined);
    assert.ok(!result.valid);
    assert.ok(result.errors.length > 0);
  });

  it("rejects an invalid status", () => {
    const result = validateExecutionReport({
      reportId: "rpt-001",
      planId: "plan-001",
      executionId: "exec-001",
      status: "unknown",
      stepResults: [],
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T01:00:00Z",
      rollbackTriggered: false,
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("rejects a report without rollbackTriggered", () => {
    const result = validateExecutionReport({
      reportId: "rpt-001",
      planId: "plan-001",
      executionId: "exec-001",
      status: "completed",
      stepResults: [],
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T01:00:00Z",
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("rollbackTriggered")));
  });
});

// ---------------------------------------------------------------------------
// validateEvolutionExecutionEvidence
// ---------------------------------------------------------------------------

describe("validateEvolutionExecutionEvidence", () => {
  it("accepts valid evidence", () => {
    const evidence: EvolutionExecutionEvidence = {
      evidenceId: "ev-ev-001",
      evidenceClass: "executed",
      proposalId: "prop-001",
      decisionId: "dec-001",
      executionPlan: {
        planId: "plan-001",
        proposalId: "prop-001",
        proposalHash: "abc",
        decisionId: "dec-001",
        decisionHash: "def",
        environmentHash: "env",
        steps: [],
        rollbackPlan: [],
        integrityHash: "int",
      },
      executionReport: {
        reportId: "rpt-001",
        planId: "plan-001",
        executionId: "exec-001",
        status: "completed",
        stepResults: [],
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T01:00:00Z",
        rollbackTriggered: false,
      },
      environment: {
        environmentId: "env-001",
        environmentHash: "env-hash-001",
        runtimeVersion: "1.0.0",
        agentConfiguration: { model: "claude-opus" },
        baselineMetrics: { accuracy: 0.95 },
        capabilityFingerprint: "cap-fp-001",
      },
      lineage: [],
      integrityHash: "int-hash-evidence",
      expiresAt: "2027-01-01T00:00:00Z",
    };
    const result = validateEvolutionExecutionEvidence(evidence);
    assert.ok(result.valid);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects evidence without 'executed' class", () => {
    const result = validateEvolutionExecutionEvidence({
      evidenceId: "ev-ev-001",
      evidenceClass: "projected",
      proposalId: "prop-001",
      decisionId: "dec-001",
      executionPlan: {},
      executionReport: {},
      environment: {},
      lineage: [],
      integrityHash: "int",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("evidenceClass")));
  });

  it("rejects missing required fields", () => {
    const result = validateEvolutionExecutionEvidence({});
    assert.ok(!result.valid);
    assert.ok(result.errors.length > 0);
  });
});

// ---------------------------------------------------------------------------
// ExecutionAuthorizationResult
// ---------------------------------------------------------------------------

describe("ExecutionAuthorizationResult", () => {
  it("allows allowed result with decisionId", () => {
    const result: ExecutionAuthorizationResult = { allowed: true, decisionId: "dec-001" };
    assert.ok(result.allowed);
    assert.strictEqual(result.decisionId, "dec-001");
  });

  it("allows disallowed result with reason", () => {
    const result: ExecutionAuthorizationResult = { allowed: false, reason: "Not approved" };
    assert.ok(!result.allowed);
    assert.strictEqual(result.reason, "Not approved");
  });

  it("prevents accessing decisionId on disallowed result (type check)", () => {
    const result: ExecutionAuthorizationResult = { allowed: false, reason: "Denied" };
    if (result.allowed) {
      // TypeScript narrows to allowed variant
      assert.fail("Should not reach here");
    } else {
      assert.strictEqual(result.reason, "Denied");
    }
  });

  it("prevents accessing reason on allowed result (type check)", () => {
    const result: ExecutionAuthorizationResult = { allowed: true, decisionId: "dec-002" };
    if (!result.allowed) {
      // TypeScript narrows to disallowed variant
      assert.fail("Should not reach here");
    } else {
      assert.strictEqual(result.decisionId, "dec-002");
    }
  });
});

// ---------------------------------------------------------------------------
// EvidenceClass Extension
// ---------------------------------------------------------------------------

describe("EvidenceClass extension", () => {
  it("includes 'executed' in VALID_EVIDENCE_CLASSES", () => {
    assert.ok(VALID_EVIDENCE_CLASSES.includes("executed"));
  });

  it("has 4 evidence classes after extension", () => {
    assert.strictEqual(VALID_EVIDENCE_CLASSES.length, 4);
    assert.ok(VALID_EVIDENCE_CLASSES.includes("observed"));
    assert.ok(VALID_EVIDENCE_CLASSES.includes("derived"));
    assert.ok(VALID_EVIDENCE_CLASSES.includes("projected"));
    assert.ok(VALID_EVIDENCE_CLASSES.includes("executed"));
  });
});
