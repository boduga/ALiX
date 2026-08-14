# CAP-O — Underperformer Update-Path Closure

**Status:** Design (brainstorm → spec → plan → SDD → closeout)
**Date:** 2026-08-14
**Author:** CAP-O spec drafting session
**Parent program:** CAP-1 → CAP-12 greenfield capability platform (tag `alix-capability-greenfield-complete`) → CAP-N
**Predecessor frontier:** CAP-N (`f5b2f663`) closed the §20 #12 carve-out at `src/capability/capability-service.ts:702,704`.
**Closes:** the post-CAP-N discriminator gap where `underperformer` `sourcePatternId` routes to `capability.transition` instead of `capability.update`.

## 1. Problem

CAP-N closed the greenfield program carve-out (`gap` → `capability.create`, `deprecation_signal` → `capability.remove`). Two sourcePatternIds still route to `capability.transition`: `underperformer` and `consolidation_opportunity`. The post-CAP-N wayfinder map #511 (closed 2026-08-14) locked the frontier order `CAP-O → CAP-P → A8 → A9 → TUI/Web`. CAP-O is the next authorized frontier.

The carve-out is in the same function CAP-N edited: `candidateToExecutionStep` at `src/capability/capability-service.ts:695-771`. The fallback path at lines 757-771 catches both `underperformer` and `consolidation_opportunity` (and `default`) and emits `capability.transition`.

For `underperformer` this is semantically wrong. The signal reports that an existing capability is underperforming. The right mutation is to **update** that capability, recording the approved evolutionary decision and its evidence so it is durably attributable. The current fallback emits a transition from `emerging` to `active`, which is exactly what `capability.transition` should do — but the signal isn't asking for a lifecycle change.

## 2. Goal

`apply()` discriminates `underperformer` sourcePatternId to emit `capability.update`. The discriminator table post-CAP-O has 5 cells green:

| Candidate `sourcePatternId` | Emitted `operation` | Status |
|---|---|---|
| `"gap"` | `"capability.create"` | ✅ CAP-N |
| `"deprecation_signal"` | `"capability.remove"` | ✅ CAP-N |
| `"underperformer"` | `"capability.update"` | 🔲 **CAP-O** |
| `"consolidation_opportunity"` | `"capability.transition"` | 🔲 CAP-P (next) |
| (any other / default) | `"capability.transition"` | ✅ defensive default |

The architectural progression: `CAP-N → CAP-O → CAP-P` — each CAP adds one candidate-carried material to enable one mutation operation: `create` material → `update` provenance → `consolidate` sources+target.

## 3. Non-goals

- **CAP-P changes.** `consolidation_opportunity` continues routing to `capability.transition`. CAP-P is the next locked frontier and will mirror CAP-O's contract-extension pattern with `absorbedCapabilityIds` + optional `proposedDefinition` (per post-CAP-N wayfinder Ticket C verdict, commit `3772e941`).
- **TUI/Web work.** CAP-11 territory per CAP-8 ruling.
- **A5 changes.** Measurement produces the signal; A7 converts the signal into the candidate and the proposed patch. A5 stays out of CAP-O.
- **Generalized candidate refactor.** `CapabilityEvolutionCandidate` gains exactly one new optional field. No `executionHints` abstraction, no discriminated-union overhaul.
- **Speculative semantic-update policy.** The provenance patch is the only legitimate derivation from an underperformer observation. If future evidence supports richer patch derivation (e.g., bumping `risk` based on observed failure rate), that's a separate CAP with its own evidence-backed design.
- **Mutation contract changes.** `CapabilityUpdateMutation` already requires `capabilityId`, `sourceVersion`, non-empty `patch`. CAP-O supplies those via the candidate; no contract changes.
- **Executor changes.** `nextDefinitionForUpdate` and the executor's update path handle the provenance-only patch without modification.
- **No CAP-O tag.** CAP-O merges like CAP-N — no separate tag ceremony.
- **CAP-12 forbidden-file policy partly lifted.** `src/capability/capability-service.ts` is on the CAP-12 forbidden list. CAP-O lifts the restriction for that single file because the discriminator is exactly in that file. All other CAP-12 forbidden files remain forbidden.

## 4. Architecture

### 4.1 Operation mapping (locked)

The discriminator lives in `candidateToExecutionStep` at `src/capability/capability-service.ts:695-771`. CAP-O rewrites the `case "underperformer":` arm (currently falls through to `capability.transition`).

