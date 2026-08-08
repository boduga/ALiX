# C2 #18 — Graceful Irreducible Context-Budget Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an irreducible `ContextBudgetOverflowError` a graceful `RunResult` failure (`reason: "context_budget_overflow"` + structured payload) instead of an uncaught throw that crashes the daemon and route-executor and flattens the diagnostic to `String(err)` on every surface.

**Architecture:** Catch the irreducible overflow inside `runTaskLoop` and **return** a failed `RunResult` (payload intact) instead of re-throwing. The new reason is added to the `RunResult` union and `FAILURE_REASONS` so `runTaskCore` / `processTurn` mark the run failed via `result.reason`. The payload is threaded through `AgentTurnResult` so the CLI can render a friendly diagnostic, and the daemon serializes the numbers into its `task.failed` error string. Reducible overflows still throw — they are programming/validation failures, not a runtime condition.

**Tech Stack:** TypeScript (ESM, `import ... from "...js"`), Vitest (`pnpm vitest run`), Node 22. Reference: `docs/superpowers/specs/2026-08-07-c2-18-graceful-irreducible-design.md`.

## Global Constraints

- **GitNexus gates** (repo CLAUDE.md + user memory): run `impact` on the SPECIFIC symbol you are about to edit BEFORE editing it — each task lists its symbols (e.g. `impact runTaskLoop`, `impact processTurn`). Run `detect_changes({scope: "compare", base_ref: "main"})` before committing. If GitNexus reports HIGH/CRITICAL risk, STOP and surface it to the user before proceeding or pushing. Repo name is **ALiX**. The index may be stale for recently-added files — fall back to `grep`/`context` and note the fallback.
- **Branch:** all work happens on `c2-18-graceful-irreducible` (already checked out).
- **Suite before push:** `pnpm build` FIRST (dist is gitignored), then `pnpm test:vitest` + `pnpm test:node` + `npx tsc --noEmit`.
- **Node-lane pre-existing failures:** exactly **10 leaf** failures (9× `streamSSE` + 1× `agent-view`) — byte-identical to fork base `e5396602`. NEVER attribute them to this branch.
- **Payload guardrail:** `contextBudgetOverflow` is in-process diagnostic data. Consumers of the payload (daemon, CLI, TUI, route-executor) MUST read the typed readonly fields only — never `Error` methods, stack traces, or `instanceof`. The Error instance is never serialized as JSON; the daemon serializes the *fields* into a string. Inside `runTaskLoop` (the producer that constructed and threw the error), the catch discriminates on the class's `kind` literal via a local guard — **not** `instanceof` — so no new error-class coupling is introduced anywhere, including at the throw site.
- **`streamed` semantics:** the new failure returns `streamed: config.model.streaming` for consistency with every other `runTaskLoop` return site. An irreducible overflow occurs before any provider call, but changing `streamed` semantics is OUT OF SCOPE for C2 #18 (scope discipline) — do not "improve" it.
- **Scope discipline:** do NOT introduce a shared reason-constants module. Do NOT introduce a serializable DTO. Add the reason inline to the `RunResult` union + `FAILURE_REASONS` exactly as the existing three failure reasons are handled.

---

### Task 1: Extend the `RunResult` type and `FAILURE_REASONS`

**Files:**
- Modify: `src/run.ts:6-21` (type import block + `RunResult`)
- Modify: `src/agent/system-prompt.ts:91-95` (`FAILURE_REASONS`)

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces: `RunResult["reason"]` now includes `"context_budget_overflow"`; `RunResult` gains optional `contextBudgetOverflow?: ContextBudgetOverflowError`. Later tasks rely on both.

- [ ] **Step 1: Add the type-only import to `src/run.ts`**

Add `import type { ContextBudgetOverflowError } from "./config/context-budget.js";` after the existing type imports (lines 6-7). Do NOT touch the value imports on lines 1-4.

- [ ] **Step 2: Extend the `reason` union + add the payload field**

Replace the `RunResult` type (lines 14-21) with:

