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

Reconciled again at `c1727aa5` for PRE-R002, PRE-R005, PRE-R009, PRE-R010,
PRE-R011, PRE-R017, PRE-R020 and PRE-R031. Reconciled at `9e0ae4dd` for
PRE-R006 (delegate deny-case: honest-refusal reading excluded; reported status
string unrecovered).

Corpus/evidence pass at `a4ce4980` plus working changes:
[complete case audit](2026-10-23-eval-corpus-audit.md). PRE-R005/006 and Gate B
below now include later retained repetitions, deny-task correction and explicit
oracle limits. Other rows retain their earlier source scope.

**Authorization pass (2026-10-23).** The operator authorized all remaining work,
recorded in `docs/audits/2026-10-23-harness-authorization.md`. This pass re-read **every one
of the 32 requirement rows** and the six gates against one question: *was this
row blocked on authority, or on something an approval cannot supply?*

- **Blocked on authority only** → now marked authorized, with the run that still
  has to happen named (PRE-R007, R008, R024, R032).
- **Blocked on missing evidence** → unchanged; an approval does not fill it.
- **Blocked on a third party or on humans** → unchanged, with the reason stated.

Source anchors were re-verified at HEAD for PRE-R003, R004, R015 and the
coordination completion path. The remaining rows keep their earlier `c0def71d`
source grounding; this pass changed their *authorization framing*, not their
source review. No row changed to PASS, because no new measurement was run.

## Evidence grades

- **Supported:** cited artifact addresses the stated acceptance; owner review or
  a separate security gate is still required where specified.
- **Design supported:** the requirement asks for a definition, schema, or plan;
  implementation and measurements are separate and are not implied.
- **Recorded:** historical result exists, with the stated reproducibility limits.
- **Partial / open:** named acceptance work remains.
- **Authorized:** the operator has cleared permission for this work
  (`docs/audits/2026-10-23-harness-authorization.md`); the evidence or run it needs has still
  not happened. Authorization is never a PASS.
- **Blocked:** execution or acceptance requires something an authorization cannot
  supply — a third party, human reviewers, or a measured number.

These grades are deliberately not a count of approved requirements. A document
is evidence for a definition, not evidence an experiment or control was executed.

## Requirement-by-requirement assessment

Paths below are relative to `docs/` unless explicitly prefixed `src/`, `tests/`,
or `benchmark/` (repository-relative).