```typescript
case "underperformer": {
  // CAP-O: underperformer signals → capability.update.
  // The candidate carries a non-empty patch that the executor applies
  // unchanged. Per CAP-O ruling: patch is provenance-only; no speculative
  // semantic change to the capability definition. The lifecycle consequence
  // remains governed by the existing lifecycle machinery.
  if (!candidate.proposedPatch || !isNonEmptyPatch(candidate.proposedPatch)) {
    throw new Error(
      `capability.update: underperformer candidate '${candidate.candidateId}' must carry a non-empty proposedPatch; observed keys=${Object.keys(candidate.proposedPatch ?? {}).join(",") || "<none>"}`,
    );
  }
  return {
    ...baseStep,
    operation: "capability.update",
    parameters: {
      operation: "capability.update",
      capabilityId: sourceId,
      sourceVersion: currentVersion,
      patch: candidate.proposedPatch,
    },
  };
}
```

`isNonEmptyPatch` is a small structural helper: returns `false` for `undefined`, `null`, or `{}`; `true` if at least one field is present.

### 4.2 Candidate extension (locked)

`src/adaptation/capability-evolution-types.ts:172-181` adds one optional field:

```typescript
export interface CapabilityEvolutionCandidate {
  readonly candidateId: string;
  readonly sourcePatternId: string;
  readonly confidence: number;
  readonly target: CapabilityEvolutionTarget;
  readonly description: string;
  readonly expectedEffect: string;
  readonly riskClass: CapabilityEvolutionRiskClass;
  readonly evidenceIds: ReadonlyArray<string>;
  /**
   * CAP-O: candidate-carried update patch for `underperformer` sourcePatternId.
   * Present and structurally non-empty for `underperformer`; absent for other
   * sourcePatternIds. Provenance-only — no speculative semantic change to the
   * capability definition.
   */
  readonly proposedPatch?: CapabilityDefinitionPatch;
}
```

Invariant: `proposedPatch` is **only present and non-empty** when `sourcePatternId === "underperformer"`. The invariant is enforced at the discriminator seam (Section 4.1) — TypeScript permits `undefined` for documentation, the guard rejects it deterministically.

### 4.3 A7 derivation (locked)

`src/capability/evolution/a7-proposals.ts:206-216` (`signalToCandidate` `case "underperformer":`) constructs the patch:

```typescript
case "underperformer": {
  const proposedPatch: CapabilityDefinitionPatch = {
    extensions: {
      provenance: {
        kind: "a7-underperformer",
        candidateId,
        score: signal.score,
        evidenceIds: [...signal.evidenceIds],
      },
    },
  };
  return {
    candidateId,
    sourcePatternId: signal.kind,
    confidence: signal.score,
    target: { kind: "capability", id: signal.capabilityId },
    description: `Underperformer update (score=${signal.score})`,
    expectedEffect: "Improve observed underperformance",
    riskClass: riskClassFor(signal),
    evidenceIds: [...signal.evidenceIds],
    proposedPatch,
  };
}
```

`CapabilityDefinitionPatch.extensions` accepts `Record<string, unknown>` (`mutation-contract.ts:74`). Provenance lands at the same key CAP-N uses for `gap`: `extensions.provenance.{kind, candidateId, score, evidenceIds}`.

### 4.4 Patch policy — provenance only (locked, governance-critical)

An underperformer observation legitimately derives **only** an audit/provenance patch, not a semantic modification to the capability definition:

```typescript
{
  extensions: {
    provenance: {
      kind: "a7-underperformer",
      candidateId,
      score,
      evidenceIds,
    },
  },
}
```

**Why not semantic mutation:**
- A high underperformance score does NOT establish that the capability's declared `risk` is wrong.
- An "underperformer" `tags` entry changes the capability's semantic metadata without establishing what that tag means operationally.
- Neither is universally valid across capability types.

**The observation establishes evidence of underperformance. It does not, by itself, establish the correct replacement definition.** This distinction is non-negotiable for CAP-O.

**Legitimate purpose of the provenance update:** makes the approved `capability.update` mutation durably traceable to the evolutionary signal and its evidence. The catalog post-apply reflects that an underperformer signal was approved for that capability at that version, attributable to the candidate and its evidence chain.

**Lifecycle consequences remain separately governed** by the existing lifecycle machinery (`capability.transition` for `emerging → active` etc.) — not by `capability.update`. CAP-O does not couple update with lifecycle progression.