```ts
export type RunResult = {
  sessionId: string;
  summary: string;
  streamed?: boolean;
  reason?: "completed" | "completed_unverified" | "max_repairs" | "max_iterations" | "rejected_scope_expansion" | "context_budget_overflow";
  /** Unique run identifier for diagnostic correlation. */
  runId?: string;
  /**
   * Diagnostic data for an irreducible context-budget overflow (C2 #18).
   * In-process only — consumers must read the typed readonly fields and must
   * NOT depend on Error methods, stack traces, or instanceof. This field is
   * intentionally NOT a serializable wire contract.
   */
  contextBudgetOverflow?: ContextBudgetOverflowError;
};
```

- [ ] **Step 3: Add the reason to `FAILURE_REASONS`**

In `src/agent/system-prompt.ts`, add the literal inside the set (after `"rejected_scope_expansion",`):

```ts
export const FAILURE_REASONS = new Set<string>([
  "max_iterations",
  "max_repairs",
  "rejected_scope_expansion",
  "context_budget_overflow",
]);
```

- [ ] **Step 4: Verify the type surface compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors in `src/run.ts` or `src/agent/system-prompt.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/run.ts src/agent/system-prompt.ts
git commit -m "C2 #18: add context_budget_overflow reason + payload to RunResult

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `runTaskLoop` catches irreducible overflow and returns a graceful `RunResult` (RED → GREEN)

**Files:**
- Modify: `tests/run/task-loop-context-budget.vitest.ts:435-467` (test 1, rename + rewrite)
- Modify: `tests/run/task-loop-context-budget.vitest.ts:659-692` (test 2, rewrite)
- Modify: `src/run/task-loop.ts` (add helper after `completeSession` ~line 79; add `catch` clause to the outer `try` ~line 1268)
- Test: `tests/run/task-loop-context-budget.vitest.ts`

**Interfaces:**
- Consumes: `RunResult` union + `contextBudgetOverflow` field from Task 1.
- Produces: `runTaskLoop` now returns `RunResult` with `reason: "context_budget_overflow"` + `contextBudgetOverflow` when irreducible; still throws for reducible and all other errors. Local helper `buildContextBudgetOverflowSummary(err): string` (module-private).

- [ ] **Step 0: GitNexus impact + verify the error definition (before ANY edit)**

Run `impact({target: "runTaskLoop", direction: "upstream"})` (GitNexus MCP, repo ALiX). Report the blast radius (direct callers, affected processes, risk level) to the user. If risk is HIGH/CRITICAL, STOP and surface it. Then confirm the five pre-verified facts against the code (all already confirmed during planning — spot-check, don't re-derive):

1. `ContextBudgetOverflowError` carries a discriminating literal `readonly kind = "context_budget_overflow" as const` — confirmed at `src/config/context-budget.ts:207`.
2. `reducible` is reliably present on every thrown instance — confirmed: both throw sites construct `new ContextBudgetOverflowError({...})` with `reducible` set (`context-assembly.ts:153`, `task-loop.ts:518`), and the inner catch re-throws the same instance (`task-loop.ts:453-468`).
3. `overageTokens`, `availableInputTokens`, `mandatoryTokens` are readonly on the class — confirmed (`context-budget.ts:209-213`).
4. `session.ended` is the correct terminal event — confirmed: every other terminal reason return in `runTaskLoop` appends `session.ended` (max_repairs line 839, max_iterations 1267, rejected_scope_expansion 920).
5. There is no existing overflow-summary helper — confirmed via grep; `buildContextBudgetOverflowSummary` is new.

- [ ] **Step 1: Rewrite test 1 to expect the graceful return (RED)**

Replace the entire `it('throws ContextBudgetOverflowError for irreducible mandatory overflow', ...)` block (currently lines 435-467) with:

```ts
  it('returns context_budget_overflow RunResult for irreducible mandatory overflow', async () => {
    const mockProvider = createMockProvider({ responseText: 'done.' });
    // Extremely small budget: 200 window, 100 reserved, 100 available
    // Even the mandatory core (system prompt + task) won't fit in 100 tokens.
    const budget = createContextBudget(
      { contextWindowTokens: 200 },
      { outputFloor: 100, outputCap: 100, outputRatio: 0.5 },
    );
    const { deps } = await makeTestDeps({
      provider: mockProvider,
      contextBudget: budget,
      messages: [{ role: 'user', content: longText(200) }], // ~200 tokens > 100 available
      systemPrompt: 'You are an assistant. ' + longText(50), // ~50 tokens
      maxIterations: 1,
    });

    // C2 #18: irreducible overflow is a graceful RunResult failure, not a throw.
    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow).toBeDefined();
    expect(result.contextBudgetOverflow?.reducible).toBe(false);
    expect(result.contextBudgetOverflow?.kind).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow?.overageTokens).toBeGreaterThan(0);
    expect(result.contextBudgetOverflow?.availableInputTokens).toBeGreaterThan(0);
    expect(result.contextBudgetOverflow?.mandatoryTokens).toBeGreaterThan(0);
    // Summary is a human-readable diagnostic, not a raw error string.
    expect(result.summary).toContain('more input tokens');

    // Money invariant: provider was NEVER called
    expect(mockProvider.requests.length).toBe(0);
  });
