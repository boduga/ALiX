// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A4.1 — Execution Planner.
 *
 * Deterministic execution plan generation from a proposal, governance
 * decision, and environment. Pure functions — no side effects, no I/O,
 * no store access.
 *
 * @module execution-planner
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { EvolutionProposal } from "../contracts/evolution-contract.js";
import type { GovernanceDecision } from "../governance/contracts/decision-contract.js";
import type {
  ExecutionPlan,
  ExecutionStep,
  RollbackStep,
  ExecutionEnvironment,
} from "./contracts/execution-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Domain prefix for execution plan identifiers.
 * Prepended to canonical content before hashing.
 */
const PLAN_PREFIX = "alix-evolution-execution-v1:";

// ---------------------------------------------------------------------------
// PlannerConfig
// ---------------------------------------------------------------------------

export interface PlannerConfig {
  /** Maximum number of steps allowed in a plan. */
  maxSteps: number;
}

/**
 * Default planner configuration: max 50 steps.
 */
export const DEFAULT_PLANNER_CONFIG: PlannerConfig = { maxSteps: 50 };

// ---------------------------------------------------------------------------
// RollbackResolver
// ---------------------------------------------------------------------------

/**
 * Abstract resolver that maps an ExecutionStep to its RollbackStep.
 *
 * Purity depends on the implementation — callers must provide a pure
 * resolver to keep the planner itself pure.
 */
export interface RollbackResolver {
  /** Produce the rollback step that reverses the given forward step. */
  createRollback(step: ExecutionStep): RollbackStep;
}

// ---------------------------------------------------------------------------
// DefaultRollbackResolver
// ---------------------------------------------------------------------------

/**
 * Default rollback resolver with built-in support for known operations.
 *
 * Supported operations (with specific rollback logic):
 *   - `upgrade_agent_runtime`: downgrade to the version from step parameters
 *   - `update_configuration`: restore configuration from step parameters
 *
 * Unknown operations fall back to a `manual_recovery:<operation>` step
 * with `rollbackType: "manual"` and `safe: false`.
 */
export class DefaultRollbackResolver implements RollbackResolver {
  private readonly rollbackMap: Map<string, (step: ExecutionStep) => RollbackStep>;

  constructor() {
    this.rollbackMap = new Map();
  }

  /**
   * Register a custom rollback resolver for an operation kind.
   */
  registerOperation(
    operation: string,
    resolver: (step: ExecutionStep) => RollbackStep,
  ): void {
    this.rollbackMap.set(operation, resolver);
  }

