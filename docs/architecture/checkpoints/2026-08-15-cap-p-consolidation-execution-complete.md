# CAP-P — Consolidation Execution Path Closure Checkpoint

**Date:** 2026-08-15
**Phase:** CAP-P — Consolidation Execution Path Closure
**Predecessor frontier:** CAP-O (`e770902a`) — closed `underperformer → capability.update`
**Closes:** the post-CAP-O discriminator gap; fills the `consolidation_opportunity` row of the CAP-N/O/P discriminator table.

## Summary

CAP-P closes the third and final cell of the CAP-N/O/P discriminator table: `consolidation_opportunity → capability.consolidate`. Pre-CAP-P, the discriminator's `default` case silently fell through to `capability.transition` — which was the bug that caused `consolidation_opportunity` candidates to emit transitions instead of consolidations. CAP-P gives the `consolidation_opportunity` sourcePatternId its own explicit case and makes the `default` case fail-closed (THROWS rather than silently emitting a mutation).

The CAP-P implementation is wiring, not analysis. The architectural decisions were all locked in 2026-08-14 (#534, #543, #544):

- **Ruling #534 (2026-08-14):** `consolidation_opportunity` signal carries `survivorCapabilityId` + complete `absorbedCapabilityIds`. Caller-supplied, A7 transports verbatim, no derivation.
- **Ruling #543 (2026-08-14):** The pair layer is a read-only evidence-only bridge from P5.5 pair analysis to A7 signal construction. It carries no survivor, no absorbed set.
- **Ruling #544 (2026-08-15):** The authorized caller for `consolidation_opportunity` is the operator CLI subcommand `alix capability consolidate --survivor=<id@version> --absorbed=<id@version>,... --definition=<id@version> --source-disposition=deprecate|remove`. The operator supplies the complete governed set explicitly.

The locked discipline — **no derivation, no inference, no expansion, no completion** — is enforced at every boundary:

1. Operator CLI (ruling #544): the operator supplies the complete set explicitly. No flag is optional; a missing flag is a usage error.
2. A7 signal contract (ruling #534): the signal carries the four operator-supplied fields required. `validateConsolidationOpportunitySignal` rejects malformed signals at the A7 signal-receipt seam.
3. A7 → candidate transport: `signalToCandidate` copies all four fields verbatim. No map/filter that could drop or reorder ids.
4. Candidate → execution step: `candidateToExecutionStep` constructs `capability.consolidate` execution step with the four operator-supplied fields verbatim. Three invariant guards throw BEFORE constructing the parameters if any field is missing/invalid (mirrors CAP-O #982).
5. Default case: throws rather than silently emitting a mutation. Pre-CAP-P, the default case emitted `capability.transition` — that was the bug.

## Architectural progression

CAP-N → CAP-O → CAP-P — each CAP adds one candidate-carried material to enable one mutation operation:

- **CAP-N (`f5b2f663`):** `gap` material → `capability.create`; `deprecation_signal` material → `capability.remove`
- **CAP-O (`e770902a`):** `underperformer` material (`proposedPatch`) → `capability.update`
- **CAP-P (this work):** `consolidation_opportunity` material (`consolidateDefinition` + `sourceDisposition` + `absorbedCapabilityIds`) → `capability.consolidate`

The discriminator table post-CAP-P is 5/5 cells green:

| Candidate `sourcePatternId` | Emitted `operation` | Status |
|---|---|---|
| `"gap"` | `"capability.create"` | CAP-N |
| `"deprecation_signal"` | `"capability.remove"` | CAP-N |
| `"underperformer"` | `"capability.update"` | CAP-O |
| `"consolidation_opportunity"` | `"capability.consolidate"` | **CAP-P** |
| default | THROWS (fail-closed) | **CAP-P** |

## Implemented

| File | Change |
|---|---|
| `src/adaptation/capability-evolution-types.ts` | `CapabilityEvolutionCandidate` gains `consolidateDefinition?: CapabilityDefinition` and `sourceDisposition?: "deprecate" \| "remove"` (both optional, present only when `sourcePatternId === "consolidation_opportunity"`) |
| `src/capability/evolution/a7-proposals.ts` | `consolidation_opportunity` signal variant gains required `consolidateDefinition` + `sourceDisposition` fields. `validateConsolidationOpportunitySignal` enforces all three shape invariants (defense in depth). `signalToCandidate` copies both new fields verbatim. Discriminator-table comment updated. |
| `src/capability/evolution/overlap-signal-source.ts` | `OverlapIdentitySupplier` callback type extended with `consolidateDefinition` + `sourceDisposition`. The pair layer constructs the signal carrying all four operator-supplied fields verbatim. |
| `src/capability/capability-service.ts` | `proposeConsolidation` constructs the signal with `consolidateDefinition: input.definition` and `sourceDisposition: input.sourceDisposition`. The candidate is built with all four fields verbatim. `candidateToExecutionStep` `case "consolidation_opportunity":` rewritten with three invariant guards and explicit `capability.consolidate` dispatch. The `default` case rewritten to THROW (fail-closed) — replaces the silent `capability.transition` fall-through. Discriminator-table docstring comment updated. |
| `tests/capability/cap-p-consolidate-execution.vitest.ts` | **NEW.** 9 sentinels: (1) `consolidation_opportunity → capability.consolidate`; (2) `consolidateDefinition` verbatim; (3) `sourceDisposition` verbatim (`'deprecate'` AND `'remove'`); (4) `sources` in same order; (5) `target` verbatim; (6) missing `consolidateDefinition` throws; (7) invalid `sourceDisposition` throws; (8) empty `absorbedCapabilityIds` throws; (9) default case throws. |
| `tests/capability/a7-proposals.vitest.ts` | Updated to include `consolidateDefinition` + `sourceDisposition` on every `consolidation_opportunity` signal literal (4 sites). |
| `tests/capability/evolution/p5-pair-layer.vitest.ts` | Updated `supplierIdentityAtoB` + 4 other `identitySupplier` callbacks to include `consolidateDefinition` + `sourceDisposition`. Signal-top-level-keys test updated to include the new fields. |
| `tests/capability/cap-n-candidate-mapping.vitest.ts` | Axis 4 (the prior `consolidation_opportunity → capability.transition` assertion) updated to assert `→ capability.consolidate`. |
| `tests/capability/cap-n-sentinel.vitest.ts` | Axis 1 updated: function body must contain all four operation literals + `default:` case must contain `throw new Error` within ~1500 chars. |
| `tests/cli/capability-consolidate.vitest.ts` | `RecordingService` mock updated to construct the signal with `consolidateDefinition` + `sourceDisposition`. `result.signal.survivorCapabilityId` access cast through `{ survivorCapabilityId: string }`. |
| `docs/superpowers/specs/2026-08-15-cap-p-consolidation-execution-design.md` | **NEW.** Design spec — 12 sections, mirrors CAP-N/CAP-O template. |
| `docs/superpowers/plans/2026-08-15-cap-p-consolidation-execution.md` | **NEW.** Implementation plan — 8 tasks, mirrors CAP-N/CAP-O template. |
| `docs/architecture/checkpoints/2026-08-15-cap-p-consolidation-execution-complete.md` | **NEW.** This document. |

## Verification Checklist

### Frozen invariants (locked, do not relax)

- [x] `consolidation_opportunity` candidate MUST carry non-empty `absorbedCapabilityIds` (ruling #534 — locked 2026-08-14). Validated at A7 signal-receipt seam AND at discriminator seam (defense in depth).
- [x] `consolidation_opportunity` candidate MUST carry well-formed `consolidateDefinition` (ruling #544 — locked 2026-08-15). Validated at A7 signal-receipt seam AND at discriminator seam.
- [x] `consolidation_opportunity` candidate MUST carry valid `sourceDisposition ∈ {"deprecate", "remove"}` (ruling #544 — locked 2026-08-15). Validated at A7 signal-receipt seam AND at discriminator seam.
- [x] A7 transports operator-supplied values VERBATIM (no derivation, no inference, no expansion, no completion).
- [x] The discriminator's `default` case THROWS rather than emitting a mutation. Pre-CAP-P, the default case emitted `capability.transition` — that was the bug.
- [x] The pair layer carries NO survivor identity, NO absorbed set, NO merge direction (ruling #543). The pair layer's `OverlapIdentitySupplier` callback is the composition-root-bound operator-construction seam.

### Architectural discipline

- [x] NO new architecture introduced. CAP-P is wiring, not analysis.
- [x] NO heuristics introduced. No derivation, no inference, no expansion, no completion anywhere in the implementation.
- [x] NO changes to `CapabilityDefinition`, `CapabilityConsolidateMutation`, `validateConsolidate()`, or any CAP-12 forbidden file OTHER than the two CAP-P carve-out sites: (a) `capability-service.ts:984-998` discriminator (CAP-O precedent), and (b) `platform.ts:111` composition-root `overlapSignalSource` wiring (locked ruling #539).
- [x] NO new persistence (analyzer output is transient per ruling #534; pair layer output is transient per ruling #534).
- [x] NO new authorities granted to A2.5/P5.1 (ruling #541 STOP_CONDITION preserved).
- [x] NO A0 EvolutionProposalStore work (ruling #540 STOP_CONDITION preserved).

### Test results

```
pnpm vitest run tests/capability/ tests/evolution/
Test Files  79 passed (79)
Tests       684 passed (684)
```

- **CAP-P sentinels:** 9/9 green (`tests/capability/cap-p-consolidate-execution.vitest.ts`)
- **CLI consolidation:** 16/16 green (`tests/cli/capability-consolidate.vitest.ts`)
- **CAP-N mapping (4-axis):** 4/4 green (axis 4 updated to assert new behavior)
- **CAP-N sentinel:** 2/2 green (axis 1 updated to assert fail-closed default)
- **Pair layer (12-axis):** 12/12 green (all `identitySupplier` callbacks updated)
- **A7 proposal generator:** 14/14 green (all `consolidation_opportunity` signals updated)
- **Full capability + evolution suite:** 684/684 green, zero regressions

### Discriminator-table integrity (5/5 cells green)

| `sourcePatternId` | Emitted `operation` | Status |
|---|---|---|
| `"gap"` | `"capability.create"` | CAP-N preserved |
| `"deprecation_signal"` | `"capability.remove"` | CAP-N preserved |
| `"underperformer"` | `"capability.update"` | CAP-O preserved |
| `"consolidation_opportunity"` | `"capability.consolidate"` | **CAP-P NEW** |
| default | THROWS (fail-closed) | **CAP-P NEW** |

## Follow-up

- **A8 Organizational Learning:** already shipped at commit `ca4ca307`. The next executable frontier after CAP-P.
- **A9 Governance:** A9 wayfinder map #526 charted 2026-08-14; destination = pre-execution risk forecast.
- **TUI/Web consolidation surfaces:** CAP-11 owns TUI/Web per CAP-8 ruling. The CAP-P CLI command (`alix capability consolidate`) is the operator-side seam; TUI/Web surfaces will consume the same `proposeConsolidation` API.
- **M2/M3 governance signal delivery/replay:** deferred; non-blocking per post-CAP-N wayfinder Ticket B verdict, commit `b7cc01e0`.
- **A0 EvolutionProposalStore:** dispositioned STOP_CONDITION at ruling #540; unblocks when an A0 seam is built.

## References

- CAP-P spec: `docs/superpowers/specs/2026-08-15-cap-p-consolidation-execution-design.md`
- CAP-P plan: `docs/superpowers/plans/2026-08-15-cap-p-consolidation-execution.md`
- CAP-N spec: `docs/superpowers/specs/2026-08-14-cap-n-end-to-end-create-path-design.md`
- CAP-O spec: `docs/superpowers/specs/2026-08-14-cap-o-underperformer-update-path-design.md`
- CAP-P preserved decisions: `memory/cap-p-deferred-pending-analyzer.md` (8 preserved rulings, 2026-08-14)
- P5.5/P5.6 rulings #534 (signal/survivorship/absorbed-set), #543 (pair layer shape), #544 (operator CLI caller)
- ADR-0013 §4/§5/§7 (provider abstraction + execution binding + lifecycle)
- Mutation contract: `src/capability/mutation-contract.ts:106-116` (`CapabilityConsolidateMutation`), 464-479 (`validateConsolidate`), 310-378 (`validateConsolidateMerge`)
- Discriminator site: `src/capability/capability-service.ts:922+`
- CAP-P sentinels: `tests/capability/cap-p-consolidate-execution.vitest.ts`

## Tags

No tag ceremony for CAP-P. The `alix-capability-greenfield-complete` tag (CAP-12) remains the canonical marker for the greenfield program completion.
