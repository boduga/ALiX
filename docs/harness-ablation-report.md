# Harness ablation report (P0-E, deliverable 4, PRE-R007–R009)

**Status:** **NO ABLATION RUN.** Design and authorization analysis only.
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §5 (PRE-R007–R009), §9 **Gate C**.
**Blocked by:** Gate B HOLD (see `harness-readiness-report.md` §1) and the PRD's
explicit prohibition in §12.4.

This document exists because deliverable 4 is required, not because a result
exists. **No keep/retire decision is made here for any candidate.** Writing a
recommendation without measurements would fabricate precisely the evidence the
PRD's validity rules forbid.

---

## 1. Why no ablation is admissible yet

The PRD states an ablation result is inadmissible unless six conditions hold
(`harness-benchmark-spec.md` §3). Current state against each:

| # | Condition | State | Blocking? |
|---|---|---|---|
| 1 | Same task set, model + version, provider policy, environment, oracle | Task set and oracle exist; **all measured runs used an explicit `openai/gpt-4o` one-off** because the operator default (`intern/deepseek-v4-flash-731`) returns 429. Reproduction is **partial**: seven drivers are committed and runnable, four recorded cost files have no producer | **yes** — a variant comparison on one model generalizes to that model only |
| 2 | Randomized ordering or repetitions | **Every figure is n=1** | **yes** — no uncertainty can be reported |
| 3 | S0 negatives run independently; a bypass is never a success | S0 negatives exist and pass; they are not re-run per ablation arm | **partial** — must be wired into each arm |
| 4 | Every failure classified (task / harness / provider / planner-contract) | Failure taxonomy exists in the evaluator; **not applied to any ablation** | **yes** — unclassified failures cannot be compared |
| 5 | Uncertainty reported with the point estimate | Nothing to report | **yes** |
| 6 | Thresholds frozen after the baseline | **No baseline signed** (Gate B HOLD) | **yes** — freezing a threshold now inverts the required order |

Additionally PRD §12.4 is explicit: the v1.1 amendments "do not authorize P0-E
ablations or production simplification." Running an ablation now would breach
that clause regardless of the statistical blockers.

**Conclusion:** a comparison produced today would be inadmissible on five of six
conditions. Recording it would be worse than recording nothing, because it would
look like evidence.

---

## 2. Candidates in scope (classified by Gate A)

Only two candidates are M2 — the class an ablation could justify removing. The
rest are S0/S1 and are preservation candidates, not ablation targets.

| ID | Source | Class | Ablation form a future run must take |
|---|---|---|---|
| **HC-01** | `src/agents/agent/system-prompt.ts` — "Parallel Execution" and "Thorough Context Gathering" sections | M2 | Paired prompt: full prompt vs. prompt with those two sections removed; everything else identical |
| **HC-03** | `src/execution/patch/edit-format-policy.ts` — provider-based preferred patch format | M2 | Paired run: provider-default format vs. forced format, stratified by model |
| HC-02 | tool-name/format guidance | S1/M1 | Keep until tool-call parity is proven; not an ablation target |
| HC-05 | `src/context/repomap/context-compiler.ts` ranking/budgets | M1 | Context-strategy comparison (PRE-R008, P2) — not a removal candidate |

---

## 3. The isolation seam (design only — not implemented)

PRE-R007 requires testing **without modifying production defaults**. That
constrains the design: an ablation must be a *read-side override*, never a changed
constant.

**Where the seam already exists.** Prompt text flows into the loop as a dependency,
not as a rewritten constant:

- `buildEffectiveSystemPrompt` (`src/execution/run/task-loop/context-phase.ts:42`)
  **is the single assembly owner** — one caller, `task-loop/main.ts:678`. Gate A
  closed the "prompt assembly spans ≥6 sites" concern (gap F-06) on exactly this
  fact.
- The assembled prompt enters the loop through `TaskLoopDeps.systemPrompt`
  (`task-loop/main.ts:254`).
- `RunOpts` (`src/execution/run/run-contract.ts:76`) already carries optional
  execution-shaping fields, so an eval-only override is consistent with the
  existing shape rather than a new mechanism.

**What a future implementation would look like** (reversible, default-off):

1. A variant identifier threaded from the eval runner into `runTask` options —
   consumed only by prompt assembly.
2. Assembly subtracts named sections from `SYSTEM_PROMPT_BASE` for the variant
   arm; the production constant is untouched and remains the default.
3. The eval case records which variant produced it, so paired results are
   distinguishable in the evidence.
4. A regression test asserting the **default** path renders byte-identical text
   to today's prompt, so an ablation harness can never silently change production
   behavior.

**Not done, deliberately:** no code was written for this. §12.4 forbids it at this
revision, and an unimplemented seam that no test exercises would be dead weight.

---

## 4. Prerequisites before any run is admissible

In order — each is a blocker, not a nice-to-have:

1. **Gate B baseline signed** with repetitions (n≥3 per stratum) and reported
   uncertainty. Today: n=1.
2. **Model pinned** as a deliberate, recorded choice. The gpt-4o one-off must be
   either adopted explicitly for benchmarking or replaced once the operator
   default stops returning 429.
3. **Reproducibility partial, not absent.** Seven driver scripts are committed
   and runnable (`benchmark/evidence/cost/{eval-case-sweep,run-positive-cases,
   positive-cases}.mjs`, `benchmark/evidence/coordination/{run-coordination-metered,
   run-restart-metered}.mjs`, the matrix generator). Four recorded cost files have
   **no producer**: `readonly-navigation.json`, `eval-mainloop-metered.json`,
   `delegate-metered-sweep.json`, `stratum9-observation.json`.
4. **Failure taxonomy wired into each arm** (condition 4).
5. **S0 negatives re-run per arm** (condition 3) — a variant that appears cheaper
   by bypassing authorization fails the gate outright.
6. **Explicit P0-E authorization** from the operator, separate from this report.

---

## 5. Costs and risks of the first admissible ablation

Recorded so a future decision is informed rather than optimistic:

- **Cost:** HC-01 needs ≥3 repetitions × 10 strata × 2 arms = **60 scored runs**
  minimum, each a real billable call. At observed per-stratum costs
  (`$0.045`–`$0.212`), a first pass is roughly **$4–10** plus retries — small in
  money, large in wall-clock and in operator review.
- **Risk — confounding:** removing the parallel-execution guidance may change
  *tool-call count* rather than *correctness*; the analysis must report tool calls
  and latency separately or it will attribute a cost change to a quality change.
- **Risk — false removal:** if the two prompt sections help only rarely, an
  n=3 study will not detect it. A "retire" recommendation at n=3 would be
  premature; absence of measured benefit is not measured absence.
- **Risk — overfitting to one model:** HC-01 plausibly matters more for weaker
  models. A single-model result must not be generalized.

---

## 6. Verdict

**No candidate is kept or retired by this report.** HC-01 and HC-03 remain **M2
candidates, unmeasured**. Gate C is **NOT MET**, and it cannot be met while Gate B
is HOLD.

The defensible statement: *the harness can now measure cost per verified success in
9 of 10 strata, which is the prerequisite for an ablation; it cannot yet measure
one repeatably, and no ablation is authorized.*

---

## 7. What would change this verdict

- Gate B signed with repetitions and uncertainty → conditions 1, 2, 5, 6 become satisfiable.
- Drivers committed to the repo → condition 1's environment clause becomes checkable.
- Operator authorization for P0-E → the §12.4 prohibition lifts.
