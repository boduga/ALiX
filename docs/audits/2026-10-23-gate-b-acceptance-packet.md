# Gate B acceptance packet — pre-2.0 harness baseline

**Packet version:** 1.0 (assembled 2026-10-23)
**Source pin:** branch `feat/phase0-master-prd`, commit
`7ca6f6899bfd87ea3fadb7fe74c19c654178685a` (working tree clean at assembly)
**Requirements:** [PRD v1.2, filename `ALiX_PRE_2_0_HARNESS_PRD_v1.1.md`](../ALiX_PRE_2_0_HARNESS_PRD_v1.1.md)
**Recommended decision: GATE B HOLD. Gate E independence absent. Gate F / Q13 HOLD.**

This packet assembles committed evidence. It is not a pass, not a signature, and not
an independent qualification. It grants no publication, push, merge, deploy,
model-run or spend authorization. Reviewer and operator fields are intentionally
blank.

---

## 1. Scope and source pin

**In scope.** Gate B — Baseline, defined by PRD §9 as a "versioned, independently
scored benchmark with reproducible environment", with the measurement contract in
PRD §7, §6 and §12.3, and requirements PRE-R005 (versioned corpus and independent
oracle) and PRE-R006 (baseline metrics).

**Source pin.** All hashes in §8 are Git blobs at `7ca6f689`. Individual evidence
artifacts pin their own producer commits, which differ; see §5.

**Evidence read for this packet** (all committed, none rewritten):

- `docs/harness-readiness-report.md`
- `docs/audits/2026-10-23-harness-acceptance-matrix.md`
- `docs/audits/2026-10-23-eval-corpus-audit.md`
- `docs/audits/2026-10-23-harness-baseline-provenance.md`
- `docs/audits/2026-10-23-harness-authorization.md`
- `docs/audits/2026-10-23-eval-false-pass-defect.md`
- `docs/harness-delegate-evidence-validity.md`
- `docs/2026-10-23-delegate-baseline-remeasurement.md`
- `docs/2026-10-23-strata-repetition-pass.md`
- `benchmark/evidence/eval-runs/guarded-2026-10-23.json`
- `benchmark/evidence/eval-runs/deterministic-14of14.json`
- `benchmark/evidence/cost/*.json` and `benchmark/evidence/coordination/*.json`
  listed in §8

Raw JSON was inspected directly; numbers below were recomputed from the rows, not
copied from the prose documents.

**Not executed by this packet.** No model or provider call, no API spend, no
benchmark run, no ablation, no security qualification, no migration, no publication,
no push. No credential lookup.

**Graph check for this documentation-only change.** A full
`gitnexus analyze --force --index-only` rebuild completed at assembly (91,036 nodes,
208,700 edges, 1,230 flows). `detect-changes --scope all` reported 3 files /
4 documentation sections, 0 affected processes, low risk, with no partial or
truncated flag. Indexing still reports incomplete flow enumeration, so absence of a
process is not proof that no execution path exists.

**What this packet deliberately does not do.** It does not pool heterogeneous
contracts into one rate, does not convert "not measured" into zero, and does not
replace the operator signature or the independent review.

---

## 2. Requirement matrix

Dispositions: **supported** = committed artifact addresses the stated acceptance;
**partial** = artifact exists and covers part of it; **missing** = no artifact of
the required kind; **requires reviewer/operator** = cannot be supplied by this
agent at all.

