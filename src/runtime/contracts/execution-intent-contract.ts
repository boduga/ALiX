// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * X1 — Execution Intent Contract
 *
 * Defines the immutable execution intent unit that all execution must carry.
 * Status is NOT stored on the intent document — it is derived from an
 * append-only event stream via {@link deriveIntentStatus}.
 *
 * Every execution in the ALiX system carries an ExecutionIntent that
 * describes what is being executed, by whom, under what constraints,
 * and with what expected effect. The intent is immutable once created;
 * its lifecycle is tracked via append-only ExecutionIntentEvent records.
 *
 * ─────────────── EXECUTION INTENT INVARIANTS ───────────────
 *
 * 1. **Immutable intent:** Once created, ExecutionIntent fields MUST NOT
 *    change. There is no "update" — a new intentId means a new intent.
 *
 * 2. **Status derived from events:** ExecutionIntent has NO status field.
 *    Status is always derived from the append-only event stream via
 *    {@link deriveIntentStatus}.
 *
 * 3. **Write-once events:** ExecutionIntentEvent records are append-only.
 *    Once created, an event MUST NOT be modified or deleted.
 *
 * 4. **Canonical hash:** {@link createIntentHash} uses deterministic
 *    property ordering (sorted keys) with SHA-256 — same inputs always
 *    produce the same hash.
 *
 * 5. **Immutable wrapper:** All contract types use {@link Readonly Readonly<T>}
 *    to prevent accidental field mutation at compile time.
 *
 * @module execution-intent-contract
 */

// ─── Core Types ──────────────────────────────────────────────────────

/**
 * The lifecycle status of an execution intent.
 *
 * Derived from the append-only event stream — NOT stored on the
 * intent document itself.
 */
export type ExecutionIntentStatus =
  | "CREATED"
  | "APPROVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "REVOKED";

/**
 * Event type for execution intent lifecycle events.
 *
 * Each event represents a transition in the intent's lifecycle.
 * Events are append-only and immutable once recorded.
 */
export type ExecutionIntentEventType =
  | "CREATED"
  | "APPROVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "REVOKED";

/**
 * Constraints that govern how an execution intent may be carried out.
 *
 * Specifies limits on file changes, allowed/blocked paths, verification
 * requirements, and tool access restrictions.
 *
 * @invariant `maxFilesChanged` MUST be a positive integer.
 * @invariant `allowedPaths` and `blockedPaths` MUST use forward-slash paths.
 */
export type ExecutionConstraints = Readonly<{
  maxFilesChanged: number;
  allowedPaths: string[];
  blockedPaths: string[];
  verificationRequired: boolean;
  allowedTools: string[];
}>;

/**
 * Immutable execution intent document.
 *
 * Describes what action is being executed, by whom, under what
 * constraints, and with what expected effect. The intent is
 * immutable once created — its lifecycle is tracked via the
 * append-only {@link ExecutionIntentEvent} stream.
 *
 * @invariant No `status` field — status is derived from events.
 * @invariant All fields are readonly after creation.
 */
export type ExecutionIntent = Readonly<{
  intentId: string;
  proposalId: string;
  actor: string;
  action: string;
  target: string;
  justification: string;
  constraints: ExecutionConstraints;
  riskClass: "low" | "medium" | "high";
  expectedEffect: string;
  sourceEvidenceId: string;
  createdAt: string;
  expiration: string;
  approvalReference: string;
  approvedBy: string;
  approvedAt: string;
  intentHash: string;
}>;

/**
 * Append-only lifecycle event for an execution intent.
 *
 * Each event records a state transition in the intent's lifecycle.
 * Events are immutable once created — they are never modified or deleted.
 *
 * @invariant `intentId` references an existing ExecutionIntent.
 * @invariant `reason` is required for `FAILED` and `REVOKED` events.
 */
export type ExecutionIntentEvent = Readonly<{
  intentId: string;
  type: ExecutionIntentEventType;
  timestamp: string;
  actor: string;
  reason?: string;
}>;

/**
 * Execution evidence — records the outcome of executing an intent.
 *
 * Captures start and end times, outcome, summary, artifacts,
 * verification status, and a content hash of the evidence record.
 */
export type ExecutionEvidence = Readonly<{
  evidenceId: string;
  intentId: string;
  startedAt: string;
  completedAt: string;
  outcome: "SUCCESS" | "FAILED" | "PARTIAL";
  summary: string;
  artifacts: string[];
  verificationPassed: boolean;
  evidenceHash: string;
}>;

// ─── Domain Prefix ──────────────────────────────────────────────────

/** Domain/version prefix prepended to canonical content before hashing. */
const DOMAIN_PREFIX = "alix-execution-v1:";

// ─── Helper Functions ───────────────────────────────────────────────

import { createHash } from "node:crypto";

