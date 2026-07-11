/**
 * A0.1 — Evolution Contract Types.
 *
 * Pure contract types for ALiX evolution. Defines the vocabulary,
 * validation boundaries, and lineage rules required for all downstream
 * A-series phases.
 *
 * This module is contract-only — no stores, no state machine, no CLI.
 * Evolution references evidence via EvidenceReference; it does not
 * redefine evidence transport or persistence (those belong to X2/X3b).
 *
 * @module evolution-contract
 */

// ---------------------------------------------------------------------------
// Evolution State
// ---------------------------------------------------------------------------

export enum EvolutionState {
  DRAFT = "DRAFT",
  PROPOSED = "PROPOSED",
  UNDER_REVIEW = "UNDER_REVIEW",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  WITHDRAWN = "WITHDRAWN",
  IMPLEMENTING = "IMPLEMENTING",
  VALIDATING = "VALIDATING",
  ACTIVE = "ACTIVE",
  FAILED_VALIDATION = "FAILED_VALIDATION",
  ROLLED_BACK = "ROLLED_BACK",
}

export const EVOLUTION_TERMINAL_STATES: readonly EvolutionState[] = [
  EvolutionState.ACTIVE,
  EvolutionState.REJECTED,
  EvolutionState.WITHDRAWN,
  EvolutionState.ROLLED_BACK,
];

export const EVOLUTION_ALL_STATES: readonly EvolutionState[] = [
  EvolutionState.DRAFT,
  EvolutionState.PROPOSED,
  EvolutionState.UNDER_REVIEW,
  EvolutionState.APPROVED,
  EvolutionState.REJECTED,
  EvolutionState.WITHDRAWN,
  EvolutionState.IMPLEMENTING,
  EvolutionState.VALIDATING,
  EvolutionState.ACTIVE,
  EvolutionState.FAILED_VALIDATION,
  EvolutionState.ROLLED_BACK,
];

// ---------------------------------------------------------------------------
// Evolution Origin
// ---------------------------------------------------------------------------

export type EvolutionOrigin =
  | "operator"
  | "governance_signal"
  | "learning_outcome"
  | "system_observation";

export const VALID_EVOLUTION_ORIGINS: readonly EvolutionOrigin[] = [
  "operator",
  "governance_signal",
  "learning_outcome",
  "system_observation",
];

// ---------------------------------------------------------------------------
// Evolution Target
// ---------------------------------------------------------------------------

export type EvolutionTargetKind =
  | "policy"
  | "agent_behavior"
  | "workflow"
  | "runtime_config"
  | "governance_rule"
  | "evidence_filter"
  | "execution_intent";

export const VALID_EVOLUTION_TARGET_KINDS: readonly EvolutionTargetKind[] = [
  "policy",
  "agent_behavior",
  "workflow",
  "runtime_config",
  "governance_rule",
  "evidence_filter",
  "execution_intent",
];

export interface EvolutionTarget {
  kind: EvolutionTargetKind;
  id: string;
  currentHash?: string;
}

// ---------------------------------------------------------------------------
// Risk Class
// ---------------------------------------------------------------------------

export type EvolutionRiskClass = "low" | "medium" | "high";

export const VALID_EVOLUTION_RISK_CLASSES: readonly EvolutionRiskClass[] = [
  "low",
  "medium",
  "high",
];

// ---------------------------------------------------------------------------
// Evidence Reference
// ---------------------------------------------------------------------------

/**
 * Reference to existing evidence systems (X2, P14, etc.).
 *
 * This does not replace X2/X3b evidence models — it references them.
 */