| ID | Requirement (source) | Evidence and exact claim | Disposition | Remaining acceptance action |
|---|---|---|---|---|
| GB-01 | Versioned corpus with independent oracle (PRE-R005; PRD §9 "versioned") | `src/operations/evals/cases/` at pinned hashes; `benchmark/evidence/eval-runs/guarded-2026-10-23.json` pins 8 source-file SHA-256 values that match `7ca6f689` exactly (verified for this packet) | partial | Corpus version is pinned by file hash, not by a corpus version identifier. Independent oracle review is not done — the oracle is author-written. |
| GB-02 | Revised-contract scripted proof | `guarded-2026-10-23.json`: run `dc62400b-72fa-4a59-b0f2-18ccbd374393`, `total: 14`, `passed: 14`, `failed: 0`, `inadmissible: 0`, `objectiveLanded: 8`, 7 configured positive guard groups `satisfied: true` | supported as scripted mechanics only | Nothing further for mechanics. Must never be reported as model quality or a baseline rate (see GB-09, GB-10). |
| GB-03 | Oracle gaps closed for future collection | `src/operations/evals/eval-guards.ts`: outside-sentinel, complete read-only workspace snapshot, partial-output exact bytes, durable tool-sequence correlation (verified by two `toolEvidence.complete: true` records in the proof run) | supported for revised contracts | Historical paid runs cannot inherit these guards. Any new collection must retain guard evidence per row. |
| GB-04 | Reproducible environment recorded per run | Artifacts carry `provider`, `model`, `sourceCommit` in some cases; none carries runtime version, config hash, offered-tool hash, or dirty-state | partial | Missing fields are enumerated in §5. Recording them requires a new capture contract, not a rerun. |
| GB-05 | Ten-stratum coverage | §3. All ten strata have at least one committed artifact; strata 6 and 8 have n≤2, stratum 9 is a single historical observation | partial | Do not read coverage as qualification. Per-stratum sample size and contract caveats stay visible. |
| GB-06 | Primary measure: measured cost / independently verified success | Recomputed valid-contract subtotal is 24 runs, 24 verified, `$0.936605` (see §4). **No independently verified denominator exists** | missing | The metric must be reported as `null / unavailable`. Only an independent scorer can supply the denominator. |
| GB-07 | Mean / median cost, token counts | Present per artifact and per case (§4). Costs are catalog-priced from observed tokens, not invoice-reconciled | partial | Invoice reconciliation and per-invocation rate evidence are absent. |
| GB-08 | p50/p95 latency | **Absent.** No per-case finish timestamps exist in any cost artifact; `startedAt` only. Stratum 6 records whole-run `wallSeconds` (77 s, 54 s) including planner overhead | missing | Latency reporting is not possible from committed evidence. Keep separate from elapsed/wait time. |
| GB-09 | Success rates with uncertainty (PRD §6, §7) | Every repeated case is n=3, or n=2 / n=1 for strata 6 and 8. Artifacts state "n=3 supports 2 of 3, not a distribution" | partial | No confidence interval or target threshold is justified by this design. Thresholds stay unfrozen until a baseline exists. |
| GB-10 | Reject mixed/confounded historical ratios | The historical 7/12 at `$0.067149/success` and the later 10/12 at `$0.045688` both include the invalid old deny task. The delegate delta is confounded by `c0def71d` postdating the sweep commit `bebe1909` | supported as an exclusion | Neither ratio may be cited as a baseline rate or an improvement. |
| GB-11 | Operator attention as a separate measured dimension (PRD §7, §12.3) | No artifact records operator active review minutes, interruptions, or approval touches | missing | `operatorActiveReviewMinutes / verifiedSuccesses` is `null`. Never convert operator time to a dollar figure. |
| GB-12 | Independent scoring (PRD §9, Gate E boundary) | Every artifact states author-run, same-author evaluator, or "no independent review" | missing | Requires an independent scorer. An operator waiver records author-only testing as a weaker labeled claim; it does not create independence. |
| GB-13 | Provenance disposition for historical records | `2026-10-23-harness-baseline-provenance.md` classifies table replay, arithmetic replay, and scenario reproduction; four historical records lack original events | partial | Disposition is written; it does not recover deleted raw evidence. `benchmark/evidence/` has no deletion history, so unrecovered records were never produced. |
| GB-14 | Operator acceptance of the baseline | No acceptance record exists; `2026-10-23-harness-authorization.md` authorizes the work, not a result | requires reviewer/operator | Signature on an exact artifact set. Blank below (§6). |

---

## 3. Ten-stratum reconciliation

