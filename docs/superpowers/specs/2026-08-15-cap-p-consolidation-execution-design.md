# CAP-P — Consolidation Execution Path Closure

**Status:** Design (brainstorm → spec → plan → SDD → closeout)
**Date:** 2026-08-15
**Author:** CAP-P implementation session
**Parent program:** CAP-1 → CAP-12 greenfield capability platform (tag `alix-capability-greenfield-complete`) → CAP-N → CAP-O
**Predecessor frontier:** CAP-O (`e770902a`) closed the `underperformer → capability.update` discriminator gap.
**Closes:** the post-CAP-O discriminator gap where `consolidation_opportunity` `sourcePatternId` falls through to `capability.transition` instead of routing to `capability.consolidate`.

## 1. Problem

CAP-N closed the greenfield program carve-out for `gap → capability.create` and `deprecation_signal → capability.remove`. CAP-O closed the next cell, `underperformer → capability.update`. One cell remained in the locked CAP-N/O/P discriminator table (commit `3772e941`): `consolidation_opportunity → capability.consolidate`.

Pre-CAP-P, the `consolidation_opportunity` sourcePatternId **silently fell through** to `capability.transition` because the discriminator's `default` case emitted transitions. This was a correctness bug, not a design choice — CAP-N deliberately deferred consolidation implementation while P5.5/P5.6 architecture was being charted (`memory/cap-p-deferred-pending-analyzer.md`). CAP-N locked eight preserved decisions for CAP-P resumption but no implementation.

CAP-P closes this discriminator cell by wiring the full consolidation execution path: operator CLI → A7 signal → candidate → CAP-6 executor. The operator-CLI-supplied governance identity (ruling #544) flows through the A7 pipeline as a complete, caller-supplied governed set — never derived, never inferred, never synthesized.

## 2. Goal

`apply()` discriminates `consolidation_opportunity` sourcePatternId to emit `capability.consolidate` (NOT `capability.transition`). The discriminator table post-CAP-P has 5 cells green:

| Candidate `sourcePatternId` | Emitted `operation` | Status |
|---|---|---|
| `"gap"` | `"capability.create"` | CAP-N (`f5b2f663`) |
| `"deprecation_signal"` | `"capability.remove"` | CAP-N (`f5b2f663`) |
| `"underperformer"` | `"capability.update"` | CAP-O (`e770902a`) |
| `"consolidation_opportunity"` | `"capability.consolidate"` | **CAP-P** |
| default | THROWS (fail-closed) | **CAP-P** |

The architectural progression: `CAP-N → CAP-O → CAP-P` — each CAP adds one candidate-carried material to enable one mutation operation: `create` material → `update` provenance → `consolidate` sources+target+definition+disposition.

## 3. Non-goals

- **TUI/Web work.** CAP-11 territory per CAP-8 ruling.
- **A8/A9 changes.** Out of CAP-P scope; CAP-P only closes the discriminator cell.
- **Pair-layer authority expansion.** The P5.5/P5.6 pair layer remains evidence-only per ruling #543 — it carries pair recommendations; the operator CLI per #544 is the construction seam. CAP-P does NOT grant the pair layer survivorship authority.
- **Analyzing heuristic introduction.** CAP-P is wiring, not analysis. No survivorship heuristic, no absorbed-set expansion, no merge-direction inference anywhere in CAP-P.
- **A0 store / A2.5 producer role.** Both were dispositioned STOP_CONDITION in tickets #540/#541; CAP-P does not unblock them.
- **Mutation contract changes.** `CapabilityConsolidateMutation` already requires `target`, `sources`, `definition`, `sourceDisposition`. CAP-P supplies those via the candidate; no contract changes.
- **CAP-12 forbidden-file policy partly lifted.** `src/capability/capability-service.ts` is on the CAP-12 forbidden list. CAP-P lifts the restriction for that single file because the discriminator is exactly in that file (same precedent CAP-O established). All other CAP-12 forbidden files remain forbidden.
- **Generalized candidate refactor.** `CapabilityEvolutionCandidate` gains exactly two new optional fields. No `executionHints` abstraction, no discriminated-union overhaul.

## 4. Architecture

### 4.1 Discriminator mapping (locked)

The discriminator lives in `candidateToExecutionStep` at `src/capability/capability-service.ts:922+`. CAP-P rewrites the `case "consolidation_opportunity":` arm (currently shares the `default` arm with `capability.transition`).

```typescript
case "consolidation_opportunity": {
  // CAP-P invariant (locked rulings #534 + #544, 2026-08-14/15):
  // the candidate MUST carry the operator-supplied
  // `consolidateDefinition` and `sourceDisposition`. This invariant
  // mirrors CAP-O's underperformer-patch invariant (#982) — both
  // are locked structural invariants that the executor depends on.
  if (candidate.consolidateDefinition === undefined) {
    throw new Error(
      `capability.consolidate: candidate '${candidate.candidateId}' must carry consolidateDefinition; observer will receive structurally invalid mutation (ruling #544 — caller-supplied target definition)`,
    );
  }
  if (
    candidate.sourceDisposition !== "deprecate" &&
    candidate.sourceDisposition !== "remove"
  ) {
    throw new Error(
      `capability.consolidate: candidate '${candidate.candidateId}' sourceDisposition must be 'deprecate' or 'remove'; observed='${String(candidate.sourceDisposition)}' (ruling #544 — caller-supplied source disposition)`,
    );
  }
  if (
    !Array.isArray(candidate.absorbedCapabilityIds) ||
    candidate.absorbedCapabilityIds.length === 0
  ) {
    throw new Error(
      `capability.consolidate: candidate '${candidate.candidateId}' must carry non-empty absorbedCapabilityIds (ruling #534 — caller-supplied complete absorbed set)`,
    );
  }
  return {
    ...baseStep,
    operation: "capability.consolidate",
    parameters: {
      operation: "capability.consolidate",
      target: candidate.target.id,
      sources: [...candidate.absorbedCapabilityIds],
      definition: candidate.consolidateDefinition,
      sourceDisposition: candidate.sourceDisposition,
      sourceVersion: currentVersion,
    },
  };
}

