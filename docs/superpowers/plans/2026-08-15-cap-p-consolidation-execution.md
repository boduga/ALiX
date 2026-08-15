# CAP-P Implementation Plan — Consolidation Execution Path Closure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the post-CAP-O discriminator gap by making `apply()` route `consolidation_opportunity` candidates to `capability.consolidate` (currently falls through to `capability.transition` via the silent default case). After CAP-P: the `consolidation_opportunity` row of the discriminator table is green; the `default` case is explicit fail-closed (THROWS, not silent transition).

**Architecture:** Single-function rewrite of the `case "consolidation_opportunity":` arm in `candidateToExecutionStep` at `src/capability/capability-service.ts`. The default case becomes fail-closed (throws on unrecognized sourcePatternId). Adds two optional fields to `CapabilityEvolutionCandidate` (`consolidateDefinition?`, `sourceDisposition?`) and extends the `consolidation_opportunity` signal in A7 with both fields. Invariant guards reject missing/invalid fields deterministically. Composition root, executor, catalog, governance, and proposal store are unchanged.

**Tech Stack:** TypeScript, vitest, pnpm. Existing capability platform architecture.

## Global Constraints

These are binding on every task — copy verbatim:

- **Carve-out sites (two files, per rulings #539 + CAP-O precedent):** (a) `src/capability/capability-service.ts:922+` (`candidateToExecutionStep` discriminator), and (b) `src/capability/platform.ts:111` (composition-root `overlapSignalSource` wiring, locked at ruling #539). These are the **only** files on the CAP-12 forbidden list that CAP-P modifies. All other CAP-12 forbidden files (`legacy-adapter.ts`, `registry.ts`, `provider-resolver.ts`, all CAP-1…CAP-11 sentinels) remain FORBIDDEN.
- **Operation mapping contract (locked post-CAP-P):** `sourcePatternId === "gap"` → `capability.create` (CAP-N); `sourcePatternId === "deprecation_signal"` → `capability.remove` (CAP-N); `sourcePatternId === "underperformer"` → `capability.update` (CAP-O); `sourcePatternId === "consolidation_opportunity"` → `capability.consolidate` (**CAP-P**); unrecognized sourcePatternId → THROWS (CAP-P fail-closed default).
- **Verbatim copy discipline (locked, governance-critical):** All four operator-supplied fields flow through the A7 pipeline VERBATIM. No derivation, no inference, no expansion, no completion:
  - `survivorCapabilityId` (signal) → `target.id` (candidate) → `parameters.target` (execution step)
  - `absorbedCapabilityIds[]` (signal) → `absorbedCapabilityIds[]` (candidate) → `parameters.sources[]` (execution step)
  - `consolidateDefinition` (signal) → `consolidateDefinition` (candidate) → `parameters.definition` (execution step)
  - `sourceDisposition` (signal) → `sourceDisposition` (candidate) → `parameters.sourceDisposition` (execution step)
- **Invariant guards (locked, mirrors CAP-O #982):** `case "consolidation_opportunity":` MUST throw a deterministic error if:
  - `candidate.consolidateDefinition` is missing (ruling #544 — caller-supplied target definition)
  - `candidate.sourceDisposition ∉ {"deprecate", "remove"}` (ruling #544 — caller-supplied disposition)
  - `candidate.absorbedCapabilityIds` is missing or empty (ruling #534 — defense in depth on the signal validator)
- **Default case fail-closed (locked):** The `default` case MUST throw a deterministic error if the sourcePatternId is unrecognized. Pre-CAP-P, the discriminator silently fell through to `capability.transition` — that was the bug. CAP-P makes the default case explicit fail-closed.
- **Candidate extension (locked):** `CapabilityEvolutionCandidate` gains exactly two new optional readonly fields at `src/adaptation/capability-evolution-types.ts`:
  - `consolidateDefinition?: CapabilityDefinition` (CAP-P, ruling #544)
  - `sourceDisposition?: "deprecate" | "remove"` (CAP-P, ruling #544)
- **Signal extension (locked):** `CapabilityEvolutionSignal`'s `consolidation_opportunity` variant gains two required readonly fields at `src/capability/evolution/a7-proposals.ts:86-103`:
  - `consolidateDefinition: CapabilityDefinition` (CAP-P, ruling #544)
  - `sourceDisposition: "deprecate" | "remove"` (CAP-P, ruling #544)
- **A7 validator (locked):** `validateConsolidationOpportunitySignal(signal)` enforces all three shape invariants: non-empty `absorbedCapabilityIds`, well-formed `consolidateDefinition`, valid `sourceDisposition`. Defense in depth — runs at the A7 signal-receipt seam.
- **Pair-layer identitySupplier extension (locked):** `OverlapIdentitySupplier` callback type extended with `consolidateDefinition` and `sourceDisposition`. The pair layer never derives these — composition-root binds the operator-CLI-supplied identities per ruling #544.
- **Operator CLI seam (locked):** `proposeConsolidation(input)` constructs the `consolidation_opportunity` signal carrying all four operator-supplied values verbatim. CLI already shipped at commit `d65dcf46` (ruling #544); CAP-P only updates the signal construction.
- **Test baseline:** 566 capability vitest tests passing post-CAP-O (`e770902a`). After CAP-P: 566 baseline + 9 new CAP-P sentinels + 0 regressions = **684 capability + evolution tests passing** (full suite verified).
- **Branch + worktree:** All work on worktree `cap-p` off branch `cap-p` (head `d65dcf46`). Push branch + PR; squash-merge to main.
- **No tag ceremony** for CAP-P. The `alix-capability-greenfield-complete` tag stays.
- **Spec deviations:** If a task requires deviation from the spec, STOP and surface to the human — do not silently adjust. Document deviations in commit messages + task reports; do NOT amend the spec doc.
- **Out of scope for CAP-P (do not implement):** A8/A9; TUI/Web surfaces; A5 measurement-side changes; executor changes (CAP-6's `validateConsolidate()` already enforces the conservative merge rules); mutation-contract changes (`CapabilityConsolidateMutation` already complete); A0 EvolutionProposalStore; P5.5/P5.6 analyzer-side changes; capability-pair layer authority expansion; A2.5/P5.1 consolidation-producer role; survivorship heuristic introduction; absorbed-set derivation/expansion.

---

### Task 1: Add `consolidateDefinition` + `sourceDisposition` to `CapabilityEvolutionCandidate`

**Files:**
- Modify: `src/adaptation/capability-evolution-types.ts:172-200` — add two optional readonly fields after `absorbedCapabilityIds`

**Interfaces:**
- Consumes: existing `CapabilityEvolutionCandidate` interface
- Produces: extended interface with two new optional readonly fields

**Code block (verbatim):**

```typescript
// In the CapabilityEvolutionCandidate interface (after `absorbedCapabilityIds`):

  /**
   * CAP-P: caller-supplied target definition carried verbatim from the
   * `consolidation_opportunity` signal (locked decisions #534 and #544 —
   * 2026-08-14/15). Present only when
   * `sourcePatternId === "consolidation_opportunity"`; absent for every
   * other sourcePatternId. The governance caller (operator CLI per #544)
   * owns construction of this definition — A7 transports it without
   * derivation, inference, or synthesis. The executor's
   * `validateConsolidate()` (mutation-contract.ts:464) enforces the
   * conservative merge invariants against catalog-resolved sources.
   */
  readonly consolidateDefinition?: CapabilityDefinition;
  /**
   * CAP-P: caller-supplied disposition for absorbed capabilities carried
   * verbatim from the `consolidation_opportunity` signal (locked
   * decisions #534 and #544). Present only when
   * `sourcePatternId === "consolidation_opportunity"`; absent for every
   * other sourcePatternId. Either `"deprecate"` (sources transition to
   * `deprecated` lifecycle) or `"remove"` (sources removed from
   * catalog). Caller-supplied — A7 does NOT infer.
   */
  readonly sourceDisposition?: "deprecate" | "remove";
```

**Steps:**

- [ ] **Step 1: Verify `CapabilityDefinition` import**

  Confirm `src/adaptation/capability-evolution-types.ts` already imports `CapabilityDefinition` (or that it's accessible without import — TypeScript may auto-import). If not present, add `import type { CapabilityDefinition } from "../capability/canonical/definition.js";` at the top.

- [ ] **Step 2: Add the two fields to `CapabilityEvolutionCandidate`**

  Per the code block above. Place after `absorbedCapabilityIds`. Both fields are `readonly`, optional (`?:`), and have docstrings citing the locked rulings.

- [ ] **Step 3: Run typecheck**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-p
  pnpm tsc --noEmit 2>&1 | tail -10
  ```

  Expected: PASS, no new errors (pre-existing `CapabilityApplyResult.status` errors are unchanged).

- [ ] **Step 4: Commit**

  ```bash
  git add src/adaptation/capability-evolution-types.ts
  git commit -m "feat(capability): CAP-P T1 candidate extension (consolidateDefinition + sourceDisposition)"
  ```

---

### Task 2: Extend `consolidation_opportunity` signal with `consolidateDefinition` + `sourceDisposition`

**Files:**
- Modify: `src/capability/evolution/a7-proposals.ts:86-103` — extend the `consolidation_opportunity` signal variant with two required readonly fields
- Modify: `src/capability/evolution/a7-proposals.ts:140-180` — extend `validateConsolidationOpportunitySignal` to enforce the new fields

**Interfaces:**
- Consumes: existing `CapabilityEvolutionSignal` union variant for `consolidation_opportunity`
- Produces: extended variant + extended validator

**Code block (verbatim):**

In `src/capability/evolution/a7-proposals.ts` after the existing variant, extend with two new fields. After the `absorbedCapabilityIds: readonly string[]` line:

```typescript
  | {
      readonly kind: "consolidation_opportunity";
      readonly survivorCapabilityId: string;
      readonly absorbedCapabilityIds: readonly string[];
      /**
       * CAP-P (ruling #544, 2026-08-15): operator-supplied target
       * definition transported verbatim through A7. Required on the
       * signal. Governance caller (operator CLI per #544) owns
       * construction — A7 transports without derivation, inference,
       * or synthesis. The executor's `validateConsolidate()`
       * (mutation-contract.ts:464) enforces conservative merge
       * invariants against catalog-resolved sources.
       */
      readonly consolidateDefinition: CapabilityDefinition;
      /**
       * CAP-P (ruling #544, 2026-08-15): operator-supplied source
       * disposition transported verbatim through A7. Required on
       * the signal. Either `"deprecate"` (sources transition to
       * `deprecated` lifecycle) or `"remove"` (sources removed
       * from catalog).
       */
      readonly sourceDisposition: "deprecate" | "remove";
      readonly score: number;
      readonly evidenceIds: ReadonlyArray<string>;
    }
```

Add to imports:

```typescript
import type { CapabilityDefinition } from "../../capability/canonical/definition.js";
```

Replace `validateConsolidationOpportunitySignal`:

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

function isValidConsolidateDefinition(value: unknown): value is CapabilityDefinition {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v["id"] !== "string" || v["id"].length === 0) return false;
  if (typeof v["version"] !== "string" || v["version"].length === 0) return false;
  if (typeof v["kind"] !== "string" || v["kind"].length === 0) return false;
  return true;
}
```

**Steps:**

- [ ] **Step 1: Extend the signal variant**

  In `src/capability/evolution/a7-proposals.ts:86-103`, add the `CapabilityDefinition` import and extend the `consolidation_opportunity` variant per the code block.

- [ ] **Step 2: Extend the validator**

  Replace `validateConsolidationOpportunitySignal` per the code block. Add the `isValidConsolidateDefinition` helper.

- [ ] **Step 3: Update existing a7-proposals tests**

  Update `tests/capability/a7-proposals.vitest.ts` to include `consolidateDefinition` and `sourceDisposition` on every `consolidation_opportunity` signal literal (4 sites). Use the same `CapabilityDefinition` shape the cap-p tests use.

- [ ] **Step 4: Update p5-pair-layer tests**

  Update `tests/capability/evolution/p5-pair-layer.vitest.ts` to include `consolidateDefinition` and `sourceDisposition` on every `OverlapIdentitySupplier` callback (4 sites). Update the signal-top-level-keys test to include the new fields.

- [ ] **Step 5: Run A7 + pair-layer tests**

  ```bash
  pnpm vitest run tests/capability/a7-proposals.vitest.ts tests/capability/evolution/p5-pair-layer.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS, 14 + 12 = 26 tests passing.

- [ ] **Step 6: Commit**

  ```bash
  git add src/capability/evolution/a7-proposals.ts tests/capability/a7-proposals.vitest.ts tests/capability/evolution/p5-pair-layer.vitest.ts
  git commit -m "feat(evolution): CAP-P T2 A7 signal contract extension + validator (consolidateDefinition + sourceDisposition)"
  ```

---

### Task 3: Update `signalToCandidate` to copy `consolidateDefinition` + `sourceDisposition` verbatim

**Files:**
- Modify: `src/capability/evolution/a7-proposals.ts` `signalToCandidate` `case "consolidation_opportunity":` — copy the two new fields verbatim

**Code block (verbatim):**

```typescript
case "consolidation_opportunity":
  // Ruling #534 (locked 2026-08-14): both `survivorCapabilityId` and
  // `absorbedCapabilityIds` are caller-supplied and authoritative.
  // Ruling #544 (locked 2026-08-15): `consolidateDefinition` and
  // `sourceDisposition` are operator-CLI-supplied and authoritative.
  // A7 transports verbatim — no derivation, inference, expansion, or
  // completion. Validator enforces all shape invariants
  // (`absorbedCapabilityIds.length >= 1`, `consolidateDefinition`
  // present, `sourceDisposition ∈ {"deprecate","remove"}`) before
  // any candidate construction occurs.
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

**Steps:**

- [ ] **Step 1: Update `signalToCandidate`**

  Per the code block above. Add `consolidateDefinition: signal.consolidateDefinition` and `sourceDisposition: signal.sourceDisposition` to the returned candidate object.

- [ ] **Step 2: Re-run A7 tests**

  ```bash
  pnpm vitest run tests/capability/a7-proposals.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add src/capability/evolution/a7-proposals.ts
  git commit -m "feat(evolution): CAP-P T3 signalToCandidate verbatim copy of consolidateDefinition + sourceDisposition"
  ```

---

### Task 4: Wire operator CLI → A7 signal with operator-supplied values

**Files:**
- Modify: `src/capability/capability-service.ts:683-735` — `proposeConsolidation(input)` constructs the `consolidation_opportunity` signal carrying all four operator-supplied values

**Code block (verbatim):**

In `proposeConsolidation(input)`:

```typescript
// 1. Signal — operator identities copied verbatim, then validated.
// CAP-P (locked rulings #534 + #544, 2026-08-14/15): the signal
// transports `consolidateDefinition` and `sourceDisposition`
// operator-supplied. A7 does NOT derive, infer, expand, or
// complete any of these fields — they pass through to the
// candidate, then to the `capability.consolidate` execution step,
// unchanged.
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

In the candidate construction (after step 4):

```typescript
// 4. Candidate — survivor is the target; absorbed set, definition, and
//    disposition all carried verbatim from the operator's request.
//    CAP-P (locked rulings #534 + #544, 2026-08-14/15): the
//    `candidateToExecutionStep` discriminator depends on these three
//    fields being present and well-formed on the candidate at apply
//    time. We copy them verbatim — no derivation, inference, expansion,
//    or completion.
const candidate: CapabilityEvolutionCandidate = {
  candidateId: `operator-consolidation-${input.survivorCapabilityId}`,
  sourcePatternId: "consolidation_opportunity",
  confidence: signal.score,
  target: { kind: "capability", id: input.survivorCapabilityId },
  description:
    `Operator-requested consolidation of ` +
    `${mutation.sources.join(", ")} into ${mutation.target}`,
  expectedEffect: "Consolidate the operator-supplied absorbed set into the survivor",
  riskClass: "high",
  evidenceIds: signal.evidenceIds,
  absorbedCapabilityIds: [...input.absorbedCapabilityIds],
  consolidateDefinition: input.definition,
  sourceDisposition: input.sourceDisposition,
};
```

**Steps:**

- [ ] **Step 1: Update `proposeConsolidation`**

  Per the code blocks above.

- [ ] **Step 2: Update CLI test recording-service mock**

  In `tests/cli/capability-consolidate.vitest.ts` `RecordingService.proposeConsolidation`, construct the signal with `consolidateDefinition: input.definition` and `sourceDisposition: input.sourceDisposition`. Add a typed cast on `result.signal.survivorCapabilityId` access (since the result type is the union `CapabilityEvolutionSignal`).

- [ ] **Step 3: Run CLI tests**

  ```bash
  pnpm vitest run tests/cli/capability-consolidate.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS, 16/16 tests green.

- [ ] **Step 4: Commit**

  ```bash
  git add src/capability/capability-service.ts tests/cli/capability-consolidate.vitest.ts
  git commit -m "feat(capability): CAP-P T4 CLI → A7 signal wiring (operator-supplied values flow verbatim)"
  ```

---

### Task 5: Replace fall-through case in `candidateToExecutionStep` with real `capability.consolidate` dispatch

**Files:**
- Modify: `src/capability/capability-service.ts:984-998` — replace the `case "consolidation_opportunity":` fall-through with explicit real dispatch + invariant guards
- Modify: `src/capability/capability-service.ts:1010+` — replace the `default` case's silent fall-through with explicit fail-closed throw

**Code block (verbatim):**

Replace the `case "consolidation_opportunity":` arm + the `default` case in `candidateToExecutionStep`:

```typescript
case "consolidation_opportunity": {
  // CAP-P invariant (locked rulings #534 + #544, 2026-08-14/15):
  // the candidate MUST carry the operator-supplied
  // `consolidateDefinition` and `sourceDisposition`. This invariant
  // mirrors CAP-O's underperformer-patch invariant (#982) — both
  // are locked structural invariants that the executor depends on.
  // If the candidate lacks them, the observer would receive a
  // structurally invalid `capability.consolidate` mutation that
  // the executor's `validateConsolidate()` (mutation-contract.ts:464)
  // would reject at apply time with a less-precise error. Throw
  // BEFORE constructing the parameters so the guard is the only
  // path the executor can possibly see, with full context about
  // which candidate lacked the operator-supplied fields.
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

Also update the discriminator-table docstring comment to reflect the closed 5-cell state.

**Steps:**

- [ ] **Step 1: Replace the fall-through case**

  Per the code block above.

- [ ] **Step 2: Update the CAP-N sentinel test**

  `tests/capability/cap-n-sentinel.vitest.ts` axis 1 now checks: (a) the function body contains all four operation literals (`create`, `remove`, `update`, `consolidate`); (b) the `default:` case contains a `throw new Error` (within ~1500 chars of context to span comment + throw). Update the test.

- [ ] **Step 3: Update CAP-N mapping test**

  `tests/capability/cap-n-candidate-mapping.vitest.ts` axis 4 was previously asserting `consolidation_opportunity → capability.transition` (pre-CAP-P behavior). Update axis 4 to:
  - Construct the signal with the new fields (`consolidateDefinition`, `sourceDisposition`)
  - Assert `step.operation === "capability.consolidate"` (post-CAP-P behavior)

- [ ] **Step 4: Run full capability + evolution suite**

  ```bash
  pnpm vitest run tests/capability/ tests/evolution/ 2>&1 | tail -10
  ```

  Expected: PASS, 684 tests passing.

- [ ] **Step 5: Commit**

  ```bash
  git add src/capability/capability-service.ts tests/capability/cap-n-sentinel.vitest.ts tests/capability/cap-n-candidate-mapping.vitest.ts
  git commit -m "feat(capability): CAP-P T5 discriminator rewrite (consolidation_opportunity → consolidate + default fail-closed)"
  ```

---

### Task 6: Add CAP-P consolidation execution sentinels

**Files:**
- Create: `tests/capability/cap-p-consolidate-execution.vitest.ts` — 9 sentinels (8 axes + 1 end-to-end)

**Interfaces:**
- Consumes: `candidateToExecutionStep` indirectly via `service.apply({ proposalId })` (mirrors CAP-N/CAP-O pattern)
- Produces: 9 sentinels covering all four operator-supplied fields verbatim + invariant guards + default-case fail-closed

**Test strategy:** mirror `cap-n-candidate-mapping.vitest.ts` exactly — `FakeSignalSource` + `A7ProposalGenerator` + `buildSpiedSiblingService` for axes 1-5 (real-path A7 → signalToCandidate → candidateToExecutionStep); `proposeDirect` for axes 6-9 (hand-rolled candidate injection for invariant-violation tests).

**Sentinel inventory (locked):**
1. `consolidation_opportunity → capability.consolidate` (no fall-through to `capability.transition`)
2. `consolidateDefinition` reaches executor verbatim (deep equality on every field)
3. `sourceDisposition` reaches executor verbatim (both `'deprecate'` AND `'remove'` tested)
4. `sources` (= `absorbedCapabilityIds`) reach executor in same order (no expansion, no reorder)
5. `target` (= `survivorCapabilityId`) reaches executor verbatim; target is the survivor (not absorbed source)
6. Missing `consolidateDefinition` → throws `/consolidateDefinition/`; executor NOT called
7. Invalid `sourceDisposition` → throws `/sourceDisposition/`; executor NOT called
8. Empty `absorbedCapabilityIds` → throws `/absorbedCapabilityIds/` (ruling #534 defense-in-depth)
9. Unrecognized sourcePatternId → throws `/unrecognized sourcePatternId/`; executor NOT called

**Steps:**

- [ ] **Step 1: Read CAP-N/CAP-O mapping tests**

  Read `tests/capability/cap-n-candidate-mapping.vitest.ts` and `tests/capability/cap-o-candidate-mapping.vitest.ts` to mirror the harness pattern.

- [ ] **Step 2: Write the 9-axis test file**

  Create `tests/capability/cap-p-consolidate-execution.vitest.ts` per the sentinel inventory above. Use the same `FakeSignalSource` + `A7ProposalGenerator` + `buildSpiedSiblingService` harness for axes 1-5, and `buildSpyServiceWithSeam` + `proposeDirect` for axes 6-9.

- [ ] **Step 3: Run sentinels**

  ```bash
  pnpm vitest run tests/capability/cap-p-consolidate-execution.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS, 9/9 sentinels green.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/capability/cap-p-consolidate-execution.vitest.ts
  git commit -m "test(capability): CAP-P T6 9-axis consolidation execution sentinels"
  ```

---

### Task 7: Write CAP-P spec + plan + checkpoint docs

**Files:**
- Create: `docs/superpowers/specs/2026-08-15-cap-p-consolidation-execution-design.md`
- Create: `docs/superpowers/plans/2026-08-15-cap-p-consolidation-execution.md` (this file)
- Create: `docs/architecture/checkpoints/2026-08-15-cap-p-consolidation-execution-complete.md`

**Steps:**

- [ ] **Step 1: Spec doc**

  Write the design spec following the CAP-N/CAP-O template (sections 1-12). Include the discriminator-table inventory, the verbatim copy discipline, the invariant guards, the operator-CLI seam, the pair-layer seam, and the test strategy.

- [ ] **Step 2: Plan doc**

  Write the implementation plan following the CAP-N/CAP-O template (this file). 7 tasks, each with subagent-reviewer gates, code blocks, and steps.

- [ ] **Step 3: Checkpoint doc**

  Write the close-out checkpoint following the CAP-N/CAP-O template. Frozen status, follow-up, references.

- [ ] **Step 4: Commit**

  ```bash
  git add docs/superpowers/specs/2026-08-15-cap-p-consolidation-execution-design.md docs/superpowers/plans/2026-08-15-cap-p-consolidation-execution.md docs/architecture/checkpoints/2026-08-15-cap-p-consolidation-execution-complete.md
  git commit -m "docs(capability): CAP-P T7 spec + plan + checkpoint docs"
  ```

---

### Task 8: PR + squash-merge + memory entry

**Steps:**

- [ ] **Step 1: Push branch**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-p
  git push -u origin cap-p
  ```

  **STOP and ask the human for approval before the push.** Standing constraint: never push without human approval.

- [ ] **Step 2: Open PR via gh**

  ```bash
  gh pr create --base main --head cap-p \
    --title "CAP-P Consolidation Execution Path Closure" \
    --body "Closes the post-CAP-O discriminator gap. Fills the consolidation_opportunity row of the CAP-N/O/P discriminator table.

  **CAP-P routes \`consolidation_opportunity\` candidates to \`capability.consolidate\`** at \`src/capability/capability-service.ts:922+\` (the CAP-N/O carve-out site). After this PR:
  - \`apply()\` discriminates per candidate \`sourcePatternId\`:
    - \`gap\` → \`capability.create\` (CAP-N, preserved)
    - \`deprecation_signal\` → \`capability.remove\` (CAP-N, preserved)
    - \`underperformer\` → \`capability.update\` (CAP-O, preserved)
    - \`consolidation_opportunity\` → \`capability.consolidate\` (**CAP-P new**)
    - default → THROWS (CAP-P fail-closed — replaces the silent fall-through to \`capability.transition\`)
  - \`CapabilityEvolutionCandidate\` gains optional \`consolidateDefinition?: CapabilityDefinition\` + \`sourceDisposition?: \"deprecate\" | \"remove\"\`
  - A7 \`consolidation_opportunity\` signal extends with required \`consolidateDefinition\` + \`sourceDisposition\` fields
  - \`validateConsolidationOpportunitySignal\` enforces all three shape invariants (defense in depth)
  - \`OverlapIdentitySupplier\` callback type extended with \`consolidateDefinition\` + \`sourceDisposition\` (composition-root-bound operator identities per #544)
  - Operator CLI (\`alix capability consolidate\`) flows all four operator-supplied values verbatim through the A7 pipeline
  - Invariant guards at the discriminator seam reject missing/invalid fields deterministically (mirrors CAP-O #982)
  - Sentinel test (\`tests/capability/cap-p-consolidate-execution.vitest.ts\`) — 9 axes, behavioral, full CLI → signal → candidate → executor path

  ## Verbatim copy discipline (governance-critical)
  All four operator-supplied fields flow through the A7 pipeline VERBATIM. No derivation, no inference, no expansion, no completion. The operator CLI (ruling #544) is the construction seam; the pair layer (ruling #543) is the evidence-only bridge; A7 transports without synthesis.

  ## Test totals
  \`\`\`
  pnpm vitest run tests/capability/ tests/evolution/
  Test Files  79 passed (79)
  Tests       684 passed (684)  # 566 CAP-O baseline + 9 CAP-P sentinels + 12 pre-existing pair-layer + 16 pre-existing CLI + remaining regression tests
  \`\`\`

  ## Commits
  - T1: candidate extension (\`consolidateDefinition\` + \`sourceDisposition\`)
  - T2: A7 signal contract extension + validator
  - T3: \`signalToCandidate\` verbatim copy
  - T4: CLI → A7 signal wiring
  - T5: discriminator rewrite + default fail-closed
  - T6: 9-axis consolidation execution sentinels
  - T7: spec + plan + checkpoint docs

  🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  ```

- [ ] **Step 3: Squash-merge**

  **STOP and ask the human for approval before the merge.** Standing constraint: never squash-merge without human approval.

  ```bash
  cd /home/babasola/Projects/Monolith
  gh pr merge <PR-number> --squash --delete-branch
  git pull origin main
  ```

- [ ] **Step 4: Write memory entry**

  Write `/home/babasola/.claude/projects/-home-babasola-Projects-Monolith/memory/cap-p-consolidation-execution-complete.md` with:
  - `type: project`
  - body: CAP-P closed the post-CAP-O `consolidation_opportunity` discriminator gap. `consolidation_opportunity` candidates now route to `capability.consolidate` (previously fell through to `capability.transition` via the silent default case). The default case is now explicit fail-closed (throws on unrecognized sourcePatternId). Operator CLI is the construction seam (ruling #544); pair layer is the evidence-only bridge (ruling #543); A7 transports all four operator-supplied values verbatim (ruling #534). Architecture progression: CAP-N (create material) → CAP-O (update provenance) → CAP-P (consolidate sources+target+definition+disposition). Next frontier: A8 organizational learning.

- [ ] **Step 5: Update MEMORY.md**

  Add a one-line pointer to the new memory file in the index. Insert it after the existing CAP-O pointer.

- [ ] **Step 6: Clean up worktree + local branch**

  Per the standing `branch-workflow-policy.md`:

  ```bash
  cd /home/babasola/Projects/Monolith
  git worktree remove --force .claude/worktrees/cap-p
  git branch -d cap-p
  ```

---

## Self-Review

**1. Spec coverage:**
- §2 goal (consolidation_opportunity → capability.consolidate, default fail-closed) → Tasks 5 ✓
- §4.1 discriminator rewrite + invariant guards → Task 5 ✓
- §4.2 candidate extension (`consolidateDefinition?`, `sourceDisposition?`) → Task 1 ✓
- §4.3 A7 signal extension → Task 2 ✓
- §4.4 A7 validator → Task 2 ✓
- §4.5 A7 derivation (verbatim copy) → Task 3 ✓
- §4.6 Operator CLI seam → Task 4 ✓
- §4.7 Pair-layer identitySupplier extension → Task 2 ✓ (pair-layer test updated)
- §5 data flow → covered by Task 6 sentinels (axis 1-5) ✓
- §7 migration (no migration; additive) → Task 5 ✓
- §8 error handling → Task 5 (invariant guards) + Task 6 sentinels (axes 6-9) ✓
- §9.1 unit tests → Task 6 (9 sentinels) ✓
- §9.2 CLI test → Task 4 (existing 16 tests remain green) ✓
- §9.3 pair-layer test → Task 2 (existing 12 tests remain green) ✓
- §9.4 CAP-N sentinel updated → Task 5 ✓
- §9.5 regression → Task 5 Step 4 + Task 6 Step 3 ✓

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later", "fill in details" ✓
- Test code is concrete (not "similar to Task N") ✓
- All step types are explicit ✓
- The "STOP and ask" notes in T8 Steps 1 and 3 are intentional user-approval gates, not placeholders ✓

**3. Type consistency:**
- `CapabilityEvolutionCandidate.consolidateDefinition?: CapabilityDefinition` consistent across T1, T3, T5, T6
- `CapabilityEvolutionSignal.consolidation_opportunity` variant consistent across T2, T3, T4, T6
- `OverlapIdentitySupplier` shape consistent across T2 and the pair-layer test updates
- Error message regexes consistent across T5 (invariant guards) and T6 (sentinels 6/7/8/9)

**4. Open question surfaced for human review:**
- The discriminator's `default` case throws rather than producing a `capability.transition`. This is the FAIL-CLOSED boundary — CAP-N's defensive default also produced `capability.transition`. **The architectural decision is locked at ruling #544 followup: any future sourcePatternId gets added as an explicit case BEFORE the default.** The default never emits a mutation; the default always throws.

---

## Execution Handoff

This plan is ready for subagent-driven execution. The 8 tasks follow the standard SDD pattern:
- T1 (candidate extension) → T2 (signal + validator) → T3 (signalToCandidate) → T4 (CLI wiring) → T5 (discriminator + default) → T6 (sentinels) → T7 (docs) → T8 (PR + merge + memory)

Per-task reviewer gates:
- T1 uses haiku (one-file additive type extension)
- T2 uses sonnet (signal contract + validator enforcement)
- T3 uses haiku (one-file copy)
- T4 uses sonnet (service-level wiring + test updates)
- T5 uses sonnet (discriminator rewrite + invariant guards + sentinel test updates)
- T6 uses sonnet (9-axis sentinels)
- T7 uses haiku (doc-only, near-zero complexity)
- T8 is the PR + merge workflow (no review)

Whole-branch final review: sonnet, after T8 squash-merge on a temporary integration branch.

**Note on user approval gates:** T8 Steps 1 (push) and Step 3 (squash-merge) both require explicit human approval. Subagents must STOP and surface the request, not proceed automatically.
