/**
 * P14.5a — Governance Audit Trail: core types and validation.
 *
 * Defines the GovernanceAuditEvent model with 13 event types, actor/subject
 * classifications, hash-chain fields, and structural validation.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Exported enums / union types
// ---------------------------------------------------------------------------

export type GovernanceEventType =
  | "policy_evaluated"
  | "action_allowed"
  | "action_denied"
  | "action_escalated"
  | "human_approval_requested"
  | "human_approval_granted"
  | "human_approval_denied"
  | "override_applied"
  | "tool_permission_checked"
  | "agent_permission_checked"
  | "memory_access_checked"
  | "model_routing_decision"
  | "security_boundary_checked";

export const VALID_EVENT_TYPES: GovernanceEventType[] = [
  "policy_evaluated",
  "action_allowed",
  "action_denied",
  "action_escalated",
  "human_approval_requested",
  "human_approval_granted",
  "human_approval_denied",
  "override_applied",
  "tool_permission_checked",
  "agent_permission_checked",
  "memory_access_checked",
  "model_routing_decision",
  "security_boundary_checked",
];

export type ActorType = "human" | "agent" | "system" | "policy_engine";

export const VALID_ACTOR_TYPES: ActorType[] = [
  "human",
  "agent",
  "system",
  "policy_engine",
];

export type SubjectType =
  | "signal"
  | "decision"
  | "proposal"
  | "action"
  | "policy"
  | "rule"
  | "tool"
  | "agent"
  | "memory"
  | "model";

export const VALID_SUBJECT_TYPES: SubjectType[] = [
  "signal",
  "decision",
  "proposal",
  "action",
  "policy",
  "rule",
  "tool",
  "agent",
  "memory",
  "model",
];

export type GovernanceDecision =
  | "allowed"
  | "denied"
  | "escalated"
  | "deferred"
  | "overridden";

export const VALID_DECISIONS: GovernanceDecision[] = [
  "allowed",
  "denied",
  "escalated",
  "deferred",
  "overridden",
];

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const VALID_RISK_LEVELS: RiskLevel[] = [
  "low",
  "medium",
  "high",
  "critical",
];

// ---------------------------------------------------------------------------
// GovernanceAuditEvent
// ---------------------------------------------------------------------------

export interface GovernanceAuditEvent {
  /** Unique event identifier. */
  eventId: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Categorised governance event type. */
  eventType: GovernanceEventType;

  /** Who/what initiated the action. */
  actorType: ActorType;
  actorId: string;

  /** What governance subject was acted upon. */
  subjectType: SubjectType;
  /** Subject identifier (null when not applicable, e.g. policy evaluation). */
  subjectId: string | null;

  /** Description of the attempted action. */
  action: string;
  /** The governance outcome. */
  decision: GovernanceDecision;

  /** Policy that was evaluated, if applicable. */
  policyId: string | null;
  policyVersion: string | null;
  ruleId: string | null;

  /** Human-readable justification. */
  reason: string;
  /** References to supporting evidence (signal IDs, decision IDs, etc.). */
  evidenceRefs: string[];

  /** Request / trace / session correlation identifiers. */
  requestId: string | null;
  traceId: string | null;
  sessionId: string | null;
  /** Reference to a parent event in the same trace. */
  parentEventId: string | null;

  riskLevel: RiskLevel;
  requiresHumanReview: boolean;

  /** Extensible metadata payload. */
  metadata: Record<string, unknown>;

  // ---- Hash-chain fields ------------------------------------------------

  /** SHA-256 of the previous event (null for the first event). */
  previousHash: string | null;
  /** SHA-256 of this event (computed over all fields except eventHash). */
  eventHash: string;
}

// ---------------------------------------------------------------------------
// Input type (eventHash and previousHash assigned by the store)
// ---------------------------------------------------------------------------

/**
 * Governance audit event input — omits hash-chain fields that are computed
 * and assigned by the store on append.
 */
export type GovernanceAuditEventInput = Omit<
  GovernanceAuditEvent,
  "previousHash" | "eventHash"
>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validate a GovernanceAuditEventInput structure.
 *
 * Checks all governance fields excluding hash-chain fields (eventHash,
 * previousHash), which are assigned by the store on append.
 */
