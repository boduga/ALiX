/**
 * P10.9.2b — Remediation Wizard: pure types, interfaces, registry, and builder.
 *
 * Provider/registry pattern with a pure builder core. No I/O, no side effects.
 * This is the architectural foundation for the entire P10.9.2b feature.
 *
 * @module
 */

import type {
  AdaptationProposal,
  ProposalAction,
  ProposalTarget,
} from "../adaptation/adaptation-types.js";
import {
  computeProposalReadiness,
  isExecutiveBridgeProposal,
} from "../adaptation/proposal-readiness.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Maps a ProposalAction to its expected target kind. */
export interface ActionSpec {
  action: ProposalAction;
  targetKind: ProposalTarget["kind"];
}

/** Operator-supplied specification for a remediation. */
export interface RemediationSpec {
  actionName: string;
  targetId: string;
  reason: string;
  additionalPayload?: Record<string, unknown>;
}

/** Execution context for the remediation build. */
export interface RemediationContext {
  actor: string;
  timestamp?: string;
  mode: "interactive" | "noninteractive";
}

/**
 * Structured error codes for validation.
 *
 * Used across validateRemediationParent, validatePayload, and
 * validateSpecification to identify the specific validation failure.
 */
export type ValidationErrorCode =
  | "NOT_FOUND"
  | "NOT_APPROVED"
  | "NOT_EXECUTIVE"
  | "WRONG_READINESS"
  | "RESERVED_KEY"
  | "UNSUPPORTED_ACTION"
  | "MISSING_TARGET"
  | "SHORT_REASON"
  | "UNSUPPORTED_GOVERNANCE_KIND"
  | "MISSING_GOVERNANCE_KIND";

/**
 * Structured error detail attached to a failed validation.
 */
export interface ValidationIssue {
  code: ValidationErrorCode;
  message: string;
  field?: string;
}

/**
 * Result of a validation check.
 *
 * Pattern:
 *   { valid: true }
 *   { valid: false, issue: { code: "...", message: "..." } }
 *
 * After narrowing via `result.valid`, the `issue` property is
 * available on the false branch.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; issue: ValidationIssue };

/**
 * Pure proposal draft produced by buildRemediationChildDraft.
 * Never includes id, createdAt, status, or evidenceFingerprints —
 * those are assigned by the effectful caller.
 */
export interface ChildProposalDraft {
  action: ProposalAction;
  target: ProposalTarget;
  payload: Record<string, unknown>;
  sourceRecommendationType: string;
  sourceConfidence: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Reserved payload keys (Section 5, R2 — immutable lineage)
// ---------------------------------------------------------------------------

/**
 * Set of lineage-field keys that MUST NOT be overridden via --payload.
 * Enforced by validatePayload() before the merge, and by
 * mergeLineagePayload() during the merge (lineage always wins).
 */
export const RESERVED_PAYLOAD_KEYS = new Set<string>([
  // Core lineage
  "parentProposalId",
  "parentAction",
  "parentTarget",

  // Source identity
  "source",
  "derivedFrom",
  "remediationType",
  "remediationReason",

  // Plan context
  "planId",
  "stepId",
  "objectiveId",
  "subsystem",

  // Recommendation metadata
  "recommendationId",
  "evaluationId",
  "reflectionId",

  // Parent version snapshot
  "parentCreatedAt",
  "parentStatus",
  "parentReadiness",

  // Graph-friendly lineage
  "lineageType",
  "lineageDepth",
  "lineageSchemaVersion",

  // Reserved for P10.9.2c orchestration
  "orchestrationState",
]);

// ---------------------------------------------------------------------------
// RemediationProvider interface
// ---------------------------------------------------------------------------

/**
 * Provider for a class of remediation.
 *
 * Implements the Strategy pattern: each provider understands one
 * source of remediation requests (e.g., executive bridge proposals)
 * and knows which concrete child proposals it can produce.
 */
export interface RemediationProvider {
  /** Unique identifier. */
  readonly id: string;

  /** Human-readable description. */
  readonly description: string;

  /** Proposal source types this provider supports. */
  readonly supportedSources: readonly string[];

  /** Dispatch priority (lower = first). */
  readonly priority: number;

  /** Schema version for lineage payload. */
  readonly version: string;

  /** Actions this provider can produce. */
  supportedActions(): readonly ActionSpec[];

