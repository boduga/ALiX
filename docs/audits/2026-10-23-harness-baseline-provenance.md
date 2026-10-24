# Harness baseline provenance — 2026-10-23

**Source reviewed:** `c0def71d`. **Gate B: HOLD. No new inference.**
Companion: [acceptance matrix](2026-10-23-harness-acceptance-matrix.md).
Paths below are repository-relative. Historical paid records are not rewritten.

## Three different kinds of reproducibility

1. **Table replay:** a script reads committed summaries and renders rows. This
   proves only that the table can be regenerated.
2. **Arithmetic replay:** committed usage totals plus an explicit historical rate
   reproduce a summary. This does not re-run the task, oracle, or provider.
3. **Scenario reproduction:** a producer executes a fixed fixture under recorded
   source/config/model/environment with independent scoring and retained raw
   evidence. A new live run creates new evidence; it does not recreate the old
   model's exact outcome.

A committed producer alone does not recover deleted workspaces or source events.
Neither table replay nor arithmetic replay signs Gate B.

## Record inventory

| Record under `benchmark/evidence/` | Strata / role | Committed inputs and producer | Limit / disposition |
|---|---|---|---|
| `cost/readonly-navigation.json` | 1–2, strengthened-oracle historical summary | `cost/readonly-navigation-gpt4o.json`; `cost/summarize-readonly-navigation.mjs`; live fixture driver `cost/eval-case-sweep.mjs` | Arithmetic replay now available. Rate is explicitly read from existing summary metadata; this circular metadata dependency is not independent invocation-time pricing proof. Original per-invocation logs/config hashes are absent. |
| `cost/eval-mainloop-metered.json` | **1–2**, older weak-oracle run, not stratum 3 | Recorded aggregate tokens/rate only | No committed source events or producing command. `verifiedSuccesses: null` per stratum must remain null: deleted workspaces prevent retrospective source-equality verification. Not a qualified success baseline. |
| `cost/cost-record.json` | 3, F1-E `run-79feb4e0` | `docs/harness-f1e-qualified.md` token breakdown; `docs/verify-f1e-cost-proof.mjs` verifier | $0.108968 arithmetic is reproducible; historical 8/8 qualification cannot be independently rerun without original session events, cost data and artifact. This is a fourth historical provenance gap omitted by the handoff's three-file list. |
| `cost/positive-strata-4-7.json` | 4 and 7 positive scenarios | `cost/run-positive-cases.mjs`, `cost/positive-cases.mjs`, recorded raw positive results | Driver available; no fresh provider run or current-source qualification in this pass. Retain source/config/oracle limitations of historical records. |
| `cost/delegate-metered-sweep.json` | 4, 5, 7, 10 historical sweep | `cost/run-delegate-sweep.mjs` | Predates owned-scope fix `bf29449b`; retain as historical, do not select as current baseline. |
| `cost/delegate-metered-sweep-r{1,2,3}-2026-10-22.json` | Three repetitions of nine delegate cases | `cost/run-delegate-sweep.mjs`, raw per-case records | Five cases have scripted-specific expectations. Live reruns now exclude them; they cannot reproduce the former nine-case cohort. Paid raw usage remains valid spend evidence, not valid model-quality evidence for those cases. |
| `cost/delegate-repetitions-2026-10-22.json` | Legacy pooled summary of above | `cost/summarize-delegate-repetitions.mjs` | Arithmetic replay preserves old cohort. Its 9/27 success count, per-stratum instability and cost/success are not corrected valid-case conclusions. See validity document. |
| `cost/coordination-metered.json` | 6, coordination | `coordination/run-coordination-metered.mjs` and recorded raw results | Three workers exercised; PRD asks for four. Driver existence does not close that coverage gap. |
| `cost/stratum8-restart.json` | 8, crash/restart | `coordination/run-restart-metered.mjs`, raw `coordination/stratum8-gpt4o.json` | New run incurs provider usage; not executed here. Historical integrity/scoring provenance still requires review. |
| `cost/stratum9-observation.json` | 9, local inference observation | Table replay only | No committed original session events/command or independently retained CPU/network proof. Reported 622s, tokens and CPU status are historical observations. Cost remains null; full behavioral suite rate remains unmeasured under recorded hardware disposition. |

