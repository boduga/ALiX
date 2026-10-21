# Harness benchmark specification (P0-C)

**Status:** DRAFT — design only. No benchmark has been run. No production change authorized.
**Baseline:** `4ac6df14`. Branch `docs/pre-2.0-harness-audit`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (root worktree; see `harness-prd-divergence-finding.md`) §5 (PRE-R005/R006), §7.
**Resolves:** the "is there even a harness to measure with?" question before P0-D.

---

## 1. What already exists (verified, not assumed)

ALiX has **two** measurement systems. Neither is a general task-success
benchmark, and P0-C must build on them rather than invent a third.

| System | Location | Measures | Scoring |
|---|---|---|---|
| **Substrate benchmark** | `benchmark/` | Context-substrate quality across horizons 10/50/100/500 (A history / B summary / C state / D hybrid) | Deterministic FakeModel; correctness = required info present; 4 metric groups; C/D boundedness invariants |
| **Behavioral evals** | `src/operations/evals/` | Whether a task **landed** on the filesystem and whether the reported status was **honest** | Evaluator-owned objective assertions + status honesty contract; `pass` only when landed AND honest |
| **Mutation-conflict benches** | `benchmark/mutation-conflict*.ts` | CAS single-winner under N concurrent mutations | Exactly one success + N−1 `STATE_VERSION_CONFLICT` |
| **Session shadow / universal rows** | `benchmark/session-shadow.ts`, `universal-row.ts` | Live-session token parity, cross-source row schema | ±2pp live-send bar |

**Cost/latency types already exist** (`benchmark-types.ts` has `p50Ms`/`p95Ms`;
`observability/cost-attribution.ts` exists), so the PRD's cost/latency requirement
does not need new plumbing.

### Coverage gap (the reason P0-C is needed)

| PRD task stratum (§7) | Existing coverage | Gap |
|---|---|---|
| 1. Read-only factual inspection | `behavioral.read-only` | — |
| 2. Unfamiliar-code navigation | none scored | **MISSING** |
| 3. Single-file edit | `behavioral.write-file`, `patch-application` | — |
| 4. Multi-file bug fix | none scored | **MISSING** |
| 5. Verification / repair | none scored | **MISSING** |
| 6. Four-worker coordination with ownership | node/vitest only | **MISSING as measured benchmark** |
| 7. Allow/ask/deny capability mixes | Gate 5/7 suites only | **MISSING as measured benchmark** |
| 8. Crash/restart, outcome-unknown | `approval-crash-recovery` test | **MISSING as measured benchmark** |
| 9. Local CPU-only execution | none | **MISSING** |
| 10. Tool failure / malformed tool-call | none scored | **MISSING** |

**Verified fact:** `behavioral.ts` contains **zero** occurrences of
"coordination", and no file under `benchmark/` mentions "approval". The two
security-critical strata (6 and 7) are covered by *correctness tests* but not by
any *measured* harness. That is the central P0-C finding: **ALiX can prove these
behave, but cannot yet measure what they cost.**

---

## 2. Scoring model

### 2.1 Primary measure (PRD §7, verbatim intent)

```
total measured cost / independently verified successful task
```

- Numerator includes cost of **failed** tasks. An optimiser that succeeds on
  easy tasks while burning budget on hard ones must not look cheap.
- "Independently verified" comes from the **evaluator**, never from ALiX's own
  claim. Reuse the existing honesty contract: a task only counts as successful
  when the objective landed AND the reported status was honest.

### 2.2 Reported per stratum

| Field | Source |
|---|---|
| total tasks, verified successes | evaluator |
| mean / median cost | `cost-attribution` |
| p50 / p95 latency | `benchmark-types` shape |
| tokens (prompt / completion) | provider usage |
| tool calls, repeated calls | session events |
| retry count | scheduler/worker attempts |
| operator interventions | approval records |

### Operator-attention metrics (PRD v1.1 §12, PRE-R015–R019) — NOT IMPLEMENTED

If the §12 amendment is adopted, P0-C/P0-D additionally owe:

| Metric | Status | Rule |
|---|---|---|
| `operatorActiveReviewMinutes / independentlyVerifiedSuccesses` | **not measured** | Report `null` + coverage unless BOTH terms are observed. Never a guessed dollar conversion. |
| Interruptions, approval touches | **not measured** | Separate from active review and from elapsed time. |
| Missed-evidence / reversal events | **not measured** | Observed only where observable. |
| Presentation-format comparison (text / diagram / HTML) | **not started** | Paired or randomized review tasks; no invented thresholds. |