  /** Whether this provider handles the given proposal. */
  supports(proposal: AdaptationProposal): boolean;

  /**
   * Build a child proposal draft.
   * Pure — deterministic, no I/O, no ids, no timestamps.
   */
  buildDraft(
    parent: AdaptationProposal,
    specification: RemediationSpec,
    context: RemediationContext,
  ): ChildProposalDraft;

  /**
   * Optional interactive specification prompts.
   * Returns null if cancelled.
   */
  promptSpecification?(
    parent: AdaptationProposal,
  ): Promise<RemediationSpec | null>;
}

// ---------------------------------------------------------------------------
// RemediatorRegistry
// ---------------------------------------------------------------------------

/**
 * Registry of RemediationProvider instances.
 *
 * Exactly-one contract: find() throws if zero or more than one
 * provider matches (ties = error; unambiguous priority wins).
 */
export class RemediatorRegistry {
  private providers: RemediationProvider[] = [];

  /** Register a provider. Duplicate ids are allowed. */
  register(provider: RemediationProvider): void {
    this.providers.push(provider);
  }

  /** Unregister all providers with the given id. */
  unregister(id: string): void {
    this.providers = this.providers.filter((p) => p.id !== id);
  }

  /**
   * Find exactly one provider that supports the proposal.
   * Throws if zero or more than one match.
   * When multiple match but priorities are unambiguous, the highest-priority
   * (lowest numerical value) provider is returned.
   */
  find(proposal: AdaptationProposal): RemediationProvider {
    const matches = this.providers.filter((p) => p.supports(proposal));
    if (matches.length === 0) {
      throw new Error(`No remediator supports proposal ${proposal.id}`);
    }
    if (matches.length > 1) {
      // Sort by priority ascending (lower = higher priority)
      matches.sort((a, b) => a.priority - b.priority);
      // If the top two have different priorities, the first wins
      if (matches.length >= 2 && matches[0].priority !== matches[1].priority) {
        return matches[0];
      }
      // Tie — throw
      const ids = matches.map((p) => p.id).join(", ");
      throw new Error(
        `Multiple remediators support proposal ${proposal.id}: ${ids}`,
      );
    }
    return matches[0];
  }

  /** Return a shallow copy of all registered providers. */
  list(): readonly RemediationProvider[] {
    return [...this.providers];
  }
}

// ---------------------------------------------------------------------------
// Action alias resolution (P10.9.2d — stabilization)
// ---------------------------------------------------------------------------

/**
 * Mapping from shorthand aliases to canonical action names.
 * Users may type the short form in CLI flags.
 */
const ACTION_ALIASES: Record<string, string> = {
  governance: "governance_change",
  agent_card: "update_agent_card",
  skill: "adjust_skill_definition",
  issue: "create_improvement_issue",
};

/**
 * Resolve an action alias to its canonical name.
 * If the name has no alias mapping, returns it unchanged.
 */
export function resolveActionAlias(name: string): string {
  return ACTION_ALIASES[name] ?? name;
}

// ---------------------------------------------------------------------------
// Action-to-target-kind mapping for buildRemediationChildDraft
// ---------------------------------------------------------------------------

const ACTION_SPEC_MAP: Record<
  string,
  { action: ProposalAction; targetKind: ProposalTarget["kind"] }
> = {
  governance_change: { action: "governance_change", targetKind: "governance" },
  update_agent_card: { action: "update_agent_card", targetKind: "agent_card" },
  adjust_skill_definition: { action: "adjust_skill_definition", targetKind: "skill" },
  create_improvement_issue: { action: "create_improvement_issue", targetKind: "issue" },
};

// ---------------------------------------------------------------------------
// ExecutiveBridgeRemediator
// ---------------------------------------------------------------------------

/**
 * Concrete RemediationProvider for P10.7c executive bridge proposals.
 *
 * Produces child proposals for all 4 supported action families:
 * governance_change, update_agent_card, update_skill, create_issue.
 */
export class ExecutiveBridgeRemediator implements RemediationProvider {
  readonly id = "executive-bridge";
  readonly description = "Remediate executive bridge recommendations";
  readonly supportedSources = ["executive_bridge"];
  readonly priority = 100;
  readonly version = "1.0.0";

  supportedActions(): readonly ActionSpec[] {
    return [
      { action: "governance_change", targetKind: "governance" },
      { action: "update_agent_card", targetKind: "agent_card" },
      { action: "adjust_skill_definition", targetKind: "skill" },
      { action: "create_improvement_issue", targetKind: "issue" },
    ];
  }

