// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.7 — Runtime Observability Contract
 *
 * Defines the contract for runtime observability evidence in the ALiX system.
 * Bridges runtime events to P14–P30 governance by providing a standardised
 * evidence envelope that all observability consumers (governance, dashboards,
 * audit trails) depend on.
 *
 * ─────────────── GOVERNANCE EVIDENCE INVARIANTS ───────────────
 *
 * **Immutable identity:** Once observed, an evidence record's `eventId` and
 * `timestamp` are fixed for its lifetime.  No consumer may alter these fields.
 *
 * **Governance-relevant filtering:** The `governanceRelevant` flag is the sole
 * gate for whether an evidence record is forwarded to P14–P30 governance
 * pipelines.  A record with `governanceRelevant: false` MUST be excluded from
 * governance processing.
 *
 * **Trace linkage:** `traceIds` connects this evidence to one or more
 * distributed traces.  An empty array means the record is not part of any
 * trace — consumers MUST handle this case without error.
 *
 * **Append-only evidence log:** Evidence records are ADDED to the observation
 * log — never removed, never mutated after ingestion.  Correction evidence
 * is emitted as a new record with a new `eventId`.
 *
 * @module observability-contract
 */

// ─── Core Observability Types ────────────────────────────────────

/**
 * A single piece of runtime evidence observed by the ALiX observability layer.
 *
 * Every observable runtime event (tool call, state transition, scope expansion,
 * memory operation, etc.) is captured as a `RuntimeEvidence` record.  These
 * records form the bridge between raw runtime telemetry and the P14–P30
 * governance pipeline.
 *
 * @property eventId           - Globally unique identifier for this evidence record (UUIDv4).
 * @property timestamp         - ISO 8601 timestamp of when the event was observed.
 * @property sourceType        - The category or originating subsystem of the event
 *                               (e.g., `"tool"`, `"agent"`, `"memory"`, `"replay"`).
 * @property description       - Human-readable description of the observed event.
 * @property governanceRelevant - Whether this evidence should be forwarded to the
 *                               P14–P30 governance pipeline.  `false` means the record
 *                               is purely operational and MUST be excluded from governance.
 * @property traceIds          - Distributed trace identifiers that this evidence belongs to.
 *                               May be empty (the record is not part of any trace).
 *
 * @example
 * ```ts
 * const evidence: RuntimeEvidence = {
 *   eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
 *   timestamp: "2026-07-10T12:00:00.000Z",
 *   sourceType: "tool",
 *   description: "Tool requested: file.read on /tmp/test",
 *   governanceRelevant: true,
 *   traceIds: ["trace-001"],
 * };
 * ```
 */
export type RuntimeEvidence = {
  /** Globally unique identifier for this evidence record (UUIDv4). */
  readonly eventId: string;

  /** ISO 8601 timestamp of when the event was observed. */
  readonly timestamp: string;

  /**
   * The category or originating subsystem of the event.
   *
   * Examples: `"tool"`, `"agent"`, `"memory"`, `"replay"`, `"rollback"`,
   * `"approval"`, `"context"`, `"policy"`.
   */
  readonly sourceType: string;

  /** Human-readable description of the observed event. */
  readonly description: string;

  /**
   * Whether this evidence should be forwarded to the P14–P30 governance
   * pipeline.  `false` means the record is purely operational and MUST
   * be excluded from governance processing.
   */
  readonly governanceRelevant: boolean;

  /**
   * Distributed trace identifiers that this evidence belongs to.
   * May be empty (the record is not part of any trace).
   */
  readonly traceIds: readonly string[];
};

// ─── Governance Bridge Types ──────────────────────────────────────

/**
 * A filter predicate for selecting governance-relevant evidence.
 *
 * Returns `true` when the evidence should be forwarded to the P14–P30
 * governance pipeline.  The canonical implementation is:
 *
 * ```ts
 * const isGovernanceRelevant = (e: RuntimeEvidence): boolean => e.governanceRelevant;
 * ```
 */
export type GovernanceEvidenceFilter = (evidence: RuntimeEvidence) => boolean;

// ─── Invariants ───────────────────────────────────────────────────

/**
 * Observability invariants: the type-level constant version.
 * Used by contract consumers to assert the invariants at compile time.
 */
export type ObservabilityInvariantsAssertion = {
  readonly immutableIdentity: true;
  readonly governanceRelevantFilterGate: true;
  readonly traceLinkageHandlesEmpty: true;
  readonly appendOnlyEvidenceLog: true;
};

/**
 * Singleton asserting all observability invariants are active.
 * Consumers that depend on observability invariants can reference this value
 * as a documentary anchor rather than repeating the invariant.
 */
export const OBSERVABILITY_INVARIANTS: ObservabilityInvariantsAssertion = {
  immutableIdentity: true,
  governanceRelevantFilterGate: true,
  traceLinkageHandlesEmpty: true,
  appendOnlyEvidenceLog: true,
} as const;

// ─── (No runtime code in this file — pure type exports, re-exports,
//        and a const assertion that serves as documentary anchor.) ──
