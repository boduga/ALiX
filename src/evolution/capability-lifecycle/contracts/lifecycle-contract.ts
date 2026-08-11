// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { LifecycleState } from "../../../adaptation/capability-evolution-types.js";
import type { CapabilityGap, CapabilityHealth, CapabilityOverlap, CapabilityDrift } from "../../../adaptation/capability-evolution-types.js";
import type { GovernanceDecision, GovernanceDecisionKind } from "../../governance/contracts/decision-contract.js";
import type { ValidationResult } from "../../contracts/evolution-contract.js";
import type { VerificationEvidence } from "../../verification/contracts/verification-contract.js";
import type { PatternObservation } from "../../contracts/pattern-discovery-contract.js";

// ---------------------------------------------------------------------------
// Lifecycle intent
// ---------------------------------------------------------------------------

export type CapabilityLifecycleIntent =
  | "register"
  | "promote"
  | "modify"
  | "consolidate"
  | "deprecate";

export const CAPABILITY_LIFECYCLE_INTENTS: readonly CapabilityLifecycleIntent[] = [
  "register", "promote", "modify", "consolidate", "deprecate",
];

export type CapabilityLifecycleEventType = "intent" | "proposed" | "decided" | "applied" | "measured";

export const CAPABILITY_LIFECYCLE_EVENT_TYPES: readonly CapabilityLifecycleEventType[] = [
  "intent", "proposed", "decided", "applied", "measured",
];

// ---------------------------------------------------------------------------
// Ledger record
// ---------------------------------------------------------------------------

export interface CapabilityLifecycleTarget {
  /** Primary capability. For consolidation: the resulting/merged capability (C). */
  capabilityId: string;
  /** Related affected capabilities. For consolidation: the merged inputs (A, B). */
  relatedCapabilityIds?: string[];
}

/**
 * Append-only record of a capability lifecycle event.
 *
 * Identity rule: `recordId` is generated once on append and never changes; it is
 * NOT the identity of the proposal/decision (proposalId/decisionId carry that).
 * A timestamp is never part of the identity.
 *
 * Semantics: `observedLifecycleState` = what the registry reported when this
 * record was created; `proposedLifecycleState` = the state REQUESTED by the
 * proposal. An APPROVE record never claims the registry entered the proposed
 * state. A7.0 records never carry `executionId` / `measurementId` (A7.1 fields).
 */
