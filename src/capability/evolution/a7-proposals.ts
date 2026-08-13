// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 5 — A7ProposalGenerator (pure, signal-only).
 *
 * A7 is the proposal-intelligence identity in CAP-9. It reads
 * `CapabilityEvolutionSignal` values from a `ProposalSignalSource` and emits
 * one `CapabilityEvolutionCandidate` per signal. No catalog reads, no
 * registry reads, no writes, no clock. The transformation is pure and
 * deterministic for a given input — `candidateId` is derived from the signal
 * body alone (no `Date.now()`, ruling #18 spirit).
 *
 * Hard architectural boundary (axis-4 sentinel, ruling #14):
 *   - MUST NOT import from the canonical-catalog mutator module
 *     (`capability/canonical/catalog`) — `CapabilityDefinition` type excepted.
 *   - MUST NOT import from the lifecycle-governance module
 *     (`evolution/capability-lifecycle`).
 *   - MUST NOT import from the policy-registry module
 *     (`policy/capability-registry`).
 *   - MUST NOT import from the tool-registry module
 *     (`tools/tool-registry`).
 *   - MUST NOT invoke any catalog registration or removal entry point.
 *   - MUST NOT invoke any registry lifecycle-state change or
 *     mutation-application entry point.
 *   - MUST NOT write to any store.
 *
 * Persistence is `service.propose()`'s sole responsibility (ruling #3).
 * The ledger-bound `proposalId` (SHA-256 of canonical-JSON candidate body)
 * is computed inside `ProposalStore.append()` — A7 only emits the candidate.
 *
 * The default factory (`defaultA7ProposalGenerator()`) is intentionally a
 * composition-root placeholder. Tests inject a fake `ProposalSignalSource`
 * via the constructor; the composition root constructs the real
 * P5.5/P5.6-backed source explicitly.
 *
 * @module capability/evolution/a7-proposals
 */

import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";
import { CapabilityEvolutionProposalGenerator } from "../../adaptation/capability-evolution-proposal-generator.js";

// ---------------------------------------------------------------------------
// Signal discriminator
// ---------------------------------------------------------------------------

/**
 * CAP-9 — A7 input signal. Discriminated union over four kinds produced by
 * the P5.5/P5.6 evolution analyzers:
 *
 *   - `gap` — a new capability is suggested; `capabilityId` is `undefined`
 *     (no existing capability to target).
 *   - `underperformer` — an existing capability is underperforming;
 *     `capabilityId` is the existing capability id.
 *   - `consolidation_opportunity` — two capabilities overlap and one should
 *     absorb the other; `capabilityId` is the survivor.
 *   - `deprecation_signal` — an existing capability is obsolete;
 *     `capabilityId` is the capability to remove.
 *
 * `score` is the analyzer's confidence in the finding (0..1).
 * `evidenceIds` are opaque fingerprints used by downstream consumers.
 */
export type CapabilityEvolutionSignal =
  | {
      readonly kind: "gap";
      readonly capabilityId?: undefined;
      readonly score: number;
      readonly evidenceIds: ReadonlyArray<string>;
    }
  | {
      readonly kind: "underperformer";
      readonly capabilityId: string;
      readonly score: number;
      readonly evidenceIds: ReadonlyArray<string>;
    }
  | {
      readonly kind: "consolidation_opportunity";
      readonly capabilityId: string;
      readonly score: number;
      readonly evidenceIds: ReadonlyArray<string>;
    }
  | {
      readonly kind: "deprecation_signal";
      readonly capabilityId: string;
      readonly score: number;
      readonly evidenceIds: ReadonlyArray<string>;
    };

/**
 * Source of evolution signals. P5.5/P5.6 adapters implement this interface.
 * A7 only knows the signal shape — never catalog/registry/eventLog.
 */
export interface ProposalSignalSource {
  signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>>;
}

export interface A7ProposalGeneratorOptions {
  readonly signalSource: ProposalSignalSource;
}

// ---------------------------------------------------------------------------
// A7 proposal generator
// ---------------------------------------------------------------------------

/**
 * A7 proposal generator. Pure transformation: signals → candidates.
 *
 * Construction is dependency-free (no I/O, no clock). The injected
 * `ProposalSignalSource` is the sole coupling to the rest of the system.
 */
export class A7ProposalGenerator {
  private readonly signalSource: ProposalSignalSource;

  constructor(options: A7ProposalGeneratorOptions) {
    this.signalSource = options.signalSource;
  }

  /**
   * Emit one candidate per signal. Returns an empty array when the source
   * yields no signals. Errors from the source propagate (no swallowing).
   */
  async generate(): Promise<CapabilityEvolutionCandidate[]> {
    const signals = await this.signalSource.signals();
    const candidates: CapabilityEvolutionCandidate[] = [];
    for (const signal of signals) {
      candidates.push(signalToCandidate(signal));
    }
    return candidates;
  }
}

// ---------------------------------------------------------------------------
// Pure signal → candidate mapper
// ---------------------------------------------------------------------------

/**
 * Stable candidate-id derivation. Same signal body → same id (ruling #18
 * spirit — deterministic proposal ids). Derived from signal content alone;
 * no `Date.now()`.
 *
 *   - `gap` → `a7-gap-new` (no capability yet)
 *   - everything else → `a7-<kind>-<capabilityId>`
 *
 * NOTE: `proposalId` itself (the SHA-256 ledger identifier) is computed by
 * `ProposalStore.append()` via `computeProposalId(candidate)` — see
 * `src/capability/governance/proposal-identity.ts`. This `candidateId` is
 * the A7 candidate-body identifier; the two are distinct by design.
 */
function candidateIdFor(signal: CapabilityEvolutionSignal): string {
  const id = signal.capabilityId ?? "new";
  return `a7-${signal.kind}-${id}`;
}

/**
 * Per-signal-kind risk class. Drives downstream approval routing and
 * validation gates:
 *   - `gap` → low (new capability creation is exploratory; no existing state)
 *   - `underperformer` → medium (in-place update of existing capability)
 *   - `consolidation_opportunity` → high (structural change)
 *   - `deprecation_signal` → high (removal)
 */
function riskClassFor(signal: CapabilityEvolutionSignal): "low" | "medium" | "high" {
  switch (signal.kind) {
    case "gap":
      return "low";
    case "underperformer":
      return "medium";
    case "consolidation_opportunity":
      return "high";
    case "deprecation_signal":
      return "high";
  }
}

/**
 * Convert one signal to one candidate. Pure — no I/O, no clock, no reads.
 */
function signalToCandidate(
  signal: CapabilityEvolutionSignal,
): CapabilityEvolutionCandidate {
  const candidateId = candidateIdFor(signal);
  switch (signal.kind) {
    case "gap":
      return {
        candidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: `new.${candidateId}` },
        description: `Gap-driven proposal (score=${signal.score})`,
        expectedEffect: "Close observed capability gap",
        riskClass: riskClassFor(signal),
        evidenceIds: [...signal.evidenceIds],
      };
    case "underperformer":
      return {
        candidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: signal.capabilityId },
        description: `Underperformer update (score=${signal.score})`,
        expectedEffect: "Improve observed underperformance",
        riskClass: riskClassFor(signal),
        evidenceIds: [...signal.evidenceIds],
      };
    case "consolidation_opportunity":
      return {
        candidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: signal.capabilityId },
        description: `Consolidation opportunity (score=${signal.score})`,
        expectedEffect: "Consolidate overlapping capability",
        riskClass: riskClassFor(signal),
        evidenceIds: [...signal.evidenceIds],
      };
    case "deprecation_signal":
      return {
        candidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: signal.capabilityId },
        description: `Deprecation signal (score=${signal.score})`,
        expectedEffect: "Remove obsolete capability",
        riskClass: riskClassFor(signal),
        evidenceIds: [...signal.evidenceIds],
      };
  }
}

// ---------------------------------------------------------------------------
// Composition-root factory (placeholder)
// ---------------------------------------------------------------------------

/**
 * Composition-root factory. The ONLY allowed coupling between A7 and the
 * P5.5/P5.6 evolution-proposal-generator subsystem.
 *
 * The static `import` of `CapabilityEvolutionProposalGenerator` at the top
 * of this module is the boundary seam — composition root code that calls
 * this factory will receive the wired signal source. The factory itself
 * currently throws because the real P5.5/P5.6 wiring is the composition
 * root's responsibility (CAP-9 keeps A7 free of implicit globals).
 *
 * Tests inject a fake `ProposalSignalSource` via the constructor and never
 * touch this factory.
 */
export function defaultA7ProposalGenerator(): A7ProposalGenerator {
  // Reference the imported symbol so the static import stays in use and
  // future composition-root wiring has a single typed seam to extend.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _unwiredSeam: typeof CapabilityEvolutionProposalGenerator =
    CapabilityEvolutionProposalGenerator;
  void _unwiredSeam;
  throw new Error(
    "defaultA7ProposalGenerator() is a composition-root placeholder — wire the real P5.5/P5.6 signal source explicitly",
  );
}
