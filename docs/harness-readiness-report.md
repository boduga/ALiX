# Harness readiness report (P0 — deliverable 6, PRE-R014)

**Status:** PARTIAL PASS / **Gate B HOLD** / Gate C–F not met.
**Artifact under assessment:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`
(tree dirty-carrying: uncommitted work excluded from every claim below unless named).
**Baseline the audit was pinned to:** `4ac6df14` (tree `8bf5ac2b`), branch
`docs/pre-2.0-harness-audit`.
**Runtime:** Node `v26.11.0`, package version `0.6.0`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §5 (PRE-R014), §9, §10.
**Publication:** HOLD (Q13). Nothing in this report authorizes push, merge,
deploy, release, or production simplification.

This report answers one question only: **which requirements are satisfied by
evidence, and which are unknown?** Unknown stays unknown. A document existing is
not evidence a gate passed, and this report does not upgrade any verdict without
an artifact that a reviewer can re-check.

---

## 1. Gate verdicts

| Gate | Criterion (PRD §9) | Verdict | Basis |
|---|---|---|---|
| **A — Inventory** | all high-risk candidates mapped; unknown source/ownership blocks retirement | **PASS with named unknowns** | `harness-component-inventory.md`; §7 lists unresolved items rather than closing them |
| **B — Baseline** | versioned, independently scored benchmark with reproducible environment | **HOLD** | Coverage 10/10 verified; cost-per-verified-success in 9/10 strata; **reproducibility partial** — 5 of 7 evidence records have a committed driver, the rest do not; **n=1** per stratum |
| **C — Ablation** | demonstrable efficiency gain with no unaccepted correctness regression | **NOT STARTED — not authorized** | PRD §12.4 forbids P0-E ablations at this revision |
| **D — Migration design** | Q04/Q05 cover every supported reader/writer | **NOT STARTED** | PRE-R010 inventory incomplete (gap F-05) |
| **E — Execution/security** | F8b, authority, crash/recovery, ownership, denied-action negatives qualified **independently** | **PARTIAL — not independently qualified** | S0 negatives exist and pass; independence is a separate security track (P0-G), not performed here |
| **F — Release** | technical evidence + independent security clearance + authorized maintainer approval on the exact artifact | **HOLD** | Q13; no maintainer approval exists |

**No gate above is reported as PASS beyond Gate A.** Gate B is the one this work
advanced, and it did not clear it.

---

## 2. Requirement status

### 2.1 PRE-R001–R014

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| R001 | Pin commit, dirty state, branch, schema, Gate 7 differences | **met** | this report's header; `harness-component-inventory.md` baseline section |
| R002 | Inventory every candidate with symbol/callers/owner/tests/class | **met with unknowns** | 13 HC candidates classified S0/S1/M1/M2/L0; caller graph is import-count proxy (dynamic dispatch not captured) |
| R003 | Publish protected S0 invariant map | **met** | `harness-invariant-register.md` §2: S0-1…S0-7, each with owning authority and negative test |
| R004 | Identify duplicated decisions / incompatible transitions | **partially met** | authority map names one owner per decision; `harness-decision-transition-map.md` |
| R005 | Fixed, versioned task corpus, independently verified outcomes | **met for 10 strata** | `src/operations/evals/cases/` (14 behavioral cases); evaluator-owned assertions + honesty contract |
| R006 | Baseline verified success, tokens, cost, latency, retries, tool calls, intervention | **partial** | tokens/cost/verified-success recorded for 9/10 strata; **latency partially**, **retries and operator intervention not measured**; every figure **n=1**. Seven drivers committed; four cost files lack a producer (U-1) |
| R007 | Prompt/shim ablations without modifying production defaults | **NOT STARTED — blocked** | Requires Gate C authorization; see `harness-ablation-report.md` §4 for the seam analysis that avoids touching production defaults |
| R008 | Benchmark patch-format, routing, context strategies | **NOT STARTED (P2)** | — |
| R009 | Register model-facing shims with owner/trigger/usage/tests/retirement | **NOT STARTED** | HC register classifies candidates but does not carry per-shim usage telemetry |
| R010 | Inventory legacy readers, aliases, wrappers, formats, consumers | **partial** | `config.model`/`config.subagents` projection readers **not inventoried** (F-05) — blocks safe retirement |
| R011 | Reversible consolidation proposals, one package per concern | **NOT STARTED** | — |
| R012 | Preserve independent authorization across in-process and child workers | **met** | S0-1/S0-2 (`WorkerApprovalPort`), R1.5 containment, pinned both ways |
| R013 | Enforce audit/design/experimental/production separation | **met** | nothing pushed; publication HOLD; no production default modified |
| R014 | Publish final readiness verdict with blockers and evidence links | **met by this document** | — |

### 2.2 PRE-R015–R032 (v1.1 amendments)

The PRD states all eighteen are **not started**. Re-checked against the tree at
this commit: **that remains accurate for all eighteen.** Definitions now exist as
separate design artifacts (deliverables 7–12), and defining a requirement is not
satisfying it. None of the new documents claims a measurement it did not take.

| Group | Requirements | Status |
|---|---|---|
| Operator attention (§12) | R015–R019 | **not started** — definitions in `harness-operator-attention-metrics.md`, contract in `harness-decision-brief-contract.md`; every measure `not measured` |
| Harness² research (§13) | R020–R026 | **not started** — source review/spec/readiness written read-only; the upstream demo was **not reproduced** |
| Progressive supervision (§14) | R027–R032 | **not started** — authority map and eligibility schema proposed; no evaluation executed |

---

## 3. What is genuinely established

Claims below are supported by an artifact a reviewer can re-run or re-read.

1. **The ten task strata have coverage, and 10/10 are verified.** One stratum
   (9, local CPU-only) rests on a verified inference observation rather than a
   suite run — hardware-excused with the measurement recorded (F-13). Its suite
   completion rate is **unmeasured** and no claim depends on it.
2. **Cost-per-verified-success exists for 9/10 strata** (`$0.044678`–`$0.211623`).
   Stratum 9 is `null` by construction (non-billable), never zero.
3. **Authorization survives the worker boundary.** Single-use consumption, child
   self-approval prevention, and ownership parity are all pinned by negative
   tests that fail when the guard is reverted.
4. **The owned-scope authorization defect found by this audit is fixed**
   (`bf29449b`): the gate returned the capability allow before the owned-path
   rule, so under auto/bypass a write worker could write outside its grant.
5. **Two harness defects found by running, not reading** are fixed with
   regression tests: the child provider ignored the configured call budget
   (`f8a335b7`) and the policy gate could emit zero `approval.created` on a
   composition root whose store has no `EventLog` (`a64f57f7`).
6. **The verification lanes are green on this artifact.** Node lane: 8923 tests,
   8917 pass, 0 fail, 6 skipped. Typecheck, unused-symbol gate, dead-module gate,
   architecture boundaries and DOX claim audit all clean.

---

## 4. What remains unknown (and is not rounded up)

| # | Unknown | Why it blocks | Consequence if ignored |
|---|---|---|---|
| U-1 | **Reproducibility of every cost figure** | **Partial, not absent.** Seven driver scripts are committed and runnable (`benchmark/evidence/cost/*.mjs`, `benchmark/evidence/coordination/*.mjs`), and the fixture suite passes 6/6 with no network. But four recorded cost files have **no committed producer**: `readonly-navigation.json` (strata 1–2), `eval-mainloop-metered.json` (stratum 3), `delegate-metered-sweep.json` (strata 4/5/7/10) and `stratum9-observation.json` (stratum 9). Those rows cannot be regenerated from this repo; the rest can, at the cost of real billable calls | A reviewer cannot regenerate every baseline row, so Gate B cannot be signed |
| U-2 | **Statistical support** | Every stratum figure is **n=1** | No uncertainty is reported; a single lucky or unlucky run is indistinguishable from a baseline |
| U-3 | **HC-01 / HC-03 effectiveness** | No ablation is authorized or run | "Can be removed" is a hypothesis, not a finding |
| U-4 | **Operator attention** | Not instrumented | Cost-per-success omits the scarce resource §12 was written about |
| U-5 | **Latency, retries, intervention** | Recorded only incidentally, not as scored dimensions | An efficiency claim cannot separate "cheaper" from "slower but cheaper" |
| U-6 | **Independence of security qualification** | P0-G is a separate track, not performed | Gate E self-assessment by the same author is not independent clearance |
| U-7 | **Supervision eligibility thresholds** | No evaluation exists; no threshold may be invented | Any numeric autonomy threshold would be fabricated |
| U-8 | **D4-04 delegate transport** | Bounded (42 consecutive passes, zero reproduction), not fixed | A delegate case may not be sole evidence until it reproduces or is hardened |

---

## 5. Stop conditions currently in force

From PRD §9, all still binding: unauthorized execution (**none attempted**),
missing authoritative evidence (**Gate B, U-1..U-3**), non-idempotent automatic
retry after uncertain effects (**n/a here**), unexpected data loss (**none**),
approval reuse (**prevented by S0-1**), unverifiable benchmark results
(**U-1/U-2**), and absorption of publication during HOLD (**not attempted**).

---

## 6. Verdict

**PRE-R014 verdict: PARTIAL PASS with Gate B HOLD.**

- Gate A: **pass**, with the unknowns in `harness-component-inventory.md` §7 left open.
- Gate B: **HOLD** — coverage and 9/10 cost measurement are real progress over the
  PRD's recorded 1/10 state, but reproducibility and sample size are the gate
  criteria and neither is met.
- Gates C–F: **not met**; C is not authorized.
- PRE-R015–R032: **not started**, as recorded.

**Not authorized by this report:** publication, merge, deployment, release,
production simplification, or any claim that the harness is Gate-B complete.

---

## 7. Traceability

| Artifact | Role |
|---|---|
| `harness-component-inventory.md` | Gate A register (deliverable 1) |
| `harness-invariant-register.md` | S0 authorities and gaps (deliverable 2) |
| `harness-benchmark-spec.md` | Scoring model and validity rules (deliverable 3) |
| `harness-ablation-report.md` | Gate C design + why no comparison is admissible (deliverable 4) |
| `harness-cutover-plan.md` | Dependency order and rollback (deliverable 5) |
| `harness-operator-attention-metrics.md` | PRE-R015 definitions (deliverable 7) |
| `harness-decision-brief-contract.md` | PRE-R016–R019 contract (deliverable 8) |
| `harness2-source-review.md` | PRE-R020–R021 (deliverable 9) |
| `harness-optimization-experiment-spec.md` | PRE-R022–R025 (deliverable 10) |
| `harness-optimization-readiness.md` | PRE-R026 recommendation (deliverable 11) |
| `harness-supervision-authority-map.md` / `harness-supervision-eligibility-schema.md` | PRE-R027–R032 (deliverable 12) |