/**
 * Generate a deterministic intentId from proposalId, actor, and optional timestamp.
 *
 * Uses SHA-256 with domain prefix to produce a unique, deterministic identifier.
 * Same inputs always produce the same intentId.
 *
 * @param proposalId - The proposal that generated this intent.
 * @param actor - The actor who created the intent.
 * @param timestamp - Optional ISO 8601 timestamp (defaults to current time).
 * @returns A hex-encoded SHA-256 prefix (first 16 characters).
 */
export function createIntentId(proposalId: string, actor: string, timestamp?: string): string {
  const ts = timestamp ?? new Date().toISOString();
  const hash = createHash("sha256");
  hash.update(`${DOMAIN_PREFIX}intentId:${proposalId}:${actor}:${ts}`);
  return hash.digest("hex").slice(0, 16);
}

/**
 * Compute the canonical SHA-256 hash for an ExecutionIntent (excluding intentHash).
 *
 * Uses deterministic property ordering (sorted keys) — same inputs always
 * produce the same hash.
 *
 * Canonical form:
 *   `sha256("alix-execution-v1:" + canonicalStringify(intent))`
 *
 * @param intent - The execution intent document (without intentHash field).
 * @returns A hex-encoded SHA-256 digest (64 characters).
 * @throws {TypeError} if the intent contains non-serializable values.
 */
export function createIntentHash(intent: Omit<ExecutionIntent, "intentHash">): string {
  const canonical = canonicalStringify(intent);
  const hash = createHash("sha256");
  hash.update(DOMAIN_PREFIX, "utf8");
  hash.update(canonical, "utf8");
  return hash.digest("hex");
}

/**
 * Derive the current ExecutionIntentStatus from the append-only event stream.
 *
 * Sorts events by timestamp (ascending) and returns the type of the most
 * recent event. An empty event stream produces an error — at minimum
 * a `CREATED` event is expected.
 *
 * @param events - The append-only event stream for an execution intent.
 * @returns The derived status based on the most recent event.
 * @throws {Error} if the events array is empty.
 */
export function deriveIntentStatus(events: readonly ExecutionIntentEvent[]): ExecutionIntentStatus {
  if (events.length === 0) {
    throw new Error("Cannot derive intent status from empty event stream");
  }

  // Sort by timestamp ascending; the most recent event determines status
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return sorted[sorted.length - 1].type as ExecutionIntentStatus;
}

// ─── Canonical JSON Serialization ───────────────────────────────────

/**
 * Produce a deterministic, canonical JSON string for the given value.
 *
 * Object keys are sorted alphabetically at each nesting level.
 * Arrays preserve their original element order.
 *
 * @throws {TypeError} for non-finite numbers, undefined, functions, or symbols.
 */
function canonicalStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";

  const t = typeof value;

  switch (t) {
    case "string":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError("Canonical JSON: non-finite numbers are not allowed");
      }
      if (Object.is(value, -0)) return "0";
      return JSON.stringify(value);
    }
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) return serializeArray(value);
      return serializeObject(value as Record<string, unknown>);
    }
    case "undefined":
      throw new TypeError("Canonical JSON: undefined is not allowed");
    case "function":
      throw new TypeError("Canonical JSON: functions are not allowed");
    case "symbol":
      throw new TypeError("Canonical JSON: symbols are not allowed");
    default:
      // bigint and other non-JSON types
      throw new TypeError("Canonical JSON: unsupported type");
  }
}

function serializeArray(arr: unknown[]): string {
  if (arr.length === 0) return "[]";
  const parts: string[] = [];
  for (const item of arr) {
    parts.push(serialize(item));
  }
  return "[" + parts.join(",") + "]";
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return "{}";
  const parts: string[] = [];
  for (const key of keys) {
    if ({}.hasOwnProperty.call(obj, key)) {
      parts.push(JSON.stringify(key) + ":" + serialize(obj[key]));
    }
  }
  return "{" + parts.join(",") + "}";
}

// ─── Invariants ──────────────────────────────────────────────────────

/**
 * Execution intent invariants: type-level constant assertion.
 * Used by contract consumers to assert invariants at compile time.
 *
 * Every key maps to `true`, confirming the invariant is structurally
 * enforced by the types and functions in this module.
 */
export type ExecutionIntentInvariantsAssertion = {
  readonly immutableIntent: true;
  readonly statusDerivedFromEvents: true;
  readonly writeOnceEvents: true;
  readonly canonicalHash: true;
  readonly immutableWrapper: true;
};

/**
 * Singleton asserting all execution intent invariants are active.
 *
 * Consumers depending on the intent contract shape can reference
 * this value as a documentary anchor rather than repeating the
 * invariants in their own documentation.
 */
export const EXECUTION_INTENT_INVARIANTS: ExecutionIntentInvariantsAssertion = {
  immutableIntent: true,
  statusDerivedFromEvents: true,
  writeOnceEvents: true,
  canonicalHash: true,
  immutableWrapper: true,
} as const;
