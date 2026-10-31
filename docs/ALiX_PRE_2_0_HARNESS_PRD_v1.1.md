# ALiX — Pre-2.0 Harness Rationalization PRD

**Version:** 1.2 (supersedes v1.1; three amendments: §12 autonomous-review efficiency, §13 Harness², §14 progressive supervision)
**Date:** 2026-10-20  
**Status:** ACTIVE CLOSEOUT — agent-driven execution, grading, review, and readiness assessment; authority remains fail-closed and policy-bound
**Parent:** ALiX Master PRD v2.8, Stage 0; Q01–Q15 unchanged  
**Program:** Pre-2.0 harness complexity audit, measured simplification, and legacy cutover readiness  
**Source baseline:** audit work performed against `4ac6df14` (tree `8bf5ac2b6dfaeccaa69567410e32e6f7a768a305`), the Gate 7 release candidate fast-forwarded onto `main`. PRE-R001 requires a pinned commit; this is that pin.

**Evidence reconciliation (2026-10-23):** [PRE-R001–R032 acceptance matrix](audits/2026-10-23-harness-acceptance-matrix.md), [baseline provenance](audits/2026-10-23-harness-baseline-provenance.md), and [legacy consumer inventory](audits/2026-10-23-harness-legacy-inventory.md). Requirements and acceptance criteria are unchanged. These records distinguish design evidence from executed measurements and prior acceptance assumptions; they grant no new authority. The 2026-10-28 agent-driven amendment supersedes any Harness-local requirement for routine human review/signature while preserving external authorization boundaries.

> **Version-identification record (resolved).** Two different documents previously
> carried the string "v1.1" — this one (§1–§11 + §12–§14) and an audit-branch copy
> (§1–§11 only, with the `4ac6df14` pin). The audit copy was deleted on operator
> instruction and its unique content preserved in
> `docs/harness-component-inventory.md`. This revision is numbered **1.2** so the
> version string identifies exactly one content set. The bump changes no
> requirement and does not touch Q01–Q15; it exists only to remove the ambiguity.
> History: `docs/harness-prd-divergence-finding.md`.

> **Filename note.** The file is still named `ALiX_PRE_2_0_HARNESS_PRD_v1.1.md`.
> Renaming would break 12+ inbound references across `docs/`; the version string
> above is authoritative. Rename can be done as a separate mechanical change.

> **Agent-driven operating model (2026-10-28).** Harness v1.2 is executed end-to-end by planner, executor, verifier, critic, evidence-reconciliation, and readiness agents plus deterministic checks. There is no routine human-in-the-loop planning, grading, review, approval, remediation, or gate promotion inside this program. Existing policy/approval authorities remain deterministic constraints rather than human workflow steps. Agents may consume authority already delegated to the run, but may not mint, widen, renew, or waive it. Any action that requires authority not already present must fail closed and park durably as `BLOCKED`; the program continues other independent work where safe. Human/legal/organizational actions outside ALiX remain external dependencies and are not modeled as an in-loop review stage.

## 1. Executive summary

ALiX must enter its 2.0 baseline with deterministic security and recovery guarantees intact, while eliminating demonstrably obsolete model-facing scaffolding, duplicate decision points, and compatibility-only runtime paths. Smarter models can replace some behavioral prompting; they cannot replace authority, durable execution, or independent evidence. This PRD turns that distinction into a gated, measurable pre-release program.

**Outcome:** a documented, canonical, testable ALiX runtime with an evidence-backed disposition for each model-facing shim and a migration-ready inventory of legacy paths, produced by agents and deterministic verifiers without routine human review. Do not confuse audit completion with authority to exceed the pre-authorized execution envelope, or test PASS with publication clearance.

## 2. Problem and goals

Existing ALiX components span shared prompts, task classification, context compilation, model selection, editing preferences, agent and subagent loops, coordination, policy, approvals, and recovery. Some are necessary controls; others may encode historical model limitations. Blind removal risks security regressions; blind retention raises tokens, latency, maintenance burden, and integration complexity.

