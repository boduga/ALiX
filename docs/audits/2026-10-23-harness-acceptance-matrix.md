# Pre-2.0 harness acceptance reconciliation — 2026-10-23

**Verdict: OPEN; Gate B HOLD.** This is an evidence assessment, not operator
acceptance, an ablation authorization, or release clearance.
**Requirements:** [PRD v1.2](../ALiX_PRE_2_0_HARNESS_PRD_v1.1.md) (filename retained).
**Source reviewed:** local `main`, `c0def71d32f430d336b2cae7d749aaec0043bb11`;
clean tracked tree at entry, Node v26.11.0, package 0.6.0. Historical release pin:
`4ac6df14` / tree `8bf5ac2b6dfaeccaa69567410e32e6f7a768a305`.
The source comparison spans 193 files (25,422 additions / 268 deletions), not a
newly qualified release. Reproduce with `git diff --stat 4ac6df14..c0def71d`.
`main` was 104 commits ahead of the local `origin/main` tracking ref; no remote
fetch or publication performed. This assessment does not certify every intervening change.

## Evidence grades

- **Supported:** cited artifact addresses the stated acceptance; owner review or
  a separate security gate is still required where specified.
- **Design supported:** the requirement asks for a definition, schema, or plan;
  implementation and measurements are separate and are not implied.
- **Recorded:** historical result exists, with the stated reproducibility limits.
- **Partial / open:** named acceptance work remains.
- **Blocked:** execution or acceptance requires a separate authorization.

These grades are deliberately not a count of approved requirements. A document
is evidence for a definition, not evidence an experiment or control was executed.

## Requirement-by-requirement assessment

Paths below are relative to `docs/` unless explicitly prefixed `src/`, `tests/`,
or `benchmark/` (repository-relative).

