# Gate B collection proposal — priced and scoped

**Status: PROPOSAL ONLY. NOT AUTHORIZED. NO SPEND.**
**Date:** 2026-10-23
**Source pin:** `feat/phase0-master-prd`, commit `4dbbfd0d` (clean tree)
**Companion:** [Gate B acceptance packet](2026-10-23-gate-b-acceptance-packet.md)
**Gate B remains HOLD whether or not this proposal is approved.**

This document scopes the next real-model measurement pass and states what it would
cost. It does not authorize that pass, does not freeze a model, and does not quote a
current provider price. Execution requires an explicit operator approval recorded
against this file.

---

## 1. What this pass would and would not close

| Gate B requirement | Effect of an approved pass |
|---|---|
| GB-01 versioned corpus | Closes for the revised corpus if every run records corpus file hashes and guard evidence |
| GB-02 scripted proof | Already supported; unchanged |
| GB-03 oracle guards | Already implemented; new runs must retain `guardEvidence` |
| GB-04 reproducible environment | Partially closes — adds model revision, config, offered-tool manifest and runtime hashes per run |
| GB-05 ten-stratum coverage | Improves strata 1–5, 7, 10; keeps 6 and 8 at small n and 9 as a single resource observation |
| GB-06 primary metric | **Cannot close from collection alone** — needs an independent scorer (see §7) |
| GB-07 mean/median cost, tokens | Present if capture extension in §4 is implemented first |
| GB-08 p50/p95 latency | Only if per-case finish timestamps are captured; **not currently recorded** |
| GB-09 uncertainty | Improves n from 3 to 5 per case; still not a distribution |
| GB-10 mixed-ratio exclusion | Unchanged; new runs produce a separate, clearly scoped set |
| GB-11 operator attention | Only if review intervals are observed; otherwise stays `null` |
| GB-12 independent scoring | Not closable by the author; see §7 |
| GB-13 provenance | New runs carry their own provenance; historical gaps stay open |
| GB-14 operator acceptance | Not supplied by a run |

**Out of scope:** ablations (Gate C), migration (Gate D), security qualification
(Gate E), release signature (Gate F/Q13).

---

## 2. Proposed scope

### 2.1 Revised-contract real-model cases

Nine scorable cases, five repetitions each, run on the operator's current default
model resolved at run time (`models.default`), never hardcoded:

| Case | Stratum | n | Basis for n |
|---|---|---|---|
| `behavioral.read-only` | 1 | 5 | Repeated binary outcome; exposes noninterference guard |
| `behavioral.code-navigation` | 2 | 5 | Same |
| `behavioral.write-file` | 3 | 5 | Same |
| `behavioral.patch-application` | 3 | 5 | Corrected task; currently has no raw post-fix artifact |
| `behavioral.block-replacement` | 3 | 5 | Same |
| `behavioral.multi-file-fix` | 4 | 5 | Same |
| `behavioral.verification-repair` | 5 | 5 | Same, plus sequence guard |
| `behavioral.forbidden-path-write` | 7 | 5 | Security case; needs corrected contract and sentinel |
| `behavioral.tool-failure-recovery` | 10 | 5 | Same, plus recovery sequence guard |

Total case-level runs: **45**.

Five scripted-only cases are excluded and stay excluded:
`unmet-write-zero-attempts`, `partial-objective`, `multi-file-fix-partial`,
`verification-repair-not-applied`, `malformed-tool-call`. They cannot execute on a
real provider by design.

### 2.2 Coordination and crash strata

| Item | Runs | Scope |
|---|---|---|
| Stratum 6 four-worker coordination | 3 | 4 workers per run, all four markers, `workerCount` read from persisted run |
| Stratum 8 kill/resume | 3 | Kill on a persisted `running` worker, resume same run id, record attempt counters |
| Stratum 9 local CPU | 1 suite | Non-billable; resource-time only, `costUsd: null` |

Stratum 9 carries no monetary estimate. Hardware, wall time and CPU/network proof
must be retained; this proposal does not estimate its duration.

### 2.3 Not covered, and why

- **Allow/ask capability mixes (stratum 7).** The corpus has one real-model-capable
  deny case and no real-model allow/ask case. Covering those requires new case
  authoring and oracle review, which is separate corpus work.
- **Malformed tool-call on a real provider.** The case is scripted-only by design.
- **Coordination fan-out above four workers.** Untested and outside the PRD
  stratum contract.

---

## 3. Frozen inputs

Every run must record, before the first invocation:

| Input | Requirement |
|---|---|
| Model | Operator default at run start, pinned to the provider's immutable revision where one exists; alias alone is insufficient |
| Provider | Recorded per run; no ad-hoc override unless declared in the approval |
| Config | Hash of the resolved config actually used |
| Offered tools | Hash of the exact model-facing tool manifest for the session |
| Corpus | Hashes of the eval case files and oracle implementation |
| Environment | Node version, OS, architecture; local-CPU hardware for stratum 9 |
| Pricing | Rate snapshot with source and timestamp, not only the catalog default |

Unknown or missing input → do not run. A run admitted with a missing pin is not
Gate B evidence.

---

## 4. Capture contract (prerequisite code work)

Current producers do not record several Gate B fields. The following capture work
must land and be reviewed **before** collection:

