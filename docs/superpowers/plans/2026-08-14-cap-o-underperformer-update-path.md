# CAP-O Implementation Plan — Underperformer Update-Path Closure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the post-CAP-N discriminator gap by making `apply()` route `underperformer` candidates to `capability.update` (currently falls through to `capability.transition`). After CAP-O: the `underperformer` row of the discriminator table is green; `consolidation_opportunity` continues routing to `capability.transition` (CAP-P's territory).

**Architecture:** Single-function rewrite of the `case "underperformer":` arm in `candidateToExecutionStep` at `src/capability/capability-service.ts`. Adds an optional `proposedPatch?: CapabilityDefinitionPatch` field to `CapabilityEvolutionCandidate` (`src/adaptation/capability-evolution-types.ts`); A7's `signalToCandidate` (`src/capability/evolution/a7-proposals.ts`) constructs a **provenance-only** patch. Invariant guard rejects empty/missing `proposedPatch` deterministically. Composition root, executor, catalog, governance, and proposal store are unchanged.

**Tech Stack:** TypeScript, vitest, pnpm. Existing capability platform architecture.

## Global Constraints

These are binding on every task — copy verbatim:

- **Carve-out site:** `src/capability/capability-service.ts:695-771` (`candidateToExecutionStep` function). This is the **only** file on the CAP-12 forbidden list that CAP-O modifies. All other CAP-12 forbidden files (`src/capability/platform.ts`, `legacy-adapter.ts`, `registry.ts`, `provider-resolver.ts`, all CAP-1…CAP-11 sentinels) remain FORBIDDEN.
- **Operation mapping contract (locked):** `sourcePatternId === "gap"` → `capability.create` (CAP-N); `sourcePatternId === "deprecation_signal"` → `capability.remove` (CAP-N); `sourcePatternId === "underperformer"` → `capability.update` (CAP-O); `sourcePatternId === "consolidation_opportunity"` → `capability.transition` (CAP-P territory, preserved); defensive `default` → `capability.transition`.
- **Patch policy — provenance only (locked, governance-critical):** The underperformer candidate carries ONLY an audit/provenance patch — never a semantic modification to the capability definition. Patch shape:
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
  No `risk` bump, no `tags` annotation, no other field. If evidence cannot deterministically justify a meaningful patch, the candidate must not manufacture one merely to satisfy `CapabilityUpdateMutation`'s non-empty-patch requirement.