Goals:
- Classify current components against the exact target commit and Gate 7 release worktree.
- Prove the single authority for each decision and distinguish actual duplicates from complementary state machines.
- Establish repeatable verified-success, cost, latency, and tool-efficiency baselines.
- Identify removable or replaceable model scaffolding using paired ablations.
- Preserve Q01–Q15, especially Q02/Q03/Q04/Q05/Q07/Q08/Q11/Q12/Q13/Q15.
- Deliver a prioritized, reversible ALiX 2.0 legacy cutover plan.

Non-goals:
- Rebuild ALiX around a new framework or introduce a second agent loop.
- Remove approvals, policy, audit, ownership, recovery, or independent verification.
- Implement software factories, subscriptions, AFK or remote backends in Stage 0.
- Require a human-in-the-loop step for planning, implementation, grading, review, remediation, or readiness assessment. Work that exceeds already-delegated authority must park durably as `BLOCKED`; agents cannot manufacture new privilege.
- Assume a heuristic is obsolete merely because frontier models improved.

## 3. Scope and classification

| Class | Meaning | Default decision |
|---|---|---|
| S0 | Deterministic safeguard: policy, approvals, scope, budgets, ownership, ledger, cancellation, recovery, verification | Preserve; equivalent replacement requires security review |
| S1 | Execution infrastructure: scheduler, task lifecycle, model/tool adapters, provider interoperability | Retain authority; consolidate only with contract parity |
| M1 | Adaptive intelligence support: context ranking, model routing, classification, tool discovery | Benchmark before tuning |
| M2 | Candidate model-compensation: repetitive prompts, provider-specific format heuristics, excessive search, brittle fallback nudges | Ablate; retire only with evidence |
| L0 | Legacy runtime interface/reader/alias with no canonical necessity | Migrate consumers/data, then remove under Q04/Q05 |

No S0/S1 component may be reclassified M2 solely because a model can imitate its behavior.

## 4. Initial source-grounded candidate register

The source references below were inspected from GitHub `main` snapshot `e948e356`, not from the isolated Gate 7 worktree. Verify paths and behavior again at the pinned implementation target.

| ID | Source | Candidate / safeguard | Class | Action |
|---|---|---|---|---|
| HC-01 | `src/agents/agent/system-prompt.ts` | Full-picture search, parallel-default, phase supplements | M2 candidate | Paired prompt ablation |
| HC-02 | same | Tool-name/structured-call compatibility guidance | S1/M1 | Keep until tool-call parity proven |
| HC-03 | `src/execution/patch/edit-format-policy.ts` | Provider-based preferred patch format | M2 candidate | Compare by model and task |
| HC-04 | same | Full-file rewrite denial and patch safety | S0 | Preserve |
| HC-05 | `src/context/repomap/context-compiler.ts` | Ranking, token budgets, 60s cache, lazy embeddings | M1 | Compare light/ranked/deep context |
| HC-06 | `src/planning/autonomy/state-machine.ts` | Iteration, repair and runtime ceilings | S0 | Preserve |
| HC-07 | `src/agents/agent/agent-loop.ts` and `src/execution/run/task-loop.ts` | Agent orchestration vs execution decisions | S1 | Map decisions and transitions |
| HC-08 | `src/agents/subagent-cli.ts` | Child worker model/tool iteration | S1/M1 | Map overlap and auth integration |
| HC-09 | `src/coordination/kernel/coordination-scheduler.ts` | Scheduler, bounded dispatch, timeouts, leases | S0/S1 | Preserve authority |
| HC-10 | `src/coordination/kernel/worker-executor.ts` and `subagent-worker-executor.ts` | In-process/child execution adapters | S1 | Keep contract; test both |
| HC-11 | `src/operations/config/defaults.ts` | Configuration surface and projections | L0 candidates | Inventory actual writers/readers |
| HC-12 | `src/coordination/kernel/AGENTS.md` | Ledger-first, single scheduler, meaningful event emission | S0 | Pin invariant tests |

**Unverified:** actual model-specific effectiveness, complete caller graph, local release-worktree state, exact legacy inventory, production costs.

## 5. Functional requirements

