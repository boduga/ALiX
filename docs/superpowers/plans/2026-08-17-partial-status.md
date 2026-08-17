# Partial-Status & Objective-Aware Subagent Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the #567 false negative — a subagent whose delegated write objective landed must not report `failed` because the model emitted later failed writes — by making completion objective-aware (owned-path coverage), and add a `partial` status for durable progress with an incomplete objective.

**Architecture:** Replace the single `fatalWriteFailures` ledger in `subagent-cli.ts` with a `WriteProgress` ledger (`successfulPaths: Set<string>` + `fatalWriteFailures: string[]`). Status is computed from durable write progress + owned-path coverage (reusing `resolvePolicyPath` from `policy-gate.ts`), not from failures alone. `partial` flows through `SubagentManager` untouched and maps to `ToolResult.kind: "success"` with explicit partial details at the delegate boundary. `ToolResult` stays binary.

**Tech Stack:** TypeScript (Node ESM), `node:test` + `node:assert/strict`, compiled via `tsc` to `dist/`.

## Global Constraints

- `SubagentResult.status` becomes `"success" | "failed" | "rejected" | "partial"` (`src/config/schema.ts:271`).
- `ToolResult` MUST stay binary `success | error` — no third kind, no ripple into executor/route-execution/event-handlers/continuation-manager.
- Worker exit codes stay binary: `success` → 0, everything else (`failed`/`rejected`/`partial`) → 1. The existing `process.exit(result.status === "success" ? 0 : 1)` already does this — do NOT change exit logic.
- Path canonicalization MUST reuse `resolvePolicyPath(cwd, path)` (export it from `policy-gate.ts`). Do NOT introduce a second canonicalization implementation.
- Coverage semantics = policy containment: equality OR direct child (`sc === oc || sc.startsWith(oc + "/")`).
- `partial` does NOT require a write failure (foo.ts landed, bar.ts never attempted, model stops → `partial`).
- `failed` requires NO durable progress (`successfulPaths.size === 0`) AND ≥1 fatal write failure.
- No hard stop after the first successful write. No LLM judge. No `done`-tool objective determination. No retry-semantics changes.
- Per repo CLAUDE.md: run GitNexus `impact()` (upstream) on each source symbol before editing it, and `detect_changes()` before committing.
- Per-task test command (TDD red→green): `pnpm build && node --test dist/tests/agents/<file>.test.js` (run from the worktree root).

---

### Task 1: Pure status helpers + schema union + `resolvePolicyPath` export

Introduces the objective-aware completion core as pure, unit-testable functions. Nothing is wired into the worker loop yet.

**Files:**
- Modify: `src/config/schema.ts:271`
- Modify: `src/policy/policy-gate.ts:71`
- Modify: `src/agents/subagent-cli.ts` (add helpers after `WRITE_EXEC_NAMES`, line ~136; add import)
- Test: `tests/agents/subagent-cli.test.ts`

**Interfaces:**
- Produces (consumed by later tasks):
  - `type WriteProgress = { successfulPaths: Set<string>; fatalWriteFailures: string[] }`
  - `extractSuccessfulPaths(execName: string, result: { kind: string; changedFiles?: string[]; createdPath?: string; deletedPath?: string }): string[]`
  - `isObjectiveComplete(successfulPaths: Set<string>, ownedPaths: string[], cwd: string): boolean`
  - `computeSubagentStatus(progress: WriteProgress, ownedPaths: string[], cwd: string): SubagentResult["status"]`
  - `recordWriteOutcome(progress: WriteProgress, execName: string, execResult: { kind: string; changedFiles?: string[]; createdPath?: string; deletedPath?: string }): void`
  - exported `resolvePolicyPath(cwd: string, path: string): string` from `policy-gate.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/agents/subagent-cli.test.ts`. First update the import on line 3 to include the new exports:

```ts
import { appendSubagentResponseText, buildSubagentFindings, computeSubagentStatus, extractSuccessfulPaths, formatSubagentResult, isObjectiveComplete, recordWriteOutcome, subagentToolError, SubagentCLI, inferSingleOwnedPatchPath, shouldInferPatchPath, type WriteProgress } from "../../src/agents/subagent-cli.js";
```