Sample sizes are per stratum; contracts differ between strata and between
historical and revised runs. Do not pool.

| # | Stratum | Observed n | Outcome scope actually measured | Artifact | Missing fields |
|---|---|---|---|---|---|
| 1 | Read-only inspection | 3 | 3/3 under seeded-file equality and reported answer | `cost/strata-1-3-repetitions-2026-10-23.json` | Extra-file noninterference was not measured by this artifact; the guard exists only for the scripted run |
| 2 | Code navigation | 3 | 3/3 under requested file/value and seeded bytes | same | Same noninterference limit |
| 3 | Single-file edit | 3 + 3 + 3 (+3 author-reported) | write-file 3/3; block-replacement 3/3; patch-application **0/3 on an unpassable task** (excluded); corrected patch rerun 3/3 author-reported with no located raw artifact | same; `docs/2026-10-23-strata-repetition-pass.md` | No raw rerun artifact for corrected patch; cost `$0.145900` appears only in prose |
| 4 | Multi-file bug fix | 3 | 3/3 final state | `cost/delegate-baseline-2026-10-23.json` | Prior task contract; verification sequence not enforced |
| 5 | Verification / repair | 3 | 3/3 repaired-file state | same | Neither task nor oracle proves an executed verify→repair loop |
| 6 | Four-worker coordination | 2 | 2/2 runs landed 4 markers with `workerCount: 4` | `coordination/stratum6-four-worker-2026-10-23.json` | n=2; no per-worker latency; no source/config pin |
| 7 | Capability mix (allow/ask/deny) | 3 | 3/3 deny task reports `failed` under the corrected task | `cost/deny-case-fixed-2026-10-23.json` | Outside-target observation is a separate instrumented run, not part of these three rows |
| 8 | Crash / restart, outcome unknown | 1 | 1/1 kill on a persisted `running` worker, same run resumed, 3/3 artifacts | `coordination/stratum8-restart-2026-10-23.json` | n=1; no repeated crash corpus; no source/config pin |
| 9 | Local CPU-only | 1 | One historical `Hi` task, 622 s wall, cost `null` | `cost/stratum9-observation.json` | No raw command, session events, CPU or network proof; no suite-level success rate |
| 10 | Tool failure / malformed recovery | 3 (tool failure) + scripted only (malformed) | 3/3 recovery task final state | `cost/delegate-baseline-2026-10-23.json` | Final-file oracle does not prove the failed-call→recovery sequence on a real provider; malformed-call case is scripted-only |

**Cross-stratum caveats.**

- Stratum 3's "12/12 across four cases" in `docs/2026-10-23-strata-repetition-pass.md`
  is not supported by the committed artifact: the artifact shows 6/6 across the two
  valid mutation cases plus a 0/3 invalid patch task. The committed artifact governs.
- The five scripted-only cases (`unmet-write-zero-attempts`, `partial-objective`,
  `multi-file-fix-partial`, `verification-repair-not-applied`, `malformed-tool-call`)
  are excluded from every real-model denominator. They consumed
  `$0.524213` of `$0.994258` (52.7%) in the historical sweep with no usable
  real-model evidence.
- `deterministic-14of14.json` (2026-10-21) precedes the guard work and retains
  `/tmp/...` workspace paths; it is historical and the guarded run supersedes it.

---

## 4. Metric ledger

Computed by this packet directly from artifact rows. `null` means not recorded,
never zero.

### 4.1 Committed real-model artifacts (2026-10-23 repetitions)

| Artifact | Runs | Verified | Cost USD | Input tokens | Output tokens | Mean cost/run | Median cost/run |
|---|---|---|---|---|---|---|---|
| `cost/strata-1-3-repetitions-2026-10-23.json` | 15 | 12 | 0.560188 | 216,571 | 1,876 | 0.037346 | 0.044840 |
| `cost/delegate-baseline-2026-10-23.json` | 12 | 10 | 0.456878 | 171,911 | 2,710 | 0.038073 | 0.037400 |
| `cost/deny-case-fixed-2026-10-23.json` | 3 | 3 | 0.064465 | 24,718 | 267 | 0.021488 | 0.021507 |
| **Total** | **30** | **25** | **1.081530** | **413,200** | **4,853** | 0.036051 | — |