| ID | Requirement | Priority | Acceptance |
|---|---|---|---|
| PRE-R001 | Pin source commit, dirty state, branch, runtime/config schema and Gate 7 differences | P0 | Reproducible baseline manifest; no accidental worktree mutation |
| PRE-R002 | Inventory every candidate with symbol, callers, owner, reason, tests and classification | P0 | Source-referenced register independently reviewed by a verifier agent and deterministic source checks |
| PRE-R003 | Publish protected S0 invariant map | P0 | Every invariant linked to a negative/fault test or tracked evidence gap |
| PRE-R004 | Identify duplicated decisions and incompatible state transitions across agent/task/subagent/coordination loops | P1 | Decision ownership and state-transition map; no speculative deletion |
| PRE-R005 | Define fixed, versioned task corpus and independently verified outcomes | P0 | Tasks, fixtures, environment and scoring repeatable |
| PRE-R006 | Collect baseline verified success, token usage, cost, latency, retries, tool calls and intervention | P1 | Results tied to model version, config, commit and sample size |
| PRE-R007 | Test individual prompt/shim ablations without modifying production defaults | P1 | Paired comparisons, error analysis and keep/retire recommendation |
| PRE-R008 | Benchmark patch-format, routing and context strategies | P2 | Task-stratified evidence; deterministic guards unchanged |
| PRE-R009 | Register model-facing shims with owner, trigger, applicability, usage, tests and retirement criterion | P1 | Catalog; telemetry must not flood authoritative event log |
| PRE-R010 | Inventory legacy readers, aliases, wrappers, data formats, consumers and migration paths | P0 | Q04/Q05 migration/compatibility manifest |
| PRE-R011 | Produce reversible consolidation proposals with affected contracts and tests | P1 | One change package per concern, rollback criteria |
| PRE-R012 | Preserve independent authorization and approval across in-process and child-process workers | P0 | Gate 7/F8b security qualification remains independent release gate |
| PRE-R013 | Enforce separation between audit, design, experimental branch, and production change | P0 | Production changes require an explicit machine-verifiable delegated-authority token/policy decision; absent authority yields durable `BLOCKED`, never agent self-approval |
| PRE-R014 | Publish final readiness verdict with blockers and evidence links | P0 | PASS/HOLD per requirement; unknown remains unknown |

### 5.1 v1.1 amendment requirements (PRE-R015–R032)

These are defined in full in their own sections and are **not** repeated here, so
each requirement has exactly one authoritative statement — an amendment may change
its own row without desynchronising this table.

| ID | Requirement | Priority | Defined in |
|---|---|---|---|
| PRE-R015 | Define autonomous review-efficiency measurements for decision-bearing runs | P1 | §12.1 |
| PRE-R016 | Define an evidence-linked decision brief contract | P1 | §12.1 |
| PRE-R017 | Compare text, diagram and optional interactive presentations of the same evidence | P2 | §12.1 |
| PRE-R018 | Preserve governance across representations | P0 | §12.1 |
| PRE-R019 | Preserve evidence provenance and safety of generated views | P0 | §12.1 |
| PRE-R020 | Reproduce the upstream credential-free deterministic demo, or record the inability | P1 | §13.1 |
| PRE-R021 | Map upstream components to ALiX owners; flag duplicate authority | P1 | §13.1 |
| PRE-R022 | Define a read-only candidate manifest and probe evidence contract | P1 | §13.1 |
| PRE-R023 | Specify a paired baseline-versus-candidate benchmark | P1 | §13.1 |
| PRE-R024 | Qualify isolation before any model-backed probe | P0 | §13.1 |
| PRE-R025 | Document recursion budgets, task ordering, holdouts and rollback criteria | P1 | §13.1 |
| PRE-R026 | Produce a recommendation without modifying production harnesses | P0 | §13.1 |
| PRE-R027 | Inventory current governance, approval and trace contracts for supervision gaps | P1 | §14.1 |
| PRE-R028 | Define a node-level eligibility schema; treat unmeasured rates as unknown | P1 | §14.1 |
| PRE-R029 | Design independent evaluation for promotion; thresholds must be versioned in policy before execution and cannot be invented or changed by the evaluated agents | P0 | §14.1 |
| PRE-R030 | Define automatic downgrade and suspension triggers | P0 | §14.1 |
| PRE-R031 | Benchmark verifier/critic effort, sampling quality and missed-risk rates as distinct measures | P1 | §14.1 |
| PRE-R032 | Demonstrate supervision policy never bypasses existing authorization | P0 | §14.1 |