- **Invariant guard (locked):** `case "underperformer":` MUST throw a deterministic error if `candidate.proposedPatch` is missing, `undefined`, or structurally empty (`{}`). The guard lives at the discriminator seam (inside `candidateToExecutionStep`), BEFORE executor invocation. Empty-detection is structural (`Object.keys(patch).length === 0`) — NOT truthiness (`!patch` would let `{}` slip through). The guard test must cover both `undefined` and `{}` cases.
- **Candidate extension (locked):** `CapabilityEvolutionCandidate` gains exactly one new optional readonly field: `proposedPatch?: CapabilityDefinitionPatch` at `src/adaptation/capability-evolution-types.ts:172-181`. Import `CapabilityDefinitionPatch` from `../capability/mutation-contract.js`. No other type changes; no `executionHints` abstraction; no discriminated-union refactor.
- **A7 derivation (locked):** `signalToCandidate`'s `case "underperformer":` constructs the provenance-only patch. Copy `evidenceIds` to avoid aliasing (`[...signal.evidenceIds]`).
- **`sourceId` semantics:** For `underperformer`, `sourceId` arrives as the existing capability's id (matches `candidate.target.id`, which is `signal.capabilityId`). Caller at `capability-service.ts:409` is unchanged. The signature `candidateToExecutionStep(candidate, sourceId, currentVersion)` is preserved.
- **Forecast pin:** `parameters.sourceVersion` = `currentVersion` (forward-pinned catalog version at apply time, CAP-9 ruling #17). Empty guard failure happens before the version is used.
- **Test baseline:** 68 capability vitest files, 559 tests passing (post-CAP-N, commit `f5b2f663`). After CAP-O: 559 + 7 new (3 mapping axes + 3 sentinel axes + 1 e2e step 12c) = **566 tests passing**. Zero regressions.
- **Branch + worktree:** All work on a fresh worktree named `cap-o-underperformer-update-path` off main. Push branch + PR; squash-merge to main.
- **No tag ceremony** for CAP-O. The `alix-capability-greenfield-complete` tag stays.
- **Spec deviations:** If a task requires deviation from the spec, STOP and surface to the human — do not silently adjust. Document deviations in commit messages + task reports; do NOT amend the spec doc.
- **Out of scope for CAP-O (do not implement):** CAP-P (`consolidation_opportunity` → `capability.consolidate`); A8/A9; TUI/Web surfaces; A5 measurement-side changes; executor changes; mutation-contract changes; speculative semantic-update policy; generalized candidate refactor.

---

### Task 1: Unit test for candidateToExecutionStep underperformer mapping

**Files:**
- Create: `tests/capability/cap-o-candidate-mapping.vitest.ts`

**Interfaces:**
- Consumes: `candidateToExecutionStep(candidate, sourceId, currentVersion)` via `service.apply({ proposalId })` (end-to-end) — testing the function directly is impossible because it's module-private; use the e2e path through `service.propose` → `service.apply` to observe the emitted `ExecutionStep.operation` and `ExecutionStep.parameters`.
- Produces: 3 test cases that each propose + apply an `underperformer` candidate and assert the executor saw the correct `operation` + `parameters`, plus the invariant guard.

**Test harness pattern (read `tests/capability/cap-n-candidate-mapping.vitest.ts` for the canonical pattern — `FakeSignalSource` + `makeExecutorSpy` + `buildSpiedSiblingService`):**

```typescript
// 3 axes:
//   axis 1 — underperformer + non-empty proposedPatch → capability.update
//   axis 2 — underperformer + missing proposedPatch → throws (guard)
//   axis 3 — underperformer + empty proposedPatch ({}) → throws (guard)

it("axis 1: underperformer with proposedPatch routes to capability.update", async () => {
  const seedId = "core.session.show";
  const signal: CapabilityEvolutionSignal = {
    kind: "underperformer",
    capabilityId: seedId,
    score: 0.7,
    evidenceIds: ["cap-o-t1-axis-1"],
  };
  const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
  const proposal = await service.propose();
  const applyResult = await service.apply({ proposalId: proposal.proposalId });
  expect(applyResult.status).toBe("executed");
  expect(calls.length).toBe(1);
  const params = calls[0]!.step.parameters as Record<string, unknown>;
  expect(calls[0]!.step.operation).toBe("capability.update");
  expect(params["operation"]).toBe("capability.update");
  expect(params["capabilityId"]).toBe(seedId);
  expect(typeof params["sourceVersion"]).toBe("string");
  expect(params["patch"]).toEqual({
    extensions: {
      provenance: {
        kind: "a7-underperformer",
        candidateId: proposal.candidate.candidateId,
        score: 0.7,
        evidenceIds: ["cap-o-t1-axis-1"],
      },
    },
  });
});

it("axis 2: underperformer with missing proposedPatch throws (guard)", async () => {
  // To exercise the guard, fabricate a candidate with no proposedPatch.
  // The cleanest path is to construct a candidate directly + propose it,
  // bypassing A7's automatic derivation (which always adds the patch).
  // Construct a sibling service that accepts a hand-rolled candidate.
  const seedId = "core.session.show";
  // proposeDirect accepts a hand-rolled candidate (test-only seam).
  const candidate = makeUnderperformerCandidateWithoutPatch(seedId);
  const proposal = await service.proposeDirect(candidate);
  await expect(service.apply({ proposalId: proposal.proposalId })).rejects.toThrow(
    /underperformer.*non-empty.*proposedPatch/,
  );
});

it("axis 3: underperformer with empty proposedPatch {} throws (guard)", async () => {
  const seedId = "core.session.show";
  const candidate = makeUnderperformerCandidate(seedId, { proposedPatch: {} });
  const proposal = await service.proposeDirect(candidate);
  await expect(service.apply({ proposalId: proposal.proposalId })).rejects.toThrow(
    /underperformer.*non-empty.*proposedPatch/,
  );
});
```

**Steps:**

- [ ] **Step 1: Read existing test patterns**

  Read `tests/capability/cap-n-candidate-mapping.vitest.ts` — full file, especially the `FakeSignalSource` (line 60), `makeExecutorSpy` (line 78), and `buildSpiedSiblingService` (line 115) helpers. Read `tests/capability/cap-12-e2e.vitest.ts` `buildSiblingService` for the canonical propose+apply pattern.

- [ ] **Step 2: Write the 3-axis test file**

  Create `tests/capability/cap-o-candidate-mapping.vitest.ts`. Mirror CAP-N's file structure: imports → helpers → describe block → 3 `it` axes.

  For axis 1, use the standard `FakeSignalSource` + `buildSpiedSiblingService` pattern (no need for `proposeDirect`).

  For axes 2 and 3, you have two options:
    - (a) Add a test-only `proposeDirect(candidate)` seam to `CapabilityService` that bypasses A7 and persists a hand-rolled candidate. This is the cleanest approach but adds a test seam.
    - (b) Construct a `FakeSignalSource` that returns a signal whose A7 derivation would produce an underperformer candidate WITHOUT `proposedPatch`. But A7 always derives the patch in CAP-O's design, so this requires a pre-CAP-O shim — fragile.

  **Recommended: option (a).** Add a test-only `proposeDirect(candidate)` method to `CapabilityService` (gated behind an environment variable or test-only export) that bypasses A7. Document the seam clearly in the test file's header comment.

  Helper signatures needed:
  ```typescript
  function makeUnderperformerCandidateWithoutPatch(seedId: string): CapabilityEvolutionCandidate;
  function makeUnderperformerCandidate(
    seedId: string,
    overrides: { proposedPatch?: CapabilityDefinitionPatch | undefined },
  ): CapabilityEvolutionCandidate;
  ```

- [ ] **Step 3: Run the test to verify it FAILS**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  pnpm vitest run tests/capability/cap-o-candidate-mapping.vitest.ts 2>&1 | tail -30
  ```

  Expected: FAIL on all 3 axes. The current `candidateToExecutionStep` falls through `case "underperformer":` to `capability.transition`, so:
    - axis 1: receives `"capability.transition"`, expected `"capability.update"`
    - axis 2: the candidate's missing `proposedPatch` doesn't matter yet because the function ignores it
    - axis 3: same as axis 2

  If `proposeDirect` doesn't exist yet (it doesn't — you're adding it in T2), the test file will fail to import. That's expected and part of the red.

- [ ] **Step 4: Commit the failing test**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  git add tests/capability/cap-o-candidate-mapping.vitest.ts
  git commit -m "test(capability): CAP-O T1 failing 3-axis mapping test (underperformer → update)"
  ```

---

### Task 2: Rewrite `candidateToExecutionStep` per §4.1 mapping + add `proposedPatch` to candidate + A7 derivation

**Files:**
- Modify: `src/capability/capability-service.ts:695-771` — rewrite `case "underperformer":` arm + add `isNonEmptyPatch` helper (next to `candidateToExecutionStep` in the same file)
- Modify: `src/adaptation/capability-evolution-types.ts:172-181` — add `readonly proposedPatch?: CapabilityDefinitionPatch` field; add `import type { CapabilityDefinitionPatch } from "../capability/mutation-contract.js"`
- Modify: `src/capability/evolution/a7-proposals.ts:206-216` — `case "underperformer":` constructs `proposedPatch`

**Interfaces:**
- Consumes: existing `CapabilityEvolutionCandidate` (now with optional `proposedPatch` field); existing `signalToCandidate(signal)` returns `CapabilityEvolutionCandidate`.
- Produces: discriminator emits `capability.update` for `underperformer`; `proposedPatch` is forwarded into `parameters.patch`; missing/empty `proposedPatch` causes a deterministic throw.

**Code blocks (verbatim):**

`src/capability/capability-service.ts` — replace the `case "underperformer":` arm and add a small helper just before `candidateToExecutionStep`:

```typescript
/**
 * CAP-O: structural emptiness check for `CapabilityDefinitionPatch`.
 * Returns true if `patch` is undefined, null, or has no own enumerable keys.
 * Used by `candidateToExecutionStep` to enforce the underperformer
 * invariant: every underperformer candidate MUST carry a non-empty patch.
 */
function isNonEmptyPatch(patch: unknown): boolean {
  if (patch === undefined || patch === null) return false;
  if (typeof patch !== "object") return false;
  return Object.keys(patch as Record<string, unknown>).length > 0;
}
```

And inside `candidateToExecutionStep`, replace `case "underperformer":` with:

```typescript
case "underperformer": {
  // CAP-O: underperformer signals → capability.update.
  // The candidate carries a non-empty patch that the executor applies
  // unchanged. Per CAP-O ruling: patch is provenance-only; no speculative
  // semantic change to the capability definition. The lifecycle consequence
  // remains governed by the existing lifecycle machinery.
  if (!isNonEmptyPatch(candidate.proposedPatch)) {
    throw new Error(
      `capability.update: underperformer candidate '${candidate.candidateId}' must carry a non-empty proposedPatch; observed keys=${Object.keys((candidate.proposedPatch ?? {}) as Record<string, unknown>).join(",") || "<none>"}`,
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

`src/adaptation/capability-evolution-types.ts` — add one import line and one field to the interface:

```typescript
// Add at the top, alongside existing imports:
import type { CapabilityDefinitionPatch } from "../capability/mutation-contract.js";

// In the CapabilityEvolutionCandidate interface (after `evidenceIds`):
  /**
   * CAP-O: candidate-carried update patch for `underperformer` sourcePatternId.
   * Present and structurally non-empty for `underperformer`; absent for other
   * sourcePatternIds. Provenance-only — no speculative semantic change to the
   * capability definition.
   */
  readonly proposedPatch?: CapabilityDefinitionPatch;
```

`src/capability/evolution/a7-proposals.ts` — replace the `case "underperformer":` arm:

```typescript
case "underperformer": {
  // CAP-O: candidate carries a provenance-only update patch so that
  // apply() can route to capability.update. The patch records the
  // approved evolutionary decision durably; the capability definition
  // itself is not semantically modified.
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

**Steps:**

- [ ] **Step 1: Add `proposedPatch` to `CapabilityEvolutionCandidate`**

  In `src/adaptation/capability-evolution-types.ts:172-181`, add the `import type` line and the new readonly field per the code block above.

- [ ] **Step 2: Update `signalToCandidate` `case "underperformer":`**

  In `src/capability/evolution/a7-proposals.ts:206-216`, replace the `case "underperformer":` arm per the code block above. The change adds `proposedPatch` to the returned candidate.

- [ ] **Step 3: Run capability suite to verify T2 changes haven't broken anything yet**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  pnpm vitest run tests/capability/ 2>&1 | tail -10
  ```

  Expected: PASS, 559/559 (or possibly 559 + 3 new failures from T1's failing test — but other tests stay green). The discriminator function hasn't been rewritten yet, so existing tests still pass. T1's failing test still fails (will flip green after Step 4).

  If anything other than T1 fails, STOP and investigate before continuing.

- [ ] **Step 4: Rewrite `case "underperformer":` arm in `candidateToExecutionStep`**

  In `src/capability/capability-service.ts`, add the `isNonEmptyPatch` helper just before `candidateToExecutionStep`, then replace the `case "underperformer":` arm per the code block above.

- [ ] **Step 5: Run T1's test to verify it flips GREEN**

  ```bash
  pnpm vitest run tests/capability/cap-o-candidate-mapping.vitest.ts 2>&1 | tail -20
  ```

  Expected: PASS, 3/3 axes green.
    - axis 1: `underperformer` + non-empty patch → `capability.update`, parameters include `capabilityId`, `sourceVersion`, and the provenance patch.
    - axis 2: `underperformer` + missing patch → throws with the expected error message.
    - axis 3: `underperformer` + `{}` → throws (not silently accepted).

  **Note on `proposeDirect`:** if axes 2 and 3 need a test-only seam in `CapabilityService`, add it in this step. Place it under a comment `// CAP-O test seam — not for production use` and gate it with `process.env.NODE_ENV === "test"` OR a build-time flag if your test runner respects one. The simplest approach: a public method `proposeDirect(candidate: CapabilityEvolutionCandidate): Promise<{ proposalId: string; candidateId: string }>` that calls `proposalStore.record` directly with a pre-built proposal.

- [ ] **Step 6: Run the full capability suite**

  ```bash
  pnpm vitest run tests/capability/ 2>&1 | tail -10
  ```

  Expected: PASS, 559 + 3 (T1 mapping) = 562 tests passing. Zero regressions.

- [ ] **Step 7: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  git add src/capability/capability-service.ts src/adaptation/capability-evolution-types.ts src/capability/evolution/a7-proposals.ts tests/capability/cap-o-candidate-mapping.vitest.ts
  git commit -m "feat(capability): CAP-O T2 underperformer → capability.update + invariant guard"
  ```

  If `proposeDirect` was added in Step 5, it goes in this commit too.

---

### Task 3: Extend CAP-12 e2e step 12 with step 12c — real-executor catalog-preservation + provenance update

**Files:**
- Modify: `tests/capability/cap-12-e2e.vitest.ts` — add step 12c after step 12b

**Interfaces:**
- Consumes: existing `buildSiblingService` (line 163) + real `CapabilityMutationExecutorImpl` (constructed fresh per CAP-N step 12b's pattern).
- Produces: step 12c that asserts catalog preservation AND provenance update through the real executor.

**Code block (verbatim — add after the existing step 12b):**

```typescript
// ─── Step 12c: apply(underperformer-candidate) durably attributes the
//              existing capability to the evolutionary signal ───────────
// CAP-O e2e. The candidate carries a provenance-only patch; apply()
// routes through capability.update; the existing capability's
// extensions.provenance.kind === "a7-underperformer" with the
// candidateId + evidenceIds from the candidate.
it("step 12c: apply(underperformer) durably attributes the existing capability", async () => {
  const seedId = "core.session.show";
  const candidateId = "cap-o-e2e-step-12c-underperformer";
  const signal: CapabilityEvolutionSignal = {
    kind: "underperformer",
    capabilityId: seedId,
    score: 0.72,
    evidenceIds: ["cap-o-e2e-12c-evidence-1", "cap-o-e2e-12c-evidence-2"],
  };
  const sibling = buildSiblingService(platform, eventLog, signal);
  const catalogBefore = sibling.service.list();
  const beforeCount = catalogBefore.items.length;
  const beforeTarget = catalogBefore.items.find((it) => it.id === seedId);
  expect(beforeTarget).toBeDefined();

  const proposal = await sibling.service.propose();
  expect(proposal.candidateId).toBeDefined();
  const applyResult = await sibling.service.apply({ proposalId: proposal.proposalId });

  // (1) same capability identity, (2) no catalog growth
  const catalogAfter = sibling.service.list();
  expect(catalogAfter.items.length).toBe(beforeCount);
  const afterTarget = catalogAfter.items.find((it) => it.id === seedId);
  expect(afterTarget).toBeDefined();

  // (3) real-executor succeeded
  expect(applyResult.status).toBe("executed");

  // (4) provenance lands at extensions
  // The real catalog lookup (not the list projection) carries the full
  // definition including extensions.
  const fullDef = sibling.platformCatalog.get(seedId);
  expect(fullDef.extensions).toBeDefined();
  const provenance = (fullDef.extensions as Record<string, unknown>)["provenance"] as Record<string, unknown>;
  expect(provenance).toBeDefined();
  expect(provenance["kind"]).toBe("a7-underperformer");

  // (5) provenance retains candidate attribution + evidence
  // Note: candidateId is auto-generated by A7 from the signal; we don't
  // pin the exact value but we assert the field is present and the
  // evidenceIds match the candidate's evidenceIds exactly.
  expect(typeof provenance["candidateId"]).toBe("string");
  expect(JSON.stringify(provenance["evidenceIds"])).toBe(
    JSON.stringify(signal.evidenceIds),
  );
});
```

**Steps:**

- [ ] **Step 1: Read CAP-N step 12b**

  Read `tests/capability/cap-12-e2e.vitest.ts` around line 788 (CAP-N step 12b, the create-path scenario). Mirror the construction pattern: how `buildSiblingService` is called, how the `CapabilityMutationExecutorImpl` is wired, and what assertions are made on `platformCatalog`.

- [ ] **Step 2: Insert step 12c**

  Add the code block above to `tests/capability/cap-12-e2e.vitest.ts` immediately after the existing step 12b. Use `pnpm vitest run tests/capability/cap-12-e2e.vitest.ts -t "step 12c"` to run just this new step.

  **Discovery task:** Before writing the test, verify that `sibling.platformCatalog.get(seedId)` returns the full `CapabilityDefinition` (with `extensions`). If it doesn't, you may need to use the catalog's list path or a different accessor. If unsure, read `src/capability/canonical/catalog.ts` and identify the correct accessor.

- [ ] **Step 3: Run step 12c to verify it PASSES**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  pnpm vitest run tests/capability/cap-12-e2e.vitest.ts -t "step 12c" 2>&1 | tail -20
  ```

  Expected: PASS. All 5 assertions hold.

  If FAIL: STOP. The discriminator works (T2's T1 test passed) but the e2e path through the real executor has a wiring issue. Common causes:
    - `platformCatalog` not exposed on the sibling — use the right accessor
    - `extensions` not preserved through `nextDefinitionForUpdate` — verify the patch's `extensions` field survives `applyCapabilityDefinitionPatch`
    - The real executor's update path bumps the SemVer but the catalog lookup returns the OLD definition — use `getLatest()` or similar

- [ ] **Step 4: Run full capability suite**

  ```bash
  pnpm vitest run tests/capability/ 2>&1 | tail -10
  ```

  Expected: PASS, 562 (post-T2) + 1 (step 12c) = 563 tests passing. Zero regressions.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  git add tests/capability/cap-12-e2e.vitest.ts
  git commit -m "test(capability): CAP-O T3 e2e step 12c — underperformer real-executor provenance update"
  ```

---

### Task 4: Behavioral sentinel — underperformer produces capability.update, never capability.transition

**Files:**
- Create: `tests/capability/cap-o-sentinel.vitest.ts`

**Interfaces:**
- Consumes: `candidateToExecutionStep` indirectly via the test-only `proposeDirect` seam added in T2 (or by constructing the e2e path with a hand-rolled candidate).
- Produces: 3 sentinel axes asserting (a) underperformer → `capability.update` always, (b) underperformer never produces `capability.transition`, (c) `case "underperformer":` arm exists in `candidateToExecutionStep` and `case "consolidation_opportunity":` continues to fall through.

**Test philosophy:** behavioral, not source-text dependent. The test should construct candidates and observe `step.operation`, not grep the function body. This avoids brittleness from CAP-N-style textual layout checks.

**Code block (verbatim):**

```typescript
// CAP-O structural sentinel — behavioral, not textual.
// Asserts the underperformer arm routes to capability.update and the
// invariant guard fires on missing/empty proposedPatch. Mirror CAP-N
// sentinel file structure.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CapabilityPlatform } from "../../src/capability/platform.js";
import { registerInitialCapabilities } from "../../src/capability/initial-capabilities.js";
import { registerSessionCapabilities } from "../../src/integrations/session-capabilities.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import type { CapabilityEvolutionCandidate } from "../../src/adaptation/capability-evolution-types.js";

// ... setup/teardown mirrors cap-n-candidate-mapping.vitest.ts ...

describe("CAP-O behavioral sentinel", () => {
  it("axis 1: underperformer always emits capability.update (not transition)", async () => {
    // Construct 3 different underperformer candidates with non-empty
    // proposedPatch values (each represents a slightly different scenario).
    // All 3 must emit capability.update.
    for (const overrides of [
      { score: 0.5 },
      { score: 0.9 },
      { score: 0.71, evidenceIds: ["a", "b", "c"] },
    ]) {
      const candidate = makeUnderperformerCandidate(seedId, {
        score: overrides.score,
        evidenceIds: overrides.evidenceIds ?? ["x"],
        proposedPatch: { extensions: { provenance: { kind: "a7-underperformer", candidateId: "x", score: overrides.score, evidenceIds: overrides.evidenceIds ?? ["x"] } } },
      });
      const proposal = await service.proposeDirect(candidate);
      await expect(service.apply({ proposalId: proposal.proposalId })).resolves.toMatchObject({ status: "executed" });
      const op = lastSeenOperation();
      expect(op).toBe("capability.update");
      expect(op).not.toBe("capability.transition");
    }
  });

  it("axis 2: underperformer with missing proposedPatch throws", async () => {
    const candidate = makeUnderperformerCandidate(seedId, { proposedPatch: undefined });
    const proposal = await service.proposeDirect(candidate);
    await expect(service.apply({ proposalId: proposal.proposalId })).rejects.toThrow(
      /underperformer.*non-empty.*proposedPatch/,
    );
  });

  it("axis 3: underperformer with empty proposedPatch {} throws (not truthy-bypass)", async () => {
    const candidate = makeUnderperformerCandidate(seedId, { proposedPatch: {} });
    const proposal = await service.proposeDirect(candidate);
    await expect(service.apply({ proposalId: proposal.proposalId })).rejects.toThrow(
      /underperformer.*non-empty.*proposedPatch/,
    );
  });
});
```

**Steps:**

- [ ] **Step 1: Read CAP-N sentinel**

  Read `tests/capability/cap-n-sentinel.vitest.ts` (full file) to mirror its setup/teardown pattern and the `readFunctionBody` helper convention. CAP-O's sentinel is **behavioral** (no body-grep); use the e2e path via `proposeDirect`.

- [ ] **Step 2: Write the 3-axis sentinel file**

  Create `tests/capability/cap-o-sentinel.vitest.ts` per the code block above. The 3 axes:
    - axis 1: underperformer always → `capability.update`, never `capability.transition` (3 sub-iterations)
    - axis 2: missing `proposedPatch` → throws
    - axis 3: `proposedPatch: {}` → throws

  Use the same `buildSpiedSiblingService` pattern from T1 (or a fresh sibling service if `proposeDirect` was added in T2).

- [ ] **Step 3: Run the sentinel**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  pnpm vitest run tests/capability/cap-o-sentinel.vitest.ts 2>&1 | tail -15
  ```

  Expected: PASS, 3/3 axes green (3 iterations of axis 1 + axis 2 + axis 3 = 5 logical assertions inside 3 `it` blocks).

- [ ] **Step 4: Run full capability suite**

  ```bash
  pnpm vitest run tests/capability/ 2>&1 | tail -10
  ```

  Expected: PASS, 563 (post-T3) + 3 sentinel axes = 566 tests passing. Zero regressions.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  git add tests/capability/cap-o-sentinel.vitest.ts
  git commit -m "test(capability): CAP-O T4 behavioral sentinel (3 axes)"
  ```

---

### Task 5: Doc migration — record CAP-O close-out in the post-CAP-N frontier map body + memory entry

**Files:**
- Modify: none on this branch — the post-CAP-N wayfinder map (#511) is already closed. CAP-O's close-out records land in the memory entry (T6).

**Why this task is documentation-only:** CAP-O does NOT close a greenfield §20 carve-out like CAP-N did. The CAP-12 carve-out is already closed by CAP-N. CAP-O fills the `underperformer` row of the discriminator table — a frontier tightening authorized by the post-CAP-N wayfinder map #511 close-out (2026-08-14). No checkpoint doc annotation is needed. The discriminator-table inventory in the post-CAP-N memory entry already lists CAP-O as the next frontier; this task records that CAP-O is now implemented.

**Steps:**

- [ ] **Step 1: Verify no checkpoint doc change is needed**

  Confirm that `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md` does NOT need an annotation — the §20 #12 carve-out was closed by CAP-N, and CAP-O does not touch §20. No changes to the checkpoint doc.

- [ ] **Step 2: Document in the implementation report only**

  Capture CAP-O's close-out details (commits, test totals, deviations if any) in `.superpowers/sdd/2026-08-14-cap-o-underperformer-update-path/task-5-report.md` for the SDD ledger. The user-facing close-out is the memory entry (T6 Step 4).

- [ ] **Step 3: Commit any ledger file**

  If `.superpowers/sdd/2026-08-14-cap-o-underperformer-update-path/task-5-report.md` is git-tracked in this worktree (SDD ledger convention), commit it. If gitignored, no commit needed.

---

### Task 6: PR + squash-merge + memory entry

**Steps:**

- [ ] **Step 1: Push branch**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-o-underperformer-update-path
  git push -u origin cap-o-underperformer-update-path
  ```

  **STOP and ask the human for approval before the push.** Standing constraint: never push without human approval.

- [ ] **Step 2: Open PR via gh**

  ```bash
  gh pr create --base main --head cap-o-underperformer-update-path \
    --title "CAP-O Underperformer Update-Path Closure" \
    --body "Closes the post-CAP-N frontier map #511 next-frontier authorization. Fills the underperformer row of the discriminator table post-CAP-N; CAP-P remains the next locked frontier.

  **CAP-O routes \`underperformer\` candidates to \`capability.update\`** at \`src/capability/capability-service.ts:695-771\` (the CAP-N carve-out site). After this PR:
  - \`apply()\` discriminates per candidate \`sourcePatternId\`:
    - \`gap\` → \`capability.create\` (CAP-N, preserved)
    - \`deprecation_signal\` → \`capability.remove\` (CAP-N, preserved)
    - \`underperformer\` → \`capability.update\` (**CAP-O new**)
    - \`consolidation_opportunity\` → \`capability.transition\` (CAP-P territory, preserved)
    - default → \`capability.transition\` (defensive default, preserved)
  - \`CapabilityEvolutionCandidate\` gains optional \`proposedPatch?: CapabilityDefinitionPatch\` (provenance-only — no speculative semantic change)
  - A7 \`signalToCandidate\` derives the provenance-only patch for \`underperformer\` signals
  - Invariant guard at the discriminator seam rejects empty/missing \`proposedPatch\` deterministically
  - E2E step 12c (\`tests/capability/cap-12-e2e.vitest.ts\)) asserts catalog preservation + provenance update through the real executor
  - Behavioral sentinel (\`tests/capability/cap-o-sentinel.vitest.ts\)) pins the discriminator routing + invariant guard

  ## Patch policy (governance-critical)
  Per CAP-O ruling: underperformer observations legitimately derive ONLY an audit/provenance patch, never a semantic modification. The observation establishes evidence of underperformance; it does NOT establish the correct replacement definition. Lifecycle consequences remain separately governed by existing lifecycle machinery.

  ## Test totals
  \`\`\`
  pnpm vitest run tests/capability/
  Test Files  ~68 passed (68)
  Tests       566 passed (566)  # +7 over the 559 CAP-N baseline
  \`\`\`

  ## Commits
  - T1: failing 3-axis mapping test
  - T2: rewrite \`case \"underperformer\":\` + invariant guard + candidate extension + A7 derivation
  - T3: e2e step 12c — catalog preservation + provenance update via real executor
  - T4: behavioral sentinel (3 axes)
  - T5: doc migration (none required; checkpoint doc not touched)

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

  Write `/home/babasola/.claude/projects/-home-babasola-Projects-Monolith/memory/cap-o-underperformer-update-path-complete.md` with:
  - `type: project`
  - body: CAP-O closed the post-CAP-N `underperformer` discriminator gap. `underperformer` candidates now route to `capability.update` (previously fell through to `capability.transition`). Patch is **provenance-only** — no speculative semantic change to the capability definition. Architecture progression: CAP-N (create material) → CAP-O (update provenance) → CAP-P (consolidation material). Next frontier: CAP-P.

- [ ] **Step 5: Update MEMORY.md**

  Add a one-line pointer to the new memory file in the index. Insert it after the existing CAP-N pointer.

- [ ] **Step 6: Clean up worktree + local branch**

  Per the standing `branch-workflow-policy.md`:

  ```bash
  cd /home/babasola/Projects/Monolith
  git worktree remove --force .claude/worktrees/cap-o-underperformer-update-path
  git branch -d cap-o-underperformer-update-path
  ```

---

## Self-Review

**1. Spec coverage:**
- §2 goal (underperformer → capability.update, table row green) → Task 2 ✓
- §4.1 discriminator rewrite + invariant guard → Task 2 ✓
- §4.2 candidate extension (`proposedPatch?`) → Task 2 ✓
- §4.3 A7 derivation (provenance-only) → Task 2 ✓
- §4.4 patch policy (provenance only) → enforced by Task 2's T1/T4 guard tests + Task 3 e2e assertion ✓
- §4.5 `sourceId` semantics (preserved) → Task 2 ✓ (no caller change)
- §5 data flow → covered by Task 3 e2e ✓
- §7 migration (e2e step 12c) → Task 3 ✓
- §8 error handling (deterministic throw + apply() catch) → Task 2 + Task 4 axis 2/3 ✓
- §9.1 unit tests → Task 1 (3 axes) ✓
- §9.2 e2e test → Task 3 (step 12c) ✓
- §9.3 sentinel → Task 4 (3 axes, behavioral) ✓
- §9.4 regression (zero regressions) → Task 2 Step 6 + Task 3 Step 4 + Task 4 Step 4 ✓

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later", "fill in details" ✓
- Test code is concrete (not "similar to Task N") ✓
- All step types are explicit ✓
- The "STOP and ask" notes in T6 Steps 1 and 3 are intentional user-approval gates, not placeholders ✓

**3. Type consistency:**
- `CapabilityEvolutionCandidate.proposedPatch?: CapabilityDefinitionPatch` consistent across T2's code block and T1's test helper ✓
- `case "underperformer":` arm signature consistent across T2 and T4 ✓
- Error message regex `/underperformer.*non-empty.*proposedPatch/` consistent across T1 (axes 2/3) and T4 (axes 2/3) ✓
- `a7-underperformer` provenance `kind` consistent across T2 (A7 derivation) and T3 (e2e assertion) and T1 (axis 1) ✓

**4. Open question surfaced for human review:**
- T1 proposes adding a test-only `proposeDirect(candidate)` seam to `CapabilityService` for axes 2/3 (the invariant-guard tests). Alternative: pre-CAP-O A7 stub. The seam is cleaner but adds test-only public surface. **Decision should be made during T2 implementation; the plan flags it as "Recommended: option (a)" with explicit documentation.**

---

## Execution Handoff

This plan is ready for subagent-driven execution. The 6 tasks follow the standard SDD pattern:
- T1 (failing test) → T2 (implementation) → T3 (e2e update) → T4 (sentinel) → T5 (doc — minimal) → T6 (PR + merge + memory)

Per-task reviewer gates:
- T1 uses haiku (mechanical failing-test scaffolding)
- T2 uses sonnet (spec-faithful implementation + type extensions)
- T3 uses sonnet (e2e real-executor integration)
- T4 uses haiku (behavioral sentinel, low complexity)
- T5 uses haiku (doc-only, near-zero complexity)
- T6 is the PR + merge workflow (no review)

Whole-branch final review: sonnet, after T6 squash-merge on a temporary integration branch.

**Note on user approval gates:** T6 Steps 1 (push) and Step 3 (squash-merge) both require explicit human approval. Subagents must STOP and surface the request, not proceed automatically.