default:
  // Defensive default. Pre-CAP-P, the discriminator fell through to
  // `capability.transition` silently — that was the bug that
  // caused `consolidation_opportunity` candidates to emit
  // transitions instead of consolidations. The discriminator now
  // has an explicit case for every sourcePatternId (gap → create,
  // deprecation_signal → remove, underperformer → update,
  // consolidation_opportunity → consolidate); an unrecognized
  // sourcePatternId MUST throw rather than silently produce a
  // mutation that the observer didn't intend. Future
  // sourcePatternIds get added as explicit cases BEFORE this
  // default; this default is the explicit fail-closed boundary.
  throw new Error(
    `candidateToExecutionStep: unrecognized sourcePatternId '${candidate.sourcePatternId}' on candidate '${candidate.candidateId}'; discriminator has no explicit case (CAP-N/O/P closed; this default is fail-closed)`,
  );
```

The CAP-P invariant guards mirror CAP-O's `proposedPatch` non-empty check. Both are locked structural invariants that the executor depends on. If a candidate lacks the operator-supplied fields, the discriminator throws BEFORE constructing the parameters — the executor receives nothing, the observer never sees a structurally-invalid mutation.

### 4.2 Candidate extension (locked)

`src/adaptation/capability-evolution-types.ts:181-198` adds two optional fields:

```typescript
export interface CapabilityEvolutionCandidate {
  // ... existing fields ...
  /**
   * P5.5/P5.6 + CAP-P: caller-supplied absorbed-set carried verbatim from
   * `consolidation_opportunity` signal (ruling #534 — locked 2026-08-14).
   * Present only when `sourcePatternId === "consolidation_opportunity"`.
   */
  readonly absorbedCapabilityIds?: readonly string[];
  /**
   * CAP-P: caller-supplied target definition carried verbatim from the
   * `consolidation_opportunity` signal (locked decisions #534 and #544).
   * Present only when `sourcePatternId === "consolidation_opportunity"`.
   */
  readonly consolidateDefinition?: CapabilityDefinition;
  /**
   * CAP-P: caller-supplied disposition for absorbed capabilities carried
   * verbatim from the `consolidation_opportunity` signal (locked
   * decisions #534 and #544). Either `"deprecate"` or `"remove"`.
   */
  readonly sourceDisposition?: "deprecate" | "remove";
}
```

Invariants:
- `absorbedCapabilityIds` is **only present and non-empty** when `sourcePatternId === "consolidation_opportunity"`. (CAP-P, ruling #534 — locked 2026-08-14)
- `consolidateDefinition` is **only present and well-formed** when `sourcePatternId === "consolidation_opportunity"`. (CAP-P, ruling #544 — locked 2026-08-15)
- `sourceDisposition ∈ {"deprecate", "remove"}` is **only present** when `sourcePatternId === "consolidation_opportunity"`. (CAP-P, ruling #544)

All three invariants are enforced at the discriminator seam (Section 4.1) AND at the A7 signal validator seam (Section 4.4) — defense in depth.

### 4.3 A7 signal extension (locked)

`src/capability/evolution/a7-proposals.ts:86-103` extends the `consolidation_opportunity` signal type:

```typescript
| {
    readonly kind: "consolidation_opportunity";
    readonly survivorCapabilityId: string;
    readonly absorbedCapabilityIds: readonly string[];
    /** CAP-P (ruling #544): operator-supplied target definition. Required. */
    readonly consolidateDefinition: CapabilityDefinition;
    /** CAP-P (ruling #544): operator-supplied source disposition. Required. */
    readonly sourceDisposition: "deprecate" | "remove";
    readonly score: number;
    readonly evidenceIds: ReadonlyArray<string>;
  }
