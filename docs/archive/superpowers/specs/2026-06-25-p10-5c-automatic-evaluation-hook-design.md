# P10.5c — Automatic Outcome Evaluation Hook (Design)

> **Status:** Design spec — ready for implementation plan.
> **Builds on:** P10.5a `evaluatePlanOutcome()` (unchanged) + P10.5b `OutcomeReportStore` (unchanged).
> **Risk level:** LOW — additive hook, no mutation, best-effort.

## Hard governance boundary

```
P10.5c may call evaluatePlanOutcome() automatically when a plan reaches a terminal status.
P10.5c may persist the resulting report via OutcomeReportStore.
P10.5c must not modify evaluatePlanOutcome().
P10.5c must not modify OutcomeReportStore.
P10.5c must not add evidence types.
P10.5c must not modify the plan approval gate, step runner, or proposal bridge.
P10.5c must be best-effort — never block plan completion.
```

## 1. Trigger

The hook fires when a plan transitions to a terminal status:

```
state.status === "completed"   → evaluate and save
state.status === "failed"      → evaluate and save
```

In practice, `execution-engine.ts` only transitions `running → completed` via `maybeCompletePlan()`. `failed` is defined in the type union but not currently reachable in code. The hook must cover both for forward compatibility.

## 2. Idempotency

```
terminalTimestamp = state.timestamps.completedAt ?? state.timestamps.failedAt
reportId = buildReportId(plan.id, terminalTimestamp)

if outcomeStore.load(reportId) !== null:
  skip  // already evaluated for this terminal transition
else:
  evaluate → override generatedAt → save
```

The deterministic `reportId` ensures retrying the hook does not create duplicates.

## 3. Best-effort rules

| Condition | Action |
|-----------|--------|
| `terminalTimestamp` missing | `console.warn` to stderr, skip evaluation |
| `evaluatePlanOutcome()` throws | `console.warn`, skip |
| `outcomeStore.save()` throws | `console.warn`, skip |
| `outcomeStore.load()` for idempotency check throws | `console.warn`, attempt save anyway |

Auto-evaluation never fails a plan completion. All failures are logged to stderr only — no report is created to record a missing report.

## 4. generatedAt override

The pure `evaluatePlanOutcome()` uses `new Date().toISOString()` internally for `report.generatedAt`. The automatic hook builds a **new object** with the deterministic timestamp — it does not mutate the evaluator's return value, to preserve the pure-output contract:

```
const evaluated = evaluatePlanOutcome(plan, state, baseline, current);

const report = {
  ...evaluated,
  generatedAt: terminalTimestamp,
};

outcomeStore.save(report);
```

This works because:
- `OutcomeReportStore.save()` computes the `reportId` from `report.generatedAt`, so the saved file matches the idempotency key
- The override happens **only** in the automatic path
- The CLI `evaluate` flow keeps `new Date()` for fresh timestamps
- The hook constructs a new report object and **never mutates** the object returned by `evaluatePlanOutcome()`. The evaluator's return value is treated as immutable.

## 5. Shared report-ID helper

To prevent drift between the idempotency check and the filename, the `buildReportId` logic is exposed from a shared module rather than duplicated. The hook imports it directly so the storage class is not a dependency of the hook:

```
import { buildOutcomeReportId } from "./outcome-report-id.js";

const reportId = buildOutcomeReportId(plan.id, terminalTimestamp);
const existing = outcomeStore.load(reportId);
```

`OutcomeReportStore.save()` calls the same `buildOutcomeReportId()` internally. This guarantees the idempotency key and the saved filename are always computed identically, and the helper is independently unit-testable.

## 6. Best-effort rules (with forensic preservation)

