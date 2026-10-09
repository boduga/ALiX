// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.5 — Runtime Context Contract
 *
 * Defines contract types for ALiX context management: context identification,
 * typing, ownership tracking, and cross-agent context transfer.
 * Every consumer of context data MUST adhere to these types and invariants.
 *
 * These types define the structural contract for context objects used
 * throughout the ALiX system — stores, governance pipelines, dashboards,
 * and agent handoff mechanisms all depend on this contract.
 *
 * ─────────────── CONTEXT INVARIANTS ───────────────
 *
 * 1. **Immutable identity:** Once created, `contextId` MUST NOT change
 *    over the lifetime of a context object. There is no "repurpose" —
 *    a new contextId means a new context.
 *
 * 2. **Kind fidelity:** `kind` is set at creation time and MUST accurately
 *    reflect the context's origin category. Consumers MUST NOT reinterpret
 *    a context's kind after creation.
 *
 * 3. **Owner accountability:** Every context has exactly one `ownerId`
 *    at creation. `parentContextId` is optional — when absent, the
 *    context is a root context with no parent ancestry.
 *
 * 4. **Transfer traceability:** Every `ContextTransfer` records the
 *    originating agent, the receiving agent, and an explicit list of
 *    data keys transferred. No transfer is anonymous or bulk-inferred.
 *
 * @module context-contract
 */

// ─── Context Types ────────────────────────────────────────────────

/**
 * ALiX context — identifies, categorises, and traces ownership of
 * a unit of contextual information within the system.
 *
 * Every context instance has a unique `contextId`, a `kind` that
 * categorises its origin, an `ownerId` linking it to its creating
 * entity, and a `data` payload. Optionally, `parentContextId` links
 * to a parent context for hierarchical traceability.
 *
 * @invariant `contextId` is immutable over the lifetime of the context.
 * @invariant `kind` is set at creation and must match the origin category.
 */
export type ALiXContext = {
  /** Unique identifier for this context instance. */
  readonly contextId: string;
  /** Categorises the origin: task, session, execution, or governance. */
  readonly kind: "task" | "session" | "execution" | "governance";
  /** Identifier of the entity that owns this context. */
  readonly ownerId: string;
  /** Optional identifier of the parent context for hierarchical traceability. */
  readonly parentContextId?: string;
  /** Identifier of the entity that created this context. */
  readonly createdBy: string;
  /** ISO 8601 timestamp of context creation. */
  readonly createdAt: string;
  /** Context payload data. */
  readonly data: Record<string, unknown>;
};

/**
 * Context transfer record — tracks the handoff of context data
 * from one agent to another.
 *
 * Every transfer records the originating agent (`fromAgentId`),
 * the receiving agent (`toAgentId`), the timestamp of transfer,
 * and the explicit list of data keys that were transferred.
 *
 * @invariant Every transfer has exactly one `fromAgentId` and one `toAgentId`.
 * @invariant `includesData` is an explicit allowlist — no bulk or inferred keys.
 */
export type ContextTransfer = {
  /** Identifier of the context being transferred. */
  readonly contextId: string;
  /** Identifier of the agent transferring the context. */
  readonly fromAgentId: string;
  /** Identifier of the agent receiving the context. */
  readonly toAgentId: string;
  /** ISO 8601 timestamp of the transfer. */
  readonly transferredAt: string;
  /** Explicit list of data keys included in the transfer. */
  readonly includesData: string[];
};

// ─── Invariants ──────────────────────────────────────────────────

/**
 * Context invariants: type-level constant assertion.
 * Used by contract consumers to assert invariants at compile time.
 */
export type ContextInvariantsAssertion = {
  readonly immutableIdentity: true;
  readonly kindFidelity: true;
  readonly ownerAccountability: true;
  readonly transferTraceability: true;
};

/**
 * Singleton asserting all context invariants are active.
 * Consumers depending on context shape can reference this value
 * as a documentary anchor rather than repeating invariants.
 */
export const CONTEXT_INVARIANTS: ContextInvariantsAssertion = {
  immutableIdentity: true,
  kindFidelity: true,
  ownerAccountability: true,
  transferTraceability: true,
} as const;

// ── (No runtime code in file — pure type exports and
// const assertions serve as documentary anchors.) ──
