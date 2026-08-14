# CAP-N Implementation Plan — End-to-End Create-Path Closure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the CAP-12 §20 #12 carve-out by making `apply()` discriminate between candidate `sourcePatternId`s so `gap` candidates emit `capability.create`, `deprecation_signal` emits `capability.remove`, and other patterns continue to emit `capability.transition`. After CAP-N: §20 #12 reads plain "PASS" with no caveat.

**Architecture:** Single-function rewrite of `candidateToExecutionStep` at `src/capability/capability-service.ts:695-715`. Discriminator is the existing `CapabilityEvolutionCandidate.sourcePatternId` (no type changes). For gap candidates, an auto-derived `proposedDefinition` is emitted (sourced from candidate fields). Composition root, executor, catalog, governance, and proposal store are unchanged.

**Tech Stack:** TypeScript, vitest, pnpm. Existing capability platform architecture.

## Global Constraints

These are binding on every task — copy verbatim:

- **Carve-out site:** `src/capability/capability-service.ts:695-715` (`candidateToExecutionStep` function). This is the **only** file on the CAP-12 forbidden list that CAP-N modifies. All other CAP-12 forbidden files (`src/capability/platform.ts`, `legacy-adapter.ts`, `registry.ts`, `provider-resolver.ts`, all CAP-1…CAP-11 sentinels) remain FORBIDDEN.
- **Operation mapping contract (locked):** `sourcePatternId === "gap"` → `capability.create`; `sourcePatternId === "deprecation_signal"` → `capability.remove`; all other source patterns → `capability.transition`. Defensive default is `capability.transition`.
- **Auto-derived proposedDefinition (locked):** Per spec §4.2 — `id: target.id, version: "0.1.0", kind: "operation", lifecycle: "emerging", bindings: [], argsSchema/resultSchema: empty objects, title/description: candidate.description, tags: [], examples: [], allowFallbacks: false, requiredPermissions: [], category: "uncategorized", risk: candidate.riskClass, extensions: { provenance: { kind: "a7-gap", candidateId: candidate.candidateId } }`.
- **`sourceId` semantics:** For create intents, the caller continues to pass `""` (already implemented at `capability-service.ts:409`); the function detects create via `sourcePatternId === "gap"`, not via the empty string.
- **Forecast pin:** `parameters.sourceVersion` preserved for transition + remove cases; defaults to `"0.0.0"` placeholder for create (already documented at `capability-service.ts:402`).
- **Test baseline:** 67 capability vitest files, 552 tests passing. After CAP-N: 552 + 4 unit axes + 2 sentinel axes = 558 tests passing. Zero regressions.
- **Branch + worktree:** All work on a fresh worktree named `cap-n-end-to-end-create-path` off main. Push branch + PR; squash-merge to main.
- **No tag ceremony** for CAP-N (the greenfield-complete tag stays). A future CAP could mint `alix-capability-platform-v1` if desired; out of scope for CAP-N.
- **Spec deviations:** If a task requires deviation from the spec, STOP and surface to the human — do not silently adjust.

---

### Task 1: Unit test for candidateToExecutionStep mapping

**Files:**
- Create: `tests/capability/cap-n-candidate-mapping.vitest.ts`

**Interfaces:**
- Consumes: `candidateToExecutionStep(candidate, sourceId, currentVersion)` via `service.apply({ proposalId })` (end-to-end) — testing the function directly is impossible because it's module-private; use the e2e path through `service.propose` → `service.apply` to observe the emitted `ExecutionStep.operation`.
- Produces: 4 test cases that each propose + apply a different `sourcePatternId` candidate and assert the executor saw the correct `operation` field.

**Test harness pattern (read `tests/capability/cap-12-e2e.vitest.ts` for the `buildSiblingService` + `executorSpy` pattern):**

