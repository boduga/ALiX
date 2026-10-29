# Harness readiness report — reconciled 2026-10-23

**Verdict: PARTIAL; Gate B HOLD.** Corpus/evidence reconciliation: `a4ce4980`
plus working changes on `feat/phase0-master-prd`. Other source assessments retain
their earlier `c0def71d` scope. No API spend or publication in this reconciliation.
Requirements remain PRD v1.2 (filename v1.1).

> **Agent-driven closeout amendment — 2026-10-28.** Harness PRD v1.2 now removes routine human-in-the-loop execution, grading, review, remediation, and readiness assessment. Historical signatures/approvals below remain provenance only. Active closeout evidence must come from independent verifier/critic agents and deterministic checks. Missing delegated authority yields durable `BLOCKED`; it is not converted into a human-review stage. Gate F is an agent-generated readiness handoff; actual publication/release remains outside the Harness loop unless pre-existing delegated release authority exists.


The [32-requirement acceptance matrix](audits/2026-10-23-harness-acceptance-matrix.md)
is the detailed assessment. It separates definitions, historical results,
executed checks and independent qualification. Historical operator acceptance is provenance, not a current Harness closeout criterion. The previous
blanket claim that PRE-R015–R032 were all untouched was incorrect: several ask
for designs that already exist. Their existence does not prove measurements.

## Gates

| Gate | Verdict | Evidence / remaining acceptance |
|---|---|---|
| A — Inventory | Historical PASS with named unknowns; authorized to complete | Component/invariant maps exist. Current legacy inventory adds real consumers; graph lookup and dynamic/external consumer completeness remain unresolved. |
| B — Baseline | **CLOSED-WITH-WAIVER (historical)** | Historical 13-met/1-waived closure and `36/45` / `$0.080520` evidence remain provenance. Under the 2026-10-28 amendment, the waived human-attention dimension is replaced by autonomous-review metrics that are still unmeasured; Gate B historical closure is not reopened solely for that reason, but PRE-R015–R019 remain open until agent-review evidence exists. |
| C — Ablation | **RETAIN DISPOSITION RECORDED; no paired run** | No paired ablation executed. §9's "otherwise retain" branch is exercised in [`harness-gate-c-retain-disposition.md`](harness-gate-c-retain-disposition.md): both M2 candidates retained, none retired, and it is explicitly not a measured efficiency finding. PRE-R007/R008 remain unexecuted comparisons. |
| D — Migration | **AUTHORIZED; not implemented** | Concrete reader/writer manifest and MP-01…MP-03 designs exist; implementation requires machine-verifiable delegated authority, parity evidence, and independent verifier/critic qualification. |
| E — Execution/security | **HOLD — 0 of 5 clauses qualified** | An independent model-independent review ([Codex/gpt-6.1-sol](audits/evidence/2026-10-25-codex-gate-e-review.txt)) **rejected** the author-side qualification: authority and ownership are NOT QUALIFIED (hard deny bypassed in ask-mode safe-shell dispatch; `shell.run` escapes owned scope), F8b/crash-recovery/denied-action are partial. 2 of the 11 defects were in this gate's own validator and are fixed; the two authority holes (D1 deny bypass, D2 shell write escape) are **remediated** with mutation-checked tests, while D11 (deny-wins precedence) and five more remain open. See [Gate E qualification](audits/2026-10-24-gate-e-qualification.md). |
| F — Readiness handoff | **HOLD** | Harness-local Gate F now requires exact-artifact provenance, completed technical/security qualification, and an agent-generated readiness verdict. Actual Q13 publication/release remains outside this Harness loop unless pre-existing delegated release authority exists. Historical maintainer-decision absence remains release provenance, not an in-loop Harness acceptance task. |

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
| R015–R019 autonomous review/briefs | **Metric/protocol contracts reconciled 2026-10-28**; read-only brief fields, governance and provenance rules preserved; deterministic review scorer 5/5 | Execute paired verifier/critic presentation trials and capture cost, latency, disagreement, BLOCKED escalation and seeded-risk misses. Future renderer qualification remains open. |
| R020–R026 Harness² | Historical demo result, component map, manifest, paired design, recursion/holdout rules and defer/reject recommendation | Demo logs/clone locally corroborated, not freshly executed or portable dependency-qualified; benchmark-specific isolation and independent authority review remain open. No adoption or model-backed probe. |
| R027–R032 autonomous verification | Authority map now separates permission modes from verification modes; eligibility schema defines pre-versioned thresholds and fail-closed downgrade to full verification/`BLOCKED`; non-bypass specification retained | No verifier/critic sampling/risk measurements or executed autonomous-mode qualification. No agent may self-promote authority; missing qualification or authority => `BLOCKED`. |

## Executed verification and limits

`c0def71d` fixed a real summary defect: a no-tool nudge followed by bare `Done.`
no longer discards the preceding substantive answer. Original answer objectives
were preserved. The preceding verified pass recorded behavioral **14/14**, eval
unit tests **173/173**, task-loop tests **52/52**, build, unused-symbol,
dead-module and DOX checks. Child-process checks required normal process
visibility; task-loop checks used a one-off 60s test budget during indexing.
Those are regression results, not Gate E clearance or fresh paid baselines. Gate E
coverage is recorded separately by clause in the
[qualification record](audits/2026-10-24-gate-e-qualification.md) and is
author-side only.

The [complete corpus audit](audits/2026-10-23-eval-corpus-audit.md) records the
latest offline checks, each case's disposition and remaining oracle work. This
pass claims no fresh full node lane, model sweep, ablation or independent security
qualification.

## Next acceptance packet

The Gate B acceptance packet is assembled and re-signed:
[`audits/2026-10-23-gate-b-acceptance-packet.md`](audits/2026-10-23-gate-b-acceptance-packet.md).
Scope: Gate B only (PRD §9 baseline, PRE-R005/R006, §7 measurement contract).
Assembled at branch `feat/phase0-master-prd`, commit `7ca6f689`; re-signed
2026-10-24 against `d7ee992e`. As assembled it recommended HOLD with Gate E
independence and the Gate F/Q13 signature blank. It now records Gate B
`CLOSED-WITH-WAIVER` (13 met, 1 waived) and Gate F/Q13 **HOLD computed** by
[`release-clearance-record.mjs`](../benchmark/evidence/release-clearance-record.mjs).
It is not a pass, a qualification or a release authorization, and it authorizes
no collection or spend.

Remaining work under the agent-driven closeout:

1. Complete source/consumer review and historical provenance disposition with independent verifier/critic agents.
2. Finish shim trigger/usage/retirement evidence and benchmark isolation protocol.
3. Replace the unmeasured human-attention dimension with PRE-R015–R019 autonomous-review evidence: verifier/critic cost, latency, disagreement, seeded-risk misses, and BLOCKED escalations.
4. Complete PRE-R024 rubric containment and per-arm negative execution before any model-backed probe.
5. Continue Gate E/D9 remediation until independent security qualification no longer rejects the execution boundary.
6. Produce exact-artifact agent readiness evidence for Gate F. Actual publication/release remains outside the Harness program unless machine-verifiable delegated release authority already exists; otherwise report `BLOCKED` without inserting a human review step.

Full PRD completion remains open. Gate B retains its historical labelled weaker closure. Gate E is `HOLD` because independent review rejected qualification; that gap is remediation and requalification. Harness Gate F is also `HOLD` until exact-artifact technical/security evidence and an agent readiness verdict exist. Q13 publication/release authority remains a separate external boundary and is not manufactured by agents.