export interface CapabilityLifecycleRecord {
  recordId: string;
  target: CapabilityLifecycleTarget;
  intent: CapabilityLifecycleIntent;
  eventType: CapabilityLifecycleEventType;
  timestamp: string;
  proposalId?: string;
  decisionId?: string;
  /** A7.1 — must be absent in A7.0 records. */
  executionId?: string;
  /** A7.1 — must be absent in A7.0 records. */
  measurementId?: string;
  evidenceRefs: string[];
  observedLifecycleState: LifecycleState | null;
  proposedLifecycleState: LifecycleState;
  decisionKind?: GovernanceDecisionKind;
  /** A7.1 — full A3 GovernanceDecision persisted on `decided` records. */
  decision?: GovernanceDecision;
  /** A7.1 — present on `measured` records; pre-application baseline evidence. */
  baselineEvidenceRefs?: string[];
  /** A7.1 — present on `measured` records; post-application observation evidence. */
  postObservationRefs?: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const P5_5_LIFECYCLE_STATES: readonly LifecycleState[] = [
  "emerging", "active", "mature", "stagnant", "declining", "deprecated",
];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function validateCapabilityLifecycleRecord(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["CapabilityLifecycleRecord must be an object"] };
  }
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.recordId)) errors.push("recordId required and must be non-empty");
  if (!v.target || typeof v.target !== "object" || !isNonEmptyString((v.target as Record<string, unknown>).capabilityId)) {
    errors.push("target.capabilityId required and must be non-empty");
  }
  if (typeof v.intent !== "string" || !(CAPABILITY_LIFECYCLE_INTENTS as readonly string[]).includes(v.intent)) {
    errors.push(`intent must be one of: ${CAPABILITY_LIFECYCLE_INTENTS.join(", ")}`);
  }
  if (typeof v.eventType !== "string" || !(CAPABILITY_LIFECYCLE_EVENT_TYPES as readonly string[]).includes(v.eventType)) {
    errors.push(`eventType must be one of: ${CAPABILITY_LIFECYCLE_EVENT_TYPES.join(", ")}`);
  }
  if (!isNonEmptyString(v.timestamp)) errors.push("timestamp required and must be non-empty");
  if (!Array.isArray(v.evidenceRefs)) errors.push("evidenceRefs must be an array");
  if (v.eventType === "decided") {
    if (!isNonEmptyString(v.decisionId)) errors.push("decided record requires decisionId");
    if (!isNonEmptyString(v.proposalId)) errors.push("decided record requires proposalId");
    if (typeof v.decisionKind !== "string" || !["APPROVE", "REJECT", "MONITOR", "REQUEST_MORE_EVIDENCE"].includes(v.decisionKind)) {
      errors.push("decided record requires a valid decisionKind");
    }
    if (isNonEmptyString(v.executionId)) errors.push("decided record must not carry executionId");
    if (isNonEmptyString(v.measurementId)) errors.push("decided record must not carry measurementId");
  }
  if (v.eventType === "proposed" && !isNonEmptyString(v.proposalId)) {
    errors.push("proposed record requires proposalId");
  }
  if (v.eventType === "applied") {
    if (!isNonEmptyString(v.executionId)) errors.push("applied record requires executionId");
    if (!isNonEmptyString(v.decisionId)) errors.push("applied record requires decisionId");
    if (isNonEmptyString(v.measurementId)) errors.push("applied record must not carry measurementId");
  }
  if (v.eventType === "measured") {
    if (!isNonEmptyString(v.measurementId)) errors.push("measured record requires measurementId");
    if (!Array.isArray(v.baselineEvidenceRefs)) errors.push("measured record requires baselineEvidenceRefs array");
    if (!Array.isArray(v.postObservationRefs)) errors.push("measured record requires postObservationRefs array");
  }
  if (v.observedLifecycleState !== null && typeof v.observedLifecycleState === "string") {
    if (!(P5_5_LIFECYCLE_STATES as readonly string[]).includes(v.observedLifecycleState)) {
      errors.push("observedLifecycleState must be a P5.5 lifecycle state or null");
    }
  } else if (v.observedLifecycleState !== null && typeof v.observedLifecycleState !== "string") {
    errors.push("observedLifecycleState must be a P5.5 lifecycle state or null");
  }
  if (typeof v.proposedLifecycleState !== "string" || !(P5_5_LIFECYCLE_STATES as readonly string[]).includes(v.proposedLifecycleState)) {
    errors.push("proposedLifecycleState must be a P5.5 lifecycle state");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Deterministic record id (spec §5.2 identity rule)
// ---------------------------------------------------------------------------

/**
 * Deterministic record id derived from an immutable artifact. Used for
 * proposed/decided records which carry a proposalId/decisionId. The default
 * append path generates a write-time unique id instead; a timestamp is never
 * part of the identity.
 */
export function computeDeterministicRecordId(
  eventType: CapabilityLifecycleEventType,
  correlationId: string,
): string {
  const hash = createHash("sha256");
  hash.update(`a7-record|${eventType}|${correlationId}`, "utf-8");
  return `clr-${hash.digest("hex").slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Derived projection state (spec §5.3)
// ---------------------------------------------------------------------------

/**
 * Governance-overlay projection state. NEVER enters LifecycleState — the P5.5
 * enum remains `emerging|active|mature|stagnant|declining|deprecated`.
 */
export type CapabilityProjectionState =
  | "PROPOSED"
  | "REJECTED"
  | "APPROVED_PENDING_APPLICATION"
  | "APPLIED"
  | "MEASURED";

/**
 * Projection over (latest A7 decision). The registry's current state remains
 * authoritative and is read separately by the caller.
 */
export function deriveCapabilityProjectionState(
  latestDecision: CapabilityLifecycleRecord | null,
): CapabilityProjectionState {
  if (!latestDecision || latestDecision.eventType === "intent" || latestDecision.eventType === "proposed") return "PROPOSED";
  if (latestDecision.eventType === "applied") return "APPLIED";
  if (latestDecision.eventType === "measured") return "MEASURED";
  if (latestDecision.decisionKind === "REJECT") return "REJECTED";
  return "APPROVED_PENDING_APPLICATION"; // APPROVE / MONITOR / REQUEST_MORE_EVIDENCE
}

// ---------------------------------------------------------------------------
// Analyzer inputs / candidates
// ---------------------------------------------------------------------------

export interface CapabilityAdoptionTelemetry {
  invocationCount: number;
  successRate: number;
}

export interface CapabilitySignalInputs {
  health: CapabilityHealth[];
  gaps: CapabilityGap[];
  overlap: CapabilityOverlap[];
  drift: CapabilityDrift[];
  /** Per-capability invocation telemetry, keyed by capabilityId. */
  adoption: Record<string, CapabilityAdoptionTelemetry>;
  /** A5 observed evidence — outcome effectiveness. */
  outcome: VerificationEvidence[];
  /** A6 curated patterns — corroborating evidence. */
  patterns: PatternObservation[];
}

export interface CapabilityLifecycleCandidate {
  intent: CapabilityLifecycleIntent;
  target: CapabilityLifecycleTarget;
  confidence: number;
  rationale: string[];
  evidenceRefs: string[];
  observedLifecycleState: LifecycleState | null;
  proposedLifecycleState: LifecycleState;
}
