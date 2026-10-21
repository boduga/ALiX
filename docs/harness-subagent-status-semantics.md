# FINDING — subagent status certifies ownership, not achievement; the reviewed path is not the subagent path

**Status:** OPEN — real asymmetry on the **DEFAULT** path.
**Recorded:** 2026-10-20 (severity corrected upward the same day)
**Severity:** **High** — `subagents.enabled` defaults to `true`.

> **Correction.** An earlier revision of this note said the unreviewed path was
> opt-in because `isSubagentsEnabled` returns `config?.subagents?.enabled ?? false`.
> That reads the *fallback*, not the shipped default. `DEFAULT_CONFIG.subagents.enabled`
> is **`true`** (`defaults.ts:108`, verified at runtime), and the loader fills the
> default before `isSubagentsEnabled` sees it. **The unreviewed path is the
> default path**, not an opt-in one. The earlier Medium rating was wrong.

---

## 1. The mechanism, reproduced

`computeSubagentStatus` is an **ownership** contract. Verified directly:

```
ownedPaths=["."], wrote some-other-file.txt (NOT the objective):
  status = success
ownedPaths=["report.md"], same write:
  status = partial
```

With `ownedPaths: ["."]` — the delegate driver's default — a worker writing *any*
file reports `success` even when the objective file is untouched.

This is **documented and intentional**, not a defect in the function:
`evals-types.ts` states the default means *"any in-cwd change counts as covering
ownership."* Matrix-G answers *"did the worker stay inside and deliver to its
scope?"*, which is a legitimate question.

## 2. Where it becomes a false-success risk

The status is an ownership verdict, but downstream consumers read it as a **task
verdict**. The two coordination executors differ here:

| Executor | Independent review before accepting success | Used when |
|---|---|---|
| `worker-executor.ts` (in-process) | **Yes** — `reviewDefaultWorkerResult` (`worker-executor.ts:166`) | `subagents.enabled` is false |
| `subagent-worker-executor.ts` | **No** — `if (result.status === "success")` accepts directly (`:130`) | `subagents.enabled` is **true** |

`isSubagentsEnabled` reads `config?.subagents?.enabled ?? false`, but that `false`
is only the *absent-config* fallback. `DEFAULT_CONFIG.subagents.enabled` is **true**
(`defaults.ts:108`), and the config loader materialises the defaults before this
reader runs — verified: `isSubagentsEnabled(DEFAULT_CONFIG) === true`.

So **the unreviewed path is the default path.** Every coordination run on a
stock configuration accepts `result.status === "success"` from a subagent worker
without the independent review that `worker-executor.ts` performs. Enabling
`subagents` does not "lose" a check the user had; the check was never on that path.

## 3. What is NOT wrong

- `computeSubagentStatus` itself: correct for the ownership question it answers.
- The `["."]` default: documented, and appropriate for "any in-scope change".
- Coordination's completion derivation: `deriveCoordinationCompletion` still
  requires a verified aggregate and a durable verification event, so a run cannot
  complete on worker status alone.

The gap is specifically the **missing review on the subagent worker path**.

## 4. The fix, not implemented

Port `reviewDefaultWorkerResult` to `subagent-worker-executor.ts` so both executors
apply the same independent check before reporting `outcome: "success"`. That keeps
one success authority instead of two divergent ones.

Not done here: it changes coordination semantics, needs a failing-first test, and
a decision about whether review cost is acceptable on every subagent worker.

## 4a. A second, related gap

`subagent-cli.ts` likewise never emitted `model.usage` until this session, so the
default coordination path was **also** invisible to cost accounting. Both gaps sit
on the same path: the default worker executor neither reviewed its result nor
reported its spend. That is worth treating as one area, not two coincidences.

## 5. Effect on the benchmark

Strata 4 and 7 recorded cost but **zero verified successes**, partly because
scripted-negative cases diverge on a real model and partly because two cases
(`patch-application`, `forbidden-path-write`) reported success without achieving
the objective — the mechanism above, observed on gpt-4o.

Those two cases are honest evidence of the gap, not defects in gpt-4o.