Replace the three existing `computeSubagentStatus` tests (lines 80-91) with the new-signature equivalents plus the full matrix:

```ts
const CWD = "/project";
const P = (paths: string[] = [], failures: string[] = []): WriteProgress =>
  ({ successfulPaths: new Set(paths), fatalWriteFailures: failures });

test("computeSubagentStatus: success when nothing written and no failure", () => {
  assert.equal(computeSubagentStatus(P(), ["foo.ts"], CWD), "success");
});

test("computeSubagentStatus: failed when a write failed with no durable progress", () => {
  assert.equal(computeSubagentStatus(P([], ["patch.apply"]), ["foo.ts"], CWD), "failed");
});

test("computeSubagentStatus: failed when a write was denied with no durable progress", () => {
  assert.equal(computeSubagentStatus(P([], ["file.create"]), ["foo.ts"], CWD), "failed");
});

// Spec 32.1 Test A — v3 regression: complete objective stays success despite later write noise
test("matrix: complete objective stays success despite later write noise (v3)", () => {
  assert.equal(
    computeSubagentStatus(P(["/project/verify-scratch.ts"], ["patch.apply", "patch.apply"]), ["verify-scratch.ts"], CWD),
    "success",
  );
});

// Spec 32.1 Test B
test("matrix: complete with no failures", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts", "/project/bar.ts"], []), ["foo.ts", "bar.ts"], CWD), "success");
});

// Spec 32.1 Test C
test("matrix: complete despite failed later write", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts", "/project/bar.ts"], ["patch.apply"]), ["foo.ts", "bar.ts"], CWD), "success");
});

// Spec 32.1 Test D — partial does not require a write failure
test("matrix: partial without failures", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts"], []), ["foo.ts", "bar.ts"], CWD), "partial");
});

// Spec 32.1 Test E
test("matrix: partial with write failure", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts"], ["patch.apply"]), ["foo.ts", "bar.ts"], CWD), "partial");
});

// Spec 32.1 Test F
test("matrix: no progress + failed write", () => {
  assert.equal(computeSubagentStatus(P([], ["patch.apply"]), ["foo.ts"], CWD), "failed");
});

// Spec 32.1 Test G
test("matrix: clean no-progress", () => {
  assert.equal(computeSubagentStatus(P(), ["foo.ts"], CWD), "success");
});

// Spec 32.1 Test H
test("matrix: empty owned paths, no writes", () => {
  assert.equal(computeSubagentStatus(P(), [], CWD), "success");
});

// Spec 32.1 Test I
test("matrix: empty owned paths with write failure is still success", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts"], ["patch.apply"]), [], CWD), "success");
});

// Spec 33 — normalization
test("isObjectiveComplete: relative owned vs absolute successful match", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/foo.ts"]), ["src/foo.ts"], "/project"), true);
});
test("isObjectiveComplete: absolute owned vs relative successful match", () => {
  assert.equal(isObjectiveComplete(new Set(["src/foo.ts"]), ["/project/src/foo.ts"], "/project"), true);
});

// Spec 34 — directory coverage
test("isObjectiveComplete: owned directory covers children", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/foo.ts"]), ["src"], "/project"), true);
});
test("isObjectiveComplete: prefix without separator does not match", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/foo.ts.bak"]), ["/project/src/foo.ts"], "/project"), false);
});
test("isObjectiveComplete: unrelated path does not cover", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/bar.ts"]), ["/project/src/foo.ts"], "/project"), false);
});
test("isObjectiveComplete: empty owned paths is always complete", () => {
  assert.equal(isObjectiveComplete(new Set(), [], "/project"), true);
});

// Spec 35 — path extraction
test("extractSuccessfulPaths: patch.apply uses changedFiles", () => {
  assert.deepEqual(extractSuccessfulPaths("patch.apply", { kind: "success", changedFiles: ["a.ts"] }), ["a.ts"]);
});
test("extractSuccessfulPaths: file.create prefers createdPath", () => {
  assert.deepEqual(extractSuccessfulPaths("file.create", { kind: "success", createdPath: "a.ts", changedFiles: ["a.ts"] }), ["a.ts"]);
});
test("extractSuccessfulPaths: file.create falls back to changedFiles", () => {
  assert.deepEqual(extractSuccessfulPaths("file.create", { kind: "success", changedFiles: ["a.ts"] }), ["a.ts"]);
});
test("extractSuccessfulPaths: file.delete prefers deletedPath", () => {
  assert.deepEqual(extractSuccessfulPaths("file.delete", { kind: "success", deletedPath: "a.ts" }), ["a.ts"]);
});
test("extractSuccessfulPaths: failed write gets no credit", () => {
  assert.deepEqual(extractSuccessfulPaths("patch.apply", { kind: "error", message: "Search block not found" }), []);
});
test("extractSuccessfulPaths: success with no recognized path contributes nothing", () => {
  assert.deepEqual(extractSuccessfulPaths("patch.apply", { kind: "success", output: "ok" }), []);
});
test("extractSuccessfulPaths: non-write tools contribute nothing", () => {
  assert.deepEqual(extractSuccessfulPaths("file.read", { kind: "success", output: "x" }), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: FAIL — `computeSubagentStatus is not a function` (wrong arity) / `extractSuccessfulPaths` / `isObjectiveComplete` not defined.

- [ ] **Step 3: Implement the helpers**

`src/config/schema.ts:271`:

```ts
  status: "success" | "failed" | "rejected" | "partial";