### 4.2 Valid-contract subtotal

Excludes the unpassable patch task and the superseded old deny task (`delegate-baseline`
`forbidden-path-write` rows predate the task fix):

| Subset | Runs | Verified | Cost USD | Input tokens | Output tokens |
|---|---|---|---|---|---|
| Strata 1–3 minus patch-application | 12 | 12 | 0.481970 | 186,284 | 1,626 |
| Delegate three valid cases | 9 | 9 | 0.390170 | 147,340 | 2,182 |
| Corrected deny case | 3 | 3 | 0.064465 | 24,718 | 267 |
| **Subtotal** | **24** | **24** | **0.936605** | **358,342** | **4,075** |

This subtotal is **not** a qualified baseline rate. Its denominator is author-scored,
the strata are not comparable, and the sample is n=3 per case.

### 4.3 Coordination and local axes

| Item | Runs | Verified | Cost USD | Input tokens | Output tokens | Elapsed |
|---|---|---|---|---|---|---|
| Stratum 6, four workers | 2 | 2 | 0.431245 | 162,262 | 2,559 | 77 s, 54 s wall (includes planner) |
| Stratum 8, kill + resume | 1 | 1 | 0.165505 | 62,110 | 1,023 | null |
| Stratum 9, local CPU | 1 | not scored | **null** (non-billable) | 3,304 | 14 | 622 s |

### 4.4 Fields required by PRD §7 and their status

| Field | Status |
|---|---|
| Total tasks | 30 committed real-model repetitions in the three 2026-10-23 cost artifacts; 34 when stratum 6 (2), stratum 8 (1) and the stratum 9 local observation (1) are added |
| Verified successes | 25 of 30 in the cost set; 28 of 34 overall; stratum 9 is not scored |
| Mean / median cost | Present per artifact and per case; pooled mean is not a population estimate |
| p50 / p95 latency | **null / not recorded** — no per-case finish timestamps |
| Tokens | Present and observed for every 2026-10-23 real-model row |
| Tool calls / repeated calls | **null / not recorded** in cost artifacts; present only for two scripted guard cases |
| Retry count | **null / not recorded** |
| Operator interventions | **null / not recorded** |
| Operator active review minutes | **null / not recorded** |
| Local resource-time | 622 s wall for stratum 9; CPU and network proof absent |

### 4.5 Cost basis

Every dollar figure above is observation-derived: providers reported usage, and the
catalog rate `$2.5 / $10 per million input/output tokens` (effective 2025-01-01) was
applied afterward. This is arithmetic reproduction of a recorded rate, not
invocation-time pricing evidence and not invoice reconciliation. Historical
`$0.994258` (2026-10-22 sweep) and `$1.759716` (2026-10-23 repetition pass) are
separate spends; the second equals `0.456878 + 0.560188 + 0.431245 + 0.165505 +
0.145900`, where the last term is the corrected patch rerun that has no committed
raw artifact.

---

## 5. Provenance and uncertainty

### 5.1 Model identity

| Record | Provider | Model string | Immutable revision |
|---|---|---|---|
| 2026-10-23 repetitions, coordination | `openai` | `gpt-4o` | **Not recorded** |
| `readonly-navigation.json` (2026-10-21) | `openai` | `gpt-4o` | **Not recorded** |
| `deny-case-repetitions-2026-10-23.json` | `hive` | `deepseek-ai/deepseek-v4.1-flash-1017` | **Not recorded** |
| `stratum9-observation.json` | `ollama` | `llama3.2:3b` | **Not recorded** |

`gpt-4o` is a catalog alias, not a pin. A provider-side model swap would be invisible
in these records. `readonly-navigation.json` also records an explicit one-off model
override because the operator default returned 429; the default was not changed.

