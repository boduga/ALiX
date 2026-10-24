# D4-04 — delegate transport flake: investigation and disposition

**Status:** OPEN — measured, bounded, not fixed. **Not attributed to measurement work.**
**Branch:** `docs/pre-2.0-harness-audit`.
**Origin:** P0-D3 baseline execution (single observation).

---

## 1. The observation

During baseline execution, `behavioral.block-replacement` failed **once** on a
run that included `--synthetic`, then passed 2/2 on immediate re-run and 3/3
without synthetic. It was recorded at the time as an observation rather than
dismissed, and carried as D4-04.

`behavioral.block-replacement` is a **delegate** case: it spawns a real child
process through `SubagentManager.spawn`, unlike the in-process main-loop cases.

---

## 2. Repetition (this session)

| Condition | Runs | Result |
|---|---|---|
| `--driver delegate`, no synthetic | 20 | **0 failures** (as of the last completed iteration) |
| full suite, no synthetic | 12 | **0 failures** |
| full suite, `--synthetic` | 10 | **0 failures** |

**A flake that does not reproduce is not thereby fixed — it is unobserved.** The
repetition narrows the probability; it does not close the item.

---

## 3. Two mechanisms excluded by construction

These are now pinned by `tests/evals/d4-04-recurrence.vitest.ts` so a future
reader does not re-derive them:

### Synthetic mode cannot reach a delegate case

`runEvalCase` returns **before any driver runs** when `syntheticStatus` is set,
and the synthetic fixtures are separate case objects — never
`block-replacement`. So `--synthetic` has no causal path into the delegate case.
What it *can* change is **run order and timing** (two extra cases, extra work
before the delegate case executes). That is consistent with a timing/load
sensitivity, and inconsistent with "synthetic mode broke the case".

### Cross-case lease leakage is excluded

Every case gets a fresh `mkdtempSync(tmpdir()/eval-task-*)` cwd, the ownership
registry is rooted at that cwd, and the cwd is removed in an unconditional
`finally`. A lease from one case cannot block a later one.

---

## 4. Standing hypothesis (NOT proven)

The delegate path spawns a real child process and therefore inherits
scheduling/load nondeterminism that the in-process scripted path does not. The
child's own parent-liveness watchdog terminates on stdin EOF, which makes the
path sensitive to anything that disturbs the parent-child pipe.

**This is a hypothesis, not a finding.** Nothing here demonstrates it.

---

## 5. Disposition

- **Not fixed.** No mechanism was observed, so any "fix" would be speculative —
  and a speculative change to the transport would be worse than a recorded flake.
- **Not attributed.** It remains a separate reliability finding; no measurement
  result in P0-D/F1 depends on it (those paths do not spawn the delegate child).
- **Bounded.** Synthetic causality and lease leakage are excluded; the remaining
  surface is the child-process transport itself.
- **Gate B treatment:** a delegate case must not be used as the sole evidence for
  any comparison baseline until either (a) it reproduces under repetition, or
  (b) the transport is hardened with a deterministic test that fails before the
  change. Deterministic strata cases (2, 4, 5, 10) do not depend on the delegate
  child for their *evaluator* correctness, but the delegate-driver cases
  (`write-file`, `patch-application`, `block-replacement`) do.

---

## 6. Files

| File | Change |
|---|---|
| `tests/evals/d4-04-recurrence.vitest.ts` | new — pins the two excluded mechanisms |

No production code changed for D4-04. That is deliberate.
