// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A4.0 — Execution Contract Types.
 *
 * Core artifact types for A4 Governed Evolution Execution. Defines
 * execution request, plan, context, checkpoint, report, rollback,
 * and evidence types used across all A4 components.
 *
 * @module execution-contract
 */

import type { LineageRecord } from "../../verification/contracts/verification-contract.js";
import type { ValidationResult } from "../../contracts/evolution-contract.js";
import type { ExecutionState } from "./execution-lifecycle.js";

// ---------------------------------------------------------------------------
// Execution Request
// ---------------------------------------------------------------------------

/**
 * Separates operator request from governance approval.
 */
export interface ExecutionRequest {
  /** Unique request identifier. */
  requestId: string;
  /** Reference to the evolution being requested for execution. */
  evolutionId: string;
  /** Who requested the execution. */
  requestedBy: string;
  /** When the request was made. */
  requestedAt: string;
  /** Optional reason for the execution request. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Execution Environment
// ---------------------------------------------------------------------------

/**
 * Captures the environment snapshot for an execution.
 */
export interface ExecutionEnvironment {
  /** Unique environment identifier. */
  environmentId: string;
  /** Hash of the environment configuration. */
  environmentHash: string;
  /** Runtime version used during execution. */
  runtimeVersion: string;
  /** Agent configuration key-value pairs. */
  agentConfiguration: Record<string, string>;
  /** Baseline metrics measured before execution. */
  baselineMetrics: Record<string, number>;
  /** Fingerprint of capabilities available in the environment. */
  capabilityFingerprint: string;
}

// ---------------------------------------------------------------------------
// Execution Step
// ---------------------------------------------------------------------------

/**
 * A single step within an execution plan.
 */
export interface ExecutionStep {
  /** Unique step identifier. */
  stepId: string;
  /** Operation to perform. */
  operation: string;
  /** Parameters for the operation. */
  parameters: Record<string, unknown>;
  /** Whether the operation is idempotent. */
  idempotent: boolean;
  /** Preconditions that must hold before execution. */
  preconditions: Record<string, unknown>;
  /** Postconditions that must hold after execution. */
  postconditions: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Rollback Step
// ---------------------------------------------------------------------------

/**
 * A rollback step that reverses a forward execution step.
 */
export interface RollbackStep {
  /** Unique step identifier. */
  stepId: string;
  /** Reference to the forward step being rolled back. */
  forwardStepId: string;
  /** Operation to perform for rollback. */
  operation: string;
  /** Parameters for the rollback operation. */
  parameters: Record<string, unknown>;
  /** How the rollback is performed. */
  rollbackType: "automatic" | "manual" | "impossible";
  /** Whether the rollback is safe to execute. */
  safe: boolean;
}

// ---------------------------------------------------------------------------
// Execution Plan
// ---------------------------------------------------------------------------

/**
 * An execution plan linking a governance decision to executable steps.
 */
export interface ExecutionPlan {
  /** Unique plan identifier. */
  planId: string;
  /** Reference to the originating proposal. */
  proposalId: string;
  /** Hash of the proposal at planning time. */
  proposalHash: string;
  /** Reference to the governance decision authorizing execution. */
  decisionId: string;
  /** Hash of the decision at planning time. */
  decisionHash: string;
  /** Hash of the target execution environment. */
  environmentHash: string;
  /** Ordered list of execution steps. */
  steps: readonly ExecutionStep[];
  /** Ordered list of rollback steps. */
  rollbackPlan: readonly RollbackStep[];
  /** Integrity hash of the entire plan. */
  integrityHash: string;
}

// ---------------------------------------------------------------------------
// Execution Context
// ---------------------------------------------------------------------------

/**
 * Tracks the current state of an execution.
 */
export interface ExecutionContext {
  /** Unique execution identifier. */
  executionId: string;
  /** Current execution state. */
  state: ExecutionState;
  /** Ordered list of checkpoints recorded during execution. */
  checkpoints: readonly ExecutionCheckpoint[];
  /** Outputs produced during execution. */
  outputs: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Execution Checkpoint
// ---------------------------------------------------------------------------

/**
 * A checkpoint captured at a specific step during execution.
 */
export interface ExecutionCheckpoint {
  /** Step identifier at which the checkpoint was captured. */
  stepId: string;
  /** Hash of inputs at checkpoint time. */
  inputHash: string;
  /** Hash of outputs at checkpoint time. */
  outputHash: string;
  /** Hash of the environment at checkpoint time. */
  environmentHash: string;
  /** When the checkpoint was captured. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Execution Step Result
// ---------------------------------------------------------------------------

/**
 * Result of executing a single step.
 */
export interface ExecutionStepResult {
  /** Step identifier. */
  stepId: string;
  /** Whether the step succeeded. */
  success: boolean;
  /** Output produced by the step. */
  output: Record<string, unknown>;
  /** When the step started. */
  startedAt: string;
  /** When the step completed. */
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Rollback Result
// ---------------------------------------------------------------------------

/**
 * Result of executing a rollback plan.
 */
export interface RollbackResult {
  /** Whether the rollback succeeded. */
  success: boolean;
  /** Results of individual rollback steps. */
  stepResults: readonly ExecutionStepResult[];
  /** When the rollback started. */
  startedAt: string;
  /** When the rollback completed. */
  completedAt: string;
  /** Optional reason if rollback failed or was partial. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Execution Report
// ---------------------------------------------------------------------------

/**
 * Final report for an execution, recording what happened.
 */
export interface ExecutionReport {
  /** Unique report identifier. */
  reportId: string;
  /** Reference to the execution plan. */
  planId: string;
  /** Reference to the execution context. */
  executionId: string;
  /** Final status of the execution. */
  status: "completed" | "failed" | "rolled_back" | "partial";
  /** Ordered results of each step. */
  stepResults: readonly ExecutionStepResult[];
  /** When execution started. */
  startedAt: string;
  /** When execution completed. */
  completedAt: string;
  /** Whether rollback was triggered. */
  rollbackTriggered: boolean;
  /** Result of the rollback, if triggered. */
  rollbackResult?: RollbackResult;
}

// ---------------------------------------------------------------------------
// Evolution Execution Evidence
// ---------------------------------------------------------------------------

/**
 * Immutable evidence artifact for an execution, consumed by governance.
 *
 * @invariant evidenceClass always "executed" for execution-generated evidence.
 */
export interface EvolutionExecutionEvidence {
  /** Unique evidence identifier. */
  evidenceId: string;
  /** Evidence class — always "executed" for execution-generated evidence. */
  evidenceClass: "executed";
  /** Reference to the originating proposal. */
  proposalId: string;
  /** Reference to the governance decision authorizing execution. */
  decisionId: string;
  /** The execution plan that was executed. */
  executionPlan: ExecutionPlan;
  /** The execution report produced. */
  executionReport: ExecutionReport;
  /** The environment in which execution occurred. */
  environment: ExecutionEnvironment;
  /** Ordered chain of provenance lineage records. */
  lineage: readonly LineageRecord[];
  /** Canonical integrity hash of the evidence object. */
  integrityHash: string;
  /** When the evidence expires. */
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Execution Authorization Result
// ---------------------------------------------------------------------------

/**
 * Discriminated union for execution authorization results.
 */
export type ExecutionAuthorizationResult =
  | { allowed: true; decisionId: string }
  | { allowed: false; reason: string };

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!isRecord(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val !== "string") return false;
  }
  return true;
}

function isNumberRecord(v: unknown): v is Record<string, number> {
  if (!isRecord(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val !== "number") return false;
  }
  return true;
}

/**
 * Validate an ExecutionStep structure.
 */
export function validateExecutionStep(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["ExecutionStep must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.stepId)) errors.push("stepId required and must be non-empty");
  if (!isNonEmptyString(v.operation)) errors.push("operation required and must be non-empty");
  if (typeof v.idempotent !== "boolean") errors.push("idempotent must be a boolean");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a RollbackStep structure.
 */
export function validateRollbackStep(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["RollbackStep must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.stepId)) errors.push("stepId required and must be non-empty");
  if (!isNonEmptyString(v.forwardStepId)) errors.push("forwardStepId required and must be non-empty");
  if (!isNonEmptyString(v.operation)) errors.push("operation required and must be non-empty");
  if (typeof v.safe !== "boolean") errors.push("safe must be a boolean");

  const validRollbackTypes = ["automatic", "manual", "impossible"];
  if (!validRollbackTypes.includes(v.rollbackType as string)) {
    errors.push("rollbackType must be one of: automatic, manual, impossible");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an ExecutionPlan structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateExecutionPlan(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["ExecutionPlan must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.planId)) errors.push("planId required and must be non-empty");
  if (!isNonEmptyString(v.proposalId)) errors.push("proposalId required and must be non-empty");
  if (!isNonEmptyString(v.proposalHash)) errors.push("proposalHash required and must be non-empty");
  if (!isNonEmptyString(v.decisionId)) errors.push("decisionId required and must be non-empty");
  if (!isNonEmptyString(v.decisionHash)) errors.push("decisionHash required and must be non-empty");
  if (!isNonEmptyString(v.environmentHash)) errors.push("environmentHash required and must be non-empty");
  if (!isNonEmptyString(v.integrityHash)) errors.push("integrityHash required and must be non-empty");

  if (!Array.isArray(v.steps)) {
    errors.push("steps required and must be an array");
  }

  if (!Array.isArray(v.rollbackPlan)) {
    errors.push("rollbackPlan required and must be an array");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an ExecutionReport structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateExecutionReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["ExecutionReport must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.reportId)) errors.push("reportId required and must be non-empty");
  if (!isNonEmptyString(v.planId)) errors.push("planId required and must be non-empty");
  if (!isNonEmptyString(v.executionId)) errors.push("executionId required and must be non-empty");

  const validStatuses = ["completed", "failed", "rolled_back", "partial"];
  if (!validStatuses.includes(v.status as string)) {
    errors.push("status must be one of: completed, failed, rolled_back, partial");
  }

  if (!Array.isArray(v.stepResults)) {
    errors.push("stepResults required and must be an array");
  }

  if (!isNonEmptyString(v.startedAt)) errors.push("startedAt required and must be non-empty");
  if (!isNonEmptyString(v.completedAt)) errors.push("completedAt required and must be non-empty");
  if (typeof v.rollbackTriggered !== "boolean") errors.push("rollbackTriggered must be a boolean");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionExecutionEvidence structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionExecutionEvidence(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionExecutionEvidence must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.evidenceId)) errors.push("evidenceId required and must be non-empty");
  if (v.evidenceClass !== "executed") errors.push("evidenceClass must be 'executed'");
  if (!isNonEmptyString(v.proposalId)) errors.push("proposalId required and must be non-empty");
  if (!isNonEmptyString(v.decisionId)) errors.push("decisionId required and must be non-empty");
  if (!isNonEmptyString(v.integrityHash)) errors.push("integrityHash required and must be non-empty");
  if (!isNonEmptyString(v.expiresAt)) errors.push("expiresAt required and must be non-empty");

  if (!v.executionPlan || typeof v.executionPlan !== "object") {
    errors.push("executionPlan required and must be an ExecutionPlan object");
  }

  if (!v.executionReport || typeof v.executionReport !== "object") {
    errors.push("executionReport required and must be an ExecutionReport object");
  }

  if (!v.environment || typeof v.environment !== "object") {
    errors.push("environment required and must be an ExecutionEnvironment object");
  }

  if (!Array.isArray(v.lineage)) {
    errors.push("lineage required and must be an array");
  }

  return { valid: errors.length === 0, errors };
}
