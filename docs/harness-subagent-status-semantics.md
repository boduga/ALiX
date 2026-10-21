# FINDING — subagent status is an ownership verdict; coordination reviews it, plain delegate does not

**Status:** OPEN — narrow, correctly scoped on the third attempt.
**Recorded:** 2026-10-20. **Severity corrected downward: High → Low.**

> ## Two corrections in this file's history — read this first
>
> **v1 (wrong):** "the subagent executor skips the review." I had read
> `subagent-worker-executor.ts` and stopped there.
>
> **v2 (wrong, worse):** I rated it **High** because `DEFAULT_CONFIG.subagents.enabled`
> is `true`, concluding the unreviewed path was the default.
>
> **v3 (this one):** `src/agents/subagent-cli.ts:704` **does** call
> `reviewCoordinationResult`, gated on `coordinationRunId` — which is exactly what a
> coordination worker has. So **production coordination workers ARE reviewed.** The
> reachable gap is narrower: a plain delegate (eval/chat) with no
> `coordinationRunId` returns at line 703 before any review.
>
> I wrote v2 with the same confidence I wrote v1. Both were wrong because I read one
> call site and generalised to the path. Verified this time by grepping
> `coordinationRunId` through the CLI and checking which callers set it.

---

## 1. What is actually true

`computeSubagentStatus` is an **ownership** verdict. Reproduced:

```
ownedPaths=["."], wrote some-other-file.txt (NOT the objective) -> success
ownedPaths=["report.md"], same write                             -> partial
```

With `["."]` — the delegate driver default — any in-cwd change covers ownership.
Documented and intentional.

## 2. What the review actually covers

| Path | `coordinationRunId` | Objective review |
|---|---|---|
| Coordination worker (default, subagents enabled) | **set** | **YES** — `reviewCoordinationResult`, `subagent-cli.ts:704` |
| Plain delegate (eval driver, chat delegate) | absent | **NO** — returns at `:703` |
| In-process coordination worker | n/a | YES — `reviewDefaultWorkerResult` |

So the gap is **plain delegate only**. Coordination — the multi-worker path where a
false success would matter most — is reviewed on both executors.

## 3. Severity: Low

- Production coordination workers are reviewed.
- The unreviewed path is a single delegated worker whose result the **parent**
  consumes; the parent's own loop still evaluates the objective.
- The reachable consequence is a misleading `status: "success"` on a delegate
  result, not a false run completion (`deriveCoordinationCompletion` still demands a
  verified aggregate).

## 4. Observed consequence in the benchmark

Two gpt-4o delegate cases (`patch-application`, `forbidden-path-write`) reported
`success` while the objective did not land. That is this mechanism, on the plain
delegate path. It is a **real observation** and the reason those cases failed
honestly — the evaluator caught what the status claimed.

## 5. Fix, not implemented

Either (a) run `reviewCoordinationResult` for plain delegates too, or (b) stop
presenting `SubagentResult.status` as achievement — rename/document it as an
ownership verdict and let callers evaluate objectives. (b) is cheaper and matches
what the field actually means.

Not done: it changes the delegate contract and needs a decision on review cost per
delegated task.