```typescript
// 4 axes: gap → create, deprecation_signal → remove, underperformer → transition,
//         consolidation_opportunity → transition

it("sourcePatternId=gap routes to capability.create", async () => {
  const candidate = makeCandidate({ sourcePatternId: "gap", target: { kind: "capability", id: "new.foo" } });
  const proposal = await service.propose(candidate);
  await service.apply({ proposalId: proposal.id });
  const op = executorSpy.lastCall.operation;
  expect(op).toBe("capability.create");
});

it("sourcePatternId=deprecation_signal routes to capability.remove", async () => {
  // seed an existing capability, then deprecate
  const candidate = makeCandidate({ sourcePatternId: "deprecation_signal", target: { kind: "capability", id: existingId } });
  const proposal = await service.propose(candidate);
  await service.apply({ proposalId: proposal.id });
  expect(executorSpy.lastCall.operation).toBe("capability.remove");
});

it("sourcePatternId=underperformer routes to capability.transition", async () => {
  const candidate = makeCandidate({ sourcePatternId: "underperformer", target: { kind: "capability", id: existingId } });
  await service.propose(candidate);
  await service.apply({ proposalId: proposal.id });
  expect(executorSpy.lastCall.operation).toBe("capability.transition");
});

it("sourcePatternId=consolidation_opportunity routes to capability.transition", async () => {
  const candidate = makeCandidate({ sourcePatternId: "consolidation_opportunity", target: { kind: "capability", id: existingId } });
  await service.propose(candidate);
  await service.apply({ proposalId: proposal.id });
  expect(executorSpy.lastCall.operation).toBe("capability.transition");
});
```

**Steps:**

- [ ] **Step 1: Read existing test patterns**

  Read `tests/capability/cap-12-e2e.vitest.ts` (especially the `buildSiblingService` + step 9-11 propose/apply pattern). Read `tests/capability/capability-service-apply.vitest.ts` for the canonical propose+apply pattern.

