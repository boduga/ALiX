# Benchmark evidence

Recorded evidence backing `docs/harness-baseline-report.md`. Promoted from an
external evidence repository so every row is reproducible from a clean checkout
(benchmark-spec finding **C-03**, partially closed: summaries are reproducible;
not all original scenario drivers were promoted).

## Reproduce

```bash
node benchmark/evidence/gate7/baseline-coverage-matrix.mjs
```

No arguments, no network, no credentials. It reads recorded files only and never
re-runs a model. Current qualified cost coverage: **9/10** (regenerate rather
than trusting this line — it is a snapshot and the count moves as evidence is
added). Only stratum 9 is unmeasured, and it is non-billable by construction
(local CPU inference carries resource time, not a token cost — `null`, never zero).

## Which evidence can be regenerated

A row is only reproducible if a committed driver produces its record. That is
**partial**, and the split is stated here rather than implied:

| Evidence record | Strata | Committed driver |
|---|---|---|
| `cost/readonly-navigation.json` | 1, 2 | **none** |
| `cost/eval-mainloop-metered.json` | 3 | **none** |
| `cost/cost-record.json` (F1-E) | 3 | **none** (qualified by `docs/harness-f1e-qualified.md`) |
| `cost/positive-strata-4-7.json` | 4, 7 | `cost/run-positive-cases.mjs` |
| `cost/delegate-metered-sweep.json` | 4, 5, 7, 10 | `cost/run-delegate-sweep.mjs` — **stale**: recorded 2026-10-20, before the owned-scope authorization fix `bf29449b`; superseded by the repetition record below |
| `cost/delegate-metered-sweep-r{1,2}-2026-10-22.json` | 4, 5, 7, 10 | `cost/run-delegate-sweep.mjs` (real gpt-4o, one per repetition) |
| `cost/delegate-repetitions-2026-10-22.json` | 4, 5, 7, 10 | `cost/summarize-delegate-repetitions.mjs` (n=2, with per-stratum stability) |
| `cost/coordination-metered.json` | 6 | `coordination/run-coordination-metered.mjs` |
| `cost/stratum8-restart.json` | 8 | `coordination/run-restart-metered.mjs` |
| `cost/stratum9-observation.json` | 9 | **none** |

Drivers never estimate cost. They report observed usage and, when no
`model.usage` event exists, say so — `null`, not zero.

## Repetitions and stability (Gate B)

`cost/run-delegate-sweep.mjs` runs the delegate-driven behavioral cases on a real
priced model; `cost/summarize-delegate-repetitions.mjs` folds N runs into a
per-stratum stability verdict. Repetition matters: the 2026-10-20 single sweep
predates the owned-scope authorization fix (`bf29449b`), and re-running the same
cases on the same model does NOT reproduce it.

| Stratum | recorded (2026-10-20) | R1 | R2 | verdict |
|---|---|---|---|---|
| multi-file-fix | 0/2 | 2/2 | 1/2 | **UNSTABLE** |
| verification-repair | 1/2 | 0/2 | 1/2 | **UNSTABLE** |
| capability-mix | 0/3 | 0/3 | 0/3 | stable |
| tool-failure-recovery | 1/2 | 1/2 | 1/2 | stable |

Pooled over R1+R2: **6/18 verified, $0.663258 → $0.110543 per verified success**.
A stratum marked unstable carries NO single-run point estimate, and the coverage
matrix prints that caveat inline instead of a bare figure. `n=2` satisfies
"more than one run"; it does not establish a distribution — treat these as
drift-detected, not as converged baselines.

`cost/eval-case-sweep.mjs` attributes **every** behavioral case to its PRD
stratum; an unmapped case would make a paid sweep unattributable, so the map is
pinned by `cost/case-stratum-map.test.mjs` (catches both an unmapped case and a
stratum id the matrix does not define).

## Contents

| Path | Meaning |
|---|---|
| `gate7/<scenario>/summary.json` | Historical Gate 7 scenario summaries; not billable cost proof |
| `eval-runs/deterministic-14of14.json` | Scripted-provider eval run (strata 1–5, 10) |
| `cost/cost-record.json` | F1-E cost evidence (stratum 3, `run-79feb4e0`) |
| `cost/stratum9-observation.json` | Local CPU-only observation (stratum 9) |
| `gate7/baseline-coverage-matrix.mjs` | The generator |
| `cost/run-positive-cases.mjs` | Positive strata 4/7; default current real model, `--scripted` for fixture validation |
| `cost/positive-real-quota-blocked.json` | Failed real positive attempt; no qualifying usage or cost |

Only `summary.json` was promoted, not the multi-hundred-megabyte session state
around it: the matrix reads summaries, so that is the reproducible evidence. The
full original transcripts were never in this repo and are not required to
regenerate the table.

Positive cases: `node benchmark/evidence/cost/run-positive-cases.mjs --output <path>`.
An explicit `--output-cap 2048` changes only that run's temporary output budget;
raw results record it. The restart harness accepts the same option plus
`--kill-on-running` to inject failure after a worker is durably running.
Use `--scripted` only to validate mechanics; it contributes no billable successes.
Run fixture tests with `node --test benchmark/evidence/cost/positive-cases.test.mjs`.
The mixed-policy fixture resolves only its exact requested output write; it does
not grant other pending requests. Raw results do not replace priced baseline records.

`cost/output-budget-admission.json` records controlled quota diagnostics: identical
tiny requests succeeded at 128 output tokens and failed at 32768; a full captured
request succeeded with only output cap reduced to 2048. This is diagnostic usage,
not a qualified baseline. See `docs/2026-10-21-harness-output-admission.md`.

## Invariants

- **A stratum with no evidence is reported BLOCKED**, never as zero or pass.
- **Measured cost is counted only** from a record naming the stratum, carrying a
  finite numeric cost, `completeness: "complete"`, and a positive integer
  `verifiedSuccesses`. Missing/null counts remain unknown. Incomplete or unattributed
  records are refused with a warning.
- **`null` is not zero.** A scripted-provider run makes no billable call, and a
  local CPU run is non-billable resource time. Neither is a measured zero.

## Note on absolutes inside recorded summaries

`gate7/f8b-final/summary.json` contains one absolute path
(`/home/babasola/Projects/alix-legacy-approval-evidence/...`) inside a worker's
recorded **approval reason** — i.e. inside the text of what the run actually
asked to execute.

It is deliberately left untouched. It is evidence of what happened, not
configuration; rewriting it would falsify the record. It does not affect
reproducibility: the generator never reads that field.
