# FINDING — the subagent loop never records model usage

**Status:** FIXED for emission (`75af1361`); the "plain delegate skips review" half remains OPEN and is Low severity. See §4.
**Recorded:** 2026-10-20. Replaces two earlier, wrong versions of this note.
**Affects:** every `delegate`/subagent run — benchmark strata 4, 5, 7, 10 **and** production coordination workers.

---

## 1. The finding

`src/agents/subagent-cli.ts` calls `provider.complete(...)` and consumes
`resp.text` / `resp.toolCalls`. It **never reads `resp.usage`** and never appends a
`model.usage` event.

Verified with a persistent-cwd probe against real `gpt-4o`:

```
session dirs: [ 'eval:probe2' ]
  eval:probe2: {
    "subagent.started":1, "tool.requested":1, "tool.started":1,
    "observability.metric":1, "runtime.phase.started":1, "file.created":1,
    "runtime.phase.completed":1, "tool.output":1, "tool.completed":1,
    "subagent.completed":1
  }
```

Ten events, **zero `model.usage`** — on a real billable gpt-4o call.

`grep model.usage src/agents/subagent-cli.ts src/agents/subagent-manager.ts` →
no matches in either file.

## 2. Why this matters beyond benchmarks

This is **not** an eval-harness problem. Every subagent turn in production —
coordination workers, delegated chat workers — spends tokens that never appear in
the event log. Consequences:

- A coordination run's cost is **unmeasurable** even though every worker called a
  real model and was billed.
- `cost-attribution` cannot see worker spend at all.
- Any per-run or per-session cost figure silently excludes delegated work, which
  is exactly the work most likely to be expensive (parallel workers).

That is a **silent undercount**, the failure mode the whole audit has been
guarding against: not a wrong number, but a missing one presented as if complete.

## 3. Two earlier wrong claims in this file

Recorded so the error is not repeated:

1. *"Child writes to its own session outside the captured directory"* — **wrong**;
   the child's session IS inside the case cwd (`eval:<caseId>`).
2. *"Reachable, just needs one priced probe"* — **wrong**; the probe showed the
   usage event is never emitted at all, so there is nothing to capture.

Both were written before being verified. The probe that settled it was cheap; it
should have come first.

## 4. The fix — LANDED for emission; review asymmetry still open

`subagent-cli.ts` must emit `model.usage` from `resp.usage` on every completion,
carrying the child's run identity when it has one. The shape already exists and is
proven in `task-loop/main.ts:965` — the child loop simply never adopted it.

Open sub-question: the child has no `deps.context.runId`. Attribution would need
either the parent's run id passed down or a per-worker identity. That is the same
question F1-A answered for the main loop, and it must be answered before the
emitted usage is joinable.

**Landed.** `subagent-cli.ts` now emits `model.usage` on every completion. Do not
estimate subagent cost from main-loop rates: measure it, which is now possible.

## 5. Gate B effect

Measured cost has since moved from 3/10 to **6/10** (strata 1, 2, 3, 5, 6, 10).

Strata 4, 5, 7, 10 **cannot be measured** until the child loop emits usage. This is
a code change, not a budget line — and it is worth doing regardless of the audit,
because production subagent spend is currently invisible.
