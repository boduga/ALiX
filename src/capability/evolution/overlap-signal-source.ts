// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * P5.5/P5.6 — Pair layer (overlay-signal-source) bridge to A7.
 *
 * Locked ruling #543 (2026-08-14): A capability-pair recommendation layer
 * exists as a read-only bridge from P5.5 pair evidence to A7 proposal
 * construction. It identifies candidate PAIRS only; proposal identity
 * assignment (survivor + absorbed set) remains the authorized caller's
 * responsibility.
 *
 * This module implements `ProposalSignalSource` (`a7-proposals.ts`). Its
 * `signals()` method:
 *   1. Reads canonical inputs via the injected `inputs()` function.
 *   2. Calls the injected `CapabilityOverlapAnalyzer` with a
 *      `minOverlapScore` of 0.7 (locked ruling: `consolidationCandidate`
 *      threshold is binary; no banded confidence).
 *   3. For each `consolidationCandidate === true` overlap, calls the
 *      injected `identitySupplier` to obtain the caller-supplied
 *      survivor + absorbed set.
 *   4. If `identitySupplier` returns `null`, the overlap is skipped
 *      (no signal is emitted — the layer does not invent identities).
 *   5. Otherwise, emits a single `consolidation_opportunity` signal
 *      carrying the caller-supplied identity verbatim, plus pair-evidence
 *      primitives in `evidenceIds`.
 *
 * Hard architectural boundary (ruling #543):
 *   - MUST NOT derive survivor identity from pair evidence.
 *   - MUST NOT derive, infer, expand, or complete the absorbed set.
 *   - MUST NOT emit a merge direction.
 *   - MUST NOT perform any consolidation mutation.
 *   - MUST NOT introduce an execution target.
 *   - MUST NOT derive confidence bands (binary threshold only).
 *   - MUST NOT persist output (transient; recomputed per A7 cycle —
 *     ruling #534 persistence).
 *
 * The pair layer is a TRANSPORT mechanism for pair evidence + caller-supplied
 * identity. The pair recommendation is EVIDENCE for proposal construction,
 * not an authorization to consolidate.
 *
 * @module capability/evolution/overlap-signal-source
 */

import { CapabilityOverlapAnalyzer } from "../../adaptation/capability-overlap-analyzer.js";
import type { CapabilityOverlap } from "../../adaptation/capability-evolution-types.js";
import type {
  CapabilityEvolutionSignal,
  ProposalSignalSource,
} from "./a7-proposals.js";

// ---------------------------------------------------------------------------
// Canonical input shape (matches CapabilityOverlapAnalyzer's internal types)
// ---------------------------------------------------------------------------

/**
 * Minimal agent card shape required by the analyzer. Structural —
 * callers supply whichever richer type they have.
 */
export interface OverlapAgentCardInput {
  readonly id: string;
  readonly capabilities: string[];
}

/**
 * Minimal proposal shape required by the analyzer.
 */
export interface OverlapProposalInput {
  readonly target: { readonly kind: string; readonly capability?: string };
  readonly payload?: Record<string, unknown>;
}

/**
 * Minimal capability event shape required by the analyzer.
 */
export interface OverlapCapabilityEventInput {
  readonly payload: { readonly capability?: string };
}

/**
 * Canonical inputs read by the pair layer's `signals()` invocation.
 * The `inputs()` function (`overlapSignalSourceOptions.inputs`) is
 * responsible for sourcing these from canonical surfaces (agent cards,
 * proposal store, capability event log). The pair layer itself is
 * stateless between invocations.
 */
export interface OverlapProposalSignalSourceInputs {
  readonly agentCards: ReadonlyArray<OverlapAgentCardInput>;
  readonly proposals: ReadonlyArray<OverlapProposalInput>;
  readonly capabilityEvents: ReadonlyArray<OverlapCapabilityEventInput>;
  readonly registeredCapabilities: ReadonlyArray<string>;
}

/**
 * Caller-supplied identity for a consolidation opportunity.
 *
 * Ruling #543/534: SURVIVOR and ABSORBED identities are caller-supplied.
 * The pair layer does NOT derive these. The pair layer SKIPS an overlap
 * when `identitySupplier` returns `null` (no caller bound to this pair).
 *
 * The operator-CLI binding (ticket #309 / ruling #544) is the assigned
 * identity owner. Until that binding exists, the composition-root default
 * returns `null` for every overlap (no signals emitted).
 */
export type OverlapIdentitySupplier = (overlap: CapabilityOverlap) => {
  readonly survivorCapabilityId: string;
  readonly absorbedCapabilityIds: ReadonlyArray<string>;
} | null;

/**
 * Options for the pair layer.
 *
 * All three dependencies are INJECTED. The pair layer does not perform
 * I/O, does not read any store, and does not write any state. It mirrors
 * the A8 read-only adapter pattern (`learning-cli.ts:63-68`).
 */
export interface OverlapProposalSignalSourceOptions {
  readonly analyzer: CapabilityOverlapAnalyzer;
  readonly inputs: () => Promise<OverlapProposalSignalSourceInputs>;
  readonly identitySupplier: OverlapIdentitySupplier;
  /**
   * Minimum overlap score for a pair to be considered a candidate
   * (default 0.7 — matches `consolidationCandidate` threshold per
   * locked ruling #534).
   */
  readonly minOverlapScore?: number;
}

/**
 * Pair layer (opaque-name source).
 *
 * Implements `ProposalSignalSource`. The name signals provenance to
 * downstream telemetry; it is purely informational.
 */
export class OverlapProposalSignalSource implements ProposalSignalSource {
  private readonly analyzer: CapabilityOverlapAnalyzer;
  private readonly inputs: () => Promise<OverlapProposalSignalSourceInputs>;
  private readonly identitySupplier: OverlapIdentitySupplier;
  private readonly minOverlapScore: number;

  constructor(options: OverlapProposalSignalSourceOptions) {
    this.analyzer = options.analyzer;
    this.inputs = options.inputs;
    this.identitySupplier = options.identitySupplier;
    this.minOverlapScore = options.minOverlapScore ?? 0.7;
  }

  /**
   * Emit one `consolidation_opportunity` signal per pair with
   * `consolidationCandidate === true` AND a caller-supplied identity.
   *
   * Returns an empty array when:
   *   - inputs are empty,
   *   - no overlap meets the threshold,
   *   - no overlap has a caller-supplied identity,
   *   - the analyzer returns no candidates.
   *
   * Errors from the inputs or analyzer propagate (no swallowing).
   */
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    const inputs = await this.inputs();
    const overlaps = this.analyzer.analyze({
      registeredCapabilities: [...inputs.registeredCapabilities],
      agentCards: [...inputs.agentCards],
      proposals: [...inputs.proposals],
      capabilityEvents: [...inputs.capabilityEvents],
      minOverlapScore: this.minOverlapScore,
    });

    const signals: CapabilityEvolutionSignal[] = [];
    for (const overlap of overlaps) {
      if (!overlap.consolidationCandidate) continue;
      const identity = this.identitySupplier(overlap);
      if (identity === null) continue;

      // Ruling #534: caller-supplied identity transported verbatim.
      // The pair layer itself does NOT invent survivor or absorbed set;
      // whatever the caller assembles is what propagates.
      // Validator (`validateConsolidationOpportunitySignal` in
      // a7-proposals.ts) enforces `absorbedCapabilityIds.length >= 1`
      // downstream — `signalToCandidate` reacts by throwing on
      // empty arrays, so any caller error surfaces here too.
      const signal: CapabilityEvolutionSignal = {
        kind: "consolidation_opportunity",
        survivorCapabilityId: identity.survivorCapabilityId,
        absorbedCapabilityIds: [...identity.absorbedCapabilityIds],
        score: overlap.overlapScore,
        // Pair-evidence provenance. Note: we deliberately encode
        // pair primitives in `evidenceIds` (which the signal contract
        // already defines as opaque fingerprints) rather than
        // introducing a top-level pair-evidence struct. The signal's
        // top-level fields remain the locked A7 contract
        // (kind/survivor/absorbed/score/evidenceIds); the pair layer
        // does NOT add pair-only fields to the signal body.
        evidenceIds: [
          `p5.5-pair:${overlap.capabilityA}<>${overlap.capabilityB}`,
          `overlapScore=${overlap.overlapScore.toFixed(4)}`,
          `coverageAtoB=${overlap.coverageAtoB.toFixed(4)}`,
          `coverageBtoA=${overlap.coverageBtoA.toFixed(4)}`,
          `sharedSignalCount=${overlap.sharedSignalCount}`,
        ],
      };
      signals.push(signal);
    }
    return signals;
  }
}

// ---------------------------------------------------------------------------
// Composite signal source (composition-root helper)
// ---------------------------------------------------------------------------

/**
 * Concatenates signals from multiple `ProposalSignalSource` instances.
 *
 * Composition-root only — used to fan A5 measurement signals and
 * pair-layer overlap signals into a single A7 `signalSource`. The
 * pair layer itself does not depend on this class; it is provided
 * here for the platform wiring to keep A7's surface area unchanged.
 */
export class CompositeProposalSignalSource implements ProposalSignalSource {
  constructor(
    private readonly sources: ReadonlyArray<ProposalSignalSource>,
  ) {}

  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    const nested = await Promise.all(
      this.sources.map((s) => s.signals()),
    );
    return nested.flat();
  }
}