- [ ] **Step 2: Write the 4-axis test file**

  Create `tests/capability/cap-n-candidate-mapping.vitest.ts`. Use `buildSiblingService` to construct a service with a spied executor. The 4 axes above.

  The `makeCandidate` helper should construct a minimal valid `CapabilityEvolutionCandidate`. Use `target.id` with `kind: "capability"` per the existing A7 shape (`a7-proposals.ts:200-218`).

  For the `gap` case, `target.id = "new.foo"` (matches A7's `"new.${candidateId}"` pattern).
  For other cases, `target.id = seedIds[0]` (an existing seeded capability from the sibling service).

- [ ] **Step 3: Run the test to verify it FAILS**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  pnpm vitest run tests/capability/cap-n-candidate-mapping.vitest.ts 2>&1 | tail -20
  ```

  Expected: FAIL. The current `candidateToExecutionStep` hardcodes `capability.transition`, so the `gap` and `deprecation_signal` axes fail with `expected 'capability.create' / 'capability.remove', received 'capability.transition'`.

- [ ] **Step 4: Commit the failing test**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  git add tests/capability/cap-n-candidate-mapping.vitest.ts
  git commit -m "test(capability): CAP-N T1 candidate mapping 4-axis test (failing)"
  ```

---

### Task 2: Rewrite `candidateToExecutionStep` per §4.1 mapping

**Files:**
- Modify: `src/capability/capability-service.ts:695-715` (single function rewrite)

**Interfaces:**
- Consumes: `CapabilityEvolutionCandidate` (existing type, no changes), `sourceId: string`, `currentVersion: string`
- Produces: `ExecutionStep` with `operation` discriminated per `sourcePatternId`

**Steps:**

- [ ] **Step 1: Replace the function body**

  Replace lines 695-715 of `src/capability/capability-service.ts` with:

  ```typescript
  /**
   * CAP-N ruling — map a candidate to a CAP-6 `ExecutionStep` per its
   * sourcePatternId. Discriminator table (CAP-N spec §4.1):
   *   - "gap"                   → capability.create
   *   - "deprecation_signal"    → capability.remove
   *   - all other sourcePatterns → capability.transition (current behavior preserved)
   *
   * The `sourceId` + `currentVersion` parameters are forward-pinned to the
   * catalog state at apply time (CAP-9 ruling #17 — stale-detection source).
   * For create intents, `sourceId` is `""` and `currentVersion` is `"0.0.0"`.
   */
  function candidateToExecutionStep(
    candidate: CapabilityEvolutionCandidate,
    sourceId: string,
    currentVersion: string,
  ): ExecutionStep {
    const baseStep = {
      stepId: `proposal-${candidate.candidateId}`,
      idempotent: true,
      preconditions: {},
      postconditions: {},
    };

    switch (candidate.sourcePatternId) {
      case "gap": {
        // Auto-derive a minimal valid CapabilityDefinition from the candidate
        // fields. CAP-N spec §4.2 — caller can refine via capability.update.
        const proposedDefinition = {
          id: candidate.target.id,
          version: "0.1.0",
          kind: "operation" as const,
          lifecycle: "emerging" as const,
          bindings: [],
          argsSchema: { type: "object" as const, properties: {} },
          resultSchema: { type: "object" as const, properties: {} },
          title: candidate.description,
          description: candidate.description,
          tags: [],
          examples: [],
          allowFallbacks: false,
          requiredPermissions: [],
          category: "uncategorized",
          risk: candidate.riskClass,
          extensions: {
            provenance: {
              kind: "a7-gap" as const,
              candidateId: candidate.candidateId,
            },
          },
        };
        return {
          ...baseStep,
          operation: "capability.create",
          parameters: {
            operation: "capability.create",
            proposedDefinition,
          },
        };
      }

      case "deprecation_signal":
        return {
          ...baseStep,
          operation: "capability.remove",
          parameters: {
            operation: "capability.remove",
            capabilityId: sourceId,
            reason: candidate.description,
            sourceVersion: currentVersion,
          },
        };

      case "underperformer":
      case "consolidation_opportunity":
      default:
        return {
          ...baseStep,
          operation: "capability.transition",
          parameters: {
            operation: "capability.transition",
            capabilityId: sourceId,
            from: "emerging",
            to: "active",
            sourceVersion: currentVersion,
          },
        };
    }
  }
  ```

  Note: this preserves the original function's position (lines 695-715 region); adjust line numbers as needed after insertion. The new function is ~50 lines vs the original 21.

- [ ] **Step 2: Run T1's test to verify it PASSES**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  pnpm vitest run tests/capability/cap-n-candidate-mapping.vitest.ts 2>&1 | tail -20
  ```

  Expected: PASS, 4/4 axes green.

- [ ] **Step 3: Run the full capability suite**

  ```bash
  pnpm vitest run tests/capability/ 2>&1 | tail -10
  ```

  Expected: PASS, 552/552 (the existing 552 should be unaffected — only the T1 mapping test is new).

- [ ] **Step 4: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  git add src/capability/capability-service.ts
  git commit -m "feat(capability): CAP-N T2 candidate→mutation routing per sourcePatternId (gap→create, deprecation_signal→remove)"
  ```

---

### Task 3: Update CAP-12 e2e step 12 to assert catalog growth for create-path

**Files:**
- Modify: `tests/capability/cap-12-e2e.vitest.ts` (step 12)

**Interfaces:**
- Consumes: T1's `buildSiblingService` pattern + the new `candidateToExecutionStep` behavior from T2.
- Produces: A modified step 12 that asserts catalog preservation for transition-path (preserved) AND catalog growth for create-path (new).

**Steps:**

- [ ] **Step 1: Read T5's step 12**

  Read `tests/capability/cap-12-e2e.vitest.ts` step 12 (the "apply does not corrupt the existing seed universe" test from T5).

- [ ] **Step 2: Add a new step 12b for create-path**

  Add to the same describe block, after step 12:

  ```typescript
  // ─── Step 12b: create-path — apply a gap candidate, catalog grows by one ──
  it("step 12b: apply(gap-candidate) registers a new capability in the catalog", async () => {
    const beforeCount = service.list().items.length;
    const candidate = {
      candidateId: `cap-n-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      sourcePatternId: "gap",
      confidence: 0.9,
      target: { kind: "capability" as const, id: `new.test.capability.${Date.now()}` },
      description: "Auto-derived test capability from CAP-N",
      expectedEffect: "Verify create-path routing",
      riskClass: "low" as const,
      evidenceIds: ["cap-n-evidence-1"],
    };
    const proposal = await service.propose(candidate);
    await service.apply({ proposalId: proposal.id });
    const afterIds = service.list().items.map((c) => c.id).sort();
    expect(afterIds.length, "create-path must grow the catalog by one").toBe(beforeCount + 1);
    expect(afterIds, "new capability id must appear").toContain(candidate.target.id);
  });
  ```

  This new step 12b demonstrates the carve-out is closed: a gap proposal actually creates a capability.

- [ ] **Step 3: Run the e2e test**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  pnpm vitest run tests/capability/cap-12-e2e.vitest.ts 2>&1 | tail -15
  ```

  Expected: PASS, all 14 original steps + new step 12b = 15/15 green.

