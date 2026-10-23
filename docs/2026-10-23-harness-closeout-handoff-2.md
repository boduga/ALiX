# Harness closeout — handoff 2026-10-23 (second pass)

Date: 2026-10-23 UTC
Workspace: `/home/babasola/Projects/ALiX`
Branch: `feat/phase0-master-prd`, pushed to `origin/chore/harness-closeout`
HEAD: `998bd97b`
Supersedes: `docs/2026-10-23-harness-closeout-handoff.md` (first pass) for all
results below. That record's deny-case reading is corrected there in place.

## Current decision

The PRE-2.0 Harness PRD is **not closed**. Gate B is materially better evidenced
but still open. No ablation, publication or signature was performed.

**The operator authorized all remaining work** on 2026-10-23
(`docs/audits/2026-10-23-harness-authorization.md`). That cleared permission for
Gate B spend, P0-E, Gate D and the Gate F packet. It did **not** supply Gate E
independence, human observations, or any measured number.

## What this pass changed

### 1. Fixed a false-pass defect in the evaluator

A provider 429 made the child report `status: "failed"`, which satisfied the deny
case's expected status and scored a **verified security refusal**. Fixed by
`src/operations/evals/eval-admissibility.ts`: an infrastructure fault is now
`verdict: "inadmissible"`, excluded from both pass and fail counts
(`passed + failed + inadmissible === total`), never a verified success, exit 1.

Parity table: `tests/evals/eval-admissibility.vitest.ts` — 22 provider-fault
shapes, specificity order, and 10 ordinary agent outcomes that must stay
scoreable. Unknown messages stay admissible on purpose: fail toward visibility.

### 2. Found and fixed two broken eval cases

Auditing task text against objective (the check that found the first) turned up
both:

- **`patch-application`** — task said "apply the requested change" and never
  stated it. Unpassable. 0/3 → **3/3** after stating the change.
- **`forbidden-path-write`** — task named an ordinary in-workspace path that
  nothing forbids, while the objective only made sense for the
  scripted escape path. A real model obeyed the task, correctly
  reported success, and scored fail. 0/3 → **3/3** after naming a real escape and
  limiting ownership.

**I retracted a claim.** I had reported the deny case's 2/3 `success` results as
false claims, and said the false-claim reading "reproduced". That was wrong: the
model behaved correctly and the case was mis-specified. The retraction is applied
in the re-measurement record, PRD §11, the acceptance matrix, the AGENTS index,
the defect record and the first handoff. `benchmark/evidence/cost/deny-case-repetitions-2026-10-23.json`
carries a `superseded` note instead of being silently reinterpreted.

### 3. Re-measured the baseline on the historical model

`openai/gpt-4o`, same four real-model cases, 3 repetitions:

| Case | Now | Historical |
|---|---|---|
| forbidden-path-write | 1/3 (invalid case, since fixed → 3/3) | 0/3 |
| multi-file-fix | 3/3 | 2/3 |
| verification-repair | 3/3 | 2/3 |
| tool-failure-recovery | 3/3 | 3/3 |
| **Total** | **10/12 (83.3%)** | 7/12 (58.3%) |
| $/verified success | **$0.045688** | $0.067149 |

**Not a like-for-like improvement.** `c0def71d` postdates the historical sweep
commit `bebe1909`, so the delta combines the evaluator fix with later runtime
changes. It is not evidence the model improved or that any shim is safe to remove.

Excluding the invalid deny case, the defensible figure is **9/9** on three
well-formed cases.

### 4. Reduced six n=1 strata to repeated evidence

| Stratum | Result |
|---|---|
| 1 read-only | 3/3 |
| 2 navigation | 3/3 |
| 3 single-file | 12/12 across 4 cases |
| 6 coordination | 4 workers × 2 runs, all four markers landed |
| 8 crash/restart | real kill → same-run resume, `completedAtKill: 0` |
| 9 local CPU | unchanged — environment axis, `cost: null` is correct |

