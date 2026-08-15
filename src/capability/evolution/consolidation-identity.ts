// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-P — the canonical `ConsolidationIdentity` bundle.
 *
 * The quartet `(survivorCapabilityId, absorbedCapabilityIds,
 * consolidateDefinition, sourceDisposition)` is the COMPLETE governed set an
 * authorized caller supplies for a consolidation (locked rulings #534 and
 * #544). Before this module the quartet was re-encoded field-by-field across
 * six types — a data clump that forced shotgun surgery on every contract
 * change. It is now named once here and reused at every seam.
 *
 * Hard architectural boundary (rulings #534, #543, #544) — unchanged by this
 * consolidation of the shape:
 * - Every field is caller-supplied. No layer derives, infers, expands,
 *   completes, reorders, or de-duplicates any of them.
 * - `validateConsolidationIdentity` REJECTS a malformed set; it never repairs
 *   one.
 *
 * @module capability/evolution/consolidation-identity
 */

import type { CapabilityDefinition } from "../canonical/definition.js";

/**
 * Disposition applied to the absorbed capabilities once the survivor has
 * absorbed them. Caller-supplied (ruling #544) — never inferred.
 *
 * - `"deprecate"` — the absorbed capabilities transition to the `deprecated`
 *   lifecycle state and remain in the catalog.
 * - `"remove"` — the absorbed capabilities are removed from the catalog.
 */
export type SourceDisposition = "deprecate" | "remove";

/** The two legal `SourceDisposition` values, in canonical order. */
export const SOURCE_DISPOSITIONS: readonly SourceDisposition[] = Object.freeze([
  "deprecate",
  "remove",
] as const);

/** Narrowing predicate for an untrusted `sourceDisposition` value. */
export function isSourceDisposition(value: unknown): value is SourceDisposition {
  return value === "deprecate" || value === "remove";
}

/**
 * The complete governed set for one consolidation.
 *
 * Every field is REQUIRED and caller-supplied. This is the single named shape
 * that crosses the operator CLI (#544), the pair layer's identity supplier
 * (#543), the `consolidation_opportunity` signal, and the A7 candidate.
 */
export interface ConsolidationIdentity {
  /** Caller-supplied surviving capability id (ruling #534). */
  readonly survivorCapabilityId: string;
  /**
   * Caller-supplied COMPLETE absorbed set (ruling #534). Non-empty, and never
   * containing the survivor.
   */
  readonly absorbedCapabilityIds: readonly string[];
  /**
   * Caller-supplied resulting target definition (CAP-9 ruling #8 /
   * ruling #544). The governance caller owns its construction.
   */
  readonly consolidateDefinition: CapabilityDefinition;
  /** Caller-supplied disposition for the absorbed capabilities (ruling #544). */
  readonly sourceDisposition: SourceDisposition;
}

/**
 * Light structural check on a caller-supplied `consolidateDefinition`.
 *
 * Deliberately shallow: the executor's `validateConsolidate()`
 * (mutation-contract.ts) enforces the conservative merge invariants against
 * catalog-resolved sources. This only rejects a value that is not a
 * definition at all.
 *
 * OWNERSHIP (revised from spec §4.4): this module — not A7 — owns the
 * "is this well-formed?" predicates that span multiple consumers (A7 signal
 * contract, the executor's wire-up in `capability-service.ts`, and the CLI
 * parser). `consolidation-identity` owns shape invariants on the quartet;
 * A7 owns the signal CONTRACT. The previous spec naming
 * (`isValidConsolidateDefinition` on A7) is superseded — this is the
 * intentional cross-module import boundary, not a reversal of A7's signal
 * authority. A7 still constructs the signal; A7 just consults shape
 * predicates from the module that owns them.
 */
export function isWellFormedConsolidateDefinition(
  value: unknown,
): value is CapabilityDefinition {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v["id"] !== "string" || v["id"].length === 0) return false;
  if (typeof v["version"] !== "string" || v["version"].length === 0) return false;
  if (typeof v["kind"] !== "string" || v["kind"].length === 0) return false;
  return true;
}

/**
 * Bundle a `consolidation_opportunity` signal's governed quartet into a
 * `ConsolidationIdentity`.
 *
 * Caller-supplied shape only (ruling #534, ruling #544): no derivation,
 * inference, expansion, or completion. `absorbedCapabilityIds` is copied
 * defensively so downstream mutations of the original signal array do not
 * leak into the bundled identity.
 *
 * Code-review pass 3 (J1) — extracted from the inline literal in
 * `a7-proposals.ts` (`signalToCandidate`) so the operator CLI and any other
 * signal-source seam can build the same bundle without duplication.
 *
 * Note: this accepts the `consolidation_opportunity` arm of the
 * `CapabilityEvolutionSignal` discriminated union directly; callers that
 * hold a generic `CapabilityEvolutionSignal` MUST narrow before invoking
 * this helper (see `signalToCandidate`).
 */
export function bundleConsolidationIdentity(
  signal: ConsolidationOpportunitySignal,
): ConsolidationIdentity {
  return {
    survivorCapabilityId: signal.survivorCapabilityId,
    absorbedCapabilityIds: [...signal.absorbedCapabilityIds],
    consolidateDefinition: signal.consolidateDefinition,
    sourceDisposition: signal.sourceDisposition,
  };
}

/**
 * The caller-supplied governed-quartet arm of the `CapabilityEvolutionSignal`
 * discriminated union.
 *
 * Re-exported here so callers of `bundleConsolidationIdentity` can import
 * the narrow type alongside the bundle helper without depending on
 * `a7-proposals.ts`.
 */
export interface ConsolidationOpportunitySignal {
  readonly kind: "consolidation_opportunity";
  readonly survivorCapabilityId: string;
  readonly absorbedCapabilityIds: readonly string[];
  readonly consolidateDefinition: CapabilityDefinition;
  readonly sourceDisposition: SourceDisposition;
  readonly score: number;
  readonly evidenceIds: ReadonlyArray<string>;
}

/**
 * Validate — never complete — a caller-supplied `ConsolidationIdentity`.
 *
 * Throws on violation. Performs NO derivation, inference, expansion, or
 * completion of any field: an authorized caller supplies the whole governed
 * set or the request is rejected.
 */
export function validateConsolidationIdentity(identity: ConsolidationIdentity): void {
  if (typeof identity.survivorCapabilityId !== "string" || identity.survivorCapabilityId === "") {
    throw new Error(
      "ConsolidationIdentity: survivorCapabilityId must be a non-empty string (ruling #534 — caller-supplied survivor)",
    );
  }
  if (
    !Array.isArray(identity.absorbedCapabilityIds) ||
    identity.absorbedCapabilityIds.length < 1
  ) {
    throw new Error(
      "ConsolidationIdentity: absorbedCapabilityIds must be a non-empty array (ruling #534 — caller-supplied complete governed set)",
    );
  }
  if (identity.absorbedCapabilityIds.includes(identity.survivorCapabilityId)) {
    throw new Error(
      `ConsolidationIdentity: survivor '${identity.survivorCapabilityId}' must not appear in absorbedCapabilityIds (target must not be one of the sources)`,
    );
  }
  if (!isWellFormedConsolidateDefinition(identity.consolidateDefinition)) {
    throw new Error(
      "ConsolidationIdentity: consolidateDefinition is required and must be a well-formed CapabilityDefinition (ruling #544 — caller-supplied target definition)",
    );
  }
  if (!isSourceDisposition(identity.sourceDisposition)) {
    throw new Error(
      `ConsolidationIdentity: sourceDisposition must be 'deprecate' or 'remove' (ruling #544 — caller-supplied disposition); observed='${String(identity.sourceDisposition)}'`,
    );
  }
}