### 4.5 The `sourceId` parameter — underperformer case (locked, unchanged)

`sourceId` arrives as the existing capability's id (the `underperformer` candidate's `target.id` is `signal.capabilityId`). The signature `candidateToExecutionStep(candidate, sourceId, currentVersion)` is preserved.

## 5. Data flow

An underperformer signal arrives at A5 (`a5-capability-measurement.ts`) → A5 publishes to `ProposalSignalChannel` (M1 seam, CAP-10.5) → A7 reads via `A7ProposalGenerator.generate()` → A7's `signalToCandidate(signal)` constructs `CapabilityEvolutionCandidate` with `proposedPatch` containing the provenance record → user proposes via `service.propose(candidate)` → user approves via `service.apply({ proposalId })` → `apply()` calls `candidateToExecutionStep(candidate, sourceId, "0.0.0")` → the `case "underperformer":` arm emits an `ExecutionStep` with `operation: "capability.update"` and `parameters: { capabilityId, sourceVersion, patch: candidate.proposedPatch }` → `GovernedExecutionRuntime` (CAP-6) commits the update mutation → `nextDefinitionForUpdate` applies the patch, classifies the SemVer bump (the provenance-only patch is PATCH-classified per `classifyUpdateBump`, since `extensions` is a PATCH field), produces a new immutable publication → catalog reflects the new version with `extensions.provenance.kind === "a7-underperformer"` → `proposalStore.recordExecuted(...)` is called with the projected mutation result.

## 6. Composition root

No changes. The composition root at `src/capability/platform.ts` already provides `CapabilityService` with `executor`, `proposalStore`, and `catalog`. CAP-O is internal to `candidateToExecutionStep` and `signalToCandidate`.

## 7. Migration boundary

No migration. The discriminator change is additive: the `case "underperformer":` arm now emits `capability.update` instead of falling through to `capability.transition`. The existing transition-path for `consolidation_opportunity` (CAP-P territory) and the defensive `default` are preserved bit-for-bit.

The `tests/capability/cap-12-e2e.vitest.ts` file is **modified** to:
- Step 12 (existing): catalog preservation for transition-path scenarios — preserved
- Step 12b (existing, CAP-N): catalog growth for create-path scenarios — preserved
- Step 12c (new, CAP-O): update-path scenario — see Section 9.2

## 8. Error handling

- **`underperformer` candidate with empty/missing `proposedPatch`** → throw deterministic error inside `candidateToExecutionStep` before executor invocation. The error is caught by `apply()`'s try/catch (`capability-service.ts:414-447`), persisted as `proposal.execution_failed`, and rethrown. Same pattern as other validation paths.
- **Executor failure on update** → existing `apply()` error path captures and records (no change needed).
- **`isNonEmptyPatch` returns false for `{}` and `undefined`** → guards against trivially-empty patches slipping through.

## 9. Testing strategy

### 9.1 Unit test (new)

`tests/capability/cap-o-candidate-mapping.vitest.ts` — matrix test of `candidateToExecutionStep`:

- **Axis 1 — happy path:** `underperformer` candidate with non-empty `proposedPatch` → emitted step has `operation: "capability.update"`, `parameters.capabilityId === sourceId`, `parameters.sourceVersion === currentVersion`, `parameters.patch` deep-equal to `candidate.proposedPatch`.
- **Axis 2 — invariant guard:** `underperformer` candidate with `proposedPatch: undefined` → throws deterministic error before executor invocation.
- **Axis 3 — invariant guard, empty patch:** `underperformer` candidate with `proposedPatch: {}` → throws deterministic error (not accepted despite `{}` being truthy).

The test follows the CAP-N test pattern (`tests/capability/cap-n-candidate-mapping.vitest.ts:231-243`). Uses `FakeSignalSource` + `A7ProposalGenerator` so `service.propose()` reads from the generator rather than receiving the candidate as a direct arg.

### 9.2 E2E test (extended)

`tests/capability/cap-12-e2e.vitest.ts` — new step 12c:

"apply(underperformer-candidate) durably attributes the existing capability to the evolutionary signal."

- Uses real executor (not spy) via fresh sibling-service construction with `new CapabilityMutationExecutorImpl({ catalog, registry })` — same pattern as CAP-N step 12b.
- Asserts:
  - **same capability identity** — `service.list().items.length` unchanged; the targeted id still present
  - **no catalog growth** — items.length before == items.length after
  - **real-executor succeeds** — no exception, `status === "executed"`
  - **provenance lands at extensions** — `platformCatalog.get(targetId).extensions.provenance.kind === "a7-underperformer"`
  - **provenance retains candidate attribution** — `extensions.provenance.candidateId === candidate.candidateId`
  - **provenance retains evidence** — `JSON.stringify(extensions.provenance.evidenceIds) === JSON.stringify(candidate.evidenceIds)`