**Status is requirement-specific.** Metric/brief definitions, Harness² source
review and experiment design, and supervision schemas already exist. Several
requirements ask for definitions rather than implementation; reporting all eighteen
as untouched would be incorrect. The linked acceptance matrix records design,
historical experiment, measurement and review gaps separately. None clears Gate B
(§12.4); R026/R032 grant no privilege or production readiness.

## 6. Nonfunctional and safety requirements

- Zero accepted unauthorized execution or approval bypasses in the required negative corpus.
- No loss of acknowledged critical state; no automatic retry of unknown non-idempotent effects.
- No change to Q01–Q15 without explicit PRD change control.
- No telemetry polling that competes with authoritative append/commit paths.
- Benchmarks report success rates and uncertainty, not just anecdotal examples.
- No fabricated numeric performance target; thresholds are frozen after baseline measurement.
- Evaluation logs respect retention, privacy, secrets handling and policy-approved provider limits.
- Local-first and CPU-only paths remain supported within Master PRD platform qualification.

## 7. Benchmark specification

Task strata: (1) read-only factual inspection, (2) unfamiliar-code navigation, (3) single-file edit, (4) multi-file bug fix, (5) verification/repair, (6) four-worker coordination with ownership, (7) allow/ask/deny capability mixes, (8) crash/restart and outcome-unknown, (9) local CPU-only execution, (10) tool failure and malformed tool-call recovery.

Primary measure: `total measured cost / independently verified successful tasks`. Report total tasks, verified successes, mean/median cost, p50/p95 latency, tokens, tool calls, repeated calls, retry count, verifier/critic invocations, and durable BLOCKED outcomes. Count unsuccessful task cost in numerator. For local models report resource-time as well as monetary estimates, clearly labeled.

**Autonomous review effort is a separate measured dimension** (§12.3). Report verifier/critic invocations, model/tool cost, review latency, disagreement rate, escalation-to-`BLOCKED` rate, and missed seeded risks. Never treat lower review cost as better when independent verification misses a security, correctness, or governance issue.

**Unmeasured is not zero.** Cost and attention are `null` wherever no billable
call or no observation occurred. A scripted-provider run emits no `model.usage`
because no billable call exists; a local CPU run is non-billable resource time.
Neither is a measured zero. Coverage must be reported alongside every aggregate
so a reader cannot mistake "not measured" for "measured, and it was nothing".

Each ablation uses the same task set, model/version, provider policy, environment and test oracle, with randomized ordering or repetitions to limit drift. Run S0 negative tests independently; never score a policy bypass as a success. Compare per-task outcomes and identify regressions before declaring a winner.

## 8. Workstreams and dependencies

| Stage | Workstream | Depends on | Exit |
|---|---|---|---|
| P0-A | Read-only target and release-worktree inventory | None | PRE-R001–004, R010 |
| P0-B | Protected invariant/evidence map | P0-A | PRE-R003, R012; gaps named |
| P0-C | Benchmark design | P0-A/B | PRE-R005, scoring contract versioned and independently verified |
| P0-D | Baseline measurements | P0-C | PRE-R006, reproducible reports |
| P0-E | Isolated prompt and heuristic ablations | P0-D | PRE-R007–009 |
| P0-F | Consolidation and legacy migration design | P0-A/E | PRE-R010–011 |
| P0-G | Gate 7/F8b qualification | Separate security track | Required for default governed worker release |
| P0-H | Agent-driven cutover qualification package | P0-F, P0-G, delegated authority present | Q04/Q05 migration evidence plus machine-verifiable readiness recommendation; absent authority => `BLOCKED` |
| P0-I | Autonomous review-efficiency measurement and evidence-brief contract (§12) | P0-C/P0-D | PRE-R015–019; definitions versioned, measurements `not measured` until instrumented |
| P0-J | Harness² research qualification (§13) | P0-A, environment isolation | PRE-R020–026; reproducible demo or documented failure, contract map, safe experiment design |
| P0-K | Progressive-supervision research (§14) | P0-C/P0-D, P0-I | PRE-R027–032; authority map, eligibility schema, evaluation plan, defer/reject recommendation |

Read-only P0-A/B/C may proceed during Gate 7 HOLD. Experiments must use isolated fixtures and policy-approved providers; they do not clear security holds. Production cutover is explicitly outside this PRD's authorization.

