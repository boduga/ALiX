// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.6 — Runtime Memory Contract
 *
 * Defines the contract for all memory store interactions in the ALiX system.
 * Every memory consumer (context assembly, session state, governance queries)
 * MUST adhere to these types and invariants.
 *
 * This contract mirrors the concrete types in {@link ../../utils/memory/types.ts}
 * and the {@link ../../utils/memory/store.ts MemoryStore} class.  It exists as
 * the single source of truth that downstream consumers depend on — the
 * implementation files are the reference, this contract is the interface
 * that must not drift.
 *
 * ─────────────── MEMORY INVARIANTS ───────────────
 *
 * **Immutable identity:** Once created, a `MemoryEntry`'s `name` and `type`
 * uniquely identify it for the lifetime of the store.  There is no "rename"
 * operation — a consumer that needs to change identity deletes the old entry
 * and saves a new one.
 *
 * **Append-only creation timestamp:** `createdAt` is set once at creation time
 * and never altered.  Only `modifiedAt` is updated on subsequent saves.
 *
 * **Confidence monotonicity:** `confidence` (0.0–1.0) starts at a system
 * default (0.5) and is updated only by explicit consolidation or feedback —
 * it never resets to 0.5 after being set.
 *
 * **Type categories are fixed:** The four `MemoryType` values ("user",
 * "project", "feedback", "reference") are the complete set.  No consumer may
 * introduce a new type without updating the contract.
 *
 * **No silent overwrite:** Calling `save()` on an existing `name` + `type`
 * pair updates the existing entry — it does not create a duplicate.  The
 * store provides no "upsert without confirmation" path.
 *
 * @module memory-contract
 */

import type {
  MemoryEntry as SourceMemoryEntry,
  MemoryConfig as SourceMemoryConfig,
  MemoryType as SourceMemoryType,
} from "../../utils/memory/types.js";

// ─── Core Memory Types ─────────────────────────────────────────────

/**
 * The four memory type categories in the system.
 *
 * Matches {@link SourceMemoryType} in `src/utils/memory/types.ts` exactly.
 *
 * | Value      | Purpose                          |
 * |------------|----------------------------------|
 * | `"user"`   | User-specific preferences, state |
 * | `"project"`| Project-level facts, decisions   |
 * | `"feedback"`| User feedback on ALiX actions   |
 * | `"reference"`| External reference material     |
 */
export type MemoryType = SourceMemoryType;

/**
 * A single entry in the memory store.
 *
 * Matches {@link SourceMemoryEntry} in `src/utils/memory/types.ts` exactly.
 * Every entry has a unique identity formed by its `name` + `type` pair.
 *
 * @invariant `createdAt` is immutable after creation.
 * @invariant `confidence` is always 0.0–1.0 and monotonically increases.
 */
export type MemoryEntry = SourceMemoryEntry;

/**
 * Configuration for the memory store behaviour.
 *
 * Matches {@link SourceMemoryConfig} in `src/utils/memory/types.ts` exactly.
 *
 * @invariant `decayDays` > 0 when `decayEnabled` is `true`.
 */
export type MemoryConfig = SourceMemoryConfig;

/**
 * Default memory configuration values.
 *
 * Matches {@link DEFAULT_MEMORY_CONFIG} in `src/utils/memory/types.ts`.
 * - decayEnabled: true
 * - decayDays: 30
 * - maxEntriesPerType: 50
 * - consolidateSchedule: "daily"
 * - indexMaxLines: 100
 */
export const DEFAULT_MEMORY_CONFIG = {
  decayEnabled: true,
  decayDays: 30,
  maxEntriesPerType: 50,
  consolidateSchedule: "daily" as const,
  indexMaxLines: 100,
} as const satisfies MemoryConfig;

// ─── Memory Store Contract Interface ───────────────────────────────

/**
 * Parameters for querying memory entries.
 */
export type MemoryQuery = {
  /** Text to search for in entry content and descriptions. */
  text?: string;
  /** Optional type filter. */
  type?: MemoryType;
  /** Maximum number of results (default: 10). */
  limit?: number;
};

/**
 * Contract for the memory store.
 *
 * Maps 1:1 to the {@link MemoryStore} class in `src/utils/memory/store.ts`.
 * Every method signature matches the concrete implementation so that
 * consumers coded against this interface can swap stores or be tested
 * with a mock that satisfies the same shape.
 *
 * @example
 * ```ts
 * function consume(store: MemoryStoreContract) {
 *   const entry = await store.save({ name: "pref", type: "user", content: "dark mode", ... });
 *   const found = await store.query({ text: "dark" });
 *   await store.delete("pref", "user");
 * }
 * ```
 */
export interface MemoryStoreContract {
  /**
   * Save a new memory entry or update an existing one.
   *
   * If an entry with the same `name` + `type` already exists it is
   * overwritten (modifiedAt is refreshed).  Returns the fully-materialised
   * entry with system-assigned timestamps.
   */
  save(entry: Omit<MemoryEntry, "createdAt" | "modifiedAt">): Promise<MemoryEntry>;

  /**
   * Read a single entry by its name and type.
   *
   * Returns `null` when no entry with that identity exists.
   */
  read(name: string, type: MemoryType): Promise<MemoryEntry | null>;

  /**
   * Query entries by text content, type filter, or both.
   *
   * Returns entries ordered by relevance (text match confidence) with
   * the result set bounded by `params.limit`.
   */
  query(params: MemoryQuery): Promise<MemoryEntry[]>;

  /**
   * Delete a single entry by its name and type.
   *
   * Returns `true` if an entry was deleted, `false` if no entry matched.
   */
  delete(name: string, type: MemoryType): Promise<boolean>;

  /**
   * List all entries, optionally filtered by type.
   *
   * Returns entries sorted by `modifiedAt` descending (most recent first).
   */
  list(type?: MemoryType): Promise<MemoryEntry[]>;

  /**
   * Consolidate the memory store.
   *
   * Rebuilds the index, evicts entries past `decayDays` when decay is
   * enabled, and recalculates confidence scores based on confirmation
   * counts and recency.
   */
  consolidate(): Promise<void>;
}

// ─── Memory Invariants ─────────────────────────────────────────────

/**
 * Memory invariants: the type-level constant version.
 *
 * Used by contract consumers to assert the invariant at compile time.
 */
export type MemoryInvariantsAssertion = {
  readonly immutableIdentity: true;
  readonly appendOnlyCreatedAt: true;
  readonly confidenceMonotonic: true;
  readonly fourFixedTypes: true;
  readonly noSilentOverwrite: true;
};

/**
 * Singleton asserting all memory invariants are active.
 *
 * Consumers that depend on memory invariants can reference this value
 * as a documentary anchor rather than repeating the invariant.
 */
export const MEMORY_INVARIANTS: MemoryInvariantsAssertion = {
  immutableIdentity: true,
  appendOnlyCreatedAt: true,
  confidenceMonotonic: true,
  fourFixedTypes: true,
  noSilentOverwrite: true,
} as const;

// ─── (No runtime code in this file — pure type exports, re-exports,
//        and const assertions that serve as documentary anchors.) ──