### 9.3 Sentinel test (new)

`tests/capability/cap-o-sentinel.vitest.ts` — structural sentinel:

- **Axis 1 — behavioral:** `underperformer` candidate always produces `capability.update` and never `capability.transition`. Behavioral test (call the function, check `step.operation`), not source-text grep — follows the CAP-N test convention where the unit test is the primary surface.
- **Axis 2 — invariant guard:** candidate with missing or empty `proposedPatch` causes the function to throw.
- **Axis 3 — discriminator table completeness:** the `case "underperformer":` arm exists in `candidateToExecutionStep` (the carve-out site); `case "consolidation_opportunity":` continues to fall through to transition (CAP-P territory).

### 9.4 Regression

Full capability vitest suite passes with **zero regressions**: all existing tests remain green and the new CAP-O tests pass. Pre-implementation baseline is 559/559 (verified post-CAP-N at commit `f5b2f663`); post-implementation should be 559 + 7 new (3 mapping axes + 3 sentinel axes + 1 e2e step 12c).

## 10. Forward compatibility

- **CAP-P:** the same architectural pattern will apply — candidate extension (`absorbedCapabilityIds` + optional `proposedDefinition` + default `sourceDisposition`) → `capability.consolidate`. The discriminator table in §2 is the single source of truth.
- **Future richer patch derivation:** if evidence-backed research later supports deriving richer patches (e.g., bumping `risk` based on observed failure rate, adding diagnostic `tags`), the patch field on the candidate is the natural extension point. CAP-O deliberately does NOT lock that policy.
- **Provenance tracking:** the `extensions.provenance` field on underperformer-updated capabilities lets future governance queries filter for "A7-underperformer-approved" capabilities — symmetrical with the `a7-gap` provenance CAP-N established.

## 11. Out of scope

- CAP-P (consolidation_opportunity → capability.consolidate)
- A8/A9 implementation
- TUI/Web surfaces
- M2/M3 governance signal delivery/replay (deferred; non-blocking per post-CAP-N wayfinder Ticket B verdict, commit `b7cc01e0`)
- Mutation contract changes
- Executor changes
- A5 measurement-side changes
- Speculative semantic-update policy for underperformer observations
- Generalized candidate refactor

## 12. References

- CAP-N spec: `docs/superpowers/specs/2026-08-14-cap-n-end-to-end-create-path-design.md`
- CAP-N implementation: `src/capability/capability-service.ts:695-771` (discriminator); `tests/capability/cap-n-candidate-mapping.vitest.ts`
- Post-CAP-N wayfinder map #511: closed 2026-08-14; locked frontier order `CAP-O → CAP-P → A8 → A9 → TUI/Web`
- Post-CAP-N Ticket B (M2/A8): commit `b7cc01e0` — M2 does not block A8
- Post-CAP-N Ticket C (CAP-P contract): commit `3772e941` — CAP-P is contract-extension
- Post-CAP-N Ticket D (A8 store): commit `9f36adb3` — A8 mirrors A6 curation pattern
- Discriminator site: `src/capability/capability-service.ts:695-771`
- Candidate type: `src/adaptation/capability-evolution-types.ts:172-181`
- A7 derivation: `src/capability/evolution/a7-proposals.ts:206-216`
- Mutation contract: `src/capability/mutation-contract.ts:90-95` (`CapabilityUpdateMutation`), 435-449 (`validateUpdate`)
- Update-bump classifier: `src/capability/mutation-contract.ts:161-193` (`classifyUpdateBump`); extensions is a PATCH field
- Executor update path: `src/evolution/execution/capability-mutation-executor.ts:110-123` (`nextDefinitionForUpdate`)
- A7 proposal generator: `src/capability/evolution/a7-proposals.ts:192-242` (discriminator mapping)
- A5 measurement (out of scope for CAP-O): `src/evolution/observation/a5-capability-measurement.ts`
- M1 emission seam (out of scope for CAP-O): `src/capability/evolution/proposal-signal-channel.ts`
- ADR-0013 §4/§5/§7 (provider abstraction + execution binding + lifecycle)