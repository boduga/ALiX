/**
 * A1.0 — Pattern Discovery Contract Types.
 *
 * Pure contract types for ALiX Pattern Discovery Engine. Defines pattern
 * observations, evolution candidates, proposal drafts, confidence scoring,
 * and validation rules.
 *
 * This module is contract-only — no stores, no state machine, no CLI.
 * A1.0 imports EvolutionTarget and EvolutionRiskClass from the A0.1
 * contract for target and risk classification.
 *
 * A1 does not create lifecycle evolutions, transition states, or approve
 * proposals. A1 is proposal-only. Discovery results flow to governance
 * intake, which creates A0 EvolutionProposal artifacts.
 *
 * @module pattern-discovery-contract
 */

import type { EvolutionTarget, EvolutionRiskClass } from "./evolution-contract.js";
import { VALID_EVOLUTION_RISK_CLASSES } from "./evolution-contract.js";
import type { ValidationResult } from "./evolution-contract.js";

// ---------------------------------------------------------------------------
// PatternCategory
// ---------------------------------------------------------------------------

export type PatternCategory =
  | "execution_failure"
  | "approval_friction"
  | "performance_degradation"
  | "policy_ineffectiveness"
  | "governance_gap"
  | "agent_misbehavior";

export const VALID_PATTERN_CATEGORIES: readonly PatternCategory[] = [
  "execution_failure",
  "approval_friction",
  "performance_degradation",
  "policy_ineffectiveness",
  "governance_gap",
  "agent_misbehavior",
];

// ---------------------------------------------------------------------------
// PatternObservation
// ---------------------------------------------------------------------------

export interface PatternObservation {
  /** Unique pattern identifier. */
  patternId: string;

  /** Category of the observed pattern. */
  category: PatternCategory;

  /** Number of times this pattern was observed. */
  frequency: number;

  /** Confidence in the pattern (0–1). */
  confidence: number;

  /** Evidence references supporting this pattern. */
  evidenceIds: string[];

  /** Human-readable description of the pattern. */
  description: string;

  /** When the pattern was first observed. */
  firstObserved: string;

  /** When the pattern was last observed. */
  lastObserved: string;
}

// ---------------------------------------------------------------------------
// EvolutionCandidate
// ---------------------------------------------------------------------------

export interface EvolutionCandidate {
  /** Unique candidate identifier. */
  candidateId: string;

  /** Source pattern that generated this candidate. */
  sourcePatternId: string;

  /** Confidence that this evolution would improve outcomes (0–1). */
  confidence: number;

  /** Target of the proposed evolution. */
  target: EvolutionTarget;

  /** Description of the proposed change. */
  description: string;

  /** Expected effect of the change. */
  expectedEffect: string;

  /** Risk assessment. */
  riskClass: EvolutionRiskClass;

  /** Evidence supporting this candidate. */
  evidenceIds: string[];
}

// ---------------------------------------------------------------------------
// EvolutionProposalDraft
// ---------------------------------------------------------------------------

/**
 * Intermediate artifact between intelligence and governance.
 *
 * A draft is NOT an A0 EvolutionProposal lifecycle artifact.
 * Only governance intake may convert a draft into an EvolutionProposal
 * and register it in the A0 evolution state machine at PROPOSED state.
 */
export interface EvolutionProposalDraft {
  /** Unique draft identifier. */
  draftId: string;

  /** Source pattern that generated this draft. */
  sourcePatternId: string;

  /** Short human-readable title. */
  title: string;

  /** Longer description of the proposed change. */
  description: string;

  /** Target of the proposed evolution. */
  target: EvolutionTarget;

  /** Confidence that this evolution would improve outcomes (0–1). */
  confidence: number;

  /** Risk assessment. */
  riskClass: EvolutionRiskClass;

  /** Evidence supporting this draft. */
  evidenceIds: string[];

  /** When the draft was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// DiscoveryResult
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  /** Patterns discovered during this run. */
  patterns: PatternObservation[];

  /** Evolution candidates derived from patterns. */
  candidates: EvolutionCandidate[];

  /** Proposal drafts generated from candidates. */
  drafts: EvolutionProposalDraft[];

  /** Metadata about the discovery run. */
  metadata: {
    /** Number of evidence records scanned. */
    evidenceScanned: number;
    /** Duration of the detection run in milliseconds. */
    detectionDurationMs: number;
    /** Number of detection strategies executed. */
    strategiesRun: number;
  };
}

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  /** Number of supporting evidence records. */
  evidenceCount: number;
  /** Expected baseline count for the metric. */
  baselineCount: number;
  /** How clearly the evidence matches the pattern (0–1). 1.0 = exact match. */
  patternStrength: number;
  /** Recency weight (0–1). Higher = more weight on recent evidence. */
  recencyFactor: number;
}

/**
 * Compute confidence score for a pattern or candidate.
 *
 * Formula:
 *   confidence = min(1, evidenceDensity * patternStrength * recencyFactor)
 *   evidenceDensity = min(1, evidenceCount / baselineCount)
 *
 * Confidence is informational only. Governance determines acceptance.
 *
 * Pure — no side effects, no I/O, no store access.
 */