Active review must be reported **separately** from waiting, interruptions and
total elapsed time. Faster approval is **not** better if the reviewer missed a
security, correctness or governance issue (§12.3).

Nothing in this audit implements PRE-R015–R019, and §12.4 states the amendment
does **not** clear Gate B.

### Harness² research (PRD v1.1 §13, PRE-R020–R026) — NOT STARTED

No upstream reproduction, contract map or experiment spec exists. Recorded here
so the requirement is not silently absent; see
`harness-prd-divergence-finding.md` — the §13 requirements are only in the root
copy of the PRD, not the audit copy.

For local models report **resource-time** alongside any monetary estimate, and
label which is which — the PRD is explicit, and a local run with a fabricated
dollar figure would be worse than no number.

---

## 3. Validity rules (what makes a comparison admissible)

An ablation result is **inadmissible** unless all of the following hold:

1. Same task set, model + version, provider policy, environment, test oracle.
2. Randomised ordering or repetitions to limit drift.
3. S0 negative tests run **independently** — a policy bypass is never a success.
4. Every failure classified: task failure, harness failure, provider failure,
   or planner-contract failure. Planner variance observed during Gate 7 (a
   cancelled run with glob-scoped infra workers) is a **planner-contract
   failure**, not a task failure, and must be reported as such.
5. Uncertainty reported with the point estimate. No single-run claims.
6. Thresholds frozen **after** the baseline, never before.

**Rule carried from Gate 7:** a run whose artifacts happen to exist is not a
pass. The Gate 7 denial work established this the hard way; the benchmark adopts
the same standard.

---

## 4. Proposed harness composition (no new framework)

| Stratum | Harness used | Why not a new one |
|---|---|---|
| 1, 3 (inspection, single edit) | existing `behavioral.*` cases | already scored and honest |
| 2, 4, 5, 10 | extend `behavioral` cases | same evaluator contract, add cases |
| 6, 7, 8 (coordination, approval mixes, crash) | **new measured cases reusing the Gate 7 drivers** | the drivers already produce durable evidence; only scoring is missing |
| 9 (CPU-only) | environment axis on existing cases | a config, not a harness |
| Substrate comparisons | existing `benchmark/` | unchanged |

**Explicit non-goal:** do not build a third harness. The gap is *scoring and
case coverage*, not infrastructure.

### 4.1 Reuse, not reinvention

The Gate 7 evidence drivers (`tui-e2e/drive-scenario.py`, `drive-fanout.py`,
`drive-real.py`) already emit structured `summary.json` with worker statuses,
approval records and artifact hashes. Those become the **row producers** for
strata 6 and 7. They live outside the repo today; P0-D decides whether to
promote them or reimplement their assertions as `behavioral` cases.

That decision is deferred rather than guessed, because promoting a
Python/PTY harness into the repo is a maintenance question the PRD does not
settle.

---

## 5. Baseline protocol (P0-D instructions)

1. Freeze the task corpus with a version id and content hash.
2. Run each stratum N times (N stated, not "a few"), record every run including
   failures and harness errors.
3. Publish raw rows, not only aggregates — the universal-row schema already
   exists for this.
4. Freeze thresholds from the measured distribution (median + spread), then
   state the regression bar.
5. Re-run negative S0 suites in the same session to prove the benchmark did not
   weaken policy.

---

## 6. Findings

| # | Finding | Severity |
|---|---|---|
| C-01 | No measured harness covers strata 6/7/8. Security behaviour is proven by tests but its **cost** is unmeasured, so the approval boundary's overhead cannot be compared or quoted | **Medium** |
| C-02 | Strata 2/4/5/10 have no scored cases at all | Medium |
| C-03 | Gate 7 evidence drivers are outside the repo (unpromoted), so their rows are not reproducible from a clean checkout | Medium |
| C-04 | `p50Ms`/`p95Ms` types and `cost-attribution` exist but are not wired into a task-level benchmark | Low |
| C-05 | Local CPU-only (stratum 9) has no defined environment axis | Low |

---

## 7. What P0-C does **not** establish

- No benchmark has been executed. Every number in P0-D is future work.
- No threshold exists. Inventing one now would violate PRD §7 ("no fabricated
  numeric performance target").
- No ablation is authorised. HC-01/HC-03/HC-05 remain M2/M1 candidates pending
  P0-D.

**Gate B (baseline) is NOT satisfied by this document.** This is the spec that
makes Gate B possible.

Production simplification: **HOLD**. Publication: **HOLD** (Q13).