```

- [ ] **Step 2: Rewrite test 2 to expect the graceful return (still RED)**

Replace the entire `it('throws irreducible when mandatory core plus tool schema exceeds available', ...)` block (currently lines 659-692) with:

```ts
  it('returns context_budget_overflow when mandatory core plus tool schema exceeds available', async () => {
    // R3 discriminating: mandatory+tools > available. 1 tool (sys=194, tools=62).
    // longText(200) msg=247. Round-2 mand=441, Round-3 mand=503.
    // available=470: Round-2 fits (441≤470), Round-3 irreducible (503>470).
    const mockProvider = createMockProvider({ responseText: 'done.', usage: { inputTokens: 100, outputTokens: 50 } });
    await ensureEncoder('cl100k_base');

    const budget = createContextBudget(
      { contextWindowTokens: 570 },
      { outputFloor: 100, outputCap: 100, outputRatio: 0.18 },
    );

    const messages: NormalizedMessage[] = [
      { role: 'user', content: longText(200) },  // ~247 padded
    ];

    const { deps } = await makeTestDeps({
      provider: mockProvider, contextBudget: budget, messages,
      systemPrompt: 'Helpful. ', maxIterations: 1,
      providerTools: makeProviderTools(1),
    });

    // C2 #18: graceful RunResult failure, not a throw.
    const result = await runTaskLoop(deps);

    expect(result.reason).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow?.reducible).toBe(false);
    expect(result.contextBudgetOverflow?.kind).toBe('context_budget_overflow');
    expect(result.contextBudgetOverflow?.overageTokens).toBeGreaterThan(0);
    // Money invariant: provider was NEVER called (irreducible → no request sent).
    expect(mockProvider.requests.length).toBe(0);
  });
```

- [ ] **Step 3: Run the two tests to confirm they fail (RED)**

Run: `node_modules/.bin/vitest run tests/run/task-loop-context-budget.vitest.ts --config vitest.config.mts`
Expected: the two rewritten tests FAIL — `runTaskLoop` still throws `ContextBudgetOverflowError`, so the `await runTaskLoop(deps)` call rejects and the test errors out. The other tests in the file still PASS.

- [ ] **Step 4: Add the overflow guard + summary helper to `src/run/task-loop.ts`**

Insert after the `completeSession` function (ends ~line 79). Both are module-private. The guard follows the codebase's established `isX(value: unknown): value is X` pattern (e.g. `isCredentialReference` in `src/security/credentials/credential-reference.ts:38`) and discriminates on the class's `kind` literal — no `instanceof`, per the guardrail:

```ts
/**
 * True when `err` is an IRREDUCIBLE context-budget overflow. Discriminates
 * on the class's `kind` literal rather than `instanceof`, so no consumer
 * coupling to the error class leaks past the producer boundary (guardrail:
 * `contextBudgetOverflow` is diagnostic data; consumers use typed fields
 * only). Reducible overflows (kind matches but reducible === true) return
 * false — they are programming/validation failures that still throw.
 */