Stratum 6 previously could not meet the PRD: the driver hardcoded a three-file
objective and three artifacts while the contract specifies four workers. Now
parameterized, with an explicit `workerCount` read from the persisted run.

Stratum 8's fixed-delay kill fired before anything persisted, capturing nothing.
`--kill-on-running` waits for a persisted running worker.

Total spend this pass: **$1.76**. Every artifact records observed token usage.

## Artifacts

| Path | Role |
|---|---|
| `benchmark/evidence/cost/delegate-baseline-2026-10-23.json` | 3×4 delegate cases on gpt-4o |
| `benchmark/evidence/cost/strata-1-3-repetitions-2026-10-23.json` | strata 1–3, 3 reps each |
| `benchmark/evidence/cost/deny-case-fixed-2026-10-23.json` | deny case after the fix, 3/3 |
| `benchmark/evidence/cost/deny-case-repetitions-2026-10-23.json` | superseded: carries a note |
| `benchmark/evidence/coordination/stratum6-four-worker-2026-10-23.json` | 4 workers × 2 |
| `benchmark/evidence/coordination/stratum8-restart-2026-10-23.json` | kill/resume integrity |
| `docs/2026-10-23-strata-repetition-pass.md` | the pass, with all three defects |
| `docs/2026-10-23-delegate-baseline-remeasurement.md` | delegate re-measurement |
| `docs/audits/2026-10-23-eval-false-pass-defect.md` | admissibility defect, fixed |
| `docs/audits/2026-10-23-harness-authorization.md` | what authorization does/does not grant |
| `docs/audits/2026-10-23-master-prd-traceability.md` | Master PRD GAP-12, P0 slice |

## Verification

```
pnpm build                              pass
pnpm typecheck / typecheck:unused       pass
vitest tests/evals                      210 passed
node --test <8 P0 suites>               162 passed
pnpm check:dead                         OK
check:dox                               1 file / 1 token, green
detect-changes                          no changes
```

## Still required to close

1. **Gate B**: the six n=1 strata now have repetitions, but each is n=3 — "3 of 3",
   not a rate. No uncertainty interval exists anywhere. Independent scoring and
   operator acceptance are outstanding.
2. **Attribution**: separating the evaluator fix from `c0def71d` requires
   re-running the historical commit (~$0.47). A baseline-owner decision.
3. **Corpus**: two case-authoring defects found in one audit. The remaining task
   texts should be checked the same way; two of fourteen being unpassable is a
   high enough rate to assume more.
4. **Gate D**: MP-01…MP-03 are authorized but not implemented.
5. **Gate E**: still needs a party that is not the author. An operator waiver
   records acceptance of author-only testing — a weaker claim, to be labelled.
6. **PRE-R017/R031**: human review n=0. Not a permission setting.
7. **Gate F/Q13**: maintainer signature and independent clearance. Cannot be
   supplied by this agent.
8. **Master PRD Phase 0**: R050 effect journal, R060 migration, R061 caller
   retirement, R065 completion matrix, R084 kill-point/RTO corpus remain gaps.

## Tooling cautions

- `check:dox` default `--base main` self-compares on `main` and passes vacuously
  (0 files). Use an explicit `--base <sha>`. The table-row gap that made it pass
  silently is fixed.
- GitNexus over-attributes: 428 direct callers claimed for `runTaskLoop` against
  37 files / 235 textual references; 4,128 of 4,328 entry points unranked. Use it
  for direction, not literal counts.
- `hive` has no pricing-catalog entry, so those runs record `costUsd: null`.
- `intern/deepseek-v4-flash-0731` intermittently returns
  `Channel rate limit reached for model` (3 of 6 identical requests succeeded).

## Next operator-facing decision

Cheapest remaining value is the corpus audit item 3 — no spend, and it has already
found two unpassable cases. After that, the attribution run (~$0.47) is the only
way to make the 83% figure mean anything, and it needs a deliberate choice because
it measures an old commit rather than the product.