export interface EvidenceReference {
  /** Evidence ID from the source system. */
  evidenceId: string;
  /** Source system identifier (e.g. "x2", "p14", "p15"). */
  source: string;
  /** Optional human-readable description of the reference. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Evolution Constraint
// ---------------------------------------------------------------------------

export interface EvolutionConstraint {
  /** Constraint type identifier (e.g. "max_impact_scope", "requires_approval"). */
  type: string;
  /** Constraint value. */
  value: unknown;
  /** Why this constraint exists. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Evolution Intent
// ---------------------------------------------------------------------------

export interface EvolutionIntent {
  /** Unique identifier for this evolution. */
  evolutionId: string;
  /** What triggered this evolution. */
  origin: EvolutionOrigin;
  /** What the evolution targets. */
  target: EvolutionTarget;
  /** Evidence references supporting this evolution. */
  rationale: EvidenceReference[];
  /** Description of the expected effect. */
  expectedEffect: string;
  /** Risk classification. */
  riskClass: EvolutionRiskClass;
  /** Constraints governing this evolution. */
  constraints: EvolutionConstraint[];
  /** When the intent was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Evolution Proposal
// ---------------------------------------------------------------------------

export interface EvolutionProposal {
  /** Unique proposal identifier. */
  proposalId: string;
  /** Reference to the originating EvolutionIntent. */
  evolutionId: string;
  /** Short human-readable title. */
  title: string;
  /** Longer description of the proposed change. */
  description: string;
  /** Description of what changes. */
  change: string;
  /** Hash of the target before change (null if not applicable). */
  beforeHash: string | null;
  /** Expected hash of the target after change (null if not applicable). */
  afterHash: string | null;
  /** When the proposal was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Evolution Review
// ---------------------------------------------------------------------------

export type EvolutionReviewDecision = "approve" | "reject" | "amend";

export const VALID_EVOLUTION_REVIEW_DECISIONS: readonly EvolutionReviewDecision[] = [
  "approve",
  "reject",
  "amend",
];

export interface EvolutionReview {
  /** Unique review identifier. */
  reviewId: string;
  /** Reference to the originating EvolutionIntent. */
  evolutionId: string;
  /** Who performed the review. */
  reviewer: string;
  /** The review decision. */
  decision: EvolutionReviewDecision;
  /** Justification for the decision. */
  rationale: string;
  /** When the review was submitted. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Evolution Approval
// ---------------------------------------------------------------------------

export interface EvolutionApproval {
  /** Unique approval identifier. */
  approvalId: string;
  /** Reference to the originating EvolutionIntent. */
  evolutionId: string;
  /** Who approved the evolution. */
  approvedBy: string;
  /** When the approval was granted. */
  approvedAt: string;
  /** The authority under which approval was granted. */
  authority: string;
}

// ---------------------------------------------------------------------------
// Evolution Implementation
// ---------------------------------------------------------------------------

export interface EvolutionImplementation {
  /** Unique implementation identifier. */
  implementationId: string;
  /** Reference to the originating EvolutionIntent. */
  evolutionId: string;
  /** Description or reference to what changed. */
  changeEvidence: string;
  /** Diff of the change (null if not applicable or too large). */
  diff: string | null;
  /** Hash before the change. */
  beforeHash: string;
  /** Hash after the change. */
  afterHash: string;
  /** When the implementation was executed. */
  executedAt: string;
}

// ---------------------------------------------------------------------------
// Evolution Validation
// ---------------------------------------------------------------------------

export type EvolutionValidationResult = "passed" | "failed" | "partial";

export const VALID_EVOLUTION_VALIDATION_RESULTS: readonly EvolutionValidationResult[] = [
  "passed",
  "failed",
  "partial",
];

