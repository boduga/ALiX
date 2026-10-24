# Benchmark evidence — reconciled 2026-10-23

Recorded artifacts, arithmetic inputs and scenario producers. Their existence is
not Gate B acceptance. Current assessment:
[requirement matrix](../../docs/audits/2026-10-23-harness-acceptance-matrix.md),
[record provenance](../../docs/audits/2026-10-23-harness-baseline-provenance.md).
Gate B and Q13 remain HOLD; ablations are not authorized.

## Offline replay

```bash
node benchmark/evidence/gate7/baseline-coverage-matrix.mjs
node benchmark/evidence/cost/summarize-readonly-navigation.mjs
```

The matrix reads summaries only: its legacy 9/10 cost-record admission and
10-stratum artifact coverage do not establish PRD-qualified baselines. Its rows
mix scripted outcomes, historical run summaries and a local CPU observation.
Three workers were exercised for a four-worker PRD stratum. A local inference
observation does not measure full-suite success. The matrix cannot authorize an
ablation or infer independent qualification from record presence.

The read-only arithmetic producer reads committed raw results and historical rate
metadata from the existing summary. It reproduces $0.090668 and two recorded
successes. This circular metadata input is explicit: it does not requalify the
oracle, invocation-time pricing, or missing original logs. Output defaults to
stdout; `--output <new-path>` refuses an existing file.

## Record-to-producer inventory

Paths below are relative to this directory. Full limitations are in the provenance
record linked above; a live driver creates new observations, not the exact old run.

| Record | Strata / role | Producer / limitation |
|---|---|---|
| `cost/readonly-navigation.json` | 1–2, strengthened oracle | `cost/summarize-readonly-navigation.mjs` offline; raw `cost/readonly-navigation-gpt4o.json`; live `cost/eval-case-sweep.mjs` |
| `cost/eval-mainloop-metered.json` | **1–2**, old weak oracle | Historical arithmetic only; success counts null, deleted workspaces cannot be rescored. Not stratum 3. |
| `cost/cost-record.json` | 3, historical F1-E | `../../docs/verify-f1e-cost-proof.mjs` requires original logs/artifact, not committed. Historical 8/8 report is not fresh reproducibility. |
| `cost/positive-strata-4-7.json` | 4, 7 | `cost/run-positive-cases.mjs`, `cost/positive-cases.mjs` |
| `cost/delegate-metered-sweep.json` | 4, 5, 7, 10 | `cost/run-delegate-sweep.mjs`; predates owned-scope fix, retain as historical |
| `cost/delegate-metered-sweep-r{1,2,3}-2026-10-22.json` | Three paid repetitions | Same driver; historical nine-case cohort includes five scripted-only cases now excluded on real providers |
| `cost/delegate-repetitions-2026-10-22.json` | Legacy pooled cohort | `cost/summarize-delegate-repetitions.mjs`; arithmetic replay, not corrected case-validity interpretation |
| `cost/coordination-metered.json` | 6 | `coordination/run-coordination-metered.mjs`; three workers, not four |
| `cost/stratum8-restart.json` | 8 | `coordination/run-restart-metered.mjs`; raw `coordination/stratum8-gpt4o.json` |
| `cost/stratum9-observation.json` | 9, historical local inference | No original committed producer/events/CPU evidence. Cost null; suite completion rate unmeasured. |
| `gate7/<scenario>/summary.json` | Historical scenarios | Summary/table replay only; original transcripts not promoted |
| `eval-runs/deterministic-14of14.json` | Scripted mechanics | No billable usage; deterministic passes do not measure real-model quality |

## Delegate validity

Five of nine historical delegate cases have expectations written for scripted
failure scenarios. Their $0.524213 spend (52.7% of $0.994258) cannot measure
real-model success. All raw paid usage is retained.

On the four measurable cases: **7/12 verified, $0.470045 total,
$0.067149 per verified success**. Multi-file and verification-repair each show
2/3 on one valid case; tool-failure recovery 3/3. Forbidden-path-write is 0/3
with unresolved honest-refusal versus false-completion reporting. The mixed
cohort's instability labels and stratum-7 0/3 do not establish a capability gap.
See [validity analysis](../../docs/harness-delegate-evidence-validity.md).

## Execution and evidence contracts

- Offline replay reads committed data and does not load credentials or call models.
- Real-provider drivers resolve current `models.default`; deliberate one-off
  provider/model overrides are explicit. No real run is authorized by this README.
- `--scripted` on positive fixtures validates mechanics only; it creates no
  billable baseline. Explicit output-cap overrides affect temporary config only.
- Failed attempt costs stay in the numerator. Missing/zero verified successes
  produce a null ratio; unknown usage or pricing stays null, never guessed zero.
- Keep raw evidence unchanged. New summaries must state derivation and limitations.
- Missing event logs, oracle artifacts, invocation prices, hardware or commands
  cannot be invented after cleanup.
- The absolute path inside `gate7/f8b-final/summary.json` is historical approval
  text, not configuration. It is preserved and not dereferenced by table replay.

Focused offline checks:

```bash
node --test benchmark/evidence/cost/*.test.mjs
node --test tests/evals/baseline-cost-success.test.mjs
```