| Condition | Action |
|-----------|--------|
| `terminalTimestamp` missing | `console.warn` to stderr, skip evaluation |
| `evaluatePlanOutcome()` throws | `console.warn`, skip |
| `outcomeStore.save()` throws | `console.warn`, skip |
| `outcomeStore.load()` returns `null` (no existing report) | evaluate and save |
| `outcomeStore.load()` returns a valid report (already evaluated) | skip — idempotent |
| `outcomeStore.load()` throws an **integrity error** (hash mismatch / invalid schema / malformed JSON) | `console.warn`, **skip — do not overwrite** |
| `outcomeStore.load()` throws an **unexpected runtime error** (permission, I/O, etc.) | `console.warn`, follow the generic best-effort path |

The integrity-error path is the forensic-preservation rule: a corrupted audit artifact is never overwritten by an automatic evaluation. Unexpected runtime errors (permissions, I/O failures) follow the same generic best-effort skip-and-warn path as evaluator failures — they cannot block plan completion.

The integrity-error distinction is implemented via a typed error subclass — the normative approach:

```
// in outcome-store.ts
export class OutcomeReportIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutcomeReportIntegrityError";
  }
}
```

`OutcomeReportStore.load()` throws `OutcomeReportIntegrityError` for:
- contentHash mismatch
- invalid JSON / malformed wrapper
- schema version mismatch

The hook checks with `err instanceof OutcomeReportIntegrityError`. Runtime errors (permission, I/O) are untyped `Error` and follow the generic best-effort path.

## 7. Persistence ordering

The hook fires **after** the durable completion, not before:

```
persist completed state  (stateStore.update)
record completion evidence (recordExecutivePlanCompleted)
await hook.run(plan, state)   // awaited, wrapped in try/catch
```

The hook is awaited inside `maybeCompletePlan()` so the evaluation is **attempted before the engine returns to the caller**. Failures are swallowed (warn + return) — they never prevent the plan from completing. The engine returns the same result regardless of hook success or failure.

> The engine waits for the hook attempt to finish, but not for it to succeed.

Never evaluate before the completion has been durably committed. Otherwise the hook could fire on a state that wasn't actually persisted.

## 8. Architectural decisions

### 8a. No new evidence types

The existing `executive_plan_completed` evidence event is unchanged. Auto-evaluation does not emit additional evidence. The persisted report file is itself the audit trail.

### 8b. The hook lives in `maybeCompletePlan()`

This is the single place where `running → completed` is set. The hook fires immediately after the state transition + the existing `recordExecutivePlanCompleted()` evidence call. Best-effort wrapping in a `try { ... } catch { console.warn(...) }`.

### 8c. CLI / sentinel impact

- `execution-engine.ts` is in the executive purity sentinel allowlist — adding new function calls is fine.
- The new helper module lives at `src/executive/automatic-outcome-hook.ts` and is added to the executive sentinel allowlist. Its only mutation is `OutcomeReportStore.save()`, mirroring the same scoped-exception pattern used for `OutcomeReportStore`.

### 8d. Interface-based injection

`ExecutionEngine` accepts the hook as an `OutcomeEvaluationHook` interface (not a bare function). This leaves room for future cross-cutting concerns without changing the constructor signature:

```
interface OutcomeEvaluationHook {
  run(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
  ): Promise<void>;
}
```

The default implementation is a real `AutomaticOutcomeEvaluator` instance; tests pass in stubs. `run()` is **always** `Promise<void>` — a consistent asynchronous contract. Stub implementations in tests use `async run() {}`. The engine can `await hook.run(plan, state)` without considering synchronous implementations.

## 9. Idempotency scope

Idempotency is scoped to `(planId, terminalTimestamp)`, **not** simply `planId`.

Today, a plan transitions once to a terminal status, and the timestamp makes the reportId unique. But future recovery workflows could allow:

```
running → failed → completed
```

That is **two distinct terminal transitions** with different timestamps. Each should produce its own report. The current implementation handles this correctly because the reportId encodes the timestamp — and the spec rule above makes this explicit so future implementers don't tighten idempotency to `planId` alone.

**Replay contract**: replaying the same persisted terminal state (e.g. restoring from backup, re-running the engine against a historical plan) **must never create additional outcome reports**. The idempotency check on `(planId, terminalTimestamp)` enforces this — if the report already exists, the hook is a no-op.

