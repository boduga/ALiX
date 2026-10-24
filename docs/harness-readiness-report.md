# Harness readiness report — reconciled 2026-10-23

**Verdict: PARTIAL; Gate B HOLD.** Corpus/evidence reconciliation: `a4ce4980`
plus working changes on `feat/phase0-master-prd`. Other source assessments retain
their earlier `c0def71d` scope. No API spend or publication in this reconciliation.
Requirements remain PRD v1.2 (filename v1.1).

The [32-requirement acceptance matrix](audits/2026-10-23-harness-acceptance-matrix.md)
is the detailed assessment. It separates definitions, historical results,
executed checks, independent qualification and operator acceptance. The previous
blanket claim that PRE-R015–R032 were all untouched was incorrect: several ask
for designs that already exist. Their existence does not prove measurements.

## Gates

| Gate | Verdict | Evidence / remaining acceptance |
|---|---|---|
| A — Inventory | Historical PASS with named unknowns; authorized to complete | Component/invariant maps exist. Current legacy inventory adds real consumers; graph lookup and dynamic/external consumer completeness remain unresolved. |
| B — Baseline | **HOLD; repetitions collected, qualification incomplete** | Later author-run repetitions and corrected deny statuses exist. Corpus oracle limits, raw provenance, uncertainty rationale, independent scoring and operator signature remain open. |
| C — Ablation | **AUTHORIZED (P0-E); no paired run** | No paired ablation executed. §9 permits an explicit retain disposition without one. |
| D — Migration | **AUTHORIZED; not implemented** | Concrete reader/writer manifest and MP-01…MP-03 designs exist; implementation, parity evidence and Q04/Q05 owner review remain. |
| E — Security | **AUTHORIZED; independence still absent** | Existing negative tests are evidence, not independent qualification. Operator waiver records author-only testing, which is a weaker claim and must be labeled as such. |
| F — Release | **AUTHORIZED to assemble; signature outstanding** | Q13. The maintainer decision and independent clearance cannot be supplied by this agent or by an authorization. |

Authorization source: `docs/audits/2026-10-23-harness-authorization.md`.

## What the measurements support

- Historical artifact coverage spans ten strata. Later evidence adds two
  four-worker coordination runs and one persisted-running-worker kill/resume
  cycle. These do not qualify every benchmark contract; local CPU suite success
  remains unmeasured under the recorded hardware disposition.
- The coverage generator admits cost records in 9/10 strata under its legacy
  schema. That count is not independent baseline qualification or ablation
  readiness; it must not substitute for the requirement matrix.
- Five of nine delegate cases are scripted-expectation contracts and unusable as
  real-model quality measurements. They consumed $0.524213 of $0.994258 (52.7%).
  Historical **7/12 at $0.067149 per scored success** and later **10/12 at
  $0.045688** both include an invalid old deny task. They are mixed historical
  figures, not qualified baseline rates or a like-for-like improvement.
- Later strata 4/5/10 each record 3/3 final-state outcomes. Verification and
  recovery sequences are not independently established by those file oracles.
  The current corpus audit fixes three comment-decoy false passes, aligns task
  formatting, corrects recovery setup and adds independent positive guards for
  complete workspace preservation, the isolated outside sentinel, partial-output
  correctness and durable execution sequences. Historical runs retain their original
  task/oracle contracts; they are not revised-corpus reruns.
- Corrected deny-task runs record `failed` in 3/3. Earlier `success` reports
  followed a permitted in-workspace task and were not established false claims.
  The revised guard additionally observes a private escaped-target sentinel;
  scripted mechanics pass, while independent containment/refusal qualification
  and real-model collection under the new contract remain open.
- Strata 1/2 each retain 3/3. Stratum 3 retains **6/6 across two valid edit
  cases**, plus an invalid old patch task 0/3. Corrected patch 3/3 is
  author-reported without a located raw rerun artifact. Four-worker coordination
  is n=2; crash/resume is n=1; local CPU is unchanged. These small samples and
  differing contracts do not establish a distribution or universal threshold.
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

The old `benchmark/evidence/cost/eval-mainloop-metered.json` is strata **1–2**, not 3; its weak-oracle
verified-success counts remain null. Stratum 3 is `benchmark/evidence/cost/cost-record.json`, whose
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

The [complete corpus audit](audits/2026-10-23-eval-corpus-audit.md) records the
latest offline checks, each case's disposition and remaining oracle work. This
pass claims no fresh full node lane, model sweep, ablation or independent security
qualification.

## Next acceptance packet

The Gate B acceptance packet is assembled:
[`audits/2026-10-23-gate-b-acceptance-packet.md`](audits/2026-10-23-gate-b-acceptance-packet.md).
Scope: Gate B only (PRD §9 baseline, PRE-R005/R006, §7 measurement contract).
Source pin: branch `feat/phase0-master-prd`, commit `7ca6f689`, clean tree.
It assembles committed evidence, records `null` for every unmeasured field, and
recommends Gate B HOLD with Gate E independence and Gate F/Q13 signature still
blank. It is not a pass, a signature, or a qualification, and it authorizes no
collection or spend.

Remaining work before a baseline can be signed:

1. Complete source/consumer review and historical provenance disposition.
2. Finish shim trigger/usage/retirement catalog and benchmark isolation protocol.
3. Design the missing human-review comparisons and metric capture.
4. Approve or reject the priced, scoped collection proposal
   [`audits/2026-10-23-gate-b-collection-proposal.md`](audits/2026-10-23-gate-b-collection-proposal.md).
   It is a proposal only: 52 planned runs, base estimate `$2.947558` at the recorded
   catalog rate, requested ceiling `$4.50`, plus a prerequisite capture extension for
   latency, tool/retry counts and operator review time. Nothing may run until the
   operator fills its approval block.
5. Obtain baseline signature and independent security review on exact artifacts.

Full PRD completion remains open. Audit closure with HOLD requires an explicit
operator disposition; it cannot silently waive the unmet gates.