export function computeConfidence(input: ConfidenceInput): number {
  const { evidenceCount, baselineCount, patternStrength, recencyFactor } = input;

  // Guard against NaN/Infinity in all inputs
  const safeCount = Number.isFinite(evidenceCount) ? Math.max(0, evidenceCount) : 0;
  const safeBaseline = Number.isFinite(baselineCount) ? Math.max(0, baselineCount) : 0;
  const safeStrength = Number.isFinite(patternStrength) ? Math.max(0, Math.min(1, patternStrength)) : 0;
  const safeRecency = Number.isFinite(recencyFactor) ? Math.max(0, Math.min(1, recencyFactor)) : 0;

  // Guard against division by zero when baseline is 0
  const evidenceDensity = safeBaseline > 0
    ? Math.min(1, safeCount / safeBaseline)
    : 0;

  return Math.max(0, Math.min(1, evidenceDensity * safeStrength * safeRecency));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidPatternCategory(v: string): v is PatternCategory {
  return (VALID_PATTERN_CATEGORIES as readonly string[]).includes(v);
}

function isValidRiskClass(v: string): v is EvolutionRiskClass {
  return (VALID_EVOLUTION_RISK_CLASSES as readonly string[]).includes(v);
}

function isInRange(v: number, min: number, max: number): boolean {
  return !Number.isNaN(v) && v >= min && v <= max;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a PatternObservation structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validatePatternObservation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["PatternObservation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.patternId)) errors.push("patternId required and must be non-empty");

  if (!isNonEmptyString(v.category) || !isValidPatternCategory(v.category as string)) {
    errors.push(`category must be one of: ${VALID_PATTERN_CATEGORIES.join(", ")}`);
  }

  if (typeof v.frequency !== "number" || Number.isNaN(v.frequency) || (v.frequency as number) < 0) {
    errors.push("frequency required and must be a non-negative number");
  }

  if (typeof v.confidence !== "number" || !isInRange(v.confidence as number, 0, 1)) {
    errors.push("confidence required and must be between 0 and 1");
  }

  if (!Array.isArray(v.evidenceIds) || (v.evidenceIds as unknown[]).length === 0) {
    errors.push("evidenceIds required and must be a non-empty array");
  }

  if (!isNonEmptyString(v.description)) errors.push("description required and must be non-empty");

  if (!isNonEmptyString(v.firstObserved)) errors.push("firstObserved required and must be non-empty");

  if (!isNonEmptyString(v.lastObserved)) errors.push("lastObserved required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionCandidate structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionCandidate(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionCandidate must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.candidateId)) errors.push("candidateId required and must be non-empty");
  if (!isNonEmptyString(v.sourcePatternId)) errors.push("sourcePatternId required and must be non-empty");

  if (typeof v.confidence !== "number" || !isInRange(v.confidence as number, 0, 1)) {
    errors.push("confidence required and must be between 0 and 1");
  }

  if (!v.target || Array.isArray(v.target) || typeof v.target !== "object") {
    errors.push("target required and must be an EvolutionTarget object");
  }

  if (!isNonEmptyString(v.description)) errors.push("description required and must be non-empty");
  if (!isNonEmptyString(v.expectedEffect)) errors.push("expectedEffect required and must be non-empty");

  if (!isNonEmptyString(v.riskClass) || !isValidRiskClass(v.riskClass as string)) {
    errors.push(`riskClass must be one of: ${VALID_EVOLUTION_RISK_CLASSES.join(", ")}`);
  }

  if (!Array.isArray(v.evidenceIds) || (v.evidenceIds as unknown[]).length === 0) {
    errors.push("evidenceIds required and must be a non-empty array");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionProposalDraft structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionProposalDraft(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionProposalDraft must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.draftId)) errors.push("draftId required and must be non-empty");
  if (!isNonEmptyString(v.sourcePatternId)) errors.push("sourcePatternId required and must be non-empty");
  if (!isNonEmptyString(v.title)) errors.push("title required and must be non-empty");
  if (!isNonEmptyString(v.description)) errors.push("description required and must be non-empty");

  if (!v.target || Array.isArray(v.target) || typeof v.target !== "object") {
    errors.push("target required and must be an EvolutionTarget object");
  }

  if (typeof v.confidence !== "number" || !isInRange(v.confidence as number, 0, 1)) {
    errors.push("confidence required and must be between 0 and 1");
  }

  if (!isNonEmptyString(v.riskClass) || !isValidRiskClass(v.riskClass as string)) {
    errors.push(`riskClass must be one of: ${VALID_EVOLUTION_RISK_CLASSES.join(", ")}`);
  }

  if (!Array.isArray(v.evidenceIds)) {
    errors.push("evidenceIds required and must be an array");
  }

  if (!isNonEmptyString(v.createdAt)) errors.push("createdAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}