> **Invariant:** A persisted terminal transition may be replayed indefinitely without producing additional outcome reports.

## 10. Files changed

| Action | Path | Notes |
|--------|------|-------|
| **Create** | `src/executive/outcome-report-id.ts` | Standalone `buildOutcomeReportId(planId, generatedAt)` helper |
| **Modify** | `src/executive/outcome-store.ts` | Import `buildOutcomeReportId`; the store uses it for filename generation; add `OutcomeReportIntegrityError` class; throw it on hash mismatch / invalid schema / malformed JSON |
| **Create** | `src/executive/automatic-outcome-hook.ts` | `AutomaticOutcomeEvaluator` class implementing `OutcomeEvaluationHook` |
| **Modify** | `src/executive/execution-engine.ts` | Wire hook into `maybeCompletePlan()` + accept `OutcomeEvaluationHook` constructor injection |
| **Modify** | `tests/executive/executive-sentinels.vitest.ts` | Add `automatic-outcome-hook.ts` to allowlist |
| **Create** | `tests/executive/outcome-report-id.vitest.ts` | Unit tests for the helper |
| **Create** | `tests/executive/automatic-outcome-hook.vitest.ts` | Unit tests for the hook |
| **Modify** | `tests/executive/execution-engine-apply-dispatch.vitest.ts` (or equivalent) | Add auto-evaluation integration tests |

## 11. Files NOT modified

- `src/executive/outcome-evaluator.ts` — unchanged. Pure function stays pure.
- `src/cli/commands/executive-evaluate-handler.ts` — manual CLI flow unchanged.
- No new evidence types.
- No protected type files (ADR-0004).

## 12. Tests

### Unit tests for `automatic-outcome-hook.ts`

- Triggers `evaluatePlanOutcome()` when status is `completed`
- Triggers when status is `failed`
- Skips when `terminalTimestamp` is missing (with warn)
- Skips when `outcomeStore.load(reportId) !== null` (idempotent)
- Builds a new report object — does not mutate the evaluator's return value
- Override `generatedAt` to `terminalTimestamp`
- Save failures don't throw — only warn
- **Corruption path**: existing report file fails hash verification → warning emitted → **no save attempted**
- **`completedAt` and `failedAt` both present**: `completedAt` wins (timestamp selection)

### Unit tests for `outcome-report-id.ts`

- `buildOutcomeReportId("plan-1", "2026-06-25T12:00:00.000Z")` produces `outcome-plan-1-20260625T120000000Z`
- The filename produced matches `OutcomeReportStore.save()` behavior

### Integration tests for `ExecutionEngine`

- Plan transition to `completed` triggers hook exactly once
- Repeated transitions (replay) skip on second call
- Hook failure does not block the plan from completing (returns `recordExecutivePlanCompleted` evidence normally)
- Plan transition order: persist completed state → record completion evidence → run automatic outcome hook
- Replay against persisted terminal state creates no additional outcome reports
- **Integrity-error path (integration)**: pre-existing report file with contentHash mismatch → `OutcomeReportStore.load()` throws `OutcomeReportIntegrityError` → hook warns to stderr → save is **NOT** called → original corrupted file remains untouched → plan completes normally

The integrity-error integration test is the most important forensic invariant in the entire design. It must verify that a corrupted audit artifact on disk is never silently overwritten by an automatic evaluation.

## 13. Architectural invariants

- The hook is **best-effort** — it never throws upward.
- The hook is **idempotent** scoped to `(planId, terminalTimestamp)`.
- The hook **never overwrites corrupted audit artifacts** — corruption warnings to stderr, no save.
- The pure evaluator is untouched — its return value is never aliased or mutated.
- `OutcomeReportStore` is the single source of truth for persisted reports — no duplicate indexes or caches.
- Idempotency key and filename generation share one helper.
- No mutation beyond `OutcomeReportStore.save()`. No evidence. No new scoring. No approval changes.
- Auto-evaluation fires **after** the completion is durably committed.