| Requirement | Assessment | Evidence | Remaining acceptance work |
|---|---|---|---|
| PRE-R001 — pin target/environment/differences | Partial | Entry snapshot above; `harness-component-inventory.md` historical pin; baseline provenance companion | Record exact environment/config and dirty state with each new measured run. Existing paid records do not all carry source/config hashes. The config contract is type-based (`src/operations/config/schema.ts`), not a newly asserted schema version. |
| PRE-R002 — candidate register with owners/callers/tests | Partial | `harness-component-inventory.md`; [legacy inventory](2026-10-23-harness-legacy-inventory.md); `benchmark/evidence/config-consumer-inventory.json` | Original caller counts are import proxies, and a post-reindex lookup still returns `UNKNOWN` with no impact count for `loadConfig`, so graph coverage remains unanswerable rather than confirmed. The compiler-bound census scanned 1,455 files and resolved 30 schema-bound and 217 other declared-field references, leaving 54 named and 1 dynamic reference unresolved for manual triage; it explicitly claims no graph, runtime, external-consumer or retirement authorization. Subsystem-owner acceptance before retirement remains open. |
| PRE-R003 — protected invariant map | Supported as a map; re-checked at HEAD | `harness-invariant-register.md` S0-1…S0-7 and named F-series gaps | Seven S0 entries present. Still a map, not independent Gate E qualification, and no safeguard retirement follows. Gate E authorization does not convert this into an independent result — see `docs/audits/2026-10-23-harness-authorization.md`. |
| PRE-R004 — decision/transition ownership | Partial; map re-checked at HEAD | `harness-decision-transition-map.md`; `src/coordination/kernel/coordination-types.ts` | Live check confirms both a legacy compatibility field and its replacement: `coordination-types.ts:578` documents a derived user-facing label while "the legacy `status` stays visible for compatibility". `deriveRunCompletion` (`:486`–`:570`) is the single completion authority, mapping execution/aggregation/outcome/verification. The map is therefore accurate at HEAD for this seam. Remaining: no exhaustive census of every legacy status alias across TUI/API/Inspector projections. |
| PRE-R005 — versioned corpus/independent oracle | Partial; full case audit and positive guards implemented | `src/operations/evals/cases/`; [corpus audit](2026-10-23-eval-corpus-audit.md); `src/operations/evals/eval-guards.ts`; oracle/helper/integration tests | Three comment-decoy false passes fixed; task formatting aligned. Independent positive guards now check the isolated outside sentinel, complete read-only workspace, correct partial output and executed verification/recovery sequences. Five scripted-only exclusions remain. Offline mechanics do not requalify historical paid results or supply independent scoring. |
| PRE-R006 — baseline metrics | **Partial; later repetitions retained, qualification open** | [corpus/evidence reconciliation](2026-10-23-eval-corpus-audit.md); `benchmark/evidence/cost/strata-1-3-repetitions-2026-10-23.json`; `benchmark/evidence/cost/delegate-baseline-2026-10-23.json`; `benchmark/evidence/cost/deny-case-fixed-2026-10-23.json`; coordination artifacts linked by the audit | Strata 1/2 each 3/3; stratum 3 has 6/6 valid mutation outcomes across two retained cases, plus an invalid old patch task 0/3. Corrected patch 3/3 is author-reported without located raw rerun artifact. Strata 4/5/10 each 3/3 final-state outcomes; recovery/verification sequences not proved. Four-worker coordination n=2; crash/resume n=1; local CPU unchanged. Corrected deny statuses are `failed` in 3/3; outside-target observation remains missing. Mixed 10/12 ($0.045688/success) includes the invalid old deny task and is not a qualified baseline or attributable improvement over mixed historical 7/12. Uncertainty, independent scoring and operator acceptance remain open. |
| PRE-R007 — individual prompt/shim ablations | **Authorized (P0-E); not executed** | `harness-ablation-report.md`; `docs/harness-shim-catalog.md` | The authority blocker is cleared by `docs/audits/2026-10-23-harness-authorization.md`. What remains is execution: an admissible paired design, independent per-arm S0 checks, and a signed baseline. §9 permits an explicit retain disposition instead of a run if candidates are simply kept. |
| PRE-R008 — patch/routing/context comparisons | **Authorized; not executed** | Comparison candidates in benchmark/ablation specs | Task-stratified experiments are now permitted but have not been run. Preserve deterministic guards; no comparative result exists. |
| PRE-R009 — shim register | Partial | `harness-shim-catalog.md` register (HC-01…HC-05, SH-01…SH-05); `harness-dependency-retirement-map.md` | Owner, trigger, applicability, static consumers, tests and keep/retirement criterion now recorded per shim, with HC-04 pinned as a non-removable control. Runtime usage, per-model frequency, incremental cost and causal effectiveness remain unmeasured; static presence is not usage. No telemetry expansion authorized here. |
| PRE-R010 — legacy consumers/formats/migration paths | Partial | [Legacy inventory](2026-10-23-harness-legacy-inventory.md); `benchmark/evidence/config-consumer-inventory.json`; `harness-cutover-plan.md` | Concrete runtime/display/load/persistence consumers are listed. The config census narrows declared-field consumers but names no external or dynamic one, so graph-qualified completeness, dynamic access and legacy alias compatibility policy stay unresolved. |
| PRE-R011 — reversible consolidation packages | Partial design | `harness-cutover-plan.md` (runtime reader parity, output-interface retirement, historical JSON migration); legacy inventory migration sequence | Three design-only packages with dependency order and a rollback per step. Every selected concern still needs complete consumer parity, Q04/Q05 treatment and approval; a step without a rollback is marked as needing design first. No production migration performed. |
| PRE-R012 — independent worker authorization | Recorded controls; qualification open | `harness-invariant-register.md`; worker-port, ownership, approval crash/single-use tests | Independent Gate 7/F8b acceptance on exact target remains separate. Author's passing tests do not provide independent clearance. |
| PRE-R013 — audit/design/experiment/production separation | Supported for this pass | This pass changes audit artifacts/offline arithmetic only; explicit no-spend/no-publication scope | Keep previous authorized product fixes distinct from audit-only work. This PRD itself grants no production authority. |
| PRE-R014 — readiness with blockers/evidence | Supported as a report | This matrix, `harness-readiness-report.md`, `docs/audits/2026-10-23-harness-authorization.md` | No implication that all requirements or gates pass. The operator authorization is now recorded; the closure signature and independent qualification remain absent. |
| PRE-R015 — attention definitions | Design supported; re-checked at HEAD | `harness-operator-attention-metrics.md`, M-1…M-5 | Five metric definitions present. All attention measurements remain unmeasured; defining a metric is not observing it, and no number changes because the work is authorized. |
| PRE-R016 — decision brief contract | Design supported | `harness-decision-brief-contract.md` fields and missing-evidence rules | Owner review; no Workbench/HTML implementation authorized or needed to claim a written contract exists. |
| PRE-R017 — compare presentations | Open | Decision brief §4 explicitly says no comparison run; `harness-review-evaluation-protocol.md` scoring protocol | Paired/blinded human review tasks and recorded accuracy, time, calibration and effort. A scorer and frozen rubric exist, but human observations are n=0 and the public `scope-claim-v1` fixture is training material, not a holdout. Interactive views are optional, not a prerequisite for text/diagram comparison. |
| PRE-R018 — governance across representations | Design supported; demonstration open | Decision brief §2 preserves existing authenticated binding/consume path | Review contract against current approval authority; no new representation was implemented or qualified. |
| PRE-R019 — provenance/rendering safety | Design supported; demonstration open | Decision brief §3: versioned claims, missing evidence, redaction, inert untrusted content | Verify source-field mapping and safety on any future renderer; document definition is not a passed renderer threat test. |
| PRE-R020 — credential-free upstream demo | Recorded fresh; install portability open | `benchmark/evidence/harness2-reproduction.json`; `harness2-source-review.md` | Fresh credential-free rerun at pinned source: 2/2 tasks, 28 executions, exit 0. Installation was not rerun — a pre-existing virtualenv was reused, so clean-checkout reproduction remains unqualified and network absence rests on the reviewed path, not packet capture. Missing inputs must remain explicit. |
| PRE-R021 — upstream/ALiX component map | Design supported; owner review open | `harness2-source-review.md` eight components and duplicate-authority findings; prompt assembly confirmed in `src/execution/run/task-loop/context-phase.ts:42` | Subsystem-owner review of mapping and duplicate-authority findings. No imported framework or performance claim. |
| PRE-R022 — candidate/probe evidence contract | Design supported | `harness-optimization-experiment-spec.md` §1 | Review missing-field/failure semantics and approve before any probe; no executed candidate. |
| PRE-R023 — paired benchmark specification | Design supported | Experiment spec §2 | Resolve baseline validity, failure accounting, uncertainty and current task matrix before execution. No comparative result exists. |
| PRE-R024 — isolation qualification | **Authorized; qualification not performed** | Experiment spec §3 qualification table | Model-backed probes are now permitted, but no benchmark-specific isolation evidence exists: hidden-rubric, sandbox/egress, secrets, replay and negative tests are still unwritten. Existing platform controls are not qualification of a new probe, and running a probe without this would produce inadmissible results. |
| PRE-R025 — recursion/order/holdouts/rollback | Design supported | Experiment spec §§4–5 | Owner-approved budgets and holdout protocol still required before execution. Proposed sample floors are not approved promotion thresholds. |
| PRE-R026 — recommendation without adoption | Supported as recommendation | `harness-optimization-readiness.md`: adopt nothing, defer probes, reject unsafe posture | Independent authority/security review remains unrecorded. Recommendation grants no new capability and clears no gate. |
| PRE-R027 — supervision contract inventory | Design supported; review open | `harness-supervision-authority-map.md` | Validate current source mappings and trace coverage. `ask` is an enforcing permission mode; it does not mean every tool call requires approval. |
| PRE-R028 — node eligibility schema | Design supported | `harness-supervision-eligibility-schema.md` §1 | Owner review of task/risk/policy/model/expiry/evidence fields. No eligibility implementation or measured failure-rate claim. |
| PRE-R029 — independent promotion evaluation design | Design supported | Eligibility schema §2 | Independent evaluation and policy-owner thresholds not approved/executed. No promotion authority follows from a proposed repetition count. |
| PRE-R030 — downgrade/suspension definition | Design supported | Eligibility schema §3 trigger table | Define concrete auditable fallback bindings before implementation; automatic downgrade is not implemented. |
| PRE-R031 — reviewer/sampling/risk benchmark | Open | Eligibility schema §2.1; attention definitions; `harness-review-evaluation-protocol.md` | Measures named and the offline scorer covers joint coverage so a failed review still counts in the denominator; no reviewer-time, missed-risk, exception or sampling result has been observed. |
| PRE-R032 — non-bypass demonstration | Open; authorized to execute | Eligibility schema §§4–5 test matrix | Matrix is specified, not executed. Authorization does not supply a supervision feature that does not exist; existing authorization tests still do not demonstrate it. Claim design only. |