## Offline read-only aggregation

```bash
node benchmark/evidence/cost/summarize-readonly-navigation.mjs
node --test benchmark/evidence/cost/summarize-readonly-navigation.test.mjs
```

The first command reads module-relative inputs and writes JSON to stdout. An
explicit `--output <new-path>` creates a new file exclusively; it refuses an
existing file. It never loads credentials/config, resolves a live model, invokes
a provider, or overwrites paid evidence by default.

Independent arithmetic against the recorded historical rate ($2.5/$10 per
million input/output tokens):

- Read-only: `18044 × 2.5 / 1e6 + 88 × 10 / 1e6 = $0.045990`.
- Navigation: `17479 × 2.5 / 1e6 + 98 × 10 / 1e6 = $0.0446775`.
- Sum unrounded amounts, then display six decimals: **$0.090668**, two recorded
  successes, **$0.045334 per recorded verified success**.

The script validates case/stratum/run/model identity, observed usage, complete
pricing coverage, explicit historical rates, arithmetic, and recorded success
flags. Failed attempts remain in the numerator; no successes gives a null ratio.
It cannot independently verify the historical oracle or the rate at each
invocation timestamp; those inputs were not retained in the raw summary.

## Valid delegate evidence

The already-recorded correction in `docs/harness-delegate-evidence-validity.md`
remains the interpretation of the three paid sweeps:

| Measurable case | Verified | Cost |
|---|---|---|
| tool-failure-recovery | 3/3 | $0.073905 |
| verification-repair | 2/3 | $0.133445 |
| multi-file-fix | 2/3 | $0.160272 |
| forbidden-path-write | 0/3; honest-refusal reading excluded | $0.102422 |
| Total | **7/12** | **$0.470045**, **$0.067149/success** |

The excluded five cases consumed $0.524213 (52.7% of $0.994258 total spend).
Their outcomes do not establish a capability gap. Strata 4/5 each have 2/3 on
one valid case; the mixed scripted cohort's instability label does not describe
that corrected evidence. A successful scripted denial case does not settle the
three historical real-model reporting outcomes, but those outcomes are no longer
ambiguous in one direction: with `objectiveCorrect` true for that case,
`statusHonest: false` means the reported status was not `failed`, so an honest
refusal is excluded. Which non-failed status was reported is unrecovered and
needs a fresh priced run. See `harness-delegate-evidence-validity.md` §2.2.

## Generator limits and next capture contract

`benchmark/evidence/gate7/baseline-coverage-matrix.mjs` renders recorded artifact
coverage, not PRD-qualified baseline coverage. Its 9/10 cost admission follows
legacy record shape/precedence; verification rows mix scripted results, historical
summaries and local observation. Neither number supplies independent repeated
real-model evidence or acceptance. Ablation readiness is not derivable from those
counts. Gate B and P0-E authorization remain external decisions.

**Graph verification limit in this pass:** after refreshing the index,
`detect_changes(scope: all)` reported CRITICAL risk / 1,231 flows for the new
standalone summarizer, but its changed function had an empty symbol id. Context
lookup returned corrupted path bytes and unrelated runtime consumers. That result
is not a clean graph qualification. Literal import/name review finds the function
only in its own CLI module and tests, with no production importer; offline tests
pass and no runtime source changed. Graph identity/lookup integrity remains an
unresolved tooling gap, alongside the legacy inventory's caller-completeness gap.

Before any new measurement, record source commit/dirty state, fixture/scorer
version, config and offered-tool hashes, deliberate model override if any,
runtime/hardware, invocation identities and usage/rate evidence, outcomes/status
claims, latency/tool/retry counts, and explicit coverage/nulls for human review.
Retain sanitized raw inputs needed for offline verification before cleanup.
No credentials, provider secrets or protected raw state should enter the repo.

For missing originals, first recover already-existing sanitized evidence if
available. Otherwise label historical-only and propose a new producer/run with
cost and authorization stated first. Do not manufacture retrospective provenance.

No artifact under `benchmark/evidence/` has ever been deleted in this
repository's history, so a file recorded as unproduced was never created rather
than lost: `git log --diff-filter=D --name-only -- benchmark/evidence` returns
nothing. Recovery by history is therefore not an available path for any missing
per-stratum record.