export function validateAuditEventInput(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Audit event must be an object"] };
  }

  const e = entry as Record<string, unknown>;

  // eventId
  if (!isNonEmptyString(e.eventId)) errors.push("eventId required and must be non-empty");

  // timestamp
  if (!isNonEmptyString(e.timestamp)) errors.push("timestamp required and must be non-empty");

  // eventType
  if (!isNonEmptyString(e.eventType) || !(VALID_EVENT_TYPES as readonly string[]).includes(e.eventType as string)) {
    errors.push(`eventType must be one of: ${VALID_EVENT_TYPES.join(", ")}`);
  }

  // actorType
  if (!isNonEmptyString(e.actorType) || !(VALID_ACTOR_TYPES as readonly string[]).includes(e.actorType as string)) {
    errors.push(`actorType must be one of: ${VALID_ACTOR_TYPES.join(", ")}`);
  }

  // actorId
  if (!isNonEmptyString(e.actorId)) errors.push("actorId required and must be non-empty");

  // subjectType
  if (!isNonEmptyString(e.subjectType) || !(VALID_SUBJECT_TYPES as readonly string[]).includes(e.subjectType as string)) {
    errors.push(`subjectType must be one of: ${VALID_SUBJECT_TYPES.join(", ")}`);
  }

  if (e.subjectId !== null && e.subjectId !== undefined && typeof e.subjectId !== "string") {
    errors.push("subjectId must be null or string");
  }

  if (!isNonEmptyString(e.action)) errors.push("action required and must be non-empty");

  if (!isNonEmptyString(e.decision) || !(VALID_DECISIONS as readonly string[]).includes(e.decision as string)) {
    errors.push(`decision must be one of: ${VALID_DECISIONS.join(", ")}`);
  }

  if (e.policyId !== null && e.policyId !== undefined && typeof e.policyId !== "string") errors.push("policyId must be null or string");
  if (e.policyVersion !== null && e.policyVersion !== undefined && typeof e.policyVersion !== "string") errors.push("policyVersion must be null or string");
  if (e.ruleId !== null && e.ruleId !== undefined && typeof e.ruleId !== "string") errors.push("ruleId must be null or string");

  if (!isNonEmptyString(e.reason)) errors.push("reason required and must be non-empty");

  if (!Array.isArray(e.evidenceRefs)) {
    errors.push("evidenceRefs must be an array of strings");
  } else if (!e.evidenceRefs.every((r) => typeof r === "string")) {
    errors.push("evidenceRefs must contain only strings");
  }

  if (e.requestId !== null && e.requestId !== undefined && typeof e.requestId !== "string") errors.push("requestId must be null or string");
  if (e.traceId !== null && e.traceId !== undefined && typeof e.traceId !== "string") errors.push("traceId must be null or string");
  if (e.sessionId !== null && e.sessionId !== undefined && typeof e.sessionId !== "string") errors.push("sessionId must be null or string");
  if (e.parentEventId !== null && e.parentEventId !== undefined && typeof e.parentEventId !== "string") errors.push("parentEventId must be null or string");

  if (!isNonEmptyString(e.riskLevel) || !(VALID_RISK_LEVELS as readonly string[]).includes(e.riskLevel as string)) {
    errors.push(`riskLevel must be one of: ${VALID_RISK_LEVELS.join(", ")}`);
  }

  if (typeof e.requiresHumanReview !== "boolean") errors.push("requiresHumanReview must be a boolean");

  if (e.metadata === null || e.metadata === undefined || typeof e.metadata !== "object" || Array.isArray(e.metadata)) {
    errors.push("metadata must be an object");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a fully-formed GovernanceAuditEvent structure (with hash fields).
 *
 * Delegates to validateAuditEventInput for governance fields, then checks
 * previousHash and eventHash.
 */
export function validateAuditEvent(entry: unknown): ValidationResult {
  const result = validateAuditEventInput(entry);
  if (!result.valid) return result;

  const e = entry as Record<string, unknown>;
  const extra: string[] = [];

  if (e.previousHash === null || e.previousHash === undefined) {
    // null is valid
  } else if (!isNonEmptyString(e.previousHash)) {
    extra.push("previousHash must be null or non-empty string");
  }
  if (!isNonEmptyString(e.eventHash)) {
    extra.push("eventHash required and must be non-empty");
  }

  return { valid: extra.length === 0, errors: extra };
}