**P0-I/J/K are agent-driven research and design stages.** Their exits are evidence packages and definitions, never self-granted production authority. None may clear Gate B, relax an authorization rule, promote itself to a less-constrained mode, or run a model-backed probe without the isolation qualification in PRE-R024 and machine-verifiable delegated authority.

## 9. Acceptance gates and stop conditions

**Gate A — Inventory:** all high-risk candidates mapped; unknown source/ownership blocks retirement.  
**Gate B — Baseline:** versioned, independently scored benchmark with reproducible environment.  
**Gate C — Ablation:** demonstrable efficiency gain with no unaccepted correctness regression; otherwise retain.  
**Gate D — Migration design:** Q04 historical-data migration and Q05 breaking-interface plan cover every supported reader/writer.  
**Gate E — Execution/security:** F8b, authority, crash/recovery, ownership and denied-action negatives qualified independently.  
**Gate F — Readiness handoff:** technical evidence, independent security qualification, exact-artifact provenance, and an agent-generated readiness verdict. Actual publication/release remains outside this Harness PRD unless a pre-existing machine-verifiable delegated release authority permits it; otherwise the terminal state is durable `BLOCKED`, not a human review step inside the workflow.

Stop on unauthorized execution, missing authoritative evidence, non-idempotent automatic retry after uncertain effects, unexpected data loss, approval reuse, unverifiable benchmark results, or attempt to publish during HOLD.

## 10. Deliverables

1. `harness-component-inventory.md` — source-referenced S0/S1/M1/M2/L0 register.
2. `harness-invariant-register.md` — authority, durability, recovery and evidence contracts.
3. `harness-benchmark-spec.md` — fixtures, scoring, model matrix and analysis method.
4. `harness-ablation-report.md` — experimental results and keep/retire decisions.
5. `harness-cutover-plan.md` — dependency order, migration, tests, rollback and risk.
6. `harness-readiness-report.md` — exact commit, status and gate verdicts.

### 10.1 v1.1 amendment deliverables

7. `harness-operator-attention-metrics.md` — retained filename; versioned autonomous-review metrics for verifier/critic cost, latency, disagreement, BLOCKED escalations, approval-boundary encounters and missed-evidence/reversal events (§12, PRE-R015).
8. `harness-decision-brief-contract.md` — read-only projection fields, provenance rules and governance binding, including the untrusted-content posture for any generated view (§12, PRE-R016–R019).
9. `harness2-source-review.md` — pinned upstream commit, licences, component inventory and contract map to ALiX (§13, PRE-R020–R021).
10. `harness-optimization-experiment-spec.md` — paired fixtures, independent judge, contamination and egress restrictions, recursion budget, stop rules and uncertainty (§13, PRE-R022–R025).
11. `harness-optimization-readiness.md` — evidence links, gaps and an explicit keep/defer/reject recommendation independently reviewed by verifier/critic agents (§13, PRE-R026).
12. `harness-supervision-authority-map.md` and `harness-supervision-eligibility-schema.md` — current governance/trace inventory, node-level eligibility contract, downgrade and exception test matrix, and an explicit reuse/defer/reject recommendation (§14, PRE-R027–R032).

**Artifact presence:** all twelve deliverables have documents (13 files, because
deliverable 12 spans two). Their acceptance is assessed individually in the linked
matrix. Ablation results, measurements, qualification and signatures remain missing
where stated; file presence alone satisfies none of those obligations.

## 11. Traceability and governance

Parent Master PRD: v2.8 Stage 0, §§5–8, 10, 14, 18–19, 22, 28, 31–32, and retained v2.7 §29. Preserve approved Q01–Q15 verbatim. Feature statuses distinguish proposed, designed, implemented-unverified, verified-on-candidate, verified-on-main and released.

**Requirement status (reconciled 2026-10-23).** See the linked acceptance matrix
for all 32 requirements. Written definitions and recommendations exist, while
measurements, complete consumer/provenance review and independent qualification remain partial. Human acceptance is not a Harness closeout requirement; missing external authority is represented as durable `BLOCKED`. No requirement is waived by this assessment.