- [ ] **Step 4: Run full capability suite**

  ```bash
  pnpm vitest run tests/capability/ 2>&1 | tail -10
  ```

  Expected: PASS, 552 + 4 (T1) + 1 (T3 step 12b) = 557 tests passing.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  git add tests/capability/cap-12-e2e.vitest.ts
  git commit -m "test(capability): CAP-N T3 e2e step 12b asserts catalog grew for create-path"
  ```

---

### Task 4: Structural sentinel — carve-out site no longer hardcodes

**Files:**
- Create: `tests/capability/cap-n-sentinel.vitest.ts`

**Interfaces:**
- Consumes: The file `src/capability/capability-service.ts` (read-only).
- Produces: A 2-axis structural test that pins the carve-out site is rewritten.

**Steps:**

- [ ] **Step 1: Write the sentinel test**

  ```typescript
  // Axis 1: capability-service.ts:702,704 no longer hardcodes a single
  //         `capability.transition` literal — the function now emits
  //         multiple operation strings (create, remove, transition).
  // Axis 2: the function body contains a switch over sourcePatternId
  //         with three branches (case "gap", case "deprecation_signal", default).

  import { readFileSync } from "node:fs";
  import { resolve } from "node:path";

  const CAPABILITY_SERVICE_PATH = resolve(
    import.meta.dirname,
    "../../src/capability/capability-service.ts",
  );

  function readFunctionBody(name: string): string {
    const source = readFileSync(CAPABILITY_SERVICE_PATH, "utf8");
    // Simple, robust: extract the function body by brace counting from
    // `function name(` to its closing brace.
    const start = source.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`function ${name} not found`);
    let depth = 0;
    let i = source.indexOf("{", start);
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return source.slice(start, i + 1);
  }

  describe("CAP-N structural sentinel", () => {
    const body = readFunctionBody("candidateToExecutionStep");

    it("axis 1: function body contains all three operation literals (create, remove, transition)", () => {
      expect(body).toContain('"capability.create"');
      expect(body).toContain('"capability.remove"');
      expect(body).toContain('"capability.transition"');
    });

    it("axis 2: function body switches on sourcePatternId with three cases", () => {
      expect(body).toMatch(/switch\s*\(\s*candidate\.sourcePatternId\s*\)/);
      expect(body).toContain('case "gap"');
      expect(body).toContain('case "deprecation_signal"');
      // default or trailing underperformer/consolidation_opportunity case
      expect(body).toMatch(/case\s+"underperformer"|default\s*:/);
    });
  });
  ```

- [ ] **Step 2: Run the sentinel**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  pnpm vitest run tests/capability/cap-n-sentinel.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS, 2/2 axes green.

- [ ] **Step 3: Run full capability suite**

  ```bash
  pnpm vitest run tests/capability/ 2>&1 | tail -10
  ```

  Expected: PASS, 552 + 4 (T1) + 1 (T3) + 2 (T4) = 559 tests passing.

- [ ] **Step 4: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  git add tests/capability/cap-n-sentinel.vitest.ts
  git commit -m "test(capability): CAP-N T4 structural sentinel (2 axes — operation literals + sourcePatternId switch)"
  ```

---

### Task 5: Doc migration — annotate carve-out as closed

**Files:**
- Modify: `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md` (additive — annotate the §10 caveat paragraph)

**Steps:**

- [ ] **Step 1: Read the carve-out paragraph**

  Read `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md` §10 ("CAP-12 §20 hard-acceptance evidence") — specifically the "§20 #12 caveat:" paragraph that follows the table.

- [ ] **Step 2: Annotate the paragraph as closed**

  Insert a new paragraph immediately after the existing caveat paragraph:

  ```markdown
  **§20 #12 closed by CAP-N at <commit SHA> — 2026-08-14.** `apply()` now routes per `sourcePatternId`: `gap` → `capability.create`, `deprecation_signal` → `capability.remove`, others → `capability.transition`. E2E step 12b (`tests/capability/cap-12-e2e.vitest.ts`) asserts a gap proposal actually grows the catalog by one. The §20 #12 evidence row now reads plain "PASS" without caveat.
  ```

  Replace `<commit SHA>` with the SHA of T2's commit (or the merged CAP-N commit if known).

- [ ] **Step 3: Update the §20 #12 table row**

  Change the §20 #12 row's Verdict column from "PASS *with caveat*" to "PASS".