function isIrreducibleContextBudgetOverflow(err: unknown): err is ContextBudgetOverflowError {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    (err as { kind?: unknown }).kind === "context_budget_overflow" &&
    "reducible" in err &&
    (err as { reducible?: unknown }).reducible === false
  );
}

/**
 * Human-readable summary for an irreducible context-budget overflow.
 * Used as the RunResult.summary so every surface (CLI, REPL, TUI, daemon,
 * route-executor) degrades to a meaningful diagnostic instead of a raw
 * error string.
 */
function buildContextBudgetOverflowSummary(err: ContextBudgetOverflowError): string {
  return `Context budget overflow: needs ${err.overageTokens} more input tokens ` +
    `(${err.availableInputTokens} available, mandatory core ${err.mandatoryTokens})`;
}
```

- [ ] **Step 5: Add the `catch` clause to `runTaskLoop`**

The outer `try` (starts line 299) currently ends with a bare `} finally {` (~line 1268) that only cleans up `EnhancedVerifier`. Insert a `catch` between the `try` body and the `finally`. Replace:

```ts
  } finally {
// Cleanup EnhancedVerifier
```

with:

```ts
  } catch (err) {
    // C2 #18: irreducible context-budget overflow is a graceful RunResult
    // failure, not a throw. Returning here preserves the structured fields —
    // a re-throw through runTaskCore/processTurn would flatten them via
    // String(err). The kind-literal guard (not instanceof) matches ONLY
    // reducible === false; reducible overflows (programming/validation
    // failures) and all other errors fall through to `throw err`.
    if (isIrreducibleContextBudgetOverflow(err)) {
      const summary = buildContextBudgetOverflowSummary(err);
      await log.append({
        ...session, actor: "system", type: "session.ended",
        payload: { reason: "context_budget_overflow", summary },
      });
      return {
        sessionId,
        summary,
        streamed: config.model.streaming,
        reason: "context_budget_overflow" as const,
        contextBudgetOverflow: err,
      };
    }
    throw err;
  } finally {
// Cleanup EnhancedVerifier
```

Keep the existing `finally` body (the `EnhancedVerifier` cleanup) unchanged — it runs on both the catch and the return paths. Note: `streamed: config.model.streaming` is intentionally consistent with every other return site — do NOT change it (see Global Constraints).

- [ ] **Step 6: Run the test file to confirm GREEN**

Run: `node_modules/.bin/vitest run tests/run/task-loop-context-budget.vitest.ts --config vitest.config.mts`
Expected: ALL tests in the file PASS, including the two rewritten return-assertion tests and the three existing sentinel tests (lines ~584, 640, 852) that still assert reducible scenarios do not produce a `context_budget_overflow` result.

- [ ] **Step 7: Verify the broader type surface**

Run: `npx tsc --noEmit`
Expected: PASS. (`completeSession` casts `reason as RunResult["reason"]` — the extended union accepts the new member; all reason consumers are `===` checks or `FAILURE_REASONS.has()`, no exhaustive switch.)

- [ ] **Step 8: Commit**

```bash
git add src/run/task-loop.ts tests/run/task-loop-context-budget.vitest.ts
git commit -m "C2 #18: runTaskLoop returns graceful RunResult on irreducible overflow

Catch ContextBudgetOverflowError (reducible === false) inside runTaskLoop
and return reason 'context_budget_overflow' with the structured payload
instead of re-throwing. Two runTaskLoop-level tests updated from throw
assertions to return assertions; reducible cases still throw.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Thread the payload through `AgentTurnResult` and render the CLI diagnostic

**Files:**
- Modify: `src/agent/session.ts:127` (import), `src/agent/session.ts:194-215` (`AgentTurnResult` interface), `src/agent/session.ts:1443-1453` (processTurn return)
- Modify: `src/cli/commands/run.ts:141-143` (add branch after the `rejected_scope_expansion` check)

**Interfaces:**
- Consumes: `RunResult.contextBudgetOverflow` from Task 1/2.
- Produces: `AgentTurnResult.contextBudgetOverflow?: ContextBudgetOverflowError` (the CLI + TUI read `AgentTurnResult`, not `RunResult`); CLI renders the friendly diagnostic and returns generic exit `1`.

- [ ] **Step 0: GitNexus impact (before ANY edit)**

Run `impact({target: "processTurn", direction: "upstream"})`, `impact({target: "AgentTurnResult", direction: "upstream"})`, and `impact({target: "handler", file_path: "src/cli/commands/run.ts", direction: "upstream"})` (GitNexus MCP, repo ALiX). Report the blast radius to the user. If risk is HIGH/CRITICAL, STOP and surface it before editing.

- [ ] **Step 1: Extend the import in `src/agent/session.ts`**

`session.ts` already imports from `context-budget.js` at line 127. Add the type to that same line:

```ts
import { createContextBudget, type ContextBudget, type ContextBudgetConfig, type ContextBudgetOverflowError } from "../config/context-budget.js";
```

- [ ] **Step 2: Add the field to `AgentTurnResult`**

In the `AgentTurnResult` interface (lines 194-215), immediately after `readonly reason?: string;`:

```ts
  /**
   * Diagnostic payload for an irreducible context-budget overflow (C2 #18).
   * In-process only — consumers must use the typed readonly fields, never
   * Error methods/stack/instanceof. Omitted on any other outcome.
   */
  readonly contextBudgetOverflow?: ContextBudgetOverflowError;
```

- [ ] **Step 3: Pass the payload through the processTurn return**

At the `processTurn` return (lines 1443-1453), add a conditional spread. Replace:

```ts
      return {
        summary: result.summary,
        sessionId: ctx.sessionId,
        toolCalls: turnToolCalls,
        streamed: result.streamed,
        reason: result.reason,
        ...(approvedPlanContent !== undefined
          ? { planContent: approvedPlanContent }
          : {}),
```

with:

```ts
      return {
        summary: result.summary,
        sessionId: ctx.sessionId,
        toolCalls: turnToolCalls,
        streamed: result.streamed,
        reason: result.reason,
        ...(result.contextBudgetOverflow
          ? { contextBudgetOverflow: result.contextBudgetOverflow }
          : {}),
        ...(approvedPlanContent !== undefined
          ? { planContent: approvedPlanContent }
          : {}),
```

- [ ] **Step 4: Add the CLI diagnostic branch**

In `src/cli/commands/run.ts`, immediately after the `rejected_scope_expansion` branch (line 141-143) and before the `try`'s `catch` (line 144), insert:

```ts
    if (result?.reason === "context_budget_overflow" && result.contextBudgetOverflow) {
      const cbo = result.contextBudgetOverflow;
      console.error(
        `\n⚠️  Context budget overflow — the mandatory context core cannot fit.` +
        `\n    Needs ${cbo.overageTokens} more input tokens (${cbo.availableInputTokens} available, core is ${cbo.mandatoryTokens}).` +
        `\n\nFix: raise context.budget, or shrink mandatory context components.`
      );
      return 1;
    }
```

The generic exit `1` matches the spec (no new `EXIT_CODES` constant).

- [ ] **Step 5: Verify compile + build**

Run: `npx tsc --noEmit`
Expected: PASS.
Then run: `pnpm build`
Expected: PASS (dist artifacts rebuilt).

- [ ] **Step 6: Regression-run the task-loop test file**

Run: `node_modules/.bin/vitest run tests/run/task-loop-context-budget.vitest.ts --config vitest.config.mts`
Expected: PASS (unchanged from Task 2 — proves the session/CLI edits didn't disturb the loop).

- [ ] **Step 7: Commit**

```bash
git add src/agent/session.ts src/cli/commands/run.ts
git commit -m "C2 #18: surface overflow payload through AgentTurnResult + CLI diagnostic

The CLI reads AgentTurnResult, not RunResult, so processTurn now threads
contextBudgetOverflow through. alix run renders the friendly token-count
diagnostic with Fix advice and returns generic exit 1.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Daemon serializes the overflow numbers into `task.failed`

**Files:**
- Modify: `src/daemon/daemon-server.ts:557-563` (the non-completed failure branch)

**Interfaces:**
- Consumes: `RunResult.contextBudgetOverflow` (flowed untouched through `runTaskCore` → `runTask` → daemon; verified `runTask` returns `result` as-is).
- Produces: `task.failed` error string that carries the numbers when the reason is `context_budget_overflow`. No crash — the overflow never reaches the daemon's uncaught throw path.

- [ ] **Step 0: GitNexus impact (before ANY edit)**

Run `impact({target: "handleRun", direction: "upstream"})` (GitNexus MCP, repo ALiX). The failure branch is inside `handleRun` (daemon-server.ts:451). Report the blast radius to the user. If risk is HIGH/CRITICAL, STOP and surface it before editing.

- [ ] **Step 1: Serialize the fields in the failure branch**

In `src/daemon/daemon-server.ts`, replace the final failure branch (currently lines 560-563):

```ts
    } else {
      registry.update(taskId, { status: "failed", error: result.reason });
      client.write(JSON.stringify({ type: "task.failed", sessionId, error: result.reason } satisfies DaemonResponse) + "\n");
    }
```

with:

```ts
    } else {
      let error = result.reason;
      if (result.reason === "context_budget_overflow" && result.contextBudgetOverflow) {
        const cbo = result.contextBudgetOverflow;
        error = `context_budget_overflow: needs ${cbo.overageTokens} more tokens (avail ${cbo.availableInputTokens}, core ${cbo.mandatoryTokens})`;
      }
      registry.update(taskId, { status: "failed", error });
      client.write(JSON.stringify({ type: "task.failed", sessionId, error } satisfies DaemonResponse) + "\n");
    }
