# Partial-Status & Objective-Aware Subagent Completion — Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the #567 false negative — a subagent whose delegated write objective landed must not report `failed` because the model emitted later failed writes — by making completion objective-aware (owned-path coverage), and add a `partial` status for durable progress with an incomplete objective.

**Architecture:** Replace the single `fatalWriteFailures` ledger in `subagent-cli.ts` with a `WriteProgress` ledger (`successfulPaths: Set<string>` + `fatalWriteFailures: string[]`). Status is computed from durable write progress + owned-path coverage (reusing the existing `resolvePolicyPath`), not from failures alone. `partial` flows through `SubagentManager` untouched and maps to `ToolResult.kind: "success"` with explicit partial details at the delegate boundary. `ToolResult` stays binary.

**Tech Stack:** TypeScript (Node ESM), `node:test` + `node:assert/strict`, compiled via `tsc` to `dist/`.

**Revision note (rev 2):** This plan was reviewed before agentic execution and corrected on 12 points (see the review that preceded this revision). Task 1 is already committed (`5cb5bf8e`, review-clean). The pure-function parts of Task 2 have also been applied in the worktree by the maintainer (uncommitted): `formatSubagentResult` partial rendering, `partialDetail`, and the new `buildResult` signature. The loop wiring is intentionally left undone and the build currently fails at the two `buildResult` call sites — Task 2 below completes that wiring.

## Global Constraints

- `SubagentResult.status` becomes `"success" | "failed" | "rejected" | "partial"` (`src/config/schema.ts:271`).
- `ToolResult` MUST stay binary `success | error` — no third kind, no ripple into executor/route-execution/event-handlers/continuation-manager.
- Worker exit codes stay binary: `success` → 0, everything else (`failed`/`rejected`/`partial`) → 1. The existing `process.exit(result.status === "success" ? 0 : 1)` already does this — do NOT change exit logic.
- Path canonicalization MUST reuse the existing `resolvePolicyPath(cwd, path)` in `policy-gate.ts`. **Change only its declaration (`function` → `export function`); never rewrite its body.** Do NOT introduce a second canonicalization implementation.
- **Canonicalization ownership:** `WriteProgress.successfulPaths` records OBSERVED paths as reported by successful tools (raw, uncanonicalized). `isObjectiveComplete()` owns all canonicalization at evaluation time. `recordWriteOutcome()` must therefore stay independent of the worker's cwd.
- **Diagnostic path presentation:** `partialDetail`/delegate output may preserve the paths exactly as the successful tools reported them (no canonicalization, no invented path-formatting abstraction). Only completion comparison requires canonicalization.
- Coverage semantics = policy containment: equality OR direct child (`sc === oc || sc.startsWith(oc + "/")`).
- `partial` does NOT require a write failure (foo.ts landed, bar.ts never attempted, model stops → `partial`).
- `failed` requires NO durable progress (`successfulPaths.size === 0`) AND ≥1 fatal write failure.
- **Failure-ledger cardinality:** preserve the existing `fatalWriteFailures` semantics — it records unique write-tool names (deduped). Keep deduplicating; do not change to one entry per failed invocation.
- No hard stop after the first successful write. No LLM judge. No `done`-tool objective determination. No retry-semantics changes.
- **Monotonic invariant:** once the owned objective is covered, adding more failed writes must never change the result away from `success`.
- Per repo CLAUDE.md: run GitNexus `impact()` (upstream) on each source symbol before editing it, and `detect_changes()` before committing.
- Per-task test command (TDD red→green): `pnpm build && node --test dist/tests/agents/<file>.test.js` (run from the worktree root).

---

### Task 1: Pure status helpers + schema union + `resolvePolicyPath` export — **COMPLETE** (`5cb5bf8e`, review-clean)