**Gate B status: AUTHORIZED; PARTIALLY MEASURED.** The 2026-10-23 authorization record (`audits/2026-10-23-harness-authorization.md`) is treated as the existing delegated authority envelope for this closeout; agents may not broaden it. It clears permission for the recorded scope, not evidence. The four real-model delegate cases were
re-measured on the historical baseline model: **10/12 verified at $0.045688 per
verified success**, against the earlier 7/12 at $0.067149. That is not a
like-for-like improvement — a runtime fix postdates the historical sweep, so the
delta is unattributed. The deny case was previously **mis-specified**: its task
text named an ordinary in-workspace path that nothing forbids, so a real model
obeyed it and correctly reported success, and the case scored that as failure. It
was fixed (task now names a real escape; ownership limited to the objective path)
and re-measured **3/3** with the boundary denying the write. An earlier reading of
its 2/3 `success` results as false claims is withdrawn.
Six strata remain n=1. Historical records otherwise cover ten strata at differing
evidence levels; the generator's legacy schema admits cost records in 9/10.
Four-worker coordination now has two real-model runs with `workerCount: 4`; the
earlier three-worker records did not meet the contract.
Five delegate cases have scripted-only expectations. Repetition/uncertainty rationale and independent scoring remain incomplete; operator signature is no longer a Harness evidence requirement.

**Decision:** continue the agent-driven closeout within the existing delegated authority envelope. Production changes require machine-verifiable delegated authority and all normal policy/security gates; when absent, the workflow parks durably as `BLOCKED`. Merge, push, deployment, release and waiver of Gate 7 publication HOLD are not implicitly authorized by this PRD.


## 12. Autonomous review-efficiency amendment (v1.2 agent-driven revision)

**Source and status:** Design implications from Ray Amjad, *Your Attention Is the REAL Bottleneck in Claude Code* (2026-10-20), supplied transcript, especially 0:37–1:07, 3:11–5:35 and 7:23–9:51. These are proposals, **not measured ALiX improvements**. The presenter demonstrates concise walkthroughs, diagrams, situational HTML review artifacts and optional explainer videos; he does not provide controlled ALiX-specific evidence of faster or safer review.

### 12.1 Stage 0 scope

Routine human review is removed from the Harness closeout loop. Review, critique, grading, evidence reconciliation, and readiness assessment are performed by independent agents and deterministic verifiers. This **extends benchmark design and evidence capture**, not the authorization boundary. Missing authority must produce durable `BLOCKED`; no evaluator or executor may grant itself additional capability.

| ID | Requirement | Stage 0 acceptance |
|---|---|---|
| PRE-R015 | Define autonomous review-efficiency measurements for decision-bearing runs | Versioned metrics: verifier/critic invocations and cost, review latency, disagreement rate, BLOCKED escalations, approval-boundary encounters, and consequential missed-evidence/reversal events |
| PRE-R016 | Define an evidence-linked decision brief contract for proposed future Workbench use | Read-only fields: objective, proposed action, scope, risk, changed artifacts, test/evaluation results, missing evidence, provenance, policy decision and approval binding |
| PRE-R017 | Compare concise text, diagrams and optional interactive views as alternative presentations of the same underlying evidence | Paired or randomized agent-review tasks; accuracy, latency, confidence calibration, disagreement and missed critical findings reported; no invented performance thresholds |
| PRE-R018 | Preserve governance across representations | All effects use existing policy/approval binding and consume rules. Generated briefs, evaluators and critics never grant capability, broaden scope, or manufacture authority; missing authority yields `BLOCKED` |
| PRE-R019 | Preserve evidence provenance and safety of generated views | Claims linked to immutable or versioned evidence; unverified claims labeled; generated HTML treated as untrusted, sandboxed content; secrets and sensitive data redacted according to policy |

### 12.2 Proposed decision brief, not a new authority

A decision brief is a **projection** of existing run, policy, approval, test and artifact evidence. The format is chosen for the decision: concise text for routine cases; dependency/call diagrams for architectural changes; interactive HTML only when visual alternatives or UI state materially aid judgment. Videos are explicitly optional and deferred until simpler representations demonstrate value. An approval button, if ever offered, must call the existing governed approval path; it must not mutate an ApprovalStore or merge code directly.