## Gates and decision sequence

Authorization is recorded in `docs/audits/2026-10-23-harness-authorization.md`. It unblocks
the work; it does not supply a result. Gates B–F are therefore **authorized but
unmet**, not passed.

| Gate | Current disposition | Required next evidence/authority |
|---|---|---|
| A | Historical PASS with named unknowns | Authorized to complete. Updated consumer inventory does not authorize deletion; graph/source/owner gaps remain named and unfilled. |
| B | **HOLD; repetitions collected, qualification incomplete** | Later repetitions and corrected deny statuses exist. Revised guards have retained scripted proof; qualify current target artifacts, resolve historical provenance and uncertainty rationale, independently score, then obtain operator acceptance. Historical outcomes are not reruns of the revised corpus. |
| C | **Authorized (P0-E); no paired run exists** | Design both arms with HC-01 mandatory coordination routing preserved, run them, then accept or retain. §9 permits an explicit retain disposition without an ablation. |
| D | **Authorized; implementation not started** | Implement MP-01…MP-03, produce reader/writer parity evidence, obtain Q04/Q05 owner approval. Design-only today. |
| E | **Authorized; independence still absent** | Run the security qualification. An operator waiving independence records acceptance of author-only testing — a weaker claim that must be labeled as such, not reported as independent clearance. |
| F | **Authorized to assemble; signature outstanding** | Build the technical packet, then obtain independent clearance and the maintainer decision (Q13). The signature cannot be supplied by this agent or by an authorization. |

## Executable next work

1. Finish offline evidence aggregation/provenance; keep historical gaps explicit.
2. Review the legacy manifest with config/agent owners; establish supported external
   consumers and alias retention policy before proposing projector removal.
3. Shim owner, trigger, test and retirement criterion are now catalogued. Measuring runtime
   usage is a separate authorization, not a documentation task; source-map corrections remain open.
4. Human-review scoring protocol is prepared for controlled use. Benchmark-specific isolation
   qualification (PRE-R024) is still open, so no model-backed probe may run.
5. Submit a priced, scoped evidence-collection proposal only if further real-model
   measurements are wanted. No API calls, repetitions or ablations in this pass.
6. Seek operator baseline acceptance and independent security review only after
   their evidence packets exist. Audit closure with HOLD is a separate explicit
   disposition, not full PRD completion.

**This pass changes no gate verdict.** Definitions already written must not be
reported as untouched; missing measurements must not be reported as completed.