```

`src/policy/policy-gate.ts:71` (add `export`):

```ts
export function resolvePolicyPath(cwd: string, path: string): string {
  if (path.startsWith("/")) return path;
  return resolve(cwd, path);
}
```

`src/agents/subagent-cli.ts` — add the import near the top (after the existing `import type { ... }` on line 8):

```ts
import { resolvePolicyPath } from "../policy/policy-gate.js";
```

Add these after `WRITE_EXEC_NAMES` (line 132) and before `subagentToolError`:

```ts
/** Durable write progress + failure observations for objective-aware completion. */
export type WriteProgress = {
  successfulPaths: Set<string>;
  fatalWriteFailures: string[];
};

/** Paths a successful write actually affected. Failed writes never receive credit. */
export function extractSuccessfulPaths(
  execName: string,
  result: { kind: string; changedFiles?: string[]; createdPath?: string; deletedPath?: string },
): string[] {
  if (result.kind !== "success") return [];
  switch (execName) {
    case "file.create":
      return result.createdPath ? [result.createdPath] : result.changedFiles ?? [];
    case "file.delete":
      return result.deletedPath ? [result.deletedPath] : result.changedFiles ?? [];
    case "patch.apply":
      return result.changedFiles ?? [];
    default:
      return [];
  }
}

/** Record one tool outcome into the progress ledger. Only write tools are tracked. */
export function recordWriteOutcome(
  progress: WriteProgress,
  execName: string,
  execResult: { kind: string; changedFiles?: string[]; createdPath?: string; deletedPath?: string },
): void {
  if (!WRITE_EXEC_NAMES.has(execName)) return;
  if (execResult.kind !== "success") {
    if (!progress.fatalWriteFailures.includes(execName)) progress.fatalWriteFailures.push(execName);
  } else {
    for (const p of extractSuccessfulPaths(execName, execResult)) progress.successfulPaths.add(p);
  }
}

/** True when a path is covered by a successful write (equality or direct child, canonicalized). */
function pathIsCovered(path: string, successful: string[], cwd: string): boolean {
  const oc = resolvePolicyPath(cwd, path);
  return successful.some((s) => {
    const sc = resolvePolicyPath(cwd, s);
    return sc === oc || sc.startsWith(oc + "/");
  });
}

/** True when every owned path is covered by a successful write. */
export function isObjectiveComplete(successfulPaths: Set<string>, ownedPaths: string[], cwd: string): boolean {
  if (ownedPaths.length === 0) return true;
  const successful = [...successfulPaths];
  return ownedPaths.every((owned) => pathIsCovered(owned, successful, cwd));
}

