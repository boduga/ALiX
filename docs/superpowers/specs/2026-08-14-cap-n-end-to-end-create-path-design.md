# CAP-N — End-to-End Create-Path Closure

**Status:** Design (brainstorm → spec → plan → SDD → closeout)
**Date:** 2026-08-14
**Author:** CAP-N spec drafting session
**Parent program:** CAP-1 → CAP-12 greenfield capability platform (tag `alix-capability-greenfield-complete`)
**Closes:** CAP-12 §20 #12 carve-out; supersedes the "PASS *with caveat*" verdict
**Carve-out site:** `src/capability/capability-service.ts:702,704` — `candidateToExecutionStep` hardcodes `operation: "capability.transition"`

## 1. Problem

CAP-12 (issue #496) closed the greenfield program with all 19 §20 hard-acceptance criteria green. Criterion #12 ("A7 register can be approved and actually applied") passed *with a caveat* — `apply()`'s candidate → mutation mapping hardcodes `capability.transition`, so a `gap`-patterned proposal that should create a new capability is instead recorded as a transition against `sourceId`.

The carve-out was user-approved 2026-08-14 and recorded in:
- `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md` §10 (table row) + §10 caveat paragraph
- tag annotation `alix-capability-greenfield-complete`
- `src/capability/capability-service.ts:687-689` (in-code comment forecasting CAP-N)

CAP-N closes this carve-out so §20 #12 reads plain "PASS" and the tag annotation can drop the carve-out paragraph.

## 2. Goal

`apply()` discriminates between candidate `sourcePatternId`s and emits the appropriate `CapabilityMutation` operation:
- `"gap"` → `capability.create` (new capability registered)
- `"deprecation_signal"` → `capability.remove` (deprecated capability removed)
- All other source patterns → `capability.transition` (preserves current behavior; `underperformer` and `consolidation_opportunity` route to transition for now — a true `capability.update` / `capability.consolidate` discriminator can be a follow-up if needed)

The CAP-12 e2e step 12 ("catalog preservation") flips to assert catalog growth for the create-path scenario while continuing to assert preservation for the transition-path scenario.

## 3. Non-goals

- **Re-architecting the proposal generator (CAP-9 work).** A7 already emits `CapabilityEvolutionCandidate` with a `sourcePatternId` discriminator. CAP-N consumes the existing shape.
- **Changing `CapabilityEvolutionCandidate` type.** The existing `sourcePatternId` field is sufficient.
- **True `capability.update` for underperformers.** Currently routes to `capability.transition`. Future work can tighten the discriminator if needed.
- **True `capability.consolidate` for consolidation_opportunity.** Same — future work.
- **CAP-12 forbidden-file policy is partly lifted.** `src/capability/capability-service.ts` is on the CAP-12 forbidden list. CAP-N lifts the restriction for that single file because the carve-out is exactly in that file. All other CAP-12 forbidden files remain forbidden.

## 4. Architecture

### 4.1 Operation mapping contract (locked)

The mapping lives in `candidateToExecutionStep` at `src/capability/capability-service.ts:695-715`. CAP-N rewrites this function (single function, single file, single carve-out site).

| Candidate `sourcePatternId` | Emitted `operation` | `parameters` shape |
|---|---|---|
| `"gap"` | `"capability.create"` | `{ operation, proposedDefinition }` — proposed definition auto-derived from candidate fields (see §4.2) |
| `"deprecation_signal"` | `"capability.remove"` | `{ operation, capabilityId: sourceId, reason: candidate.description }` |
| `"underperformer"` | `"capability.transition"` | current shape preserved |
| `"consolidation_opportunity"` | `"capability.transition"` | current shape preserved |
| (any other) | `"capability.transition"` | current shape preserved (defensive default) |

### 4.2 Auto-derived proposed definition (locked)

For `"gap"` candidates, the executor needs a complete `CapabilityDefinition`. CAP-N derives it from the candidate fields:

```
proposedDefinition = {
  id: candidate.target.id,                    // "new.${candidateId}" — placeholder; final id chosen by executor
  version: "0.1.0",                            // initial SemVer per CAP-2
  kind: "operation",                          // default per CAP-4 (covers the broadest provider-agnostic case)
  lifecycle: "emerging",                      // per CAP-7
  bindings: [],                                // empty — caller fills bindings post-create via capability.update
  argsSchema: { type: "object", properties: {} },  // placeholder, updateable
  resultSchema: { type: "object", properties: {} },  // placeholder, updateable
  title: candidate.description,                // human-readable
  description: candidate.description,
  tags: [],
  examples: [],
  allowFallbacks: false,
  requiredPermissions: [],
  category: "uncategorized",
  risk: candidate.riskClass,                   // "low" | "medium" | "high"
  extensions: { provenance: { kind: "a7-gap", candidateId: candidate.candidateId } },
}
```

Rationale: gap-candidates don't carry a full definition in the candidate shape (CAP-9 deliberately keeps them signal-light). Auto-deriving a minimal valid definition lets the create mutation succeed. Callers can refine via `capability.update` after creation. The `extensions.provenance` field records the A7 origin for governance traceability.

The `"0.1.0"` initial version and `"operation"` default kind are themselves defaults that future work may override per-gap; for CAP-N, the defaults match the most-common pattern in the existing capability vitest fixtures.

### 4.3 The `sourceId` parameter — create case (locked)

The current function signature passes `sourceId: string` (the capability being transitioned). For a create-intent, there is no existing capability — `sourceId` arrives as empty string `""` from the caller at `capability-service.ts:409` (caller comments at line 397-402 explicitly forecast this). CAP-N keeps the existing signature: the caller continues to pass `""` for create intents, and the function detects create via `sourcePatternId === "gap"` rather than via the empty string.

### 4.4 Forecast pin — preserved

The `parameters.sourceVersion` forecast-pin behavior is preserved for transition and remove cases. For create cases, `sourceVersion` defaults to the executor's "next catalog version" — `0.0.0` placeholder as already documented at `capability-service.ts:402`.

## 5. Data flow

A gap signal arrives at A7 (`a7-proposals.ts`) → A7 emits a `CapabilityEvolutionCandidate` with `sourcePatternId: "gap"` and `target.id: "new.${candidateId}"` (already implemented) → user proposes via `service.propose(candidate)` → user approves via `service.apply({ proposalId })` → `apply()` calls the rewritten `candidateToExecutionStep(candidate, "", "0.0.0")` → function emits `ExecutionStep` with `operation: "capability.create"` and `parameters.proposedDefinition` → `GovernedExecutionRuntime` (CAP-6) commits the create mutation → catalog grows by one → `proposalStore.recordExecuted(...)` is called with the projected mutation result.

## 6. Composition root

No changes. The composition root at `src/capability/platform.ts` already provides `CapabilityService` with `executor`, `proposalStore`, and `catalog`. The CAP-N change is internal to `candidateToExecutionStep`.

## 7. Migration boundary

No migration. The candidate → mutation mapping change is additive (new emission paths for create + remove). Existing transition-path behavior is preserved bit-for-bit.

The `tests/capability/cap-12-e2e.vitest.ts` file is **modified** to:
- Step 12 (existing): assert catalog preservation for transition-path (preserved)
- Step 12-new: assert catalog growth for create-path (new)

The CAP-12 carve-out paragraph in `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md` is **annotated** (not removed) as "Closed by CAP-N at <commit SHA>." Historical record preserved.

## 8. Error handling

- **Unknown `sourcePatternId`** → defensive default to `capability.transition` (current behavior). No throw — the conservative behavior is the same as today.
- **`sourcePatternId === "gap"` but `target.id` missing** → not possible given the candidate schema (target is required, kind is "capability", id is non-null string).
- **Executor failure on create** → existing `apply()` error path captures and records (no change needed).

## 9. Testing strategy

### 9.1 Unit tests (new)
`tests/capability/cap-n-candidate-mapping.vitest.ts` — small matrix test of `candidateToExecutionStep`:
- 4 axes: gap → create, deprecation_signal → remove, underperformer → transition, consolidation_opportunity → transition
- Asserts the `operation` field on the emitted `ExecutionStep`
- Asserts the `parameters` shape matches the table in §4.1
- Asserts the auto-derived `proposedDefinition` for the create case is a valid `CapabilityDefinition` (id present, version SemVer, kind valid)

### 9.2 E2E test (modified)
`tests/capability/cap-12-e2e.vitest.ts` — step 12 modified:
- For transition-path scenarios: catalog preservation unchanged
- For create-path scenarios: catalog grew by exactly one, new capability present with `target.id`

### 9.3 Carve-out verification
`tests/capability/cap-n-sentinel.vitest.ts` — structural sentinel:
- Axis 1: `candidateToExecutionStep` no longer hardcodes `"capability.transition"` as the only operation string (grep the function body for the bare `"capability.transition"` literal — must appear at most once per emission path)
- Axis 2: `capability-service.ts:702,704` no longer exists as the carve-out site (the lines now route per `sourcePatternId`)

### 9.4 Regression
Full capability vitest suite must remain at 552/552 PASS + the new tests (4 unit + 2 sentinel = 6 net new tests).

## 10. Forward compatibility

- **Future tightening**: Adding `capability.update` and `capability.consolidate` is now a 1-line change in the candidate → mutation switch. The discriminator table in §4.1 is the single source of truth.
- **Provenance tracking**: The `extensions.provenance` field on auto-derived definitions lets future governance queries filter for "A7-gap-created" capabilities.

## 11. Out of scope

- True `capability.update` for underperformers (current → transition)
- True `capability.consolidate` for consolidation_opportunity (current → transition)
- Changes to `CapabilityEvolutionCandidate` shape
- Changes to A7 proposal generator (CAP-9 work)
- Changes to the executor beyond reading `proposedDefinition` from `parameters`
- Tag ceremony (CAP-N produces its own tag, not a replacement of the greenfield-complete tag)

## 12. References

- CAP-12 carve-out: `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md` §10
- CAP-12 e2e test: `tests/capability/cap-12-e2e.vitest.ts`
- Carve-out site: `src/capability/capability-service.ts:695-715`
- Mutation contract: `src/capability/mutation-contract.ts` (5 operations defined; CAP-N uses 3)
- A7 proposal generator: `src/capability/evolution/a7-proposals.ts:192-242` (already emits gap-candidates with `target.id = "new.${candidateId}"`)
- ADR-0013 §4/§5/§7 (provider abstraction + execution binding + lifecycle)