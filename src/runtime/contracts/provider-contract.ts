// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.3 — Runtime Provider Contract
 *
 * Defines the contract for all LLM provider interactions in the ALiX system.
 * Every provider adapter, registry consumer, and selection layer MUST adhere
 * to these types and invariants.
 *
 * This contract mirrors the concrete types in {@link ../../providers/types.ts}
 * and the {@link ../../providers/base.ts BaseProvider} class, plus the
 * registration and provider-creation patterns in
 * {@link ../../providers/registry.ts}.  It exists as the single source of
 * truth that consumers (agent loop, capability negotiation, selection logic)
 * depend on — the implementation files are the reference, this contract is
 * the interface that must not drift.
 *
 * ─────────────── PROVIDER INVARIANTS ───────────────
 *
 * **ModelAdapter immutability:**  Once constructed, a provider adapter's
 * `id` and `capabilities` MUST NOT change over its lifetime.  Configuration
 * changes require a new adapter instance.
 *
 * **ProviderRegistry determinism:**  A registry's `listProviders()` output
 * MUST be deterministic for the same set of registered providers.
 * `getCapabilities(id)` MUST return the same `ModelCapabilities` object for
 * the same `id` across calls within the same registry instance.
 *
 * **Selection metadata is descriptive, not decisive:**
 * `ProviderSelectionMetadata` describes a provider's capabilities and
 * availability at a point in time.  It MUST NOT embed selection logic
 * (e.g., "best", "cheapest", "recommended" scores).  The decision of
 * *which* provider to use is the responsibility of a separate selection
 * layer that consumes this metadata.
 *
 * @module provider-contract
 */

import type {
  ModelCapabilities as SourceModelCapabilities,
  TokenUsage as SourceTokenUsage,
  CostProfile as SourceCostProfile,
  NormalizedMessage as SourceNormalizedMessage,
  ModelAdapter as SourceModelAdapter,
} from "../../providers/types.js";

// ─── Core Provider Types ─────────────────────────────────────────

/**
 * Capabilities of a single model on a single provider.
 * Maps 1:1 to {@link SourceModelCapabilities} in `src/providers/types.ts`.
 */
export type ModelCapabilities = SourceModelCapabilities;

/**
 * Token usage for a single provider call.
 * Maps 1:1 to {@link SourceTokenUsage} in `src/providers/types.ts`.
 */
export type TokenUsage = SourceTokenUsage;

/**
 * Cost profile for a provider model (pricing tiers).
 * Maps 1:1 to {@link SourceCostProfile} in `src/providers/types.ts`.
 */
export type CostProfile = SourceCostProfile;

/**
 * Normalised message exchanged with a provider.
 * Maps 1:1 to {@link SourceNormalizedMessage} in `src/providers/types.ts`.
 */
export type NormalizedMessage = SourceNormalizedMessage;

/**
 * Provider adapter — the interface every LLM provider must implement.
 * Maps 1:1 to {@link SourceModelAdapter} in `src/providers/types.ts`.
 */
export type ModelAdapter = SourceModelAdapter;

// ─── Provider Result ─────────────────────────────────────────────

/**
 * The result of a single provider completion call.
 *
 * Combines the response message, token usage, optional cost information,
 * and the finish reason from the provider.
 */
export type ProviderResult = {
  /** The text content returned by the provider. */
  message: string;
  /** Token usage for this completion. */
  usage: TokenUsage;
  /** Estimated cost in USD (if a cost profile is available). */
  cost?: number;
  /** Reason the provider finished (e.g. "stop", "length", "tool_calls"). */
  finishReason?: string;
};

// ─── Provider Registry Contract ──────────────────────────────────

/**
 * Information about a registered provider.
 * Maps to the entries returned by {@link ../../providers/registry.ts listProviders()}.
 */
export type ProviderInfo = {
  /** Canonical provider identifier (e.g. "anthropic", "openai"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Environment variable key for the API key, or empty string if not required. */
  envKey: string;
};

/**
 * Contract for the provider registry.
 *
 * Maps to the provider-management patterns in {@link ../../providers/registry.ts}.
 * Every consumer that discovers or selects providers SHOULD depend on this
 * interface rather than directly calling the registry module functions.
 */
export interface ProviderRegistry {
  /**
   * Retrieve a provider adapter by its canonical id.
   * Returns `undefined` if no provider with that id is registered.
   */
  getProvider(id: string): ModelAdapter | undefined;

  /**
   * Check whether a provider with the given id is available.
   */
  hasProvider(id: string): boolean;

  /**
   * List all registered providers with their metadata.
   * Guaranteed deterministic for the same set of registered providers.
   */
  listProviders(): ProviderInfo[];

  /**
   * Get the capabilities of a registered provider by id.
   * Returns `undefined` if the provider is not registered.
   */
  getCapabilities(id: string): ModelCapabilities | undefined;
}

// ─── Provider Selection Metadata ─────────────────────────────────

/**
 * Availability status of a provider at a point in time.
 */
export type ProviderAvailability = "available" | "unavailable" | "degraded";

/**
 * Descriptive metadata about a provider for selection purposes.
 *
 * **This type describes capability — it never decides.**
 *
 * `ProviderSelectionMetadata` is a passive data object that captures
 * what a provider offers and whether it is currently reachable.  It
 * MUST NOT contain selection logic, ranking scores, or comparative
 * judgments ("best", "cheapest", "recommended").  The responsibility
 * for choosing a provider belongs to a separate selection layer that
 * consumes this metadata.
 *
 * @invariant `capabilities` is the same object that the provider adapter
 *   exposes via its own `capabilities` property.  It MUST be produced
 *   by the same `ModelCapabilities` factory and MUST NOT be altered
 *   after construction.
 */
export type ProviderSelectionMetadata = {
  /** Canonical provider identifier. */
  provider: string;
  /** Model identifier on that provider. */
  model: string;
  /** Full capabilities descriptor (never partial or projected). */
  capabilities: ModelCapabilities;
  /** Current availability as observed by the metadata producer. */
  availability: ProviderAvailability;
};

// ─── Selection Metadata Invariant ────────────────────────────────

/**
 * ProviderSelectionMetadata design rule: the type-level assertion.
 *
 * Every field documents the descriptive-only contract:
 * - `capabilityDescriptionOnly: true` — metadata describes, never selects
 * - `noEmbeddedSelection: true` — no scores, ranks, or comparative judgments
 * - `noBestOrCheapest: true` — the words "best" and "cheapest" do not appear
 *
 * Consumers that depend on the descriptive-only invariant can reference
 * this value as a documentary anchor rather than repeating the rule.
 */
export type SelectionMetadataInvariant = {
  readonly capabilityDescriptionOnly: true;
  readonly noEmbeddedSelection: true;
  readonly noBestOrCheapest: true;
};

/**
 * Singleton asserting all selection-metadata invariants are active.
 */
export const SELECTION_METADATA_INVARIANT: SelectionMetadataInvariant = {
  capabilityDescriptionOnly: true,
  noEmbeddedSelection: true,
  noBestOrCheapest: true,
} as const;

// ─── (No runtime code in this file — pure type exports, re-exports,
//        and const assertions that serve as documentary anchors.) ──