```

`signalToCandidate` (Section 4.5) copies both new fields verbatim from the signal to the candidate.

### 4.4 A7 signal validator (locked)

`validateConsolidationOpportunitySignal(signal)` (`src/capability/evolution/a7-proposals.ts:140+`) enforces all three shape invariants:

```typescript
export function validateConsolidationOpportunitySignal(
  signal: CapabilityEvolutionSignal,
): void {
  if (signal.kind !== "consolidation_opportunity") return;
  if (
    !Array.isArray(signal.absorbedCapabilityIds) ||
    signal.absorbedCapabilityIds.length < 1
  ) {
    throw new Error(
      "consolidation_opportunity signal: absorbedCapabilityIds must be a non-empty array (ruling #534 — caller-supplied complete governed set)",
    );
  }
  if (!isValidConsolidateDefinition(signal.consolidateDefinition)) {
    throw new Error(
      "consolidation_opportunity signal: consolidateDefinition is required and must be a well-formed CapabilityDefinition (ruling #544 — caller-supplied target definition)",
    );
  }
  if (signal.sourceDisposition !== "deprecate" && signal.sourceDisposition !== "remove") {
    throw new Error(
      `consolidation_opportunity signal: sourceDisposition must be 'deprecate' or 'remove' (ruling #544 — caller-supplied disposition); observed='${String(signal.sourceDisposition)}'`,
    );
  }
}
```

The validator performs structural presence checks only; the executor's `validateConsolidate()` (`mutation-contract.ts:464`) runs the full conservative-merge rules against catalog-resolved sources. The two layers are intentional separation — the validator enforces "A7 received a well-formed signal", the executor enforces "the consolidation is structurally merge-valid".

### 4.5 A7 derivation (locked)

`src/capability/evolution/a7-proposals.ts` `signalToCandidate` `case "consolidation_opportunity":` copies the operator-supplied fields verbatim:

```typescript
case "consolidation_opportunity":
  validateConsolidationOpportunitySignal(signal);
  return {
    candidateId,
    sourcePatternId: signal.kind,
    confidence: signal.score,
    target: { kind: "capability", id: signal.survivorCapabilityId },
    description: `Consolidation opportunity (score=${signal.score})`,
    expectedEffect: "Consolidate overlapping capability",
    riskClass: riskClassFor(signal),
    evidenceIds: [...signal.evidenceIds],
    absorbedCapabilityIds: [...signal.absorbedCapabilityIds],
    consolidateDefinition: signal.consolidateDefinition,
    sourceDisposition: signal.sourceDisposition,
  };