Minimum content: decision or action under evaluation; impacted components and security domains; alternatives and consequences; authoritative outcome/evidence references; verification status; known unknowns; exact action scope; delegated-authority evidence; and current approval binding/expiry where applicable. Missing evidence or authority must be shown as missing/`BLOCKED`, not inferred.

### 12.3 Benchmark and validity rules

- Primary optimization remains **total observed cost per independently verified success**, with task failures included in the cost numerator. Autonomous review effort is a separate measured dimension and never substitutes for correctness.
- Report verifier/critic cost, latency, disagreement, retries, seeded-risk misses and escalation-to-`BLOCKED` coverage; missing measures remain `null`.
- Faster or cheaper review does **not** qualify as better if security, correctness, or governance findings are missed. Use blinded seeded-risk and deterministic review-accuracy tasks where feasible.
- Record baseline provenance, presentation format, task complexity, verifier configuration, sample sizes and uncertainty. Do not assert causal improvement from anecdotes or self-reported confidence.
- Do not generate expensive artifacts for every event; use decision significance, expected verification value and policy-defined budgets to choose the representation.

### 12.4 Dependencies and gates

**Pre-2.0:** add measurement definitions and a decision-brief contract to the P0-C/P0-D benchmark artifacts and candidate register; treat new measurements as `not measured` until instrumented. These additions **do not clear Gate B**, and they do not authorize P0-E ablations or production simplification.

**ALiX 2.0:** the Master PRD v2.8 governs any later Workbench/decision-artifact implementation. It depends on canonical evidence projections, stable approval APIs, UI threat review, independent verification and agent-review accuracy benchmarks. Existing F8b/R1 boundaries remain S0 safeguards.

**Reported audit state:** the acceptance/provenance records linked above supersede
the old 1/10 cost snapshot. They retain Gate B HOLD and distinguish recorded
coverage from qualified evidence. Attention measures remain unmeasured; no
ablation or presentation implementation follows from this amendment. Q13 and
production simplification remain HOLD.


## 13. Harness² research qualification (pre-2.0 amendment; proposed)