| Field | Current state | Required |
|---|---|---|
| Per-case finish timestamp | absent (`startedAt` only) | `finishedAt` and duration per case |
| p50/p95 latency | absent | Computed from per-case durations; whole-suite time reported separately |
| Tool-call count | absent in cost rows | Count of tool requests and terminals per case |
| Repeated-call count | absent | Identical tool name + args repeated within a session |
| Retry count | absent | Provider retries and driver re-invocations, separately |
| Operator interventions | absent | Approval touches, aborts, manual re-runs |
| Operator active review minutes | absent | Observed intervals; `null` if not instrumented |
| Guard evidence | present for guard-enabled cases | Retain unchanged |

This is a behavior-neutral instrumentation change to `eval-case-sweep.mjs` and the
run producer, with tests. It is **not** authorized by this document and must go
through the normal reviewed-change path. Until it lands, GB-08 and part of GB-07
stay missing regardless of spend.

---

## 5. Cost

### 5.1 Basis

Per-case means are recomputed from the committed 2026-10-23 rows (packet §4). The
`patch-application` estimate uses the author-reported post-fix rerun
(`$0.145900 / 3 = $0.048633`) because no raw post-fix artifact exists. Coordination
and restart use their own artifact means.

Rate assumption: `$2.5 / $10 per million input/output tokens`, the recorded catalog
rate. This is planning arithmetic at the recorded rate, not current pricing and not
an invoice forecast.

### 5.2 Estimate

| Item | Runs | Mean USD/run | Estimate USD |
|---|---|---|---|
| `read-only` | 5 | 0.045994 | 0.229971 |
| `code-navigation` | 5 | 0.044732 | 0.223662 |
| `write-file` | 5 | 0.021422 | 0.107108 |
| `patch-application` (post-fix) | 5 | 0.048633 | 0.243167 |
| `block-replacement` | 5 | 0.048508 | 0.242542 |
| `multi-file-fix` | 5 | 0.052858 | 0.264288 |
| `verification-repair` | 5 | 0.056239 | 0.281196 |
| `forbidden-path-write` | 5 | 0.021488 | 0.107442 |
| `tool-failure-recovery` | 5 | 0.020960 | 0.104800 |
| **Case subtotal** | **45** | — | **1.804175** |
| Stratum 6 four-worker | 3 | 0.215623 | 0.646868 |
| Stratum 8 kill/resume | 3 | 0.165505 | 0.496515 |
| Stratum 9 local CPU | 1 | 0 (resource time) | 0.000000 |
| **Base estimate** | **52** | — | **2.947558** |
| Contingency (50%) | — | — | 1.473779 |
| **Requested ceiling** | — | — | **4.50** |

**Conditions on the ceiling:**

- Line items are displayed rounded to six decimals; the base estimate is the sum of
  the unrounded per-run means. Displayed rows may differ by ±0.000001.
- Valid at the recorded catalog rate and comparable token profiles only.
- A model or provider change invalidates the arithmetic; rescope before running.
- Inadmissible runs are excluded from outcomes but their spend counts against the
  ceiling.
- The ceiling is a hard stop, not a target. Reaching it before the planned runs
  complete ends collection and reports partial coverage.
- Independent scorer time is human effort, not model spend, and is not priced here.

---

## 6. Stop rules

Abort the pass and report, without substituting results, if any of these occur:

1. An S0 negative test fails, or a run executes an unauthorized action.
2. A run admits an objective with missing frozen inputs.
3. Inadmissible (infrastructure/transport) outcomes prevent reaching the planned
   repetitions — report achieved n, never pad with excluded runs.
4. Provider data is lost or a session event stream cannot be retained.
5. Unknown non-idempotent effect followed by an automatic retry.
6. Any attempt to publish or cite a result during HOLD.

Partial collection is reported as partial. It never becomes a pass by attrition.

---

## 7. Independent scoring (blocking)

Gate B requires independently scored results. This proposal cannot supply a scorer.
Two admissible paths:

- **Preferred:** an independent reviewer scores the retained artifacts offline
  using the frozen rubric and records a verdict per requirement. Then the pass can
  move Gate B toward acceptance, subject to operator signature.
- **Fallback:** author-only scoring, explicitly labeled as such wherever used. This
  is a weaker claim, does not satisfy GB-12, and Gate B stays HOLD.

Independent review is scored from retained guard evidence and final state, not model
prose. An infrastructure failure is `inadmissible`, never a refusal or a success.

---

## 8. Deliverables

1. Committed evidence artifacts per stratum, with the §3 pins and §4 fields.
2. Retained sanitized raw session events and guard evidence for the runs.
3. A per-stratum ledger in the shape of packet §4, with `null` where unobserved.
4. An independent scoring record, or an explicit author-only label.
5. A dated handoff recording achieved n, spend against ceiling, stop conditions hit,
   and what still cannot be claimed.

---

## 9. Approval

Approval is required before any invocation and must name the exact committed
version of this proposal.

| Field | Value |
|---|---|
| Operator identity | _pending — blank_ |
| Approval date | _pending — blank_ |
| Approved ceiling | _pending — blank_ |
| Approved model revision | _pending — blank_ |
| Conditions added by operator | _pending — blank_ |

Until this block is filled by the operator, this document authorizes nothing.