Already committed. Records:
- `src/config/schema.ts:271` — `status: "success" | "failed" | "rejected" | "partial";`
- `src/policy/policy-gate.ts:71` — `resolvePolicyPath` exported (declaration-only change; body untouched).
- `src/agents/subagent-cli.ts` — `WriteProgress`, `extractSuccessfulPaths`, `recordWriteOutcome`, `isObjectiveComplete`, `computeSubagentStatus(progress, ownedPaths, cwd)`, module-private `pathIsCovered`. The `buildResult` shim from Task 1 is now being replaced by Task 2's real wiring.
- Tests in `tests/agents/subagent-cli.test.ts` cover the status matrix (A–I incl. the v3 regression), normalization (both directions), directory coverage (child + prefix-without-separator + unrelated), and path extraction.

No further work. The review corrections that touch this task's *plan wording* (export-only for `resolvePolicyPath`; observed-paths ownership; failure-ledger cardinality) are recorded above in Global Constraints and already hold in the committed code.

---

### Task 2: Wire progress into the worker loop + partial formatting (completing maintainer's partial work)

The maintainer has applied (uncommitted, in the worktree) the pure parts:
- `formatSubagentResult` — `failed`/`rejected` render as before; `partial` renders `[partial] <detail>\n\n<findings>`.
- `partialDetail(successfulPaths, ownedPaths, fatalWriteFailures, cwd)` — module-private, produces `delegated objective incomplete\nChanged: …\nUntouched: …\nWrite failures: …`.
- `buildResult` — new signature `(taskId, role, mode, text, toolOutputs, progress: WriteProgress, ownedPaths: string[])`, computes `status = computeSubagentStatus(progress, ownedPaths, process.cwd())`, sets `error` from `partialDetail` for `partial`.
- Tests appended: `recordWriteOutcome` (3) + `formatSubagentResult` partial (1), plus `import type { SubagentResult }`.

The build currently fails because the **loop wiring is not done**. This task completes it and adds the review-mandated regression tests.

**Files:**
- Modify: `src/agents/subagent-cli.ts` (loop at ~lines 420-508; export `buildResult` for testability)
- Modify: `tests/agents/subagent-cli.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers (`WriteProgress`, `recordWriteOutcome`, `computeSubagentStatus`, `pathIsCovered`), the maintainer's `partialDetail`/`buildResult`/`formatSubagentResult`.
- Produces: `export function buildResult(...)` (changed from module-private to exported — required for the wiring test below); worker loop tracks `WriteProgress`; two call sites pass `(…, progress, ownedPaths)`.

- [ ] **Step 1: Write the failing tests (red).**

The maintainer's Task 2 tests are already present. Add the three review-mandated tests to `tests/agents/subagent-cli.test.ts`:

```ts
// Review point 5 — file.delete fallback, making the extraction matrix symmetrical:
// create → createdPath → changedFiles; delete → deletedPath → changedFiles; patch → changedFiles.
test("extractSuccessfulPaths: file.delete falls back to changedFiles", () => {
  assert.deepEqual(
    extractSuccessfulPaths("file.delete", { kind: "success", changedFiles: ["a.ts"] }),
    ["a.ts"],
  );
});

// Review point 13 — monotonic completion invariant:
// once the owned objective is covered, arbitrary later failures cannot regress the result.
test("matrix: completed objective is monotonic despite arbitrary later failures", () => {
  const progress = P(
    ["/project/foo.ts"],
    ["patch.apply", "patch.apply", "file.create"],
  );
  assert.equal(
    computeSubagentStatus(progress, ["foo.ts"], "/project"),
    "success",
  );
});