- [ ] **Step 4: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  git add docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md
  git commit -m "docs(capability): CAP-N T5 annotate §20 #12 carve-out as closed"
  ```

---

### Task 6: PR + squash-merge + memory entry

**Steps:**

- [ ] **Step 1: Push branch**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/cap-n-end-to-end-create-path
  git push -u origin cap-n-end-to-end-create-path
  ```

- [ ] **Step 2: Open PR via gh**

  ```bash
  gh pr create --base main --head cap-n-end-to-end-create-path \
    --title "CAP-N End-to-End Create-Path Closure (#509)" \
    --body "Closes #509.

  **CAP-N closes the CAP-12 §20 #12 carve-out** at \`src/capability/capability-service.ts:702,704\`. After this PR:
  - \`apply()\` discriminates per candidate \`sourcePatternId\`:
    - \`gap\` → \`capability.create\` (registers new capability)
    - \`deprecation_signal\` → \`capability.remove\`
    - others → \`capability.transition\` (preserved)
  - E2E step 12b asserts catalog growth for create-path (\`tests/capability/cap-12-e2e.vitest.ts\`)
  - Structural sentinel (\`tests/capability/cap-n-sentinel.vitest.ts\`) pins the carve-out site is rewritten
  - Checkpoint doc §20 #12 reads plain \"PASS\" without caveat

  ## Test totals
  \`\`\`
  pnpm vitest run tests/capability/
  Test Files  ~67 passed (67)
  Tests       559 passed (559)  # +7 over the 552 CAP-12 baseline
  \`\`\`

  ## Commits
  - T1: failing 4-axis mapping test
  - T2: rewrite \`candidateToExecutionStep\` per §4.1
  - T3: e2e step 12b asserts catalog growth
  - T4: structural sentinel
  - T5: doc migration (carve-out annotated as closed)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  ```

- [ ] **Step 3: Squash-merge**

  ```bash
  cd /home/babasola/Projects/Monolith
  gh pr merge <PR-number> --squash --delete-branch
  git pull origin main
  ```

- [ ] **Step 4: Write memory entry**

  Write `/home/babasola/.claude/projects/-home-babasola-Projects-Monolith/memory/cap-n-end-to-end-create-path-complete.md` with:
  - type: project
  - body: CAP-N closed the CAP-12 §20 #12 carve-out; mapping is `sourcePatternId` → operation; tag is unchanged (`alix-capability-greenfield-complete`); next frontier is the deferred `capability.update` / `capability.consolidate` discriminator tightening.

- [ ] **Step 5: Update MEMORY.md**

  Add a one-line pointer to the new memory file in the index.

---

## Self-Review

**1. Spec coverage:**
- §2 goal → Task 2 ✓
- §4.1 mapping contract → Task 2 (single switch statement) ✓
- §4.2 auto-derive proposedDefinition → Task 2 (gap case) ✓
- §7 migration (e2e step 12 modification) → Task 3 ✓
- §9.1 unit tests → Task 1 ✓
- §9.3 structural sentinel → Task 4 ✓
- §10 carve-out annotation → Task 5 ✓
- §4.3 sourceId semantics → Task 2 (function keeps `sourceId` parameter; caller unchanged) ✓
- §4.4 forecast pin → Task 2 (transition/remove preserved; create uses default) ✓

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later", "fill in details" in the plan ✓
- Test code is concrete (not "similar to Task N") ✓
- All step types are explicit ✓

**3. Type consistency:**
- `CapabilityEvolutionCandidate.sourcePatternId` matches `a7-proposals.ts:192-242` ✓
- `ExecutionStep` shape matches the current usage ✓
- `proposedDefinition` shape is a valid `CapabilityDefinition` per CAP-2 ✓

## Execution Handoff

This plan is ready for subagent-driven execution. The 6 tasks follow the standard SDD pattern:
- T1 (failing test) → T2 (implementation) → T3 (e2e update) → T4 (sentinel) → T5 (doc) → T6 (PR + merge + memory)

Per-task reviewer gates: T1-T2 use sonnet (mechanical + spec-faithful); T3 uses sonnet (e2e integration); T4 uses haiku (structural grep); T5 uses haiku (doc-only); T6 is the PR + merge workflow.

Whole-branch final review: opus, after T6 squash-merge on a temporary integration branch.