export interface EvolutionValidation {
  /** Unique validation identifier. */
  validationId: string;
  /** Reference to the originating EvolutionIntent. */
  evolutionId: string;
  /** Whether validation passed, failed, or was partial. */
  result: EvolutionValidationResult;
  /** Metrics recorded during validation. */
  metrics: Record<string, number>;
  /** Evidence IDs produced during validation. */
  evidenceIds: string[];
  /** When validation completed. */
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Evolution Activation
// ---------------------------------------------------------------------------

export interface EvolutionActivation {
  /** Unique activation identifier. */
  activationId: string;
  /** Reference to the originating EvolutionIntent. */
  evolutionId: string;
  /** When the evolution was activated. */
  activatedAt: string;
  /** Scope of activation (e.g. "production", "staging", "specific_agent"). */
  scope: string;
  /** Whether the activation is currently live. */
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidOrigin(v: string): v is EvolutionOrigin {
  return (VALID_EVOLUTION_ORIGINS as readonly string[]).includes(v);
}

function isValidTargetKind(v: string): v is EvolutionTargetKind {
  return (VALID_EVOLUTION_TARGET_KINDS as readonly string[]).includes(v);
}

function isValidRiskClass(v: string): v is EvolutionRiskClass {
  return (VALID_EVOLUTION_RISK_CLASSES as readonly string[]).includes(v);
}

function isValidReviewDecision(v: string): v is EvolutionReviewDecision {
  return (VALID_EVOLUTION_REVIEW_DECISIONS as readonly string[]).includes(v);
}

function isValidValidationResult(v: string): v is EvolutionValidationResult {
  return (VALID_EVOLUTION_VALIDATION_RESULTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// 5. Required Validators
// ---------------------------------------------------------------------------

/**
 * Validate an EvolutionIntent structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionIntent(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionIntent must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.evolutionId)) errors.push("evolutionId required and must be non-empty");
  if (!isNonEmptyString(v.origin) || !isValidOrigin(v.origin as string)) {
    errors.push(`origin must be one of: ${VALID_EVOLUTION_ORIGINS.join(", ")}`);
  }
  if (!v.target || typeof v.target !== "object") {
    errors.push("target required and must be an EvolutionTarget object");
  }
  if (!Array.isArray(v.rationale) || v.rationale.length === 0) {
    errors.push("rationale required and must contain at least one EvidenceReference");
  }
  if (!isNonEmptyString(v.expectedEffect)) {
    errors.push("expectedEffect required and must be non-empty");
  }
  if (!isNonEmptyString(v.riskClass) || !isValidRiskClass(v.riskClass as string)) {
    errors.push(`riskClass must be one of: ${VALID_EVOLUTION_RISK_CLASSES.join(", ")}`);
  }
  if (!Array.isArray(v.constraints)) {
    errors.push("constraints required and must be an array");
  }
  if (!isNonEmptyString(v.createdAt)) errors.push("createdAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionProposal structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionProposal(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionProposal must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.proposalId)) errors.push("proposalId required and must be non-empty");
  if (!isNonEmptyString(v.evolutionId)) errors.push("evolutionId required and must be non-empty");
  if (!isNonEmptyString(v.title)) errors.push("title required and must be non-empty");
  if (!isNonEmptyString(v.description)) errors.push("description required and must be non-empty");
  if (!isNonEmptyString(v.change)) errors.push("change required and must be non-empty");
  if (!isNonEmptyString(v.createdAt)) errors.push("createdAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionReview structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionReview(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionReview must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.reviewId)) errors.push("reviewId required and must be non-empty");
  if (!isNonEmptyString(v.evolutionId)) errors.push("evolutionId required and must be non-empty");
  if (!isNonEmptyString(v.reviewer)) errors.push("reviewer required and must be non-empty");
  if (!isNonEmptyString(v.decision) || !isValidReviewDecision(v.decision as string)) {
    errors.push(`decision must be one of: ${VALID_EVOLUTION_REVIEW_DECISIONS.join(", ")}`);
  }
  if (!isNonEmptyString(v.rationale)) errors.push("rationale required and must be non-empty");
  if (!isNonEmptyString(v.createdAt)) errors.push("createdAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionApproval structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionApproval(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionApproval must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.approvalId)) errors.push("approvalId required and must be non-empty");
  if (!isNonEmptyString(v.evolutionId)) errors.push("evolutionId required and must be non-empty");
  if (!isNonEmptyString(v.approvedBy)) errors.push("approvedBy required and must be non-empty");
  if (!isNonEmptyString(v.approvedAt)) errors.push("approvedAt required and must be non-empty");
  if (!isNonEmptyString(v.authority)) errors.push("authority required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionImplementation structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionImplementation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionImplementation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.implementationId)) errors.push("implementationId required and must be non-empty");
  if (!isNonEmptyString(v.evolutionId)) errors.push("evolutionId required and must be non-empty");
  if (!isNonEmptyString(v.changeEvidence)) errors.push("changeEvidence required and must be non-empty");
  if (!isNonEmptyString(v.beforeHash)) errors.push("beforeHash required and must be non-empty");
  if (!isNonEmptyString(v.afterHash)) errors.push("afterHash required and must be non-empty");
  if (!isNonEmptyString(v.executedAt)) errors.push("executedAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionValidation structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionValidation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionValidation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.validationId)) errors.push("validationId required and must be non-empty");
  if (!isNonEmptyString(v.evolutionId)) errors.push("evolutionId required and must be non-empty");
  if (!isNonEmptyString(v.result) || !isValidValidationResult(v.result as string)) {
    errors.push(`result must be one of: ${VALID_EVOLUTION_VALIDATION_RESULTS.join(", ")}`);
  }
  if (!Array.isArray(v.evidenceIds)) errors.push("evidenceIds required and must be an array");
  if (!isNonEmptyString(v.completedAt)) errors.push("completedAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EvolutionActivation structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionActivation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionActivation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.activationId)) errors.push("activationId required and must be non-empty");
  if (!isNonEmptyString(v.evolutionId)) errors.push("evolutionId required and must be non-empty");
  if (!isNonEmptyString(v.activatedAt)) errors.push("activatedAt required and must be non-empty");
  if (!isNonEmptyString(v.scope)) errors.push("scope required and must be non-empty");
  if (typeof v.isActive !== "boolean") errors.push("isActive must be a boolean");

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 7. Evolution Lineage Validation
// ---------------------------------------------------------------------------

export interface EvolutionArtifactSet {
  intent?: EvolutionIntent;
  proposal?: EvolutionProposal;
  review?: EvolutionReview;
  approval?: EvolutionApproval;
  implementation?: EvolutionImplementation;
  validation?: EvolutionValidation;
  activation?: EvolutionActivation;
}

/**
 * Validate that all evolution artifacts in a set share the same evolutionId,
 * preserving the lineage invariant.
 *
 * Rules:
 * - If any artifact exists, its evolutionId must match the intent's evolutionId
 * - If no intent is provided and other artifacts exist, that is an error
 *
 * Pure — no side effects, no I/O, no store access.
 */
export function validateEvolutionLineage(artifacts: EvolutionArtifactSet): ValidationResult {
  const errors: string[] = [];

  const { intent, proposal, review, approval, implementation, validation, activation } = artifacts;

  if (!intent) {
    // Without an intent, no lineage can be validated
    const hasArtifacts = proposal || review || approval || implementation || validation || activation;
    if (hasArtifacts) {
      errors.push("EvolutionIntent is required when other artifacts are present");
    }
    return { valid: errors.length === 0, errors };
  }

  const id = intent.evolutionId;

  if (proposal && proposal.evolutionId !== id) {
    errors.push(`EvolutionProposal.evolutionId (${proposal.evolutionId}) does not match intent (${id})`);
  }
  if (review && review.evolutionId !== id) {
    errors.push(`EvolutionReview.evolutionId (${review.evolutionId}) does not match intent (${id})`);
  }
  if (approval && approval.evolutionId !== id) {
    errors.push(`EvolutionApproval.evolutionId (${approval.evolutionId}) does not match intent (${id})`);
  }
  if (implementation && implementation.evolutionId !== id) {
    errors.push(`EvolutionImplementation.evolutionId (${implementation.evolutionId}) does not match intent (${id})`);
  }
  if (validation && validation.evolutionId !== id) {
    errors.push(`EvolutionValidation.evolutionId (${validation.evolutionId}) does not match intent (${id})`);
  }
  if (activation && activation.evolutionId !== id) {
    errors.push(`EvolutionActivation.evolutionId (${activation.evolutionId}) does not match intent (${id})`);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 8. Deterministic Sort Helpers
// ---------------------------------------------------------------------------

/**
 * Sort evolution reviews by createdAt ascending, then reviewId ascending.
 */
export function sortReviews(reviews: EvolutionReview[]): EvolutionReview[] {
  return [...reviews].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    return byTime !== 0 ? byTime : a.reviewId.localeCompare(b.reviewId);
  });
}

/**
 * Sort evolution proposals by createdAt ascending, then proposalId ascending.
 */
export function sortProposals(proposals: EvolutionProposal[]): EvolutionProposal[] {
  return [...proposals].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    return byTime !== 0 ? byTime : a.proposalId.localeCompare(b.proposalId);
  });
}