```

This serializes the **fields** as a string — never the `Error` instance — honoring the guardrail.

- [ ] **Step 2: Verify compile + build**

Run: `npx tsc --noEmit`
Expected: PASS.
Then run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Regression-run the daemon + task-loop suites**

Run: `node_modules/.bin/vitest run tests/daemon/daemon-server.test.ts tests/daemon/daemon-protocol.test.ts tests/run/task-loop-context-budget.vitest.ts --config vitest.config.mts`
Expected: PASS (daemon behavior for non-overflow runs is unchanged; the `task.failed` branch only diverges when the new reason is present, which the daemon test harness cannot trigger — overflow fires before any provider call).

- [ ] **Step 4: Commit**

```bash
git add src/daemon/daemon-server.ts
git commit -m "C2 #18: daemon serializes overflow numbers into task.failed error

When the run failed with context_budget_overflow, the daemon's task.failed
record now carries the token counts instead of only the reason string.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Full suite + push gate

**Files:**
- None (verification + branch push).

- [ ] **Step 1: Build first**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 2: Full vitest suite**

Run: `pnpm test:vitest`
Expected: PASS. If failures appear, confirm they are not in `tests/run/task-loop-context-budget.vitest.ts` or the touched files.

- [ ] **Step 3: Node test lane**

Run: `pnpm test:node`
Expected: **10 pre-existing leaf failures** (9× `streamSSE` + 1× `agent-view`) — byte-identical to fork base `e5396602`. Do NOT attribute them to this branch. Any NEW failure is a real regression — stop and investigate.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: GitNexus detect_changes gate**

Run `detect_changes({scope: "compare", base_ref: "main"})` (GitNexus MCP, repo ALiX). Confirm the affected symbols are limited to: `runTaskLoop`, `runTaskCore` (via reason handling), `processTurn`, `RunResult`, `FAILURE_REASONS`, the CLI run handler, the daemon agent-route handler, and the two tests. No unrelated execution flows.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin c2-18-graceful-irreducible
```
