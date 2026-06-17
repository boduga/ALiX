/**
 * replan-types.ts — Shared data types for the model-assisted replan pipeline.
 *
 * Defines the plan revision draft (model output), proposal lifecycle,
 * validation/simulation types, and impact analysis types.
 *
 * All imports use .js extensions (NodeNext).
 */

import { randomUUID } from "node:crypto";
import type { PlanTriggerKind, WorkerAssignment } from "./coordination-types.js";

// ─── Trigger ───────────────────────────────────────────────────────────

export interface TriggerEvidence {
  workerId: string;
  findingIds: string[];
  conflictIds: string[];
  reason: string;
}

// ─── Draft Workers ─────────────────────────────────────────────────────

/**
 * DraftWorkerSpec uses a stable draftWorkerId for local references within
 * a plan revision draft. These IDs are local to the draft and are mapped
 * to provisional durable IDs by the ReplanSimulator.
 */
export interface DraftWorkerSpec {
  draftWorkerId: string;
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  dependencies: string[];       // existing WorkerAssignment IDs or draftWorkerIds
  verificationRequirements: string[];
}

/**
 * Spec for replacing an existing worker with a new draft worker.
 */
export interface DraftWorkerReplaceSpec {
  targetWorkerId: string;
  replacement: DraftWorkerSpec;
  reason: string;
}

/**
 * Spec for modifying an existing worker's properties.
 */
export interface DraftWorkerModifySpec {
  workerId: string;
  goalPrompt?: string;
  dependencies?: string[];
}

/**
 * Explicit dependency rewiring for downstream workers whose dependency
 * was replaced or removed.
 */
export interface DependencyRewire {
  dependentWorkerRef: string;
  removeDependencyRef: string;
  addDependencyRef: string;
  reason: string;
}

// ─── Plan Revision Draft (Model Output) ───────────────────────────────

/**
 * PlanRevisionDraft — model output (advisory, not authoritative).
 *
 * Represents the model's suggested changes to the current worker graph.
 * This is always validated by ReplanValidator before being accepted.
 */
export interface PlanRevisionDraft {
  triggerKind: PlanTriggerKind;
  triggerEvidence: TriggerEvidence;
  workersToAdd: DraftWorkerSpec[];
  workersToReplace: DraftWorkerReplaceSpec[];
  workersToCancel: string[];      // only pending/ready/blocked
  workersToModify: DraftWorkerModifySpec[];
  dependencyRewiring: DependencyRewire[];
  expectedBenefit: string;
  confidence: number;              // 0-1 scale
  unresolvedConcerns: string[];
}

// ─── Proposal Lifecycle ───────────────────────────────────────────────

export type ProposalStatus =
  | "proposed"
  | "invalid"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "applying"
  | "applied"
  | "failed"
  | "superseded";

// ─── Validation ───────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ─── Simulation ───────────────────────────────────────────────────────

export interface SimulatedWorker {
  id: string;                   // provisional durable ID (or existing ID)
  draftWorkerId?: string;       // set for new/replacement workers
  taskLabel: string;
  dependencies: string[];
  status: string;               // "pending" for new workers
}

export interface SimulatedGraph {
  workers: SimulatedWorker[];
  edges: Array<{ from: string; to: string }>;
  idMap: Record<string, string>;   // draftWorkerId → provisional durable ID
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ─── Impact Analysis ──────────────────────────────────────────────────

export interface OwnershipImpact {
  scope: string;
  currentOwner: string;
  proposedOwner: string;
  severity: string;             // "low" | "medium" | "high" | "critical"
}

export interface PolicyDecision {
  workerRef: string;
  decision: string;             // "allow" | "ask" | "deny"
  reason: string;
}

export interface ImpactAnalysis {
  riskLevel: string;            // "low" | "medium" | "high" | "critical"
  agentsAssigned: number;
  capabilitiesAdded: string[];
  capabilitiesRemoved: string[];
  ownershipChanges: OwnershipImpact[];
  activeLeaseConflicts: string[];
  protectedScopeViolations: string[];
  policyDecisions: PolicyDecision[];
  requiresApproval: boolean;
  summary: string;
}

// ─── Model Replan Context ─────────────────────────────────────────────

export interface ModelReplanContext {
  runId: string;
  trigger: PlanTriggerKind;
  triggerEvidence: TriggerEvidence;
  completedWorkers: WorkerAssignment[];
  activeConflicts: string[];
  recentFindings: string[];
  workerGraph: WorkerAssignment[];
}

// ─── Proposal Record (Persisted) ──────────────────────────────────────

export interface ProposalRecord {
  id: string;
  runId: string;
  status: ProposalStatus;
  expectedPlanRevision: number;