  /**
   * Create a rollback step for the given forward step.
   * Uses a registered resolver if available; otherwise falls back to manual.
   */
  createRollback(step: ExecutionStep): RollbackStep {
    const resolver = this.rollbackMap.get(step.operation);
    if (resolver) {
      return resolver(step);
    }
    return {
      stepId: `rb-${step.stepId}`,
      forwardStepId: step.stepId,
      operation: `manual_recovery:${step.operation}`,
      parameters: { ...step.parameters },
      rollbackType: "manual" as const,
      safe: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in rollback resolvers for known operations
// ---------------------------------------------------------------------------

/**
 * Rollback resolver for `upgrade_agent_runtime`: downgrades to the previous
 * runtime version recorded in step parameters.
 */
function rollbackUpgradeAgentRuntime(step: ExecutionStep): RollbackStep {
  const previousVersion = (step.parameters as Record<string, string>).previousVersion ?? "unknown";
  return {
    stepId: `rb-${step.stepId}`,
    forwardStepId: step.stepId,
    operation: "downgrade_agent_runtime",
    parameters: { targetVersion: previousVersion, reason: "rollback" },
    rollbackType: "automatic" as const,
    safe: true,
  };
}

/**
 * Rollback resolver for `update_configuration`: restores the previous
 * configuration values recorded in step parameters.
 */
function rollbackUpdateConfiguration(step: ExecutionStep): RollbackStep {
  const previousConfig = (step.parameters as Record<string, unknown>).previousConfiguration ?? {};
  return {
    stepId: `rb-${step.stepId}`,
    forwardStepId: step.stepId,
    operation: "restore_configuration",
    parameters: { configuration: previousConfig, reason: "rollback" },
    rollbackType: "automatic" as const,
    safe: true,
  };
}

// ---------------------------------------------------------------------------
// Built-in default resolver with pre-registered operations
// ---------------------------------------------------------------------------

/**
 * Pre-configured DefaultRollbackResolver with built-in knowledge of known
 * evolution operations.
 *
 * Registered:
 *   - `upgrade_agent_runtime` → automatic downgrade
 *   - `update_configuration` → automatic restore
 */
export function createDefaultRollbackResolver(): DefaultRollbackResolver {
  const resolver = new DefaultRollbackResolver();
  resolver.registerOperation("upgrade_agent_runtime", rollbackUpgradeAgentRuntime);
  resolver.registerOperation("update_configuration", rollbackUpdateConfiguration);
  return resolver;
}

// ---------------------------------------------------------------------------
// createPlanId
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic execution plan identifier.
 *
 * Computes SHA-256 of the canonical JSON representation of the combined
 * plan inputs (proposal, decision, environment), prefixed by the plan
 * domain tag.
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * @param proposal - The evolution proposal being planned.
 * @param decision - The governance decision authorizing execution.
 * @param environment - The target execution environment.
 * @returns Hex-encoded SHA-256 digest (64 characters).
 */
export function createPlanId(
  proposal: EvolutionProposal,
  decision: GovernanceDecision,
  environment: ExecutionEnvironment,
): string {
  const canonical = canonicalStringify({ proposal, decision, environment });
  const hash = createHash("sha256");
  hash.update(PLAN_PREFIX);
  hash.update(canonical, "utf8");
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// resolveSteps — extract steps from a proposal
// ---------------------------------------------------------------------------

/**
 * Resolve an ordered list of ExecutionSteps from an EvolutionProposal.
 *
 * If the proposal carries a `changes` array, each change is mapped to a
 * step. Otherwise a single fallback step is created from the proposal
 * description.
 *
 * Pure — no side effects, no I/O, no store access.
 */
function resolveSteps(proposal: EvolutionProposal): ExecutionStep[] {
  // Check if proposal has a 'changes' array
  if ("changes" in proposal && Array.isArray((proposal as Record<string, unknown>).changes)) {
    const changes = (proposal as Record<string, unknown>).changes as Record<string, unknown>[];
    return changes.map((c: Record<string, unknown>, i: number) => ({
      stepId: `step-${i + 1}`,
      operation: (c.operation as string) ?? "unknown",
      parameters: (c.parameters as Record<string, unknown>) ?? {},
      idempotent: (c.idempotent as boolean) ?? false,
      preconditions: (c.preconditions as Record<string, unknown>) ?? {},
      postconditions: (c.postconditions as Record<string, unknown>) ?? {},
    }));
  }

  // Fallback: single step from proposal description
  return [
    {
      stepId: "step-1",
      operation: "apply_proposal",
      parameters: { description: proposal.description ?? proposal.evolutionId },
      idempotent: false,
      preconditions: {},
      postconditions: {},
    },
  ];
}

// ---------------------------------------------------------------------------
// computeIntegrityHash
// ---------------------------------------------------------------------------

/**
 * Compute the integrity hash of a fully constructed plan.
 *
 * Hashes `PLAN_PREFIX + canonicalStringify(plan)` using SHA-256.
 *
 * Pure — no side effects, no I/O, no store access.
 */
function computeIntegrityHash(
  planId: string,
  proposalId: string,
  proposalHash: string,
  decisionId: string,
  decisionHash: string,
  environmentHash: string,
  steps: readonly ExecutionStep[],
  rollbackPlan: readonly RollbackStep[],
): string {
  const payload = canonicalStringify({
    planId,
    proposalId,
    proposalHash,
    decisionId,
    decisionHash,
    environmentHash,
    steps,
    rollbackPlan,
  });
  const hash = createHash("sha256");
  hash.update(PLAN_PREFIX);
  hash.update(payload, "utf8");
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// createExecutionPlan
// ---------------------------------------------------------------------------

/**
 * Create a deterministic execution plan from a proposal, governance
 * decision, and execution environment.
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * @param proposal - The evolution proposal being planned.
 * @param decision - The governance decision authorizing execution.
 * @param environment - The target execution environment.
 * @param resolver - RollbackResolver used to generate rollback steps.
 * @param config - Optional planner configuration (defaults used if omitted).
 * @returns A fully populated ExecutionPlan.
 * @throws {Error} if plan validation fails.
 */
export function createExecutionPlan(
  proposal: EvolutionProposal,
  decision: GovernanceDecision,
  environment: ExecutionEnvironment,
  resolver: RollbackResolver,
  config: PlannerConfig = DEFAULT_PLANNER_CONFIG,
): ExecutionPlan {
  // 1. Resolve steps from proposal
  const steps = resolveSteps(proposal);

  // 2. Generate rollback for each step (reverse order — last forward step first)
  const rollbackPlan = [...steps]
    .reverse()
    .map((step) => resolver.createRollback(step));

  // 3. Compute hashes — SHA-256 of canonical JSON
  const proposalHash = createHash("sha256")
    .update(canonicalStringify(proposal))
    .digest("hex");
  const decisionHash = createHash("sha256")
    .update(canonicalStringify(decision))
    .digest("hex");

  // 4. Compute plan ID
  const planId = createPlanId(proposal, decision, environment);

  // 5. Compute integrity hash
  const integrityHash = computeIntegrityHash(
    planId,
    proposal.proposalId,
    proposalHash,
    decision.decisionId,
    decisionHash,
    environment.environmentHash,
    steps,
    rollbackPlan,
  );

  // 6. Construct plan
  const plan: ExecutionPlan = {
    planId,
    proposalId: proposal.proposalId,
    proposalHash,
    decisionId: decision.decisionId,
    decisionHash,
    environmentHash: environment.environmentHash,
    steps,
    rollbackPlan,
    integrityHash,
  };

  // 7. Validate plan constraints
  const errors = validatePlanConstraints(plan, config);
  if (errors.length > 0) {
    throw new Error(`Execution plan validation failed: ${errors.join("; ")}`);
  }

  return plan;
}

// ---------------------------------------------------------------------------
// validatePlanConstraints
// ---------------------------------------------------------------------------

/**
 * Validate plan constraints, returning a list of error messages.
 *
 * Checks:
 *   - Plan must have at least one step.
 *   - Step count must not exceed maxSteps.
 *   - Each forward step must have a corresponding rollback step (by count).
 *   - planId must use the correct prefix (for the integrity hash check).
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * @param plan - The execution plan to validate.
 * @param config - Planner configuration with maxSteps limit.
 * @returns Array of error message strings (empty if valid).
 */
export function validatePlanConstraints(
  plan: ExecutionPlan,
  config: PlannerConfig = DEFAULT_PLANNER_CONFIG,
): string[] {
  const errors: string[] = [];

  // Must have at least one step
  if (plan.steps.length === 0) {
    errors.push("Plan must have at least one step");
  }

  // Must not exceed maxSteps
  if (plan.steps.length > config.maxSteps) {
    errors.push(`Plan exceeds maximum step count of ${config.maxSteps} (has ${plan.steps.length})`);
  }

  // Each forward step must have a corresponding rollback step
  if (plan.steps.length !== plan.rollbackPlan.length) {
    errors.push(
      `Rollback plan length (${plan.rollbackPlan.length}) does not match step count (${plan.steps.length})`,
    );
  }

  // Verify integrity hash is valid (re-compute and compare)
  const expectedIntegrity = computeIntegrityHash(
    plan.planId,
    plan.proposalId,
    plan.proposalHash,
    plan.decisionId,
    plan.decisionHash,
    plan.environmentHash,
    plan.steps,
    plan.rollbackPlan,
  );
  if (plan.integrityHash !== expectedIntegrity) {
    errors.push("Integrity hash mismatch — plan has been tampered with");
  }

  return errors;
}