  supports(proposal: AdaptationProposal): boolean {
    return isExecutiveBridgeProposal(proposal);
  }

  buildDraft(
    parent: AdaptationProposal,
    specification: RemediationSpec,
    context: RemediationContext,
  ): ChildProposalDraft {
    return buildRemediationChildDraft(parent, specification, context);
  }

  async promptSpecification(
    _parent: AdaptationProposal,
  ): Promise<RemediationSpec | null> {
    // Interactive wizard — deferred to Task 2 (CLI handler).
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Validate that a proposal is a valid remediation parent.
 *
 * Checks in order:
 * 1. Not undefined → NOT_FOUND
 * 2. Status is "approved" → NOT_APPROVED
 * 3. Is an executive bridge proposal → NOT_EXECUTIVE
 * 4. Readiness is "needs_specification" → WRONG_READINESS
 */
export function validateRemediationParent(
  proposal: AdaptationProposal | undefined,
): ValidationResult {
  if (!proposal) {
    return {
      valid: false,
      issue: { code: "NOT_FOUND", message: "Proposal not found" },
    };
  }
  if (proposal.status !== "approved") {
    return {
      valid: false,
      issue: {
        code: "NOT_APPROVED",
        message: `Proposal status is "${proposal.status}", expected "approved"`,
      },
    };
  }
  if (!isExecutiveBridgeProposal(proposal)) {
    return {
      valid: false,
      issue: {
        code: "NOT_EXECUTIVE",
        message: "Proposal is not an executive bridge proposal",
      },
    };
  }
  const readiness = computeProposalReadiness(proposal).readiness;
  if (readiness !== "needs_specification") {
    return {
      valid: false,
      issue: {
        code: "WRONG_READINESS",
        message: `Proposal readiness is "${readiness}", expected "needs_specification"`,
      },
    };
  }
  return { valid: true };
}

/**
 * Validate that a payload does not contain reserved lineage keys.
 * Returns ValidationResult — structured success or failure with issue.
 */
export function validatePayload(
  payload: Record<string, unknown>,
): ValidationResult {
  for (const key of Object.keys(payload)) {
    if (RESERVED_PAYLOAD_KEYS.has(key)) {
      return {
        valid: false,
        issue: {
          code: "RESERVED_KEY",
          message: `"${key}" is a reserved lineage field and cannot be set via --payload`,
          field: key,
        },
      };
    }
  }
  return { valid: true };
}

/**
 * Validate that a RemediationSpec is valid for the given provider.
 *
 * Checks:
 * 1. actionName is in the provider's supported actions
 * 2. targetId is non-empty
 * 3. reason is at least 10 characters
 *
 * Returns ValidationResult — structured success or failure with issue.
 */
/**
 * Supported governance change kinds (mirrors the applier's set).
 */
const GOVERNANCE_KINDS: ReadonlySet<string> = new Set([
  "confidence_calibration",
  "lens_adjustment",
  "policy_coverage",
]);

export function validateSpecification(
  spec: RemediationSpec,
  provider: RemediationProvider,
): ValidationResult {
  const actions = provider.supportedActions();
  if (!actions.some((a) => a.action === spec.actionName)) {
    return {
      valid: false,
      issue: {
        code: "UNSUPPORTED_ACTION",
        message: `Action "${spec.actionName}" is not supported by provider "${provider.id}"`,
      },
    };
  }
  if (!spec.targetId || spec.targetId.trim().length === 0) {
    return {
      valid: false,
      issue: {
        code: "MISSING_TARGET",
        message: "targetId is required",
      },
    };
  }
  if (!spec.reason || spec.reason.trim().length < 10) {
    return {
      valid: false,
      issue: {
        code: "SHORT_REASON",
        message: "reason is required and must be at least 10 characters",
      },
    };
  }
  // Governance preflight (P10.9.2d): validate governance kind when provided in payload
  if (spec.actionName === "governance_change") {
    const payload = spec.additionalPayload as Record<string, unknown> | undefined;
    if (payload && typeof payload.kind === "string") {
      if (!GOVERNANCE_KINDS.has(payload.kind)) {
        return {
          valid: false,
          issue: {
            code: "UNSUPPORTED_GOVERNANCE_KIND",
            message: `Unsupported governance kind "${payload.kind}". Supported: ${[...GOVERNANCE_KINDS].join(", ")}`,
          },
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Merge an additional payload with lineage fields.
 *
 * Lineage fields always win on conflict:
 *   result = { ...additional, ...lineage }
 *
 * This is the sole enforcement point for the immutable-lineage invariant (R2).
 */
export function mergeLineagePayload(
  additional: Record<string, unknown> | undefined,
  lineage: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(additional ?? {}), ...lineage };
}

/**
 * Build a ProposalTarget from a target kind and spec targetId.
 *
 * Each target kind uses its own field name:
 * - `issue` → `{ kind: "issue", title: spec.targetId }`
 * - All others → `{ kind, id: spec.targetId }`
 *
 * Pure — deterministic, no I/O.
 */
export function buildTarget(
  kind: ProposalTarget["kind"],
  targetId: string,
): ProposalTarget {
  if (kind === "issue") {
    return { kind: "issue", title: targetId } as ProposalTarget;
  }
  // governance, agent_card, skill, etc. all use `id`
  return { kind, id: targetId } as unknown as ProposalTarget;
}

/**
 * Build a child proposal draft from a parent proposal, specification, and context.
 *
 * Pure builder — deterministic, no I/O, no ids, no timestamps.
 * Never mutates the parent. Always returns identical output for identical inputs.
 *
 * Produces a ChildProposalDraft with:
 * - Action and target derived from spec.actionName
 * - Full immutable lineage payload (parent version snapshot, graph-friendly fields,
 *   orchestration reservation)
 * - sourceRecommendationType and sourceConfidence inherited from parent
 * - Reason from spec
 */
export function buildRemediationChildDraft(
  parent: AdaptationProposal,
  spec: RemediationSpec,
  _context: RemediationContext,
): ChildProposalDraft {
  const actionSpec = ACTION_SPEC_MAP[spec.actionName];

  // Build immutable lineage payload from parent state
  const parentPayload = parent.payload as Record<string, unknown>;
  const readiness = computeProposalReadiness(parent);

  const lineagePayload: Record<string, unknown> = {
    // Core lineage
    parentProposalId: parent.id,
    parentAction: parent.action,
    parentTarget: parent.target,
    source: "executive_remediate",

    // Parent version snapshot
    parentCreatedAt: parent.createdAt,
    parentStatus: parent.status,
    parentReadiness: readiness.readiness,

    // "Why" lineage
    derivedFrom: "executive_remediation",
    remediationType: spec.actionName,
    remediationReason: spec.reason,

    // Graph-friendly lineage
    lineageType: "remediation",
    lineageDepth: 1,
    lineageSchemaVersion: 1,

    // Inherited plan context (undefined if absent from parent payload)
    planId: parentPayload?.planId ?? undefined,
    stepId: parentPayload?.stepId ?? undefined,
    objectiveId: parentPayload?.objectiveId ?? undefined,
    subsystem: parentPayload?.subsystem ?? undefined,

    // Preserved recommendation metadata
    recommendationId: parentPayload?.recommendationId ?? undefined,
    evaluationId: parentPayload?.evaluationId ?? undefined,
    reflectionId: parentPayload?.reflectionId ?? undefined,

    // Reserved for P10.9.2c orchestration
    orchestrationState: undefined,
  };

  // Merge: additionalPayload first, lineagePayload second (lineage wins)
  const mergedPayload = mergeLineagePayload(
    spec.additionalPayload,
    lineagePayload,
  );

  // Build target — each target kind uses its own field name.
  // governance, agent_card, skill use `id`; issue uses `title`.
  const target = buildTarget(actionSpec.targetKind, spec.targetId);

  return {
    action: actionSpec.action,
    target,
    payload: mergedPayload,
    sourceRecommendationType: parent.sourceRecommendationType,
    sourceConfidence: parent.sourceConfidence,
    reason: spec.reason,
  };
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

/**
 * Create a new RemediatorRegistry with default providers registered.
 *
 * Currently registers exactly one provider: ExecutiveBridgeRemediator.
 * This is a factory, NOT a singleton — each call creates an independent
 * registry. Tests create their own registries.
 */
export function createDefaultRegistry(): RemediatorRegistry {
  const registry = new RemediatorRegistry();
  registry.register(new ExecutiveBridgeRemediator());
  return registry;
}
