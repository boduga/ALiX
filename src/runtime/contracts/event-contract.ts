// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.1 — Runtime Event Contract
 *
 * Defines the contract for all runtime events in the ALiX system.
 * Every event producer and consumer MUST adhere to these types and invariants.
 *
 * This contract mirrors the concrete types in {@link ../../events/types.ts} and
 * the {@link ../../events/event-log.ts EventLog} class.  It exists as the
 * single source of truth that consumers (stores, governance, dashboards) depend
 * on — the implementation files are the reference, this contract is the
 * interface that must not drift.
 *
 * ─────────────── EVENT IMMUTABILITY INVARIANTS ───────────────
 *
 * The event log is APPEND-ONLY.  Once committed, an event is final:
 *
 *   - **No rewrite:**  An event's `payload` and `meta` are set at creation time
 *     and never altered.  There is no "update event" — correction events are
 *     emitted as new events with a compensating or superseding type.
 *   - **No delete:**  Events persist for the lifetime of the log.  There is no
 *     `delete()` method on `EventLog` and no contract-level delete operation.
 *   - **No mutation:**  None of `AlixEvent`'s fields are mutable after commit.
 *     The `EventMeta` sub-object, when present, is also frozen at creation.
 *   - **Sequence monotonicity:**  `seq` increases by exactly 1 per append and
 *     is never recycled, skipped for reuse, or reset within a log instance.
 *   - **Append atomicity:**  Each `append()` call produces exactly one event
 *     record on durable storage before resolving.
 *   - **Write-once identity:**  `id` (UUIDv4) is assigned by the log at append
 *     time and is globally unique.  A reader never sees two events with the
 *     same `id`.
 *
 * These invariants are enforced structurally by the `EventLog` implementation
 * and by this contract's type definitions — there is no runtime enforcement
 * layer that validates them after-the-fact (readers trust the log).
 *
 * @module event-contract
 */

import type {
  AlixEvent,
  EventActor,
  EventMeta,
  NewEvent,
} from "../../events/types.js";

// ─── Core Event Types ───────────────────────────────────────────

export type { AlixEvent, EventActor, EventMeta, NewEvent };

// ─── Event Actor ────────────────────────────────────────────────

/**
 * Union of every possible event actor.
 * Matches {@link EventActor} in `src/events/types.ts` exactly.
 */
export type AlixEventActor = EventActor;

// ─── Event Identifiers ──────────────────────────────────────────

/**
 * Event immutability rule: the type-level constant version.
 * Used by contract consumers to assert the invariant at compile time.
 */
export type EventImmutabilityAssertion = {
  readonly appendOnly: true;
  readonly noRewrite: true;
  readonly noDelete: true;
  readonly noMutation: true;
  readonly seqMonotonic: true;
  readonly appendAtomic: true;
  readonly writeOnceIdentity: true;
};

/**
 * Singleton asserting all immutability rules are active.
 * Consumers that depend on event immutability can reference this value
 * as a documentary anchor rather than repeating the invariant.
 */
export const EVENT_IMMUTABILITY: EventImmutabilityAssertion = {
  appendOnly: true,
  noRewrite: true,
  noDelete: true,
  noMutation: true,
  seqMonotonic: true,
  appendAtomic: true,
  writeOnceIdentity: true,
} as const;

// ─── Event Type Categories ──────────────────────────────────────

/**
 * All 16+ event type categories in the system.
 *
 * Each constant group is defined in `src/events/types.ts` and re-exported
 * here for contract consumers.  The string values are the canonical event
 * type strings used at runtime.
 *
 * | Category              | Source constant            | Count |
 * |-----------------------|----------------------------|-------|
 * | Tool                  | `TOOL_EVENT_TYPES`         | 5     |
 * | Patch                 | `PATCH_EVENT_TYPES`        | 8     |
 * | File                  | `FILE_EVENT_TYPES`         | 2     |
 * | Agent                 | `AGENT_EVENT_TYPES`        | 3     |
 * | MCP                   | `MCP_EVENT_TYPES`          | 1     |
 * | Ownership             | `OWNERSHIP_EVENT_TYPES`    | 8     |
 * | Coordination          | `COORDINATION_EVENT_TYPES` | 8     |
 * | Collaboration         | `COLLABORATION_EVENT_TYPES`| 10    |
 * | Conflict              | `CONFLICT_EVENT_TYPES`     | 9     |
 * | Subagent              | `SUBAGENT_EVENT_TYPES`     | 2     |
 * | Context               | `CONTEXT_EVENT_TYPES`      | 5     |
 * | Policy                | `POLICY_EVENT_TYPES`       | 3     |
 * | Artifact              | `ARTIFACT_EVENT_TYPES`     | 1     |
 * | Approval              | `APPROVAL_EVENT_TYPES`     | 11    |
 * | Replay                | `REPLAY_EVENT_TYPES`       | 9     |
 * | Rollback              | `ROLLBACK_EVENT_TYPES`     | 8     |
 *
 * Consumers SHOULD import the canonical constants from `src/events/types.ts`
 * rather than redefining string literals.  This contract re-exports them as a
 * convenience for downstream packages.
 */
