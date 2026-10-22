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
re-runs a model. Current qualified cost coverage: **4/10**. Strata 1/2's old
evaluator passes did not verify unchanged contents; their recorded paid usage
remains intact, but success counts remain unknown.
(regenerate rather than trusting this line — it is a snapshot, and the
strata-with-cost count moves as evidence is added.)

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
Use `--scripted` only to validate mechanics; it contributes no billable successes.
Run fixture tests with `node --test benchmark/evidence/cost/positive-cases.test.mjs`.
The mixed-policy fixture resolves only its exact requested output write; it does
not grant other pending requests. Raw results do not replace priced baseline records.

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
