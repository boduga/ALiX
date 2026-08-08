# C2 #18 — Graceful handling of irreducible `ContextBudgetOverflowError`

**Date:** 2026-08-07
**Status:** Approved design → spec
**Ticket:** C2 #18 (Context Budget series)

## Problem

An irreducible context-budget overflow (`ContextBudgetOverflowError` with
`reducible === false` — the mandatory context core cannot fit in the window) is
currently surfaced to the user in raw/ungraceful ways:

- `alix run` CLI → `⚠️ <msg>` + exit 1 (run.ts:155)
- REPL → `Error: ...` (repl.ts:139)
- TUI → inline `(agent error: ...)` (app.ts:811)
- **daemon + route-executor → CRASH uncaught** (daemon-server.ts:523, route-executor.ts:229)

The error is thrown at 3 sites:

- `src/config/context-assembly.ts:153` — `assembleContext`
- `src/config/context-budget.ts:254` — `assertFits` (unused in main path)
- `src/run/task-loop.ts:518` — preflight backstop

It **escapes `runTaskLoop`** (task-loop.ts:256): its main `try` (~line 299) has
only a `finally`, no `catch`. It propagates through `runTaskCore`
(agent-loop.ts:406) and `processTurn` (session.ts:1213) — both catch, emit
`task.failed { error: String(err) }` + `workflow.failed`, then **re-throw**,
which **loses the structured fields** (`String(err)` → only `err.message`
survives).

The `context.irreducible` event (full structured payload: overageTokens,
byCategory, availableInputTokens, mandatoryTokens, contextWindowTokens) **is**
already emitted before the throw and rendered by the TUI TimelineBuilder —
observability is fine; the throw→user path is the gap.

## Decision summary

| Decision | Choice |
|---|---|
| Fix locus | `runTaskLoop` catch → return instead of throw |
| Reducible overflow | **Still throws** (programming/validation failure, not runtime condition) |
| Irreducible overflow | `RunResult` failure |
| Reason | `"context_budget_overflow"`, added to `RunResult` union + `FAILURE_REASONS` |
| CLI exit | **Generic `1`** (no new `EXIT_CODES` constant) |
| Payload | `contextBudgetOverflow?: ContextBudgetOverflowError` — **full object in-process**; consumers use typed readonly fields only; never serialize the Error itself |
| Daemon | task.failed `error` carries the structured numbers as a string |
| Surfaces | All consume `RunResult`; no special catches |

## Architecture

Catch at the loop, return instead of throw.

`runTaskLoop` (task-loop.ts:256) gets a `catch` that matches an irreducible
overflow — discriminated on the class's `kind` literal
(`kind === "context_budget_overflow" && reducible === false`), **not**
`instanceof`, consistent with the guardrail below — and **returns** a failed
`RunResult` instead of re-throwing. Because the return happens inside
`runTaskLoop`, the structured error fields survive intact — no `String(err)`
flattening through the `runTaskCore`/`processTurn` re-throw chain.

- Both existing throw sites inside the loop (preflight backstop ~518; budget-gate
  re-throw 450-468) are covered by this single catch.
- Reducible errors (`reducible === true`) still throw — they are a
  programming/validation failure, not a runtime condition. Only the irreducible
  runtime case becomes a graceful reason.

## `RunResult` shape

`src/run.ts:14-21`:

```ts
export type RunResult = {
  sessionId: string;
  summary: string;
  streamed?: boolean;
  reason?:
    | "completed"
    | "completed_unverified"
    | "max_repairs"
    | "max_iterations"
    | "rejected_scope_expansion"
    | "context_budget_overflow";           // NEW
  /** Unique run identifier for diagnostic correlation. */
  runId?: string;
  /**
   * Diagnostic data for an irreducible context-budget overflow.
   * In-process only — consumers must read the typed readonly fields and must
   * NOT depend on Error methods, stack traces, or instanceof. This field is
   * intentionally NOT a serializable wire contract.
   */
  contextBudgetOverflow?: ContextBudgetOverflowError;   // NEW
};
```

Add `"context_budget_overflow"` to `FAILURE_REASONS`
(system-prompt.ts:91) so `runTaskCore` (agent-loop.ts:429) and `processTurn`
(session.ts:1308) mark the run failed via `result.reason` instead of a throw.

Do **not** introduce a shared reason-constants module — the existing inline
`RunResult` union + `FAILURE_REASONS` pattern is followed as-is; a future
reason-constants refactor can migrate all reasons together if it ever becomes
worth addressing.

### Guardrail (documented in spec)