| Requirement | Assessment | Evidence | Remaining acceptance work |
|---|---|---|---|
| PRE-R001 — pin target/environment/differences | Partial | Entry snapshot above; `harness-component-inventory.md` historical pin; baseline provenance companion | Record exact environment/config and dirty state with each new measured run. Existing paid records do not all carry source/config hashes. The config contract is type-based (`src/operations/config/schema.ts`), not a newly asserted schema version. |
| PRE-R002 — candidate register with owners/callers/tests | Partial | `harness-component-inventory.md`; legacy inventory companion | Original caller counts are import proxies; current graph lookup fails for a known config symbol. Complete graph/dynamic/external consumer review and subsystem-owner acceptance before retirement. |
| PRE-R003 — protected invariant map | Supported as a map | `harness-invariant-register.md`, S0-1…S0-7 and named F-series gaps | Keep limitations explicit; this is not independent Gate E qualification. No safeguard retirement follows. |
| PRE-R004 — decision/transition ownership | Partial | `harness-decision-transition-map.md` | Review live event producers and legacy status aliases at mapping seams; historical map alone cannot certify current complete caller coverage. |
| PRE-R005 — versioned corpus/independent oracle | Partial | `src/operations/evals/cases/`; objective/status evaluators; `c0def71d` summary regression; `harness-delegate-evidence-validity.md` | Five delegate cases are scripted-only. Do not use them as real-model measurements. PRD stratum 6 specifies four workers; promoted coverage exercises at most three. Local CPU suite rate is unmeasured under recorded hardware disposition. |
| PRE-R006 — baseline metrics | Partial, Gate B HOLD | `benchmark/evidence/cost/`; `harness-event-metrics.md`; baseline provenance companion | Reproducible inputs, source/config provenance, representative repetition and uncertainty plan, latency/tool/retry/intervention coverage, ambiguous deny case, operator acceptance. Projection availability does not mean every metric was measured. |
| PRE-R007 — individual prompt/shim ablations | Blocked | `harness-ablation-report.md` | Signed baseline, admissible paired design, independent per-arm S0 checks, explicit P0-E authorization. No ablation run. |
| PRE-R008 — patch/routing/context comparisons | Open, P2 | Comparison candidates in benchmark/ablation specs | Task-stratified experiments not executed or authorized; preserve deterministic guards. |
| PRE-R009 — shim register | Partial | HC-01/02/03/05 dispositions; `harness-dependency-retirement-map.md` | Add per-shim trigger, applicability, usage coverage, owner, tests and retirement criterion. Usage remains unmeasured; no telemetry expansion authorized here. |
| PRE-R010 — legacy consumers/formats/migration paths | Partial | [Legacy inventory](2026-10-23-harness-legacy-inventory.md) | Concrete runtime/display/load/persistence consumers now listed. Graph-qualified completeness, external/dynamic consumers and legacy alias compatibility policy remain unresolved. |
| PRE-R011 — reversible consolidation packages | Partial design | `harness-cutover-plan.md`; legacy inventory migration sequence | Initial reader-only package outlined; every selected concern still needs complete consumer parity, Q04/Q05 treatment and approval. No production migration performed. |
| PRE-R012 — independent worker authorization | Recorded controls; qualification open | `harness-invariant-register.md`; worker-port, ownership, approval crash/single-use tests | Independent Gate 7/F8b acceptance on exact target remains separate. Author's passing tests do not provide independent clearance. |
| PRE-R013 — audit/design/experiment/production separation | Supported for this pass | This pass changes audit artifacts/offline arithmetic only; explicit no-spend/no-publication scope | Keep previous authorized product fixes distinct from audit-only work. This PRD itself grants no production authority. |
| PRE-R014 — readiness with blockers/evidence | Supported as a report | This matrix and `harness-readiness-report.md` | No implication that all requirements or gates pass. Operator closure/signature remains absent. |
| PRE-R015 — attention definitions | Design supported | `harness-operator-attention-metrics.md`, M-1…M-5 | All attention measurements remain unmeasured; version/approve definitions before using them in comparisons. Defining metrics does not require a renderer. |
| PRE-R016 — decision brief contract | Design supported | `harness-decision-brief-contract.md` fields and missing-evidence rules | Owner review; no Workbench/HTML implementation authorized or needed to claim a written contract exists. |
| PRE-R017 — compare presentations | Open | Decision brief §4 explicitly says no comparison run | Paired/blinded human review tasks and recorded accuracy, time, calibration and effort. Interactive views are optional, not a prerequisite for text/diagram comparison. |
| PRE-R018 — governance across representations | Design supported; demonstration open | Decision brief §2 preserves existing authenticated binding/consume path | Review contract against current approval authority; no new representation was implemented or qualified. |
| PRE-R019 — provenance/rendering safety | Design supported; demonstration open | Decision brief §3: versioned claims, missing evidence, redaction, inert untrusted content | Verify source-field mapping and safety on any future renderer; document definition is not a passed renderer threat test. |
| PRE-R020 — credential-free upstream demo | Recorded; portability partial | `harness2-source-review.md`; local pinned clone/demo/log corroborated during this pass | Pin dependency environment and retain portable raw evidence before claiming clean-checkout reproduction. No fresh demo execution performed here. Missing inputs must remain explicit. |
| PRE-R021 — upstream/ALiX component map | Design supported; owner review open | `harness2-source-review.md` eight components and duplicate-authority findings; prompt assembly confirmed in `src/execution/run/task-loop/context-phase.ts:42` | Subsystem-owner review of mapping and duplicate-authority findings. No imported framework or performance claim. |
| PRE-R022 — candidate/probe evidence contract | Design supported | `harness-optimization-experiment-spec.md` §1 | Review missing-field/failure semantics and approve before any probe; no executed candidate. |
| PRE-R023 — paired benchmark specification | Design supported | Experiment spec §2 | Resolve baseline validity, failure accounting, uncertainty and current task matrix before execution. No comparative result exists. |
| PRE-R024 — isolation qualification | Open, blocks model-backed probes | Experiment spec §3 qualification table | Benchmark-specific hidden-rubric, sandbox/egress, secrets, replay and negative-test evidence. Existing platform controls are not qualification of a new probe. |
| PRE-R025 — recursion/order/holdouts/rollback | Design supported | Experiment spec §§4–5 | Owner-approved budgets and holdout protocol still required before execution. Proposed sample floors are not approved promotion thresholds. |
| PRE-R026 — recommendation without adoption | Supported as recommendation | `harness-optimization-readiness.md`: adopt nothing, defer probes, reject unsafe posture | Independent authority/security review remains unrecorded. Recommendation grants no new capability and clears no gate. |
| PRE-R027 — supervision contract inventory | Design supported; review open | `harness-supervision-authority-map.md` | Validate current source mappings and trace coverage. `ask` is an enforcing permission mode; it does not mean every tool call requires approval. |
| PRE-R028 — node eligibility schema | Design supported | `harness-supervision-eligibility-schema.md` §1 | Owner review of task/risk/policy/model/expiry/evidence fields. No eligibility implementation or measured failure-rate claim. |
| PRE-R029 — independent promotion evaluation design | Design supported | Eligibility schema §2 | Independent evaluation and policy-owner thresholds not approved/executed. No promotion authority follows from a proposed repetition count. |
| PRE-R030 — downgrade/suspension definition | Design supported | Eligibility schema §3 trigger table | Define concrete auditable fallback bindings before implementation; automatic downgrade is not implemented. |
| PRE-R031 — reviewer/sampling/risk benchmark | Open | Eligibility schema §2.1; attention definitions | Measures named; no reviewer-time, missed-risk, exception or sampling results observed. |
| PRE-R032 — non-bypass demonstration | Open | Eligibility schema §§4–5 test matrix | Matrix is specified, not executed. Existing authorization tests do not demonstrate a supervision feature that does not exist. Keep implementation deferred and claim only design. |

## Gates and decision sequence

| Gate | Current disposition | Required next evidence/authority |
|---|---|---|
| A | Historical PASS with named unknowns | Updated consumer inventory does not authorize deletion; current graph/source/owner gaps remain named. |
| B | HOLD | Qualified corpus and metrics, reproducible inputs, repetition/uncertainty rationale, denied-write reporting evidence, operator signature. |
| C | Not authorized; unmet | Separate P0-E authorization after baseline acceptance; paired evidence, otherwise retain candidates. |
| D | Unmet | Complete supported reader/writer inventory and reviewed Q04 historical-data / Q05 interface plan. |
| E | Not independently qualified | Separate independent security track tied to exact artifact. |
| F | HOLD | Technical evidence plus independent clearance plus explicit maintainer authorization (Q13). |

## Executable next work

1. Finish offline evidence aggregation/provenance; keep historical gaps explicit.
2. Review the legacy manifest with config/agent owners; establish supported external
   consumers and alias retention policy before proposing projector removal.
3. Complete shim usage/retirement catalog and source-map corrections. These are
   documentation tasks, not permission to instrument production.
4. Prepare benchmark-specific isolation and human-review comparison protocols.
5. Submit a priced, scoped evidence-collection proposal only if further real-model
   measurements are wanted. No API calls, repetitions or ablations in this pass.
6. Seek operator baseline acceptance and independent security review only after
   their evidence packets exist. Audit closure with HOLD is a separate explicit
   disposition, not full PRD completion.

**This pass changes no gate verdict.** Definitions already written must not be
reported as untouched; missing measurements must not be reported as completed.