### 5.2 Producer commits and configuration

| Artifact | Producer commit recorded | Runtime / config / offered-tool hashes |
|---|---|---|
| `cost/strata-1-3-repetitions-2026-10-23.json` | `6d61ac27` | absent |
| `cost/delegate-baseline-2026-10-23.json` | `e25f5831` | absent |
| `cost/deny-case-fixed-2026-10-23.json` | `899eb245` | absent |
| `coordination/stratum6-four-worker-2026-10-23.json` | **absent** | absent |
| `coordination/stratum8-restart-2026-10-23.json` | **absent** | absent |
| `cost/stratum9-observation.json` | **absent** | absent |
| `eval-runs/guarded-2026-10-23.json` | base `a4ce4980` + 8 source-file hashes matching `7ca6f689` | source hashes only; no tool-manifest hash |

Differing producer commits mean these runs are not a single frozen environment.
`delegate-baseline` also postdates the behavioral-suite fix `c0def71d`, which is why
its delta against the historical sweep cannot be attributed.

### 5.3 Per-invocation event availability

Cost rows carry `sessionId`, observed token counts, `pricedRecords` and
`totalRecords`. Several delegate rows record `runId: null`; the historical sweep
explains this as subagent children having no authoritative caller run id. There is
no retained raw session event stream for any paid run, so a third party cannot
recompute an outcome from events — only from the committed summary rows.

### 5.4 Contract changes that invalidate cross-date comparison

1. `patch-application` task text was unpassable (never stated the change). Fixed;
   the 0/3 rows remain in the committed artifact and must stay excluded.
2. `forbidden-path-write` named an ordinary in-workspace path that nothing forbade.
   Fixed to name `../outside/report.md` with `ownedPaths: ["report.md"]`; the
   historical 0/3 and the interim 1/3 were measuring different things.
3. `tool-failure-recovery` fixture produced an ownership denial instead of the
   documented missing-file error. Fixed.
4. Three repair oracles accepted comment-only decoys. Fixed to exact-file.
5. Both multi-file tasks now state byte preservation explicitly.
6. Positive guards added for escaped target, read-only workspace, partial output and
   executed sequences.

Historical results were **not** rescored under any of these changes and cannot
inherit the new guards.

### 5.5 Claims that cannot be replayed or generalized

- Any cost-per-success figure, including the valid-contract subtotal.
- Any latency or throughput claim.
- Any statement that a stratum is "stable" or "qualified".
- Stratum 9 as a CPU-only success rate.
- Stratum 6 as coordination scaling evidence beyond four workers, twice.
- The corrected patch rerun (3/3) as independently replayable evidence.

### 5.6 Review status

Author-side spec-compliance review followed by code-quality review found no
actionable findings in the corpus work. That is not independent Gate E
qualification, and it does not satisfy GB-12.

---

## 6. Decision record

| Field | Value |
|---|---|
| Gate B disposition | **HOLD** |
| Basis | GB-06 primary metric unavailable; GB-08, GB-11, GB-12 missing; GB-14 unsigned |
| Gate A | Historical PASS with named unknowns; no retirement implied |
| Gate C | Authorized; no paired ablation exists; §9 permits an explicit retain disposition |
| Gate D | Authorized; design only; no parity evidence |
| Gate E | Authorized; **independence absent**; author-only testing would be a weaker labeled claim |
| Gate F / Q13 | **HOLD**; technical packet is this document, signature outstanding |
| Reviewer identity | _pending — blank_ |
| Reviewer date | _pending — blank_ |
| Reviewer verdict | _pending — blank_ |
| Operator identity | _pending — blank_ |
| Operator date | _pending — blank_ |
| Operator decision | _pending — blank_ |

Nothing in this section may be filled in on another party's behalf.

---

## 7. Next work order

### 7.1 What an independent reviewer must inspect

1. Recompute §4 from the artifact rows; confirm that no ratio is drawn from a mixed
   or invalid contract.
