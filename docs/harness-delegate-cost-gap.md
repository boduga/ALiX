# FINDING — delegate-driver cost: reachable, unproven (corrects an earlier claim)

**Status:** OPEN — reachable but **not yet measured**.
**Recorded:** 2026-10-20. Supersedes the pessimism in the first version of this file.
**Affects:** strata 4, 5, 7, 10 (all `delegate`-driver cases)

---

## 1. Correction first

An earlier revision of this note claimed delegate usage was **unreachable** because
the child wrote to "its own session, outside the captured directory". **That was
wrong and was never verified before being written down.**

A free probe (scripted provider, persistent cwd) shows the opposite:

```
session dirs under case cwd: [ 'eval:probe' ]
  eval:probe: 10 events, 0 model.usage
```

The child's session directory **is inside the case cwd**
(`<cwd>/.alix/sessions/eval:<caseId>`), because `SubagentManager.spawn` passes
`cwd: task.cwd` and the delegate driver sets `task.cwd = cwd`. `captureEvalUsage`
scans every session directory under that root, so it would read the child's log.

`0 model.usage` above is the **scripted provider**, which emits no usage at all.
It says nothing about a real provider.

## 2. What is actually still open

| Question | State |
|---|---|
| Is the child's session log inside the captured cwd? | **Yes** — verified |
| Does the child emit `model.usage` for a real provider? | **Unverified** |
| Does the child's usage carry a `runId`? | **Unverified** — the child may have no authoritative run identity to attach |
| Does `captureEvalUsage` see it before cleanup? | Structurally yes; unverified end-to-end |

The open risk is now narrow and specific: **`runId` attribution on the child
path.** `model.usage` is emitted with `...(runId ? { runId } : {})` from
`deps.context.runId`; a child subagent may have no runId, in which case usage is
captured but **unattributable** — the F1-A class of gap.

## 3. How to settle it for free-ish

One delegate case on a priced model (`gpt-4o`, ~$0.03) answers all three open
rows at once. The probe above already shows the plumbing works; only the
real-provider emission is unknown.

**Do not run all four delegate strata first.** Run one, inspect whether
`execution.usage.records[].runId` is present, and only then decide whether the
cost is attributable or needs an identity fix.

## 4. What is NOT done

- No production change for this finding.
- No priced delegate run yet.
- The gap doc's original "unattributable" conclusion is retracted above rather
  than left standing.

## 5. Gate B effect

Measured cost stands at **3/10** (strata 1, 2, 3 — all main-loop or direct run).
Delegate strata are **plausibly measurable at ~$0.03 each**, which would take
coverage to 7/10. That is a small, bounded spend rather than a code project — a
materially better position than the first version of this note implied.