/** Objective-aware status: failures matter only when there is no durable progress. */
export function computeSubagentStatus(
  progress: WriteProgress,
  ownedPaths: string[],
  cwd: string,
): SubagentResult["status"] {
  const { successfulPaths, fatalWriteFailures } = progress;
  if (successfulPaths.size === 0) return fatalWriteFailures.length > 0 ? "failed" : "success";
  if (ownedPaths.length === 0) return "success";
  return isObjectiveComplete(successfulPaths, ownedPaths, cwd) ? "success" : "partial";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: PASS (all matrix, normalization, coverage, extraction tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/policy/policy-gate.ts src/agents/subagent-cli.ts tests/agents/subagent-cli.test.ts
git commit -m "feat(delegate): objective-aware subagent status core (WriteProgress + owned-path coverage)"
```

---

### Task 2: Wire progress into the worker loop + partial formatting

Connects the helpers to the actual worker execution loop, threads progress through `buildResult`, renders `partial` in `formatSubagentResult`, and populates the partial completion detail. Exit codes already handle `partial` → 1 via the existing ternary — do not change them.

**Files:**
- Modify: `src/agents/subagent-cli.ts` (`buildResult`, `formatSubagentResult`, tool loop lines ~340-453)
- Test: `tests/agents/subagent-cli.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers (`WriteProgress`, `recordWriteOutcome`, `computeSubagentStatus`).
- Produces: `buildResult(taskId, role, mode, text, toolOutputs, progress, ownedPaths): SubagentResult` with a partial `error` detail string; `formatSubagentResult` renders `[partial]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/agents/subagent-cli.test.ts`:

```ts
test("recordWriteOutcome: failed write records a failure", () => {
  const p = P();
  recordWriteOutcome(p, "patch.apply", { kind: "error", message: "Search block not found" });
  assert.deepEqual(p.fatalWriteFailures, ["patch.apply"]);
});

test("recordWriteOutcome: successful write records affected paths", () => {
  const p = P();
  recordWriteOutcome(p, "patch.apply", { kind: "success", changedFiles: ["a.ts"] });
  assert.deepEqual([...p.successfulPaths], ["a.ts"]);
});

test("recordWriteOutcome: non-write tools are ignored", () => {
  const p = P();
  recordWriteOutcome(p, "file.read", { kind: "success", output: "x" });
  assert.equal(p.successfulPaths.size, 0);
  assert.equal(p.fatalWriteFailures.length, 0);
});

test("formatSubagentResult: partial renders [partial] note with detail", () => {
  const result: SubagentResult = {
    id: "t", role: "worker",
    status: "partial",
    findings: [{ type: "summary", content: "edited foo", confidence: "high" }],
    events: [],
    error: "delegated objective incomplete\nChanged: foo.ts\nUntouched: bar.ts\nWrite failures: none",
  };
  const out = formatSubagentResult(result, "text");
  assert.ok(out.includes("[partial]"));
  assert.ok(out.includes("Untouched: bar.ts"));
});
```

The test file does not currently import `SubagentResult`. Add a type-only import after line 2:

```ts
import type { SubagentResult } from "../../src/config/schema.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: FAIL — `recordWriteOutcome is not a function`; `formatSubagentResult` partial renders "Subagent failed." instead of `[partial]`.

- [ ] **Step 3: Implement**

In `src/agents/subagent-cli.ts`:

**3a. `formatSubagentResult` (lines 124-129) — handle `partial` distinctly from `failed`/`rejected`:**

```ts
export function formatSubagentResult(result: SubagentResult, format: SubagentOutputFormat): string {
  if (format === "json") return JSON.stringify(result);
  if (result.status === "failed" || result.status === "rejected") return result.error ?? "Subagent failed.";
  const content = result.findings.map((finding) => finding.content.trim()).filter(Boolean).join("\n\n");
  if (result.status === "partial") return `[partial] ${result.error ?? "delegated objective incomplete"}\n\n${content}`.trim();
  return content || "(no findings)";
}
```

**3b. Replace `computeSubagentStatus` at lines 134-136 with a re-export of the new implementation and add a `partialDetail` helper. The old function is removed** (its tests were rewritten in Task 1):

```ts
/** Describe a partial result: what changed, what remains untouched, write failures. */
function partialDetail(successfulPaths: Set<string>, ownedPaths: string[], fatalWriteFailures: string[], cwd: string): string {
  const successful = [...successfulPaths];
  const untouched = ownedPaths.filter((owned) => !pathIsCovered(owned, successful, cwd));
  const lines = ["delegated objective incomplete"];
  if (successfulPaths.size) lines.push(`Changed: ${[...successfulPaths].join(", ")}`);
  lines.push(`Untouched: ${untouched.length ? untouched.join(", ") : "(none)"}`);
  lines.push(`Write failures: ${fatalWriteFailures.length ? fatalWriteFailures.join(", ") : "none"}`);
  return lines.join("\n");
}
```

**3c. Rewrite `buildResult` (lines 143-158) to take progress + ownedPaths:**

```ts
function buildResult(
  taskId: string, role: SubagentRole, mode: "read_only" | "write",
  text: string, toolOutputs: string[], progress: WriteProgress, ownedPaths: string[],
): SubagentResult {
  const status = computeSubagentStatus(progress, ownedPaths, process.cwd());
  const { successfulPaths, fatalWriteFailures } = progress;
  const error =
    status === "failed"
      ? fatalWriteFailures.length
        ? `Non-retryable write failures: ${fatalWriteFailures.join(", ")}`
        : "Subagent failed"
      : status === "partial"
        ? partialDetail(successfulPaths, ownedPaths, fatalWriteFailures, process.cwd())
        : undefined;
  return {
    id: taskId, role, status,
    findings: buildSubagentFindings(text || "Task completed.", toolOutputs),
    events: [],
    error,
  };
}
```

**3d. Wire the loop (lines 342, 398-403, 410, 427).** Replace the ledger declaration:

```ts
      const progress: WriteProgress = { successfulPaths: new Set(), fatalWriteFailures: [] };
```

Replace the failure-accounting block (lines 398-400) with the unified recorder:

```ts
          if (execResult.kind !== "success" && WRITE_EXEC_NAMES.has(execName)) {
            if (!progress.fatalWriteFailures.includes(execName)) progress.fatalWriteFailures.push(execName);
          }
```
→
```ts
          recordWriteOutcome(progress, execName, execResult);
```

Update both `buildResult(...)` call sites (lines 410 and 427) from `fatalWriteFailures` to `progress, ownedPaths`:

```ts
            const result = buildResult(taskId, role, mode, text, toolOutputs, progress, ownedPaths);
            console.log(formatSubagentResult(result, outputFormat));
            process.exit(result.status === "success" ? 0 : 1);
```
```ts
      const result = buildResult(taskId, role, mode, text, toolOutputs, progress, ownedPaths);
      console.log(formatSubagentResult(result, outputFormat));
      process.exit(result.status === "success" ? 0 : 1);
```

Exit codes are unchanged (partial → 1 automatically).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm build && node --test dist/tests/agents/subagent-cli.test.js`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Write the failing tests**

Append to `tests/agents/subagent-manager.test.ts` (after the existing failed-status tests, line 119):

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && node --test dist/tests/agents/subagent-manager.test.js`
Expected: FAIL — with exit 1, status resolves to `"failed"` (partial not in the whitelist); with exit 0 it resolves to `"success"`.

- [ ] **Step 3: Implement**

`src/agents/subagent-manager.ts:126-129`:

```ts
          const status: SubagentResult["status"] =
            parsed?.status === "success" || parsed?.status === "failed" || parsed?.status === "rejected" || parsed?.status === "partial"
              ? parsed.status
              : exitCode === 0 ? "success" : "failed";
```

(The `error` derivation at line 137 — `status !== "success" ? (parsed?.error || ...) : undefined` — already yields the child's partial detail string; no change needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm build && node --test dist/tests/agents/subagent-manager.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Write the failing tests**

Append to `tests/agents/delegate-tool.test.ts` inside the `describe("Delegate tool", ...)` block:

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && node --test dist/tests/agents/delegate-tool.test.js`
Expected: FAIL — partial goes down the existing else branch → `kind: "error"`.

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm build && node --test dist/tests/agents/delegate-tool.test.js`
Expected: PASS (all four existing tests + two new).

- [ ] **Step 5: Commit**

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
- Produces: `validateResult` unchanged signature; `partial` participates in expected-output and no-findings checks like `success`.

- [ ] **Step 1: Write the failing tests**

Create `tests/agents/result-contract-validator.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult } from "../../src/agents/result-contract-validator.js";

test("validateResult: partial is treated like success for expected-output checks", () => {
  const result = {
    id: "t", role: "worker" as const, status: "partial" as const,
    findings: [{ type: "summary" as const, content: "edited foo to 42", confidence: "high" as const }],
    events: [], error: "delegated objective incomplete",
  };
  const v = validateResult(result, "42");
  assert.equal(v.valid, true);
});

test("validateResult: partial with no findings warns like success", () => {
  const result = {
    id: "t", role: "worker" as const, status: "partial" as const,
    findings: [], events: [], error: "delegated objective incomplete",
  };
  const v = validateResult(result);
  assert.equal(v.valid, false);
  assert.ok(v.warnings.some((w) => w.includes("no findings")));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build && node --test dist/tests/agents/result-contract-validator.test.js`
Expected: FAIL — partial is not treated like success, so the first test's warning fires and the second's no-findings warning does not.

- [ ] **Step 3: Implement**

`src/agents/result-contract-validator.ts` — treat `partial` like `success`:

```ts
  const isSuccessLike = (status: SubagentResult["status"]) => status === "success" || status === "partial";

  if (expected && isSuccessLike(result.status)) {
    const hasExpected = result.findings.some(f => f.content.includes(expected));
    if (!hasExpected) {
      warnings.push(`Expected output "${expected}" not found in findings`);
    }
  }

  if (result.findings.length === 0 && isSuccessLike(result.status)) {
    warnings.push("Subagent returned success but no findings were recorded");
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm build && node --test dist/tests/agents/result-contract-validator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/result-contract-validator.ts tests/agents/result-contract-validator.test.ts
git commit -m "fix(delegate): result-contract validator treats partial like success"
```

---

### Task 6: Build, typecheck, and full targeted test run

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no TS errors).

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 3: Run all touched test files**

Run:
```bash
node --test dist/tests/agents/subagent-cli.test.js dist/tests/agents/subagent-manager.test.js dist/tests/agents/delegate-tool.test.js dist/tests/agents/result-contract-validator.test.js dist/tests/policy/policy-gate.test.js
```
Expected: all PASS.

- [ ] **Step 4: detect_changes + commit**

Run GitNexus `detect_changes({scope: "compare", base_ref: "main"})`. Confirm changed symbols are limited to: schema status union, `resolvePolicyPath` (now exported), `subagent-cli.ts` helpers/loop, `subagent-manager.ts` whitelist, `delegate-tool.ts` mapping, `result-contract-validator.ts`.

```bash
git add -A
git commit -m "chore(delegate): objective-aware completion + partial status — build & test verification"
```

## Self-Review

**Spec coverage:** §1-18 (problem, model, extraction, coverage, canonicalization, matrix, examples) → Task 1 (helpers + tests A-I) + Task 2 (loop wiring). §19 (status union) → Task 1. §20 (exit codes) → Task 2 (unchanged ternary covers partial→1). §21 (manager) → Task 3. §22-26 (delegate mapping) → Task 4. §27 (validator) → Task 5. §28 (formatting) → Task 2. §32-37 (tests) → Tasks 1-5. §38-39 (integration) → manual desktop verification after Task 6 (documented; not automatable in this sandbox — keyring locked).

**Placeholder scan:** none — every step carries concrete code.

**Type consistency:** `WriteProgress` / `extractSuccessfulPaths` / `recordWriteOutcome` / `isObjectiveComplete` / `computeSubagentStatus` names and signatures match across Task 1 (definition) and Task 2 (consumption). `partialDetail` is defined and used within Task 2. `buildResult`'s new signature (progress, ownedPaths) is threaded at both call sites.

**Note on integration tests (§38-39):** they run on the user's desktop (keyring unlocked); this sandbox's keyring is locked, so `loadConfig()` hangs. After the unit tasks pass, re-run the v3 worker invocation on the desktop per the spec and expect `status: success, exit: 0`, and the synthetic foo/bar task expects `status: partial, exit: 1`.
