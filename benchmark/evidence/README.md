# Benchmark evidence

Recorded evidence backing `docs/harness-baseline-report.md`. Promoted from an
external evidence repository so every row is reproducible from a clean checkout
(benchmark-spec finding **C-03**, closed).

## Reproduce

```bash
node benchmark/evidence/gate7/baseline-coverage-matrix.mjs
```

No arguments, no network, no credentials. It reads recorded files only and never
re-runs a model. Expected output: **10/10 strata verified, 6/10 measured cost.**
(regenerate rather than trusting this line — it is a snapshot, and the
strata-with-cost count moves as evidence is added.)

## Contents

| Path | Meaning |
|---|---|
| `gate7/<scenario>/summary.json` | Real-model Gate 7 runs (strata 6, 7, 8) |
| `eval-runs/deterministic-14of14.json` | Scripted-provider eval run (strata 1–5, 10) |
| `cost/cost-record.json` | F1-E cost evidence (stratum 3, `run-79feb4e0`) |
| `cost/stratum9-observation.json` | Local CPU-only observation (stratum 9) |
| `gate7/baseline-coverage-matrix.mjs` | The generator |

Only `summary.json` was promoted, not the multi-hundred-megabyte session state
around it: the matrix reads summaries, so that is the reproducible evidence. The
full original transcripts were never in this repo and are not required to
regenerate the table.

## Invariants

- **A stratum with no evidence is reported BLOCKED**, never as zero or pass.
- **Measured cost is counted only** from a record naming the stratum, carrying a
  finite numeric cost and `completeness: "complete"`. Incomplete or unattributed
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
