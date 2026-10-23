# Harness readiness report — reconciled 2026-10-23

**Verdict: PARTIAL; Gate B HOLD.** Source assessed: local `main`,
`c0def71d32f430d336b2cae7d749aaec0043bb11`. No API spend or publication in this
reconciliation. Requirements remain PRD v1.2 (filename v1.1).

The [32-requirement acceptance matrix](audits/2026-10-23-harness-acceptance-matrix.md)
is the detailed assessment. It separates definitions, historical results,
executed checks, independent qualification and operator acceptance. The previous
blanket claim that PRE-R015–R032 were all untouched was incorrect: several ask
for designs that already exist. Their existence does not prove measurements.

## Gates

| Gate | Verdict | Evidence / remaining acceptance |
|---|---|---|
| A — Inventory | Historical PASS with named unknowns | Component/invariant maps exist. Current legacy inventory adds real consumers; graph lookup and dynamic/external consumer completeness remain unresolved. No retirement authorized. |
| B — Baseline | HOLD | Corpus validity, raw provenance, metrics, representative repetitions/uncertainty, deny-reporting ambiguity and operator signature remain incomplete. |
| C — Ablation | NOT AUTHORIZED; not met | No paired ablation. PRD §12.4 grants no P0-E authority. |
| D — Migration | NOT MET | Concrete reader/writer manifest exists; supported-interface completeness, Q04 historical-data and Q05 interface plan still require review. |
| E — Security | Not independently qualified | Existing negative tests are evidence, not independent qualification of the exact artifact. |
| F — Release | HOLD | Q13. No authorized maintainer release approval; no push/merge/deploy. |

## What the measurements support

- Historical artifact coverage spans ten strata. This includes scripted results,
  three-worker coordination and a local-inference observation. It does not mean
  all ten PRD benchmark contracts have complete measured coverage: stratum 6
  specifies four workers and local CPU suite success remains unmeasured under the
  recorded hardware disposition.
- The coverage generator admits cost records in 9/10 strata under its legacy
  schema. That count is not independent baseline qualification or ablation
  readiness; it must not substitute for the requirement matrix.
- Five of nine delegate cases are scripted-expectation contracts and unusable as
  real-model quality measurements. They consumed $0.524213 of $0.994258 (52.7%).
  On four measurable cases: **7/12 verified, $0.470045 cost,
  $0.067149 per verified success**. See
  [delegate evidence validity](harness-delegate-evidence-validity.md).
- Strata 4 and 5 each achieved 2/3 on one valid case. Mixed-cohort instability and
  stratum 7's scripted-specific 0/3 are not evidence of a capability gap.
- The three real-model forbidden-write results establish that the checked
  objective did not land. Their retained fields cannot distinguish honest
  refusal from false completion. Scripted refusal tests do not resolve that
  historical ambiguity. Future sweeps record actual and expected statuses.
- Six strata lack comparable repeated real-model baseline evidence. n=3 on the
  delegate cohort does not establish a distribution, a universal threshold, or
  coverage of all allow/ask/deny scenarios.
- F1-E's historical $0.108968/8-check result qualifies a recorded cost mechanism,
  not the full baseline. Original events/artifact are not committed for fresh
  independent reproduction.

## Reproducibility and legacy inventory

[Baseline provenance](audits/2026-10-23-harness-baseline-provenance.md) replaces
ambiguous counts of scripts with a record-by-record account. Table replay,
arithmetic replay and scenario reproduction are different claims.

The read-only/navigation numeric summary can now be regenerated without inference:

```bash
node benchmark/evidence/cost/summarize-readonly-navigation.mjs
```

Its $0.090668 total and two recorded successes reproduce from committed raw
results and explicitly supplied historical rate metadata. The rate is taken from
the existing summary: this closes an arithmetic-producer gap, not invocation-time
pricing or original oracle-proof gaps.

The old `eval-mainloop-metered.json` is strata **1–2**, not 3; its weak-oracle
verified-success counts remain null. Stratum 3 is `cost-record.json`, whose
missing raw provenance was omitted from the handoff's three-file list. Local CPU
observation also lacks its original committed event/command/hardware evidence.
No missing capture has been invented or replayed against a model.

[Legacy inventory](audits/2026-10-23-harness-legacy-inventory.md) now names final
projection owner, pre-normalization writes, runtime tier reader, loader/display
consumers, behavior consumers, persistence boundary, distinct atomic writer,
legacy aliases and regression constraints. `subagents.enabled/roles` are behavior
and must remain. Unknown graph/dynamic/external consumers still block retirement.

## Amendment work

| Group | Supported work | Remaining evidence |
|---|---|---|
| R015–R019 attention/briefs | Metric definitions, read-only brief fields, governance and provenance rules | Human presentation comparison and measurements absent; owner review and any future renderer qualification remain open. No renderer authorized. |
| R020–R026 Harness² | Historical demo result, component map, manifest, paired design, recursion/holdout rules and defer/reject recommendation | Demo logs/clone locally corroborated, not freshly executed or portable dependency-qualified; benchmark-specific isolation and independent authority review remain open. No adoption or model-backed probe. |
| R027–R032 supervision | Contract inventory, eligibility schema, promotion evaluation design, downgrade triggers and non-bypass test specification | No review/sampling/risk measurements or executed supervision non-bypass demonstration. No promotion, sampling engine or automatic downgrade implementation authorized. |

## Executed verification and limits

`c0def71d` fixed a real summary defect: a no-tool nudge followed by bare `Done.`
no longer discards the preceding substantive answer. Original answer objectives
were preserved. The preceding verified pass recorded behavioral **14/14**, eval
unit tests **173/173**, task-loop tests **52/52**, build, unused-symbol,
dead-module and DOX checks. Child-process checks required normal process
visibility; task-loop checks used a one-off 60s test budget during indexing.
Those are regression results, not Gate E clearance or fresh paid baselines.

This reconciliation runs offline producer/coverage/claim checks separately and
records their results in its closeout. It does not claim a fresh full node lane,
a fresh model sweep, an ablation, or independent security qualification.

## Next acceptance packet

1. Complete source/consumer review and historical provenance disposition.
2. Finish shim trigger/usage/retirement catalog and benchmark isolation protocol.
3. Design the missing human-review comparisons and metric capture.
4. Present a priced, scoped proposal before any new real-model collection.
5. Obtain baseline signature and independent security review on exact artifacts.

Full PRD completion remains open. Audit closure with HOLD requires an explicit
operator disposition; it cannot silently waive the unmet gates.