  /** The trigger that initiated this proposal */
  trigger: PlanTriggerKind;
  evidence: TriggerEvidence;

  /** The draft produced by the model (validated) */
  draft: PlanRevisionDraft;
  /** Deterministic hash of JSON.stringify(draft) */
  draftFingerprint: string;

  /** Result of structural validation */
  validationResult: ValidationResult;

  /** Result of graph simulation */
  simulatedGraph: SimulatedGraph;

  /** Result of impact analysis */
  impactAnalysis: ImpactAnalysis;
  /** Deterministic hash of JSON.stringify(impactAnalysis) */
  impactFingerprint: string;

  /** Approval gate reference, set when status becomes "awaiting_approval" */
  approvalId?: string;

  /** Provider/model/usage metadata from the model call */
  provider?: string;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Error message, set when status transitions to "failed" */
  error?: string;

  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

// ─── Fingerprinting ───────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hex fingerprint of a value.
 * Used for draftFingerprint and impactFingerprint.
 */
import { createHash } from "node:crypto";

export function computeFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

// ─── Constructors ─────────────────────────────────────────────────────

export function createTriggerEvidence(opts: {
  workerId: string;
  findingIds?: string[];
  conflictIds?: string[];
  reason: string;
}): TriggerEvidence {
  return {
    workerId: opts.workerId,
    findingIds: opts.findingIds ?? [],
    conflictIds: opts.conflictIds ?? [],
    reason: opts.reason,
  };
}

export function createDraftWorkerSpec(opts: {
  draftWorkerId: string;
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities?: string[];
  dependencies?: string[];
  verificationRequirements?: string[];
}): DraftWorkerSpec {
  return {
    draftWorkerId: opts.draftWorkerId,
    taskLabel: opts.taskLabel,
    goalPrompt: opts.goalPrompt,
    requiredCapabilities: opts.requiredCapabilities ?? [],
    dependencies: opts.dependencies ?? [],
    verificationRequirements: opts.verificationRequirements ?? [],
  };
}

export function createProposalRecord(opts: {
  id?: string;
  runId: string;
  status?: ProposalStatus;
  expectedPlanRevision: number;
  trigger: PlanTriggerKind;
  evidence: TriggerEvidence;
  draft: PlanRevisionDraft;
  draftFingerprint: string;
  validationResult?: ValidationResult;
  simulatedGraph?: SimulatedGraph;
  impactAnalysis?: ImpactAnalysis;
  impactFingerprint?: string;
  approvalId?: string;
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  error?: string;
}): ProposalRecord {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? `replan_proposal_${randomUUID()}`,
    runId: opts.runId,
    status: opts.status ?? "proposed",
    expectedPlanRevision: opts.expectedPlanRevision,
    trigger: opts.trigger,
    evidence: opts.evidence,
    draft: opts.draft,
    draftFingerprint: opts.draftFingerprint,
    validationResult: opts.validationResult ?? { valid: true, errors: [], warnings: [] },
    simulatedGraph: opts.simulatedGraph ?? {
      workers: [], edges: [], idMap: {},
      valid: true, errors: [], warnings: [],
    },
    impactAnalysis: opts.impactAnalysis ?? {
      riskLevel: "low", agentsAssigned: 0,
      capabilitiesAdded: [], capabilitiesRemoved: [],
      ownershipChanges: [], activeLeaseConflicts: [],
      protectedScopeViolations: [], policyDecisions: [],
      requiresApproval: false, summary: "",
    },
    impactFingerprint: opts.impactFingerprint ?? "",
    approvalId: opts.approvalId,
    provider: opts.provider,
    model: opts.model,
    usage: opts.usage,
    error: opts.error,
    createdAt: now,
    updatedAt: now,
  };
}