> Treat `contextBudgetOverflow` as diagnostic data carried by the in-process
> `RunResult`; do not make consumers depend on `Error` methods, stack traces,
> or `instanceof`. Consumers should use the typed readonly fields only.
> If/when `RunResult` becomes a cross-process wire contract, introduce a plain
> serializable DTO — deferred, out of scope for this change.

## CLI behavior

Generic exit `1` (no new `EXIT_CODES` constant). Precedent at run.ts:141 maps
`rejected_scope_expansion` → 3, but that case has a stronger automation/security
boundary; context overflow doesn't need the same treatment. All execution
surfaces converge on the same `RunResult` semantics — the CLI shouldn't invent a
second classification mechanism.

```text
$ alix run ...
→ exit 1
→ machine-readable result.reason: context_budget_overflow
→ human-readable diagnostic with token counts
```

An explicit branch in `src/cli/commands/run.ts` matches `result.reason ===
"context_budget_overflow"`, renders the friendly diagnostic below from
`result.contextBudgetOverflow`, and returns generic exit `1`. Without this
branch the payload would be silently dropped on the CLI surface.

CLI graceful-error style precedent (`\n⚠️  <msg>\n    <detail>\n\nFix: <advice>`),
run.ts:146-155:

```
⚠️  Context budget overflow — the mandatory context core cannot fit.
    Needs 1,234 more input tokens (12,345 available, core is 13,579).

Fix: raise context.budget, or shrink mandatory context components.
```

Overage + available + core numbers come from the structured fields
(`overageTokens`, `availableInputTokens`, `mandatoryTokens`).

## Surfaces that consume `result.reason`

All already treat a non-completed reason as a normal failure — no crashes:

- CLI run.ts:141 — reason branch (generic fallback → exit 1)
- daemon-server.ts:557-562 — `!result.reason || === "completed"` → else marks
  task failed with `error: result.reason`
- route-executor.ts:133 — `result.reason || ""`
- TUI app.ts:794 — friendly rewrite for max_iterations/rate-limit; overflow
  renders as a normal failure
- issue-run-handler.ts, governance.ts:358

Daemon addition: when the failure reason is `context_budget_overflow`, the
task.failed `error` record includes the structured numbers serialized as a
string, e.g.:

```
context_budget_overflow: needs 1,234 more tokens (avail 12,345, core 13,579)
```

This serializes the **fields**, never the Error instance — preserving
observability through the daemon surface while honoring the guardrail.

## Error handling

| Case | Behavior |
|---|---|
| Irreducible overflow inside `runTaskLoop` | Caught → returns `RunResult` with `reason: "context_budget_overflow"` + full `contextBudgetOverflow` payload |
| Reducible overflow | Throws as today (`reducible === true`) |
| Overflow during `assembleContext` / `assertFits` unit-level use | Throws as today (unchanged) |
| All other errors | Unchanged — existing catch/re-throw paths |

## Test changes

- `tests/run/task-loop-context-budget.vitest.ts` — **two** tests assert the
  throw from `runTaskLoop` and both change:
  - line 435 `throws ContextBudgetOverflowError for irreducible mandatory
    overflow` — becomes a return assertion
    (`reason: "context_budget_overflow"` + `contextBudgetOverflow.reducible ===
    false` + structured fields).
  - line 659 `throws irreducible when mandatory core plus tool schema exceeds
    available` — same change (was missed in the first pass; it also wraps
    `runTaskLoop` and asserts the throw).
- `tests/context/context-assembly.vitest.ts`, `tests/context/context-budget.vitest.ts`
  — test `assembleContext` / `createContextBudget` / `assertFits` directly and
  **keep asserting the throw**. Unchanged.
- Lines 583-590, 639-641 use `catch (e) { if (e instanceof ... && !e.reducible)
  ... }` as a sentinel asserting reducible cases do **not** throw — stay valid;
  the "caught" path won't fire for them anyway.

## Files touched

| File | Change |
|---|---|
| `src/run/task-loop.ts` | Add `catch` for irreducible overflow → return failed `RunResult` |
| `src/run.ts` | Extend `reason` union + add `contextBudgetOverflow?` field |
| `src/agent/system-prompt.ts` | Add `"context_budget_overflow"` to `FAILURE_REASONS` |
| `src/agent/session.ts` | Pass `contextBudgetOverflow` through `AgentTurnResult` (the CLI + TUI read this type, not `RunResult`) |
| `src/cli/commands/run.ts` | Explicit branch for `context_budget_overflow` → friendly diagnostic + generic exit 1 |
| `src/daemon/daemon-server.ts` | Serialize overflow numbers into task.failed `error` string |
| `tests/run/task-loop-context-budget.vitest.ts` | Reconcile throw assertion → return assertion |

Out of scope: shared reason-constants module; serializable DTO for
`RunResult`; trimming the payload type.
