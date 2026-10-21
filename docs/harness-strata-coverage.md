# Strata coverage — deterministic cases for 2, 4, 5, 10 (+ 9 guard)

**Status:** coverage added and passing. **No real-model cost claims.**
**Branch:** `docs/pre-2.0-harness-audit`.
**Gate B: HOLD** — coverage is no longer the blocker; measured cost is.

---

## 1. What this closed

The baseline matrix had five strata with **no case coverage at all**. Four of
them now have deterministic behavioural cases, and the fifth has a guard:

| Stratum | Before | Now |
|---|---|---|
| 2 — Unfamiliar-code navigation | none | `code-navigation` (read-only) |
| 4 — Multi-file bug fix | none | `multi-file-fix` + `multi-file-fix-partial` |
| 5 — Verification / repair | none | `verification-repair` + `verification-repair-not-applied` |
| 9 — Local CPU-only | none | **real ollama run proven**; guard derives verdict from evidence |
| 10 — Tool failure / malformed calls | none | `tool-failure-recovery` + `malformed-tool-call` |

Suite: **14/14 pass**, deterministic, no network.

---

## 2. Two real defects found by running the cases (not by reading them)

Writing the cases was cheap. **Running them was not** — the first execution
produced 2 failures, and both were genuine defects rather than bad expectations.

### D8-01 — delegate failure result was written to stderr, never parsed (High)

`SubagentManager.spawn()` parses the child's final result from **stdout only**.
The child's catch path wrote its structured failed `SubagentResult` to
**stderr** — while its own comment claimed *"the failed result on stdout is
authoritative."*

Consequence: every clean structured subagent failure was invisible to the
parent. The parent fell back to the raw exit code and `reject()`ed with a bare
error string, discarding `status`, `findings` and `error`. The reporter saw a
crash where the child had produced a well-formed failure.

Fixed in `src/agents/subagent-cli.ts`: **JSON** failure output goes to stdout
(the machine contract); **text** output stays on stderr (the human format, which
must not pollute a captured report).

### D8-02 — composite objective mismatches did not name the failing file (Medium)

Adding the composite `files` objective for stratum 4 initially ANDed the
per-file outcomes but concatenated bare mismatch strings. With N files a reader
could not tell **which** file failed — `content mismatch: expected "const other = 2;\n"`
names no file.

Fixed in `objective-evaluator.ts`: each mismatch is now prefixed with its path
(`src/b.ts: content mismatch: …`).

---

## 3. Design decisions

### The composite objective is additive, not a second scorer

Stratum 4 needs "both files fixed". Rather than a new evaluator, `files` is a
new `EvalObjective` variant that delegates **each entry to the same
`evaluateObjective`** and ANDs the results. There is still exactly one scoring
engine and one source of truth. A test asserts the composite agrees with the
single-file evaluation on the same file.

### Negative cases are the point, not padding

Each new stratum ships with its honest negative:

- `multi-file-fix-partial` — one of two files fixed must **not** land.
- `verification-repair-not-applied` — a worker *claiming* a repair it never made
  must **not** land, and must not report success.
- `malformed-tool-call` — a hard model/tool error must report failure.

Without these, "coverage" would only prove the happy path.

### `ownedPaths` is required for partial outcomes to be expressible

`multi-file-fix-partial` initially asserted `failed` while declaring no owned
paths. The delegate driver then defaults to `["."]`, so a **single** write
satisfies the ownership contract and the runtime's `success` was *correct under
that contract*. The case was asserting an outcome the runtime had no reason to
produce.

The fix was to declare `ownedPaths: ["src/a.ts", "src/b.ts"]` — the same
mechanism EVAL-007 uses — after which the harness reports `partial`, which is
the honest verdict. **The expectation moved to `partial`, not to `success`.**

### Stratum 9 is a guard, not a case

CPU-only is an **environment axis**, not a new behaviour: the same cases run
locally. Duplicating the whole suite would double the case count for zero
additional behavioural coverage. `cases/stratum-9-local.ts` instead provides the
labelling guard — a run may be recorded as CPU-only **only** when every provider
that executed was local (`ollama`, `local-llama`). A mixed run is refused.

**Correction (same session):** an earlier version of this document claimed no
local provider exists. That was wrong — it was never checked. Ollama is installed
and serving, and a real task completed on local CPU inference:

```
provider=ollama  model=llama3.2:3b  runId=run-379d9b20  in=3347 out=14  exit=0
```

So the stratum is no longer "guard only". The **inference path is proven**; the
full suite is not yet run to completion (minutes per case on this 4-core box),
so suite coverage is still not claimed.

The guard is now evidence-derived rather than intent-based:
`classifyCpuOnlyRun` reads per-case `execution.provider` and fails closed on
`unknown`.

---

## 4. Verification

| Check | Result |
|---|---|
| `tsc -p tsconfig.json` | clean |
| `tsc -p tsconfig.unused.json` | clean (zero unused) |
| New tests (`strata-coverage`, `subagent-failed-result-stdout`) | 13/13 pass |
| Regression (`tests/evals`, `tests/agents`, evals CLI) | **212/212 across 20 files** |
| Behavioural suite | **14/14 pass** |
| Coverage matrix generator | 9/10 verified, 1/10 cost |
| Real ollama run (stratum 9) | `run-379d9b20`, exit 0, in=3347 out=14 |

The stdout regression test spawns the **real** child process through the real
CLI entry point with a scripted provider. It failed before the fix and passes
after. It holds stdin open deliberately, because the child's parent-liveness
watchdog terminates on stdin EOF — closing it early would test the watchdog, not
the result contract.

---

## 5. What this does NOT establish

- **No real-model cost.** Scripted-provider cases emit no `model.usage` — there
  is no billable call. Their cost is `null`, **not zero**. Only stratum 3 has a
  measured cost, from F1-E's single 3-invocation run.
- **No claim that strata 2/4/5/10 behave the same under a real model.** These
  cases pin runtime and evaluator behaviour deterministically; they say nothing
  about model capability on those task shapes.
- **Stratum 9 suite coverage is incomplete.** Inference is proven on ollama; the
  full case suite has not run to completion.
- **D4-04 is bounded, not fixed** — see `harness-d4-04-investigation.md`.

---

## 6. Files

| File | Change |
|---|---|
| `src/operations/evals/cases/strata-2-4.ts` | new — strata 2 and 4 (3 cases) |
| `src/operations/evals/cases/strata-5-10.ts` | new — strata 5 and 10 (4 cases) |
| `src/operations/evals/cases/stratum-9-local.ts` | new — CPU-only labelling guard |
| `src/operations/evals/cases/index.ts` | register the new cases |
| `src/operations/evals/evals-types.ts` | additive composite `files` objective |
| `src/operations/evals/evaluators/objective-evaluator.ts` | composite evaluation + path-prefixed mismatches |
| `src/agents/subagent-cli.ts` | JSON failure result to stdout (D8-01) |
| `tests/evals/strata-coverage.vitest.ts` | new, 11 tests |
| `tests/evals/subagent-failed-result-stdout.vitest.ts` | new, 2 tests |

Evidence repo: `tui-e2e/baseline-coverage-matrix.mjs` now maps the new cases to
strata and accepts optional **complete, stratum-attributed** cost records;
`tui-e2e/f1e-cost/cost-record.json` carries F1-E's measurement.

Gate B HOLD. Simplification HOLD. Publication HOLD (Q13).
