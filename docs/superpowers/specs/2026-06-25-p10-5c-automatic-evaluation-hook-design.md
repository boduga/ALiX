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

The pure `evaluatePlanOutcome()` uses `new Date().toISOString()` internally for `report.generatedAt`. The automatic hook overrides this after evaluation so the saved report has a deterministic timestamp:

```
const report = evaluatePlanOutcome(plan, state, baseline, current);
report.generatedAt = terminalTimestamp;
outcomeStore.save(report);
```

This works because:
- `OutcomeReportStore.save()` computes the `reportId` from `report.generatedAt`, so the saved file matches the idempotency key
- The override happens **only** in the automatic path
- The CLI `evaluate` flow keeps `new Date()` for fresh timestamps

## 5. Architectural decisions

### 5a. No new evidence types

The existing `executive_plan_completed` evidence event is unchanged. Auto-evaluation does not emit additional evidence. The persisted report file is itself the audit trail.

### 5b. The hook lives in `maybeCompletePlan()`

This is the single place where `running → completed` is set. The hook fires immediately after the state transition + the existing `recordExecutivePlanCompleted()` evidence call. Best-effort wrapping in a `try { ... } catch { console.warn(...) }`.

### 5c. CLI / sentinel impact

- `execution-engine.ts` is in the executive purity sentinel allowlist — adding new function calls is fine.
- The new helper module is **not** an executive layer file. It is a coordinator between `ExecutionEngine` and `OutcomeReportStore`. It can live at `src/executive/automatic-outcome-hook.ts` (already-pure-of-mutation beyond `OutcomeReportStore.save()`).

### 5d. Constructor injection

`ExecutionEngine` should accept the new hook function as an optional constructor parameter so tests can stub it without writing real outcome files. Default: a real implementation. This avoids polluting tests with side-effect files.

## 6. Files changed

| Action | Path | Notes |
|--------|------|-------|
| **Create** | `src/executive/automatic-outcome-hook.ts` | Pure helper `runAutomaticOutcomeEvaluation()` |
| **Modify** | `src/executive/execution-engine.ts` | Wire hook into `maybeCompletePlan()` + accept constructor injection |
| **Modify** | `tests/executive/execution-engine-apply-dispatch.vitest.ts` (or equivalent) | Add auto-evaluation integration tests |
| **Create** | `tests/executive/automatic-outcome-hook.vitest.ts` | Unit tests for the helper |

## 7. Files NOT modified

- `src/executive/outcome-evaluator.ts` — unchanged. Pure function stays pure.
- `src/executive/outcome-store.ts` — unchanged.
- `src/cli/commands/executive-evaluate-handler.ts` — manual CLI flow unchanged.
- No new evidence types.
- No protected type files (ADR-0004).

## 8. Tests

### Unit tests for `automatic-outcome-hook.ts`

- Triggers `evaluatePlanOutcome()` when status is `completed`
- Triggers when status is `failed`
- Skips when `terminalTimestamp` is missing (with warn)
- Skips when `outcomeStore.load(reportId) !== null` (idempotent)
- Override `generatedAt` to `terminalTimestamp`
- Save failures don't throw — only warn

### Integration tests for `ExecutionEngine`

- Plan transition to `completed` triggers hook exactly once
- Repeated transitions (replay) skip on second call
- Hook failure does not block the plan from completing (returns `recordExecutivePlanCompleted` evidence normally)

## 9. Architectural invariants

- The hook is **best-effort** — it never throws upward.
- The hook is **idempotent** — repeat invocations for the same `terminalTimestamp` produce the same outcome.
- The pure evaluator is untouched — `evaluatePlanOutcome()` retains its `new Date()` `generatedAt` for manual use; only the automatic path overrides it.
- `OutcomeReportStore` is the single source of truth for persisted reports — no duplicate indexes or caches.
- No mutation beyond `OutcomeReportStore.save()`. No evidence. No new scoring. No approval changes.