2. Check every `verifiedSuccess` claim against the case's task text and objective in
   `src/operations/evals/cases/`; the two case-authoring defects found on 2026-10-23
   are the reason this is not optional.
3. Confirm the excluded cases are excluded, and that the five scripted-only cases
   never appear in a real-model denominator.
4. Confirm the guard code actually fails closed on missing, malformed, duplicate or
   unmatched trace records.
5. Confirm Gate E is not implied anywhere by Gate B evidence.
6. Record a verdict per requirement ID in §2, not one overall number.

### 7.2 How outcomes are scored

- Score from final state **and** retained guard evidence; model prose is never
  evidence.
- An infrastructure or transport failure is `inadmissible`, excluded from both
  numerator and denominator. It is never a refusal and never a success.
- Failed-task cost stays in the cost numerator.
- Report `null` for any unobserved field and state the coverage next to every
  aggregate.
- Report per-stratum outcomes; do not pool strata with different contracts.

### 7.3 Sampling and freeze before any new collection

- Freeze model (immutable revision, not alias), provider, config, offered-tool
  manifest, task set and oracle version before the first run; record their hashes.
- Declare the repetition count and a risk-based sampling plan up front; n=3 is not a
  distribution.
- Capture per-invocation finish timestamps, tool-call and repeated-call counts,
  retry counts, and operator active review minutes in the same pass.
- Retain sanitized raw events and guard evidence before cleanup.

### 7.4 Cost and authorization for new collection

Any new real-model collection requires a **separate priced and scoped proposal**
approved before execution. This packet does not quote current pricing and does not
authorize spend. Historical spends are reported above only so the next proposal can
be compared against them.

---

## 8. Artifact manifest

Hashes are SHA-256 of the Git blob at `7ca6f689`, verified for this packet. A hash
establishes byte identity only — not truth, qualification, or independent review.
This packet and the files it edits to link to it are deliberately not self-hashed.

### 8.1 Evidence artifacts

| Path | SHA-256 |
|---|---|
| `benchmark/evidence/eval-runs/guarded-2026-10-23.json` | `32995866ee794663773b4042b0f8f1afe57d2bd4c80af6c0dbb97bd8a5f687f9` |
| `benchmark/evidence/eval-runs/deterministic-14of14.json` | `c508a144fe8c20c8e0123cccecacf01685388f79d82b33bfd1e5d2779e2c60bc` |
| `benchmark/evidence/cost/strata-1-3-repetitions-2026-10-23.json` | `d2c73bd54b606d1edce610f1ec190bf99dffb28f26c6ad5028b8ec8b7b226d08` |
| `benchmark/evidence/cost/delegate-baseline-2026-10-23.json` | `aa8f79d90ab238b12d6d6343baad7ae2ce0478d23d877b1c9f4aac5e0e537254` |
| `benchmark/evidence/cost/deny-case-fixed-2026-10-23.json` | `3c2b83328aa74a63f454b9b8a4f7e70007b38570d6c174d85c845e9f76e52cb4` |
| `benchmark/evidence/cost/deny-case-repetitions-2026-10-23.json` | `2fecad903ec4a2232f96f4f3454d6f162435b796b3d59cd00b357a3c46fb071a` |
| `benchmark/evidence/cost/readonly-navigation.json` | `5bdbb888eb4dada979e44f404c9626ec44e88b443085b7696f360dbe9d2920fc` |
| `benchmark/evidence/cost/readonly-navigation-gpt4o.json` | `5c2fd14c937233a33daf9d64c2709b2258568436bacb7891e0eb2ac8df909d8e` |
| `benchmark/evidence/cost/eval-mainloop-metered.json` | `d1684867eba37095530201c6a0a12e864edcdc63db2711ae35c4150bb19f394e` |
| `benchmark/evidence/cost/cost-record.json` | `ddf4e89e10ff8247cef1f2dc1c778287fa3fbb77cddd536e477f910c763d2705` |
| `benchmark/evidence/cost/delegate-metered-sweep.json` | `37752df183e8c5bd48f905b569f72ab82b422ff5b66c6562f4ddd238aa401a65` |
| `benchmark/evidence/cost/delegate-repetitions-2026-10-22.json` | `d2e3aa00bc4b74e0ab331dacf35e31f49e347af59c6410451eef4b88069a3fca` |
| `benchmark/evidence/cost/stratum9-observation.json` | `ab25d0d487bcfd31124aadb7cbd55ef7c2fa9bbb0c7a9289bc93d9beda66fa8e` |
| `benchmark/evidence/cost/coordination-metered.json` | `6fa337b01a044a3c21ba216a31398fb7eeac53eb6fe3823f273659a05cf46366` |
| `benchmark/evidence/coordination/stratum6-four-worker-2026-10-23.json` | `1561a429f0e03ff706c22df55e3078a5e1961dcd09b45eea7d0b912c2c6d139d` |
| `benchmark/evidence/coordination/stratum8-restart-2026-10-23.json` | `b5bdc2ef1ff6fac5fd3fe1f7aa957f511c8426095bde163d6d71a1302cf76ded` |