**Research input:** [Google Research Harness²](https://github.com/google-research/harness2) ([experiment guide](https://github.com/google-research/harness2/blob/main/docs/EXPERIMENTS.md), [paper](https://arxiv.org/abs/2610.14224)), reviewed 2026-10-20. The upstream *Propose–Probe–Compose* approach and reported benchmark results are hypotheses to evaluate, not ALiX evidence or authorization. This section implements Master PRD v2.8 §31 at the **documentation/read-only research** level only.

### 13.1 Stage 0 research requirements

| ID | Proposed requirement |
|---|---|
| PRE-R020 | Reproduce the upstream **credential-free deterministic demo** in a disposable isolated environment; pin commit, Python/dependencies, command, inputs and outputs. Record inability to reproduce rather than infer success. |
| PRE-R021 | Map upstream harness snapshots, editor/proposer, probes, composer and reflection outputs to ALiX A-series governed evolution, evidence, outcome ledger and learning owners; flag duplicate authority or incompatible contracts. |
| PRE-R022 | Define a read-only **candidate manifest and probe evidence contract**: base version/hash, scoped diff, domain, model/executor, tools, permissions, fixture, scorer, budgets, seed, environment, provenance, observed outcomes and failure states. |
| PRE-R023 | Specify a paired baseline-versus-candidate benchmark with fixed task selection, independent correctness/security scoring, full cost accounting, uncertainty and autonomous review-effort measures where available; use `null` for missing measures. |
| PRE-R024 | Qualify isolation before any ALiX model-backed probe: sandbox and filesystem boundary, restricted egress, no hidden rubrics, secret controls, prompt-injection defenses, side-effect policy, replay and negative tests. |
| PRE-R025 | Document parallel and sequential recursion budgets, deterministic task ordering, incomplete-run accounting, provenance of domain-specific lessons, holdout validation and rollback criteria. |
| PRE-R026 | Produce a recommendation **without** modifying production harnesses, automatically promoting candidates, relaxing approvals, or declaring Gate B/F1-E/Q13 cleared. |

### 13.2 Minimal research deliverables and acceptance

- `harness2-source-review.md`: pinned upstream commit, licenses/third-party notices, eight editable components, executor/sandbox assumptions and contract map to ALiX.
- `harness-optimization-experiment-spec.md`: paired task fixtures, baseline, candidate scopes, independent judge, contamination/egress restrictions, recursion budget, cost ceiling, stop rules and uncertainty.
- `harness-optimization-readiness.md`: evidence links, gaps, explicit keep/defer/reject recommendation and authority/security review.

**Pass for the Stage 0 research spike** means reproducible demo evidence (or explicitly documented failure), complete contract mapping, a testable safe experiment design, and an independently reviewable recommendation. It **does not** mean ALiX harness optimization is implemented, superior, safe for production or approved for adoption. Do not convert external benchmark gains into ALiX performance claims.

### 13.3 Dependencies, hazards and governance

Research may proceed after inventory and environment isolation are documented. Model-backed experiments depend on qualified sandbox/egress, independent grading, baseline coverage, and machine-verifiable delegated authority. Upstream Harness² explicitly reports unrestricted executor network access and disabled Codex sandboxing, with benchmark rubric exposure risk: reject those settings for ALiX and block any uncontained probe. Domain/task lessons cannot alter global guardrails or tool authority; any requested authority expansion yields durable `BLOCKED`. Preserve dirty-root changes and use isolated worktrees.

**Unchanged holds:** Gate B HOLD; F1-E has a historical 8/8 qualification report (`run-79feb4e0`) with retained-input gaps recorded in the provenance assessment; Q13 publication HOLD; production simplification HOLD.


## 14. Progressive supervision and autonomy qualification research (pre-2.0; proposed)

**Source:** Evan Kormos, *How to Know When an AI Agent Can Work Unsupervised* (AI Engineer, 2026-10-19; https://www.youtube.com/watch?v=_4Ph2dhmUFI), user-provided transcript. Its conceptual stages—fully supervised, sampled, exception-based—are **not** independently established numerical certification criteria. This section scopes Master PRD v2.8 §32 to read-only Stage 0 research and benchmark design.

### 14.1 Proposed requirements

| ID | Proposed requirement |
|---|---|
| PRE-R027 | Inventory current ALiX governance, approvals, calibration, outcome, traces and coordination contracts for supervision modes, workflow-node checks, exception routing, escalation and revocation. Identify gaps before proposing new components. |
| PRE-R028 | Define a **node-level eligibility schema** scoped to task class, capability, environment, model configuration, risk, policy revision, review mode, evidence references, expiry and responsible authority. Treat unmeasured confidence and failure rates as unknown. |
| PRE-R029 | Design independent evaluation for autonomous-mode promotion: representative repeated tasks, risk-weighted failure categories, sample-size/uncertainty rationale, blinded seeded-risk checks, holdouts and trace completeness. Thresholds must be pre-versioned in policy or qualification configuration and cannot be created or changed by the evaluated agents. |
| PRE-R030 | Define automatic downgrade/suspension triggers for material failure, changed policy/model/tools, distribution shift, missing traces, stale evidence and expired qualification; fallback is fail-closed `BLOCKED` or a previously authorized lower-risk mode, with auditable exception handling. |
| PRE-R031 | Benchmark verifier/critic effort, sampling quality, missed-risk rates, exception volume, queue bottlenecks, verified outcomes, cost and latency as distinct measures. A faster workflow with worse safety fails. |
| PRE-R032 | Demonstrate that supervision policy never bypasses existing authorization, approval binding, denial, security controls or Q08 bounded autonomy. Harness² optimization cannot promote itself into higher privilege. |

### 14.2 Research outputs and stop conditions

Produce an authority map, qualification/evidence schema, independent evaluator/critic plan, downgrade/exception test matrix and explicit **reuse/defer/reject** recommendation. Keep this within the existing P0-C/P0-D baseline and candidate register; record coverage and unknowns rather than inventing data. Do not implement a second autonomy authority, relax authorization rules, let an agent self-promote privileges, or assert production readiness without evidence. Real-provider experiments require isolation, qualification, and machine-verifiable delegated authority.

**Unchanged holds:** Gate B HOLD; F1-E QUALIFIED; Q13 publication HOLD; production simplification HOLD. Q01–Q15, existing approval authority and dirty-root preservation remain unchanged.
