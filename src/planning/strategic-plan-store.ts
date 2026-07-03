// src/planning/strategic-plan-store.ts
//
// P11.3 — Append-only JSONL persistence store for StrategicPlan objects.
//
// Provides save/load/list operations with on-read validation as the primary
// defense against corrupted JSONL data. Writes are validated before flush.

import { Either } from "effect";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  StrategicPlan,
  PlanStatus,
  EffortEstimate,
  StrategicImpact,
  PlanningObjective,
  StrategicPlanSummary,
} from "./planning-types.js";
import { PlanningEngineError } from "./planning-types.js";
import { decode, formatErrors } from "../contracts/helpers.js";
import { StrategicPlanSchema } from "../contracts/plan-schemas.js";
import { buildDiagnostic, formatDiagnostic, type ContractDiagnostic } from "../contracts/contract-diagnostics.js";

// Re-export for consumer convenience.
export type { StrategicPlanSummary };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRATEGIC_PLANS_FILE = "strategic-plans.jsonl";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class StrategicPlanStore {
  constructor(
    private readonly dir: string,
    private readonly onDiagnostic?: (diag: ContractDiagnostic) => void,
  ) {}


  /**
   * Persist a validated plan to the JSONL store.
   * Validates before writing to catch programmer errors early.
   * Creates the storage directory if it does not exist.
   */
  async save(plan: StrategicPlan): Promise<void> {
    try {
      validatePlan(plan);
    } catch (e: unknown) {
      if (e instanceof PlanningEngineError && this.onDiagnostic) {
        this.onDiagnostic(
          buildDiagnostic("planning", "plan.save", "StrategicPlanSchema", e.message, plan.planId),
        );
      }
      throw e;
    }

    const filePath = join(this.dir, STRATEGIC_PLANS_FILE);
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    appendFileSync(filePath, JSON.stringify(plan) + "\n", "utf-8");
  }

  /**
   * Load the most recently written plan from the store.
   * Returns null when the file does not exist, is empty, or the last
   * line fails validation.
   */
  async loadLatest(): Promise<StrategicPlan | null> {
    const filePath = join(this.dir, STRATEGIC_PLANS_FILE);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const lines = content
      .split("\n")
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) return null;

    try {
      const parsed = JSON.parse(lines[lines.length - 1]);
      return validatePlan(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Find the first plan whose planId matches the given id.
   * Silently skips blank and malformed lines.  Returns null when no
   * match exists.
   */
  async loadById(id: string): Promise<StrategicPlan | null> {
    const filePath = join(this.dir, STRATEGIC_PLANS_FILE);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && parsed.planId === id) {
          return validatePlan(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return null;
  }

  /**
   * Return metadata summaries for every plan in the store, in write
   * order.  Returns an empty array when the file does not exist or
   * contains no valid entries.  Malformed lines are silently skipped.
   */
  async list(): Promise<StrategicPlanSummary[]> {
    const filePath = join(this.dir, STRATEGIC_PLANS_FILE);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const summaries: StrategicPlanSummary[] = [];

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        const plan = validatePlan(parsed);
        summaries.push({
          planId: plan.planId,
          generatedAt: plan.generatedAt,
          status: plan.status,
          objectives: plan.objectives.length,
          objectivesHigh: plan.meta.objectivesHigh,
          objectivesMedium: plan.meta.objectivesMedium,
          objectivesLow: plan.meta.objectivesLow,
        });
      } catch {
        // Skip malformed or invalid lines
      }
    }

    return summaries;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value as a well-formed StrategicPlan.
 *
 * Throws PlanningEngineError with a descriptive message on every
 * violation (fail-closed).  Used on both reads (defence against
 * corrupted JSONL) and writes (defence against programmer error).
 */
export function validatePlan(raw: unknown): StrategicPlan {
  if (raw === null || typeof raw !== "object") {
    throw new PlanningEngineError(
      "StrategicPlan must be a non-null object",
    );
  }

  const obj = raw as Record<string, unknown>;

  // -- Plan-level fields ------------------------------------------------

  if (obj.schemaVersion !== "p11.3.0") {
    throw new PlanningEngineError(
      `Invalid schemaVersion: expected "p11.3.0", got ${JSON.stringify(obj.schemaVersion)}`,
    );
  }

  if (typeof obj.rootCauseAnalysisId !== "string" || obj.rootCauseAnalysisId.length === 0) {
    throw new PlanningEngineError(
      "rootCauseAnalysisId must be a non-empty string",
    );
  }

  if (typeof obj.correlationGraphId !== "string" || obj.correlationGraphId.length === 0) {
    throw new PlanningEngineError(
      "correlationGraphId must be a non-empty string",
    );
  }

  if (typeof obj.planId !== "string" || obj.planId.length === 0) {
    throw new PlanningEngineError("planId must be a non-empty string");
  }

  if (typeof obj.generatedAt !== "string" || obj.generatedAt.length === 0) {
    throw new PlanningEngineError("generatedAt must be a non-empty string");
  }

  const validStatuses: PlanStatus[] = [
    "ok",
    "insufficient_analysis",
    "no_degradation",
    "no_objectives",
  ];
  if (!validStatuses.includes(obj.status as PlanStatus)) {
    throw new PlanningEngineError(
      `Invalid status: expected one of ${validStatuses.join(", ")}, got ${JSON.stringify(obj.status)}`,
    );
  }

  // -- Objectives array ------------------------------------------------

  if (!Array.isArray(obj.objectives)) {
    throw new PlanningEngineError("objectives must be an array");
  }

  // Pre-scan objective IDs for prerequisite validation.
  const objectiveIds = new Set<string>();
  for (const objective of obj.objectives) {
    if (objective && typeof objective === "object") {
      const id = (objective as Record<string, unknown>).id;
      if (typeof id === "string") {
        objectiveIds.add(id);
      }
    }
  }

  // -- Per-objective validation ----------------------------------------

  for (let i = 0; i < obj.objectives.length; i++) {
    const o = obj.objectives[i];

    if (!o || typeof o !== "object") {
      throw new PlanningEngineError(
        `objectives[${i}] must be a non-null object`,
      );
    }

    const objective = o as Record<string, unknown>;

    if (typeof objective.targetSubsystem !== "string" || objective.targetSubsystem.length === 0) {
      throw new PlanningEngineError(
        `objectives[${i}].targetSubsystem must be a non-empty string`,
      );
    }

    if (
      !Number.isInteger(objective.urgencyScore) ||
      (objective.urgencyScore as number) < 0 ||
      (objective.urgencyScore as number) > 100
    ) {
      throw new PlanningEngineError(
        `objectives[${i}].urgencyScore must be an integer between 0 and 100`,
      );
    }

    if (objective.confidence !== null && objective.confidence !== undefined) {
      if (
        typeof objective.confidence !== "number" ||
        (objective.confidence as number) < 0 ||
        (objective.confidence as number) > 1
      ) {
        throw new PlanningEngineError(
          `objectives[${i}].confidence must be null or a number between 0 and 1`,
        );
      }
    }

    const validEfforts: EffortEstimate[] = ["low", "medium", "high"];
    if (!validEfforts.includes(objective.estimatedEffort as EffortEstimate)) {
      throw new PlanningEngineError(
        `objectives[${i}].estimatedEffort must be one of "low", "medium", or "high"`,
      );
    }

    const validImpacts: StrategicImpact[] = ["direct", "indirect", "compound"];
    if (!validImpacts.includes(objective.expectedImpact as StrategicImpact)) {
      throw new PlanningEngineError(
        `objectives[${i}].expectedImpact must be one of "direct", "indirect", or "compound"`,
      );
    }

    if (!Array.isArray(objective.prerequisites)) {
      throw new PlanningEngineError(
        `objectives[${i}].prerequisites must be an array`,
      );
    }

    for (const prereq of objective.prerequisites) {
      if (prereq === objective.id) {
        throw new PlanningEngineError(
          `objectives[${i}] cannot list itself as a prerequisite`,
        );
      }
      if (!objectiveIds.has(prereq)) {
        throw new PlanningEngineError(
          `objectives[${i}] references prerequisite "${prereq}" which does not exist in this plan`,
        );
      }
    }
  }

  // -- Effect Schema validation (additional layer on top of manual checks) -
  // Catches shape mismatches the manual checks might miss (e.g. invalid
  // CorrelationSubsystemId literal, CausalMechanism literal, nested struct).
  const schemaResult = decode(StrategicPlanSchema, obj);
  if (Either.isLeft(schemaResult)) {
    const formatted = formatErrors(schemaResult.left);
    throw new PlanningEngineError(
      `StrategicPlan schema validation failed: ${formatted}`,
    );
  }

  return obj as unknown as StrategicPlan;
}