export {
  // Tool lifecycle
  TOOL_EVENT_TYPES,
  // Patch lifecycle
  PATCH_EVENT_TYPES,
  // File events
  FILE_EVENT_TYPES,
  // Agent messaging
  AGENT_EVENT_TYPES,
  // MCP invocations
  MCP_EVENT_TYPES,
  // Ownership lifecycle
  OWNERSHIP_EVENT_TYPES,
  // Coordination lifecycle
  COORDINATION_EVENT_TYPES,
  // Collaboration lifecycle
  COLLABORATION_EVENT_TYPES,
  // Conflict lifecycle
  CONFLICT_EVENT_TYPES,
  // Subagent lifecycle
  SUBAGENT_EVENT_TYPES,
  // Context lifecycle
  CONTEXT_EVENT_TYPES,
  // Policy decisions
  POLICY_EVENT_TYPES,
  // Artifact lifecycle
  ARTIFACT_EVENT_TYPES,
  // Approval lifecycle
  APPROVAL_EVENT_TYPES,
  // Replay lifecycle
  REPLAY_EVENT_TYPES,
  // Rollback lifecycle
  ROLLBACK_EVENT_TYPES,
} from "../../events/types.js";

// ─── EventLog Contract Interface ────────────────────────────────

/**
 * Type of a callback registered via {@link EventLogContract.watch}.
 * Receives every newly-appended event in real time.
 */
export type EventLogListener = (event: AlixEvent) => void;

/**
 * Contract for the event log storage layer.
 *
 * Maps 1:1 to the {@link EventLog} class in `src/events/event-log.ts`.
 * Every method signature matches the concrete implementation so that
 * consumers coded against this interface can swap logs or be tested
 * with a mock that satisfies the same shape.
 *
 * @example
 * ```ts
 * function consume(log: EventLogContract) {
 *   await log.init();
 *   const event = await log.append({ type: "tool.requested", actor: "agent", payload: { ... } });
 *   const all = await log.readAll();
 *   const stop = log.watch((e) => console.log(e.seq));
 *   await log.close();
 *   stop();
 * }
 * ```
 */
export interface EventLogContract {
  /**
   * Absolute path to the JSONL file backing this log.
   * Immutable for the lifetime of the log instance.
   */
  readonly path: string;

  /**
   * Initialise the log: ensure the parent directory exists and
   * recover the next sequence number from the existing event set.
   * MUST be called before the first `append()`.
   */
  init(): Promise<void>;

  /**
   * Append a new event to the log.
   *
   * @param event - Everything except `id`, `seq`, `version`, `timestamp`
   *   (those are assigned by the log).
   * @returns The fully-materialised event with all system-assigned fields.
   */
  append<TType extends string, TPayload>(
    event: NewEvent<TType, TPayload>,
  ): Promise<AlixEvent<TType, TPayload>>;

  /**
   * Read every event currently in the log.
   *
   * Returns events in append-order (ascending seq).  Logically equivalent
   * to the full event history up to the moment of the call.
   */
  readAll(): Promise<AlixEvent[]>;

  /**
   * Close the log and release any resources.
   *
   * For the file-based implementation this is a no-op — all I/O is
   * completed before `append()` resolves.  Kept for interface
   * compatibility with remote or buffered log backends.
   */
  close(): Promise<void>;

  /**
   * Register an in-memory listener that is notified synchronously
   * after each append.
   *
   * @returns A stop function that, when called, removes the listener.
   */
  watch(listener: EventLogListener): () => void;

  /**
   * Start polling the log file for new records and notify `listener`
   * of each one.  Useful for cross-process or long-running watchers
   * that cannot use the in-memory `watch()` path.
   *
   * @returns A stop function that stops polling.
   */
  startWatching(listener: EventLogListener): Promise<() => void>;
}

// ─── (No runtime code in this file — pure type exports, re-exports,
//        and a const assertion that serves as documentary anchor.) ──