### 8.2 Producers and audited source

| Path | SHA-256 |
|---|---|
| `benchmark/evidence/cost/eval-case-sweep.mjs` | `b88e1b3d075c408736320386abb3e129dec193bca5863fdc66a233cf83a7a3e9` |
| `benchmark/evidence/cost/run-delegate-sweep.mjs` | `579bd90a30873684178b4a87c7b02b49e4d8cdb9569e37090e68f295a6b222c9` |
| `benchmark/evidence/cost/summarize-readonly-navigation.mjs` | `4509b4013c873eb9b289c13b142f7779bd407e5965f2a3c1bacb7093eda15d79` |
| `benchmark/evidence/cost/summarize-readonly-navigation.test.mjs` | `a1efc9aaca92e0f20d17c6c52a6149ccf8cb971fe95192a74d5e7cc5dedeecce` |
| `benchmark/evidence/coordination/run-coordination-metered.mjs` | `e62f3ca6fdbcb79ece548433e1c74ef4d9feba80c2ea0236e9f15bb9d4a93ee4` |
| `benchmark/evidence/coordination/run-restart-metered.mjs` | `1d3862a36f072ede0d403aa68fe10776bf97c5de87404bf603e63536157d391d` |
| `benchmark/evidence/gate7/baseline-coverage-matrix.mjs` | `8ebfbf86c213ddc9184437871802b08583553e19bd7bad0d20c1bd7f028ef588` |
| `src/operations/evals/eval-guards.ts` | `a9b379a9aa87e949dc17256f0d7a9659326cf3e8352aa12d531111e80f2a5d6b` |
| `src/operations/evals/eval-admissibility.ts` | `721408143ecec8e42039e510f32b13a088b2958c8cfb4d47a9d227fbba9ef9a7` |
| `src/operations/evals/evaluators/objective-evaluator.ts` | `76869222509ac0a78d7e0dde1104d47e98c07abd9d1553964ec85c4072b6d56d` |
| `src/operations/evals/evaluators/status-evaluator.ts` | `3b16532d05fa07a8005ff3ade2fa52f03c7315435e322f2dc847a3858d759cd4` |
| `src/operations/evals/evals-runner.ts` | `7f271564dc219abe640c86cba715dc9a19769b43619b05b5b9af8255e92c12ed` |
| `src/operations/evals/evals-types.ts` | `c5cba7fdae3f594a0d966ea047b94427096c8db4a9538fd28e6e6dfcaf6936e6` |
| `src/operations/evals/providers/scripted-mock-provider.ts` | `d711e23fc7104d49889e0c35f21b6b135c9f90e7447697a32ad14e1af49c7ca9` |
| `src/operations/evals/cases/behavioral.ts` | `4beb2ff22fbd65b0e2272ae05f8b752c430d1048905deeeb6226e4126ada4e09` |
| `src/operations/evals/cases/strata-2-4.ts` | `3963f18afd4408cb13bd1d25c0e46210e6684e782ec81293054134c4a7381e5f` |
| `src/operations/evals/cases/strata-5-10.ts` | `9cab91edcb4a8f88bffdd9934fa524aeee27e5b7bc7d2d472e7814a196e0a35a` |
| `tests/evals/eval-admissibility.vitest.ts` | `72a86a2cd37267eb20d47207f3085e1d35696470d73adebd2e7c92044a16f7de` |
| `tests/evals/corpus-oracles.vitest.ts` | `eb3f176bdae326a7d762ccb6c5543f64934144966b1d32a353e327f2fb7ad866` |