// Review point 8 — buildResult wiring: progress → computeSubagentStatus → buildResult → partial.
// NOTE: buildResult canonicalizes against process.cwd(), so the successful path must be
// cwd-consistent (use `${process.cwd()}/foo.ts`), not a synthetic absolute path.
test("buildResult: progress + incomplete objective yields partial with untouched detail", () => {
  const cwd = process.cwd();
  const progress = P([`${cwd}/foo.ts`], []); // foo.ts landed, bar.ts never attempted
  const result = buildResult("t", "worker", "write", "done", [], progress, ["foo.ts", "bar.ts"]);
  assert.equal(result.status, "partial");
  assert.ok(result.error?.includes("Untouched: bar.ts"));
});
```

`buildResult` must be exported from `src/agents/subagent-cli.ts` for the last test to compile.

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: build FAILS on the two stale `buildResult(...)` call sites (TS2554: expected 7 args, got 6), and the new tests fail to compile (`buildResult` not exported). RED is the broken build + missing export.

- [ ] **Step 3: Complete the wiring.**

In `src/agents/subagent-cli.ts`:

**3a. Export `buildResult`:** change `function buildResult(` → `export function buildResult(` (keep the maintainer's implementation verbatim).

**3b. Replace the loop's failure ledger with a `WriteProgress` ledger.** At the top of the try block, replace:

```ts
      const fatalWriteFailures: string[] = [];
```
with:
```ts
      const progress: WriteProgress = { successfulPaths: new Set(), fatalWriteFailures: [] };
```

**3c. Replace the failure-accounting block** (currently ~line 479):

```ts
            if (execResult.kind !== "success" && WRITE_EXEC_NAMES.has(execName)) {
              if (!fatalWriteFailures.includes(execName)) fatalWriteFailures.push(execName);
            }
```
with:
```ts
            recordWriteOutcome(progress, execName, execResult);
```

`recordWriteOutcome` preserves the deduped failure-ledger semantics (per Global Constraints) and credits successful paths to `progress.successfulPaths`.

**3d. Update both `buildResult(...)` call sites** (~lines 490 and 507) from `fatalWriteFailures` to `progress, ownedPaths`:

```ts
            const result = buildResult(taskId, role, mode, text, toolOutputs, progress, ownedPaths);
```
```ts
      const result = buildResult(taskId, role, mode, text, toolOutputs, progress, ownedPaths);
```

Exit codes stay unchanged (`process.exit(result.status === "success" ? 0 : 1)` — do not touch).

- [ ] **Step 4: Run the tests to verify they pass (green).**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: PASS — all Task 1 matrix/normalization/coverage/extraction tests, the maintainer's `recordWriteOutcome`/`formatSubagentResult` tests, and the three new tests (file.delete fallback, monotonic completion, buildResult wiring).

- [ ] **Step 5: Run the worker's sibling suites** to confirm no cross-file breakage from the signature change:

Run: `node --test dist/tests/agents/subagent-manager.test.js dist/tests/agents/delegate-tool.test.js`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/agents/subagent-cli.ts tests/agents/subagent-cli.test.ts
git commit -m "fix(delegate): wire objective-aware progress into worker loop; render partial"
```

---

### Task 3: Manager preserves child-reported `partial`

**Files:**
- Modify: `src/agents/subagent-manager.ts:127`
- Test: `tests/agents/subagent-manager.test.ts`

**Interfaces:**
- Consumes: nothing new (uses `SubagentResult["status"]`).
- Produces: manager resolves `partial` results unchanged.

**Review point 9 — follow the existing fixture pattern.** The tests MUST use the exact `SubagentManager` spawn-override/mock-child pattern already established in `subagent-manager.test.ts` (the existing `"manager resolves with the child's failed status…"` tests at lines 90-119). Modify only the emitted `status` and the expected assertion — do not invent a new fixture shape.

- [ ] **Step 1: Write the failing tests (red).**

Append to `tests/agents/subagent-manager.test.ts`, mirroring the existing failed-status tests:

```ts
test("manager preserves child-reported partial status on exit 1", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "partial", findings: [], events: [], error: "delegated objective incomplete" })); process.exit(1);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "partial");
});

test("manager preserves child-reported partial status on exit 0", async () => {
  const manager = new SubagentManager({
    sessionId: "s1",
    config: { subagents: TEST_SUBAGENT_CFG } as AlixConfig,
    spawnOverride: {
      command: process.execPath,
      args: ["-e", `console.log(JSON.stringify({ id: "w", role: "worker", status: "partial", findings: [], events: [], error: "delegated objective incomplete" })); process.exit(0);`],
    },
  });
  const result = await manager.spawn({
    id: "w", role: "worker", mode: "write", ownedPaths: ["src"], prompt: "fix", contextBundle: "s1",
  });
  assert.equal(result.status, "partial");
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm build && node --test dist/tests/agents/subagent-manager.test.js`
Expected: FAIL — exit 1 → resolves `"failed"` (partial not whitelisted); exit 0 → resolves `"success"`.

- [ ] **Step 3: Implement (minimal diff).**

`src/agents/subagent-manager.ts:126-129` — add `partial` to the parsed-status whitelist:

```ts
          const status: SubagentResult["status"] =
            parsed?.status === "success" || parsed?.status === "failed" || parsed?.status === "rejected" || parsed?.status === "partial"
              ? parsed.status
              : exitCode === 0 ? "success" : "failed";
```

The `error` derivation at line 137 (`status !== "success" ? (parsed?.error || …) : undefined`) already yields the child's partial detail string — no change.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm build && node --test dist/tests/agents/subagent-manager.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/agents/subagent-manager.ts tests/agents/subagent-manager.test.ts
git commit -m "fix(delegate): manager preserves child-reported partial status"
```

---

### Task 4: Delegate maps `partial` → ToolResult success with explicit detail

**Files:**
- Modify: `src/agents/delegate-tool.ts:46-59`
- Test: `tests/agents/delegate-tool.test.ts`

**Interfaces:**
- Consumes: `SubagentResult.status === "partial"` with `error` = the partial detail string from Task 2.
- Produces: `ToolResult = { kind: "success", output }` for partial (never `kind: "error"` / `retryable`).

- [ ] **Step 1: Write the failing tests (red).**

Append to `tests/agents/delegate-tool.test.ts` inside the existing `describe("Delegate tool", …)` block (follow the existing `makeMockManager`/`makeMockBuildTask` pattern):

```ts
  it("returns success with [partial] note when subagent is partial", async () => {
    const manager = makeMockManager({
      status: "partial",
      findings: [{ type: "summary", content: "edited foo", confidence: "high", refs: [] }],
      error: "delegated objective incomplete\nChanged: foo.ts\nUntouched: bar.ts\nWrite failures: none",
    });
    const handler = createDelegateHandler(manager, makeMockBuildTask().buildTask);
    const result = await handler({ role: "worker", prompt: "fix both", ownedPaths: ["foo.ts", "bar.ts"] });
    assert.equal(result.kind, "success");
    assert.ok((result as any).output.includes("[partial]"));
    assert.ok((result as any).output.includes("Untouched: bar.ts"));
  });

  it("still returns error when subagent fails", async () => {
    const manager = makeMockManager({ status: "failed", error: "Model timeout" });
    const handler = createDelegateHandler(manager, makeMockBuildTask().buildTask);
    const result = await handler({ role: "explorer", prompt: "explore" });
    assert.equal(result.kind, "error");
    assert.ok((result as any).message.includes("Model timeout"));
  });
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm build && node --test dist/tests/agents/delegate-tool.test.js`
Expected: FAIL — partial goes down the existing else branch → `kind: "error"`.

- [ ] **Step 3: Implement (minimal diff).**

`src/agents/delegate-tool.ts` — replace lines 46-59:

```ts
      if (result.status === "success" || result.status === "partial") {
        if (onResult) onResult(result);
        const body = result.findings.map((f) => `[${f.type}] ${f.content}`).join("\n") || "(no findings)";
        const output =
          result.status === "partial"
            ? `[partial] ${result.error ?? "delegated objective incomplete"}\n\n${body}`
            : body;
        return { kind: "success", output };
      } else {
        if (onResult) onResult(result);
        return {
          kind: "error",
          message: `Subagent failed: ${result.error ?? "unknown error"}`,
          retryable: false,
        };
      }
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm build && node --test dist/tests/agents/delegate-tool.test.js`
Expected: PASS (all existing tests + two new).

- [ ] **Step 5: Commit.**

```bash
git add src/agents/delegate-tool.ts tests/agents/delegate-tool.test.ts
git commit -m "fix(delegate): partial maps to ToolResult success with explicit partial detail"
```

---

### Task 5: Result-contract validator treats `partial` like `success`

**Files:**
- Modify: `src/agents/result-contract-validator.ts`
- Test: Create `tests/agents/result-contract-validator.test.ts`

**Interfaces:**
- Consumes: `SubagentResult`.
- Produces: `validateResult` unchanged signature; `partial` participates in expected-output and no-findings checks exactly like `success`.

**Review point 10 — test by comparison, not hard-coded semantics.** The regression to protect is: `partial + no findings` behaves identically to `success + no findings`, and likewise for expected-output checks. Do NOT hard-code `valid === false`; compare the two outputs.

**Review point 11 — minimal implementation diff.** Change `status === "success"` to `status === "success" || status === "partial"` at the finding-based checks. Do NOT introduce a local helper or restructure the validator.

- [ ] **Step 1: Write the failing tests (red).**

Create `tests/agents/result-contract-validator.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult } from "../../src/agents/result-contract-validator.js";
import type { SubagentResult } from "../../src/config/schema.js";

function makeResult(status: SubagentResult["status"], content?: string): SubagentResult {
  return {
    id: "t", role: "worker",
    status,
    findings: content ? [{ type: "summary", content, confidence: "high" }] : [],
    events: [],
    error: status === "partial" ? "delegated objective incomplete" : undefined,
  };
}

test("validateResult: partial behaves identically to success for expected-output checks", () => {
  // Content must not contain the expected token, or the missing-warning check
  // would pass even if partial were dropped from the expected-output branch.
  const partial = validateResult(makeResult("partial", "edited foo to 41"), "42");
  const success = validateResult(makeResult("success", "edited foo to 41"), "42");
  assert.deepEqual(partial.warnings, success.warnings);
  assert.equal(partial.valid, success.valid);
});

test("validateResult: partial behaves identically to success for no-findings warnings", () => {
  const partial = validateResult(makeResult("partial"));
  const success = validateResult(makeResult("success"));
  assert.deepEqual(partial.warnings, success.warnings);
  assert.equal(partial.valid, success.valid);
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm build && node --test dist/tests/agents/result-contract-validator.test.js`
Expected: FAIL — partial is currently treated as a generic failure, so `partial`/`success` outputs differ.

- [ ] **Step 3: Implement (minimal diff).**

`src/agents/result-contract-validator.ts` — replace the two `result.status === "success"` conditions with `result.status === "success" || result.status === "partial"`:

```ts
  if (expected && (result.status === "success" || result.status === "partial")) {
    const hasExpected = result.findings.some(f => f.content.includes(expected));
    if (!hasExpected) {
      warnings.push(`Expected output "${expected}" not found in findings`);
    }
  }

  if (result.findings.length === 0 && (result.status === "success" || result.status === "partial")) {
    warnings.push("Subagent returned success but no findings were recorded");
  }
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm build && node --test dist/tests/agents/result-contract-validator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/agents/result-contract-validator.ts tests/agents/result-contract-validator.test.ts
git commit -m "fix(delegate): result-contract validator treats partial like success"
```

---

### Task 6: Build, typecheck, full targeted run, detect_changes gate, integration

**Files:** none (verification only).

**Review point 12 — `detect_changes` is a verification gate, not a visual check.** Run it, and **STOP** (report to the maintainer) if it surfaces: unexpected source files; changes outside the declared scope; changes to `ToolResult`; executor/continuation/event-handler changes; unrelated policy-gate changes. The design deliberately avoids the `ToolResult.kind` ripple — verify it did not happen.

- [ ] **Step 1: Typecheck.** Run `pnpm typecheck`. Expected: PASS.

- [ ] **Step 2: Build.** Run `pnpm build`. Expected: succeeds.

- [ ] **Step 3: Full targeted test run.**

```bash
node --test dist/tests/agents/subagent-cli.test.js dist/tests/agents/subagent-manager.test.js dist/tests/agents/delegate-tool.test.js dist/tests/agents/result-contract-validator.test.js dist/tests/policy/policy-gate.test.js
```
Expected: all PASS.

- [ ] **Step 4: Inspect the diff surface.** Run `git diff --stat origin/main...HEAD` and confirm exactly: `src/config/schema.ts`, `src/policy/policy-gate.ts` (export only), `src/agents/subagent-cli.ts`, `src/agents/subagent-manager.ts`, `src/agents/delegate-tool.ts`, `src/agents/result-contract-validator.ts`, `tests/agents/*.test.ts`, `tests/policy/policy-gate.test.ts` (if touched), plus the two docs commits.

- [ ] **Step 5: GitNexus `detect_changes` gate.** Run `detect_changes({scope: "compare", base_ref: "main"})`. Enforce the STOP conditions above. If any surface, report to the maintainer before committing.

- [ ] **Step 6: Commit the branch.** The feature commits are already made per task. Do NOT create a trivial trailing commit for this verification task unless a change was required to pass it.

- [ ] **Step 7: Desktop integration (manual, on the user's desktop — keyring unlocked; NOT this sandbox).** Run from the worktree (rebuild first if source changed):

```bash
cd /home/babasola/Projects/Monolith/.claude/worktrees/partial-status-followup
node dist/src/agents/subagent-cli.js --subagent worker --task-id vX --mode write --session-id vX --owned-paths verify-scratch.ts --prompt "Change target to 42 in verify-scratch.ts via alix_patch_apply."
```
Expected (per spec §38): after `patch target=42` lands and the model emits later failed patches, final `status: success, exit: 0` (sole owned path covered — v3 false negative gone).

- [ ] **Step 8: Synthetic partial integration (manual, desktop).** A two-owned-path task (e.g. `--owned-paths foo.ts,bar.ts` with only `foo.ts` landed) expected `status: partial, exit: 1`, and delegate layer exposes `kind: success` with `[partial]` + untouched path.

## Self-Review

**Spec coverage:** §1-18 (problem, model, extraction, coverage, canonicalization, matrix, examples) → Task 1 (committed) + Task 2 (loop wiring). §19 (status union) → Task 1. §20 (exit codes) → Task 2 (unchanged ternary covers partial→1). §21 (manager) → Task 3. §22-26 (delegate mapping) → Task 4. §27 (validator) → Task 5. §28 (formatting) → Task 2 (maintainer's edit). §32-37 (tests) → Tasks 1-5, including the three review-mandated additions (monotonic, file.delete fallback, buildResult wiring). §38-39 (integration) → Task 6 Steps 7-8.

**Review-point coverage:** #1 export-only resolvePolicyPath → Global Constraints + Task 1 record. #2 Task-2 contradiction removed → Task 2 3a-3d consumes, never redefines. #3 failure-ledger cardinality → Global Constraints + Task 2 3c. #4 canonicalization invariant wording → Global Constraints + Task 1 record. #5 file.delete fallback test → Task 2 Step 1. #6 observed-paths ownership → Global Constraints. #7 diagnostic presentation → Global Constraints + partialDetail unchanged. #8 buildResult wiring test → Task 2 Step 1 (buildResult exported). #9 manager fixture pattern → Task 3. #10 validator compare-don't-hard-code → Task 5 Step 1. #11 validator minimal diff → Task 5 Step 3. #12 detect_changes as gate → Task 6 Step 5. Mandatory monotonic test → Task 2 Step 1.

**Placeholder scan:** none — every step carries concrete code.

**Type consistency:** `WriteProgress` / `extractSuccessfulPaths` / `recordWriteOutcome` / `isObjectiveComplete` / `computeSubagentStatus(progress, ownedPaths, cwd)` names and signatures match across Task 1 (committed), Task 2 (consumption + call sites), and the maintainer's edits. `buildResult` becomes exported in Task 2; its new 7-arg signature is used at both call sites (3d) and the new wiring test.