```

**Locked discipline:** A7 transports verbatim — no derivation, no inference, no expansion, no completion. The identity owner (operator CLI per #544) supplies; A7 carries.

### 4.6 Operator CLI → A7 signal (locked)

`src/capability/capability-service.ts` `proposeConsolidation(input)` constructs the `consolidation_opportunity` signal from `OperatorConsolidationInput`:

```typescript
const signal: CapabilityEvolutionSignal = {
  kind: "consolidation_opportunity",
  survivorCapabilityId: input.survivorCapabilityId,
  absorbedCapabilityIds: [...input.absorbedCapabilityIds],
  consolidateDefinition: input.definition,
  sourceDisposition: input.sourceDisposition,
  score: 1,
  evidenceIds: [...(input.evidenceIds ?? [])],
};
validateConsolidationOpportunitySignal(signal);
```

The candidate is then built carrying all four operator-supplied values verbatim (`absorbedCapabilityIds`, `consolidateDefinition`, `sourceDisposition`, plus the survivor target).

### 4.7 Pair-layer identitySupplier (locked extension)

`src/capability/evolution/overlap-signal-source.ts` `OverlapIdentitySupplier` extended to include `consolidateDefinition` and `sourceDisposition`. The supplier callback is the seam where the composition-root binds the operator-CLI-supplied identities:

```typescript
export type OverlapIdentitySupplier = (overlap: CapabilityOverlap) => {
  readonly survivorCapabilityId: string;
  readonly absorbedCapabilityIds: ReadonlyArray<string>;
  readonly consolidateDefinition: CapabilityDefinition;
  readonly sourceDisposition: "deprecate" | "remove";
} | null;
```

The pair layer itself (`OverlapProposalSignalSource.signals()`) constructs the signal carrying all four operator-supplied fields:

```typescript
const signal: CapabilityEvolutionSignal = {
  kind: "consolidation_opportunity",
  survivorCapabilityId: identity.survivorCapabilityId,
  absorbedCapabilityIds: [...identity.absorbedCapabilityIds],
  consolidateDefinition: identity.consolidateDefinition,
  sourceDisposition: identity.sourceDisposition,
  score: overlap.overlapScore,
  evidenceIds: [/* overlap evidence */],
};
```

The pair layer never derives any identity — it transports what `identitySupplier` returns. The supplier callback is the operator-construction seam per ruling #544.

## 5. Data flow

A P5.5 pair overlap is detected by `CapabilityOverlapAnalyzer` → `OverlapProposalSignalSource` invokes `identitySupplier(overlap)` to obtain the operator-supplied identities → pair layer emits a `consolidation_opportunity` signal carrying all four operator-supplied fields → A7 reads via `A7ProposalGenerator.generate()` → A7's `signalToCandidate(signal)` constructs `CapabilityEvolutionCandidate` with `absorbedCapabilityIds`, `consolidateDefinition`, `sourceDisposition` set verbatim from the signal → user proposes via `service.propose(candidate)` → user approves via `service.apply({ proposalId })` → `apply()` calls `candidateToExecutionStep(candidate, sourceId, currentVersion)` → the `case "consolidation_opportunity":` arm emits an `ExecutionStep` with `operation: "capability.consolidate"` and `parameters: { target, sources, definition, sourceDisposition, sourceVersion }` → `GovernedExecutionRuntime` (CAP-6) commits the consolidate mutation → `validateConsolidate()` runs conservative merge rules against catalog-resolved sources → catalog reflects the new consolidated capability → `proposalStore.recordExecuted(...)` is called.

The operator-CLI path is identical except it constructs the `consolidation_opportunity` signal directly via `service.proposeConsolidation(input)` (`src/capability/capability-service.ts:683+`), bypassing the pair layer — the operator is the construction seam.

## 6. Composition root

No changes. The composition root at `src/capability/platform.ts` already provides `CapabilityService` with `executor`, `proposalStore`, `catalog`, and `proposalGenerator`. CAP-P is internal to `signalToCandidate` (A7), `candidateToExecutionStep` (discriminator), `proposeConsolidation` (CLI seam), and `OverlapIdentitySupplier` (pair-layer seam).

## 7. Migration boundary

No migration. The discriminator change is additive: the `case "consolidation_opportunity":` arm now emits `capability.consolidate` instead of falling through to `capability.transition`. The `default` case becomes explicit fail-closed (throws on unrecognized sourcePatternId). The CAP-N discriminator-table 5-cell green state is preserved with CAP-P closing the consolidation cell.

The CLI seam (`alix capability consolidate --survivor --absorbed --definition --source-disposition`, locked ruling #544) and the pair-layer seam (`OverlapIdentitySupplier` callback, ruling #543) both existed before CAP-P. CAP-P only extends the `OverlapIdentitySupplier` type to include `consolidateDefinition` and `sourceDisposition`.

## 8. Error handling

- **`consolidation_opportunity` candidate missing `consolidateDefinition`** → throw deterministic error inside `candidateToExecutionStep` before executor invocation. Error message includes `candidate.candidateId` and the ruling citation (`#544`).
- **`consolidation_opportunity` candidate with invalid `sourceDisposition`** → throw deterministic error before executor invocation.
- **`consolidation_opportunity` candidate with empty `absorbedCapabilityIds`** → throw deterministic error before executor invocation (ruling #534 — defense in depth on the signal validator).
- **Unrecognized sourcePatternId** → `default` case throws deterministic error before executor invocation. The error includes the unrecognized sourcePatternId and the candidate id. Future sourcePatternIds get added as explicit cases BEFORE the default.
- **Executor failure on consolidate** → existing `apply()` error path captures and records `proposal.execution_failed` (no change needed).
- **`validateConsolidate()` rejection** → existing executor path returns the mutation validator's errors (no change needed; CAP-P relies on the existing conservative merge rules).

## 9. Testing strategy

### 9.1 Unit test (new)

`tests/capability/cap-p-consolidate-execution.vitest.ts` — 9-axis sentinel test of `candidateToExecutionStep` and the full CLI → signal → candidate → ExecutionStep path:

- **Sentinel 1 — happy path:** `consolidation_opportunity` signal → emitted step has `operation: "capability.consolidate"`, NOT `capability.transition`.
- **Sentinel 2 — `consolidateDefinition` verbatim:** operator-supplied definition reaches the executor structurally intact (deep equality on every field).
- **Sentinel 3 — `sourceDisposition` verbatim:** operator-supplied disposition reaches the executor unchanged (`'deprecate'` AND `'remove'` both tested).
- **Sentinel 4 — `sources` verbatim, in order:** operator-supplied absorbed set reaches the executor in the same order with no expansion, no inference, no reorder.
- **Sentinel 5 — `target` verbatim:** operator-supplied survivor reaches the executor unchanged; target is the survivor (not one of the absorbed sources — pre-CAP-P fall-through produced the wrong target).
- **Sentinel 6 — invariant guard, missing `consolidateDefinition`:** throws `/consolidateDefinition/`. Executor is NOT called.
- **Sentinel 7 — invariant guard, invalid `sourceDisposition`:** throws `/sourceDisposition/`. Executor is NOT called.
- **Sentinel 8 — invariant guard, empty `absorbedCapabilityIds`:** throws `/absorbedCapabilityIds/` (ruling #534, defense in depth).
- **Sentinel 9 — `default` case throws:** unrecognized sourcePatternId throws `/unrecognized sourcePatternId/`. Executor is NOT called.

The test follows the CAP-N/CAP-O test pattern (`tests/capability/cap-n-candidate-mapping.vitest.ts`, `tests/capability/cap-o-candidate-mapping.vitest.ts`). Uses `FakeSignalSource` + `A7ProposalGenerator` so `service.propose()` reads from the generator rather than receiving the candidate as a direct arg. Uses `proposeDirect` for the guard-throws axes (axes 6/7/8/9) where the candidate needs to violate the invariants.

### 9.2 CLI test (existing, extended)

`tests/cli/capability-consolidate.vitest.ts` — pre-existing 16 tests, all GREEN post-CAP-P. The `RecordingService` mock was updated to construct the `consolidation_opportunity` signal with `consolidateDefinition` and `sourceDisposition` set from `input.definition` and `input.sourceDisposition` (the operator-CLI-supplied values). All operator-supplied identity invariants tested: survivor verbatim, absorbed verbatim (including empty-set rejection, survivor-in-absorbed rejection), definition resolution against catalog, disposition validation.

### 9.3 Pair-layer test (existing, extended)

`tests/capability/evolution/p5-pair-layer.vitest.ts` — pre-existing 12 tests, all GREEN post-CAP-P. `supplierIdentityAtoB` updated to return `consolidateDefinition` and `sourceDisposition` as test fixtures. The validator-rejects-empty-array test now also supplies the other two fields so the validator reaches the empty-array check (the test pins the empty-array enforcement per ruling #534).

### 9.4 CAP-N sentinel test (existing, updated)

`tests/capability/cap-n-sentinel.vitest.ts` — the discriminator-table sentinel updated to reflect CAP-P. The function body must now contain all four operation literals (`capability.create`, `capability.remove`, `capability.update`, `capability.consolidate`) and the `default:` case must contain a `throw new Error` (fail-closed, NOT a `capability.transition` emission).

### 9.5 Regression

Full capability + evolution vitest suite passes with **zero regressions**: all existing tests remain green and the new CAP-P tests pass. Pre-implementation baseline was 559 capability tests (CAP-N + CAP-O closed); post-implementation is 684 capability + evolution tests (559 baseline + 9 new CAP-P consolidation execution sentinels + 12 pre-existing pair-layer + 16 pre-existing CLI + remaining regression tests).

## 10. Forward compatibility

- **CAP-P extension:** future consolidation mutation parameters (e.g., consolidation strategy, governance-policy metadata) extend `CapabilityConsolidateMutation` first; the candidate and signal fields follow. The CAP-P invariant guards (`consolidateDefinition` present, `sourceDisposition` valid, `absorbedCapabilityIds` non-empty) are the architectural anchor — they MUST NOT be relaxed.
- **A8/A9:** A8 reads from the same candidate shape (`CapabilityEvolutionCandidate`); A8's organizational learning produces its own `LearningFindingKind` values and does NOT produce consolidation opportunities. A9 governance proposals operate at a different seam; CAP-P is upstream of both.
- **TUI/Web:** CAP-11 owns TUI/Web surfaces. CAP-P only changes the CLI command (already shipped at `src/cli/commands/capability-consolidate.ts` per #544).

## 11. Out of scope

- A8/A9 implementation
- TUI/Web surfaces
- M2/M3 governance signal delivery/replay (deferred; non-blocking per post-CAP-N wayfinder Ticket B verdict, commit `b7cc01e0`)
- Mutation contract changes (`CapabilityConsolidateMutation` already complete)
- Executor changes (CAP-6's `validateConsolidate()` already enforces the conservative merge rules)
- A5 measurement-side changes
- A0 EvolutionProposalStore (out of scope per ruling #540 — STOP_CONDITION)
- P5.5/P5.6 analyzer-side changes (the analyzer produces pair evidence only; construction seam is operator CLI per #544)
- Capability-pair layer authority expansion (ruling #543 — pair recommendation is EVIDENCE not AUTHORIZATION)
- A2.5/P5.1 consolidation-producer role (ruling #541 — STOP_CONDITION)
- Survivorship heuristic introduction (rejected per ruling #534 investigation #1)
- Absorbed-set derivation/expansion (rejected per ruling #534 investigation #2)
- Bounded heuristic invention at any layer (rejected per #534 ruling)

## 12. References

- CAP-N spec: `docs/superpowers/specs/2026-08-14-cap-n-end-to-end-create-path-design.md`
- CAP-O spec: `docs/superpowers/specs/2026-08-14-cap-o-underperformer-update-path-design.md`
- CAP-N implementation: `src/capability/capability-service.ts:922+` (discriminator); `tests/capability/cap-n-candidate-mapping.vitest.ts`
- CAP-O implementation: `src/capability/capability-service.ts:942+` (underperformer case); `tests/capability/cap-o-candidate-mapping.vitest.ts`
- CAP-P preserved decisions: `memory/cap-p-deferred-pending-analyzer.md` (8 preserved rulings, 2026-08-14)
- P5.5/P5.6 survivorship ruling: `memory/p5-survivorship-ruling-locked.md` (#534 investigation #1)
- P5.5/P5.6 absorbed-set ruling: `memory/p5-absorbed-set-ruling-locked.md` (#534 investigation #2)
- P5.5/P5.6 signal-contract ruling: `memory/p5-signal-contract-ruling-locked.md` (#534 investigation #3)
- P5.5/P5.6 pair-layer ruling: `memory/p5-layer-shape-ruling-locked.md` (#543)
- P5.5/P5.6 caller-shape ruling: `memory/p5-caller-shape-ruling-locked.md` (#544 — operator CLI is authorized caller)
- Operator CLI implementation: `src/cli/commands/capability-consolidate.ts` (shipped at commit `d65dcf46` per #544)
- Pair-layer implementation: `src/capability/evolution/overlap-signal-source.ts` (shipped at commit `dcb3f3fe` per #543)
- A7 signal contract: `src/capability/evolution/a7-proposals.ts:77-103` (extended at commit `6a18e573` per #534)
- Mutation contract: `src/capability/mutation-contract.ts:106-116` (`CapabilityConsolidateMutation`), 464-479 (`validateConsolidate`), 310-378 (`validateConsolidateMerge`)
- Discriminator site: `src/capability/capability-service.ts:922+`
- Candidate type: `src/adaptation/capability-evolution-types.ts:172-200`
- A7 derivation: `src/capability/evolution/a7-proposals.ts:296-330` (`signalToCandidate`)
- A7 signal validator: `src/capability/evolution/a7-proposals.ts:140-180` (`validateConsolidationOpportunitySignal`)
- Operator CLI seam: `src/capability/capability-service.ts:678-735` (`proposeConsolidation`)
- Pair-layer seam: `src/capability/evolution/overlap-signal-source.ts:105-128` (`OverlapIdentitySupplier`)
- CAP-P sentinels: `tests/capability/cap-p-consolidate-execution.vitest.ts`
- ADR-0013 §4/§5/§7 (provider abstraction + execution binding + lifecycle)