### 8.3 Governing documents at the pin

| Path | SHA-256 |
|---|---|
| `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` | `28df0b2f1cc4df7dab8e615d983cab5c2b9a41aebcc085d5214393884356b879` |
| `docs/audits/2026-10-23-harness-acceptance-matrix.md` | `10e53baf280221e22cd62aa2e9291d0022fde8f7846f77b71f0963834910757a` |
| `docs/audits/2026-10-23-eval-corpus-audit.md` | `3ddfe81663e220e07541c0750681e50857f78a135b088a4d1e86281c0b4afc1a` |
| `docs/audits/2026-10-23-harness-baseline-provenance.md` | `c67ab31b5d8143af9ba77e7abf25846995d13ae38ced89854cbf800f4bc2a4f5` |
| `docs/audits/2026-10-23-harness-authorization.md` | `e81f09297a5f4d8cd6ad2df83e129f4ba14641366095b5d12d0bb0e0460587fc` |
| `docs/audits/2026-10-23-eval-false-pass-defect.md` | `36e33ce84c7a44e643d10825ad2d57e581d86e8e3bd2c9358ab9578a39b18fbf` |
| `docs/audits/2026-10-23-harness-legacy-inventory.md` | `74f56521af41ce01b2aaf3527c002eaf591af4aa7e6260ef0a6f9121fce75a2f` |
| `docs/harness-delegate-evidence-validity.md` | `12a8286281286899eb1b98511ce62d13b851725f67257b3417e52c8f0fa9ac27` |
| `docs/2026-10-23-strata-repetition-pass.md` | `150edb5d895e592d4c5dd39a487e9d7e57f94fd3ed6eff7918f200bbc4d4c4ac` |
| `docs/2026-10-23-delegate-baseline-remeasurement.md` | `f86ef1e354dbdc8de05919ddc068d52e7e9cf216058e528716e513a51d0c5e27` |
| `docs/2026-10-23-harness-audit-opencode-handoff.md` | `0ad01ac009a535fc74c2f96dae63af5ea82fae2568237da7827989a79a200d52` |

---

## Appendix A — Reconciliation notes for reviewers

1. `docs/2026-10-23-strata-repetition-pass.md` reports stratum 3 as 12/12 across
   four cases and a total spend of `$1.759716`. The committed artifact shows 6/6
   valid plus 0/3 invalid, and the corrected patch rerun has no committed raw
   artifact. Treat the artifact as authoritative; the handoff is a narrative record.
2. `deny-case-repetitions-2026-10-23.json` is `hive` / `deepseek-v4.1-flash-1017`
   with `costUsd: null` (no catalog entry). Its 1-of-3 `success` reading was
   withdrawn as a false claim because the task then named an in-workspace path.
   It is retained for history and must not enter any rate.
3. `eval-mainloop-metered.json` is strata 1–2, not stratum 3, and its
   `verifiedSuccesses: null` must stay null — the case workspaces were deleted and
   the old oracle checked existence only.
4. `cost-record.json` reproduces `$0.108968` arithmetically; its historical 8/8
   qualification cannot be rerun without original session events.
5. `coordination-metered.json` used three workers, not the PRD's four; it is
   superseded on the worker-count contract by the 2026-10-23 four-worker record.
6. The coverage generator's "9/10 strata admitted" count reflects the legacy record
   schema, not qualified baseline coverage.
