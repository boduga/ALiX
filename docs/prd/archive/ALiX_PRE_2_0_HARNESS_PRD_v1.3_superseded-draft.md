# ALiX — Pre-2.0 Harness Rationalization PRD

**Version:** 1.3 (supersedes v1.2; adds §15 grounded reasoning and independent agent evaluation)  
**Date:** 2026-10-25  
**Status:** DRAFT — implementation not authorized by this document  
**Parent:** ALiX Master PRD v2.9, Stage 0; Q01–Q15 unchanged  
**Program:** Pre-2.0 harness complexity audit, measured simplification, and legacy cutover readiness  
**Source baseline:** audit work performed against `4ac6df14` (tree `8bf5ac2b6dfaeccaa69567410e32e6f7a768a305`), the Gate 7 release candidate fast-forwarded onto `main`. PRE-R001 requires a pinned commit; this is that pin.

**Evidence reconciliation (2026-10-23):** [PRE-R001–R032 acceptance matrix](audits/2026-10-23-harness-acceptance-matrix.md), [baseline provenance](audits/2026-10-23-harness-baseline-provenance.md), and [legacy consumer inventory](audits/2026-10-23-harness-legacy-inventory.md). Requirements and acceptance criteria are unchanged. These records distinguish design evidence from executed measurements and owner acceptance; they grant no new authority.

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

## 1. Executive summary

ALiX must enter its 2.0 baseline with deterministic security and recovery guarantees intact, while eliminating demonstrably obsolete model-facing scaffolding, duplicate decision points, and compatibility-only runtime paths. Smarter models can replace some behavioral prompting; they cannot replace authority, durable execution, or independent evidence. This PRD turns that distinction into a gated, measurable pre-release program.

**Outcome:** a documented, canonical, testable ALiX runtime with an evidence-backed disposition for each model-facing shim and a migration-ready inventory of legacy paths. Do not confuse audit completion with approval to refactor, or test PASS with publication clearance.

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
- Publish, deploy, merge, or modify production behavior without separate approval.
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
| PRE-R002 | Inventory every candidate with symbol, callers, owner, reason, tests and classification | P0 | Source-referenced register reviewed by subsystem owners |
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
| PRE-R013 | Enforce separation between audit, design, experimental branch, and production change | P0 | No production code changes without explicit operator authorization |
| PRE-R014 | Publish final readiness verdict with blockers and evidence links | P0 | PASS/HOLD per requirement; unknown remains unknown |

### 5.1 v1.1 amendment requirements (PRE-R015–R032)

These are defined in full in their own sections and are **not** repeated here, so
each requirement has exactly one authoritative statement — an amendment may change
its own row without desynchronising this table.

| ID | Requirement | Priority | Defined in |
|---|---|---|---|
| PRE-R015 | Define operator-attention measurements for decision-bearing runs | P1 | §12.1 |
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
| PRE-R029 | Design independent evaluation for promotion; thresholds require policy-owner approval | P0 | §14.1 |
| PRE-R030 | Define automatic downgrade and suspension triggers | P0 | §14.1 |
| PRE-R031 | Benchmark reviewer time, sampling quality and missed-risk rates as distinct measures | P1 | §14.1 |
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

Primary measure: `total measured cost / independently verified successful tasks`. Report total tasks, verified successes, mean/median cost, p50/p95 latency, tokens, tool calls, repeated calls, retry count, and operator interventions. Count unsuccessful task cost in numerator. For local models report resource-time as well as monetary estimates, clearly labeled.

**Operator attention is a separate measured dimension** (§12.3). Report
`operatorActiveReviewMinutes / independentlyVerifiedSuccesses` **only when both
terms are observed**; otherwise report `null` and the coverage. Never convert
operator time into a guessed dollar figure. Keep active review distinct from
waiting, interruptions and total elapsed time. A faster approval is **not**
better if the reviewer missed a security, correctness or governance issue.

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
| P0-C | Benchmark design | P0-A/B | PRE-R005, scoring approved |
| P0-D | Baseline measurements | P0-C | PRE-R006, reproducible reports |
| P0-E | Isolated prompt and heuristic ablations | P0-D | PRE-R007–009 |
| P0-F | Consolidation and legacy migration design | P0-A/E | PRE-R010–011 |
| P0-G | Gate 7/F8b qualification | Separate security track | Required for default governed worker release |
| P0-H | Approved cutover and qualification | P0-F, P0-G, separate approval | Q04/Q05 and Stage 0 release evidence |
| P0-I | Operator-attention measurement and decision-brief contract (§12) | P0-C/P0-D | PRE-R015–019; definitions versioned, measurements `not measured` until instrumented |
| P0-J | Harness² research qualification (§13) | P0-A, environment isolation | PRE-R020–026; reproducible demo or documented failure, contract map, safe experiment design |
| P0-K | Progressive-supervision research (§14) | P0-C/P0-D, P0-I | PRE-R027–032; authority map, eligibility schema, evaluation plan, defer/reject recommendation |

Read-only P0-A/B/C may proceed during Gate 7 HOLD. Experiments must use isolated fixtures and policy-approved providers; they do not clear security holds. Production cutover is explicitly outside this PRD's authorization.

**P0-I/J/K are read-only research and design stages.** Their exits are documents
and definitions, never production behaviour. None of them may clear Gate B, relax
an approval rule, promote a task to less-supervised review, or authorise a
model-backed probe without the isolation qualification in PRE-R024.

## 9. Acceptance gates and stop conditions

**Gate A — Inventory:** all high-risk candidates mapped; unknown source/ownership blocks retirement.  
**Gate B — Baseline:** versioned, independently scored benchmark with reproducible environment.  
**Gate C — Ablation:** demonstrable efficiency gain with no unaccepted correctness regression; otherwise retain.  
**Gate D — Migration design:** Q04 historical-data migration and Q05 breaking-interface plan cover every supported reader/writer.  
**Gate E — Execution/security:** F8b, authority, crash/recovery, ownership and denied-action negatives qualified independently.  
**Gate F — Release:** technical evidence, independent security restriction clearance and explicit authorized maintainer approval tied to exact artifact (Q13).

Stop on unauthorized execution, missing authoritative evidence, non-idempotent automatic retry after uncertain effects, unexpected data loss, approval reuse, unverifiable benchmark results, or attempt to publish during HOLD.

## 10. Deliverables

1. `harness-component-inventory.md` — source-referenced S0/S1/M1/M2/L0 register.
2. `harness-invariant-register.md` — authority, durability, recovery and evidence contracts.
3. `harness-benchmark-spec.md` — fixtures, scoring, model matrix and analysis method.
4. `harness-ablation-report.md` — experimental results and keep/retire decisions.
5. `harness-cutover-plan.md` — dependency order, migration, tests, rollback and risk.
6. `harness-readiness-report.md` — exact commit, status and gate verdicts.

### 10.1 v1.1 amendment deliverables

7. `harness-operator-attention-metrics.md` — versioned definitions for active review minutes per independently verified success, interruptions, approval touches and missed-evidence/reversal events (§12, PRE-R015).
8. `harness-decision-brief-contract.md` — read-only projection fields, provenance rules and governance binding, including the untrusted-content posture for any generated view (§12, PRE-R016–R019).
9. `harness2-source-review.md` — pinned upstream commit, licences, component inventory and contract map to ALiX (§13, PRE-R020–R021).
10. `harness-optimization-experiment-spec.md` — paired fixtures, independent judge, contamination and egress restrictions, recursion budget, stop rules and uncertainty (§13, PRE-R022–R025).
11. `harness-optimization-readiness.md` — evidence links, gaps and an explicit keep/defer/reject recommendation with authority review (§13, PRE-R026).
12. `harness-supervision-authority-map.md` and `harness-supervision-eligibility-schema.md` — current governance/trace inventory, node-level eligibility contract, downgrade and exception test matrix, and an explicit reuse/defer/reject recommendation (§14, PRE-R027–R032).

**Artifact presence:** all twelve deliverables have documents (13 files, because
deliverable 12 spans two). Their acceptance is assessed individually in the linked
matrix. Ablation results, measurements, qualification and signatures remain missing
where stated; file presence alone satisfies none of those obligations.

## 11. Traceability and governance

Parent Master PRD: v2.8 Stage 0, §§5–8, 10, 14, 18–19, 22, 28, 31–32, and retained v2.7 §29. Preserve approved Q01–Q15 verbatim. Feature statuses distinguish proposed, designed, implemented-unverified, verified-on-candidate, verified-on-main and released.

**Requirement status (reconciled 2026-10-23).** See the linked acceptance matrix
for all 32 requirements. Written definitions and recommendations exist, while
measurements, complete consumer/provenance review, independent qualification and
operator acceptance remain partial. No requirement is waived by this assessment.

**Gate B status: AUTHORIZED; PARTIALLY MEASURED.** The operator authorized the
remaining work on 2026-10-23 (`audits/2026-10-23-harness-authorization.md`); that
clears permission, not evidence. The four real-model delegate cases were
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
Five delegate cases have scripted-only expectations. Repetition/uncertainty
rationale, independent scoring and operator signature remain incomplete.

**Decision:** continue authorized documentation and offline audit work. Production
changes need their own explicit operator authorization. Merge, push, deployment,
release and waiver of Gate 7 publication HOLD remain unauthorized.


## 12. Operator-attention efficiency amendment (v1.1; 2026-10-20)

**Source and status:** Design implications from Ray Amjad, *Your Attention Is the REAL Bottleneck in Claude Code* (2026-10-20), supplied transcript, especially 0:37–1:07, 3:11–5:35 and 7:23–9:51. These are proposals, **not measured ALiX improvements**. The presenter demonstrates concise walkthroughs, diagrams, situational HTML review artifacts and optional explainer videos; he does not provide controlled ALiX-specific evidence of faster or safer review.

### 12.1 Stage 0 scope

Human review time is a potentially scarce resource and should be measured alongside tokens, monetary cost, verified task outcomes and latency. This **extends benchmark design and evidence capture**, not the authorization boundary or the Stage 0 mandate. No interactive artifact implementation, HTML renderer, video generator or additional approval service is authorized by this PRD.

| ID | Requirement | Stage 0 acceptance |
|---|---|---|
| PRE-R015 | Define operator-attention measurements for decision-bearing runs | Versioned metric definitions: operator active review minutes per independently verified success, number of interruptions, approval touches, and consequential missed-evidence/reversal events where observable |
| PRE-R016 | Define an evidence-linked decision brief contract for proposed future Workbench use | Read-only fields: objective, proposed action, scope, risk, changed artifacts, test/evaluation results, missing evidence, provenance, policy decision and approval binding |
| PRE-R017 | Compare concise text, diagrams and optional interactive views as alternative presentations of the same underlying evidence | Paired or randomized review tasks; accuracy, time, confidence calibration, missed critical findings and operator effort reported; no invented performance thresholds |
| PRE-R018 | Preserve governance across representations | All decisions use existing authenticated approval interfaces and binding/consume rules; generated briefs never approve, merge, mutate or grant capability themselves |
| PRE-R019 | Preserve evidence provenance and safety of generated views | Claims linked to immutable or versioned evidence; unverified claims labeled; generated HTML treated as untrusted, sandboxed content; secrets and sensitive data redacted according to policy |

### 12.2 Proposed decision brief, not a new authority

A decision brief is a **projection** of existing run, policy, approval, test and artifact evidence. The format is chosen for the decision: concise text for routine cases; dependency/call diagrams for architectural changes; interactive HTML only when visual alternatives or UI state materially aid judgment. Videos are explicitly optional and deferred until simpler representations demonstrate value. An approval button, if ever offered, must call the existing governed approval path; it must not mutate an ApprovalStore or merge code directly.

Minimum content: decision requested; why human authority is needed; impacted components and security domains; alternatives and consequences; authoritative outcome/evidence references; verification status; known unknowns; exact action scope; and the current approval binding and expiry where applicable. Missing evidence must be shown as missing, not inferred.

### 12.3 Benchmark and validity rules

- Primary optimization remains **total observed cost per independently verified success**, with task failures included in the cost numerator. Operator time is a **separate measured dimension**, not a guessed dollar conversion or a substitute for correctness.
- Define `operatorActiveReviewMinutes / independentlyVerifiedSuccesses` only when both terms are observed; otherwise report `null` and coverage. Separate active review from waiting, interruptions and total elapsed time.
- Faster approvals do **not** qualify as better if reviewers miss security, correctness, or governance issues. Include blinded seeded-risk or independently verified review-accuracy tasks where feasible.
- Record baseline provenance, presentation format, task complexity, reviewer context, sample sizes and uncertainty. Do not assert causal improvement from anecdotes or self-reported convenience.
- Do not generate expensive artifacts for every event; use decision significance, expected operator benefit and policy-approved budgets to choose the representation.

### 12.4 Dependencies and gates

**Pre-2.0:** add measurement definitions and a decision-brief contract to the P0-C/P0-D benchmark artifacts and candidate register; treat new measurements as `not measured` until instrumented. These additions **do not clear Gate B**, and they do not authorize P0-E ablations or production simplification.

**ALiX 2.0:** the Master PRD v2.8 governs any later Workbench/decision-artifact implementation. It depends on canonical evidence projections, stable approval APIs, UI threat review, independent verification and operator-accuracy benchmarks. Existing F8b/R1 boundaries remain S0 safeguards.

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
| PRE-R023 | Specify a paired baseline-versus-candidate benchmark with fixed task selection, independent correctness/security scoring, full cost accounting, uncertainty and measured operator attention where available; use `null` for missing measures. |
| PRE-R024 | Qualify isolation before any ALiX model-backed probe: sandbox and filesystem boundary, restricted egress, no hidden rubrics, secret controls, prompt-injection defenses, side-effect policy, replay and negative tests. |
| PRE-R025 | Document parallel and sequential recursion budgets, deterministic task ordering, incomplete-run accounting, provenance of domain-specific lessons, holdout validation and rollback criteria. |
| PRE-R026 | Produce a recommendation **without** modifying production harnesses, automatically promoting candidates, relaxing approvals, or declaring Gate B/F1-E/Q13 cleared. |

### 13.2 Minimal research deliverables and acceptance

- `harness2-source-review.md`: pinned upstream commit, licenses/third-party notices, eight editable components, executor/sandbox assumptions and contract map to ALiX.
- `harness-optimization-experiment-spec.md`: paired task fixtures, baseline, candidate scopes, independent judge, contamination/egress restrictions, recursion budget, cost ceiling, stop rules and uncertainty.
- `harness-optimization-readiness.md`: evidence links, gaps, explicit keep/defer/reject recommendation and authority/security review.

**Pass for the Stage 0 research spike** means reproducible demo evidence (or explicitly documented failure), complete contract mapping, a testable safe experiment design, and an independently reviewable recommendation. It **does not** mean ALiX harness optimization is implemented, superior, safe for production or approved for adoption. Do not convert external benchmark gains into ALiX performance claims.

### 13.3 Dependencies, hazards and governance

Research may proceed after inventory and environment isolation are documented. Model-backed experiments depend on qualified sandbox/egress, independent grading and baseline coverage; production changes depend on separate A-series governance decisions. Upstream Harness² explicitly reports unrestricted executor network access and disabled Codex sandboxing, with benchmark rubric exposure risk: reject those settings for ALiX and block any uncontained probe. Domain/task lessons cannot alter global guardrails or tool authority without explicit scoped approval. Preserve dirty-root changes, use isolated worktrees, and do not merge/push/deploy as part of this documentation amendment.

**Unchanged holds:** Gate B HOLD; F1-E has a historical 8/8 qualification report (`run-79feb4e0`) with retained-input gaps recorded in the provenance assessment; Q13 publication HOLD; production simplification HOLD.


## 14. Progressive supervision and autonomy qualification research (pre-2.0; proposed)

**Source:** Evan Kormos, *How to Know When an AI Agent Can Work Unsupervised* (AI Engineer, 2026-10-19; https://www.youtube.com/watch?v=_4Ph2dhmUFI), user-provided transcript. Its conceptual stages—fully supervised, sampled, exception-based—are **not** independently established numerical certification criteria. This section scopes Master PRD v2.8 §32 to read-only Stage 0 research and benchmark design.

### 14.1 Proposed requirements

| ID | Proposed requirement |
|---|---|
| PRE-R027 | Inventory current ALiX governance, approvals, calibration, outcome, traces and coordination contracts for supervision modes, workflow-node checks, exception routing, escalation and revocation. Identify gaps before proposing new components. |
| PRE-R028 | Define a **node-level eligibility schema** scoped to task class, capability, environment, model configuration, risk, policy revision, review mode, evidence references, expiry and responsible authority. Treat unmeasured confidence and failure rates as unknown. |
| PRE-R029 | Design independent evaluation for full-to-sampled and sampled-to-exception promotion: representative repeated tasks, risk-weighted failure categories, sample-size/uncertainty rationale, blinded seeded-risk checks, holdouts and trace completeness. Thresholds require explicit policy-owner approval; do not invent default numbers. |
| PRE-R030 | Define automatic downgrade/suspension triggers for material failure, changed policy/model/tools, distribution shift, missing traces, stale evidence and expired qualification; specify human fallback and auditable exception handling. |
| PRE-R031 | Benchmark reviewer active time, sampling quality, missed-risk rates, exception volume, queue bottlenecks, verified outcomes, cost and latency as distinct measures. A faster workflow with worse safety fails. |
| PRE-R032 | Demonstrate that supervision policy never bypasses existing authorization, approval binding, denial, security controls or Q08 bounded autonomy. Harness² optimization cannot promote itself into higher privilege. |

### 14.2 Research outputs and stop conditions

Produce a read-only authority map, qualification/evidence schema proposal, independent evaluation plan, downgrade/exception test matrix and explicit **reuse/defer/reject** recommendation. Keep this within the existing P0-C/P0-D baseline and candidate register; record coverage and unknowns rather than inventing data. Do not implement a new autonomy engine, relax human approval rules, promote any task to sampled/exception-only review or assert production readiness. Real-provider experiments require separate isolation, qualification and authorization.

**Unchanged holds:** Gate B HOLD; F1-E QUALIFIED; Q13 publication HOLD; production simplification HOLD. Q01–Q15, existing approval authority and dirty-root preservation remain unchanged.


## 15. Grounded reasoning and evaluator-agent research (v1.3; proposed)

**Source and limits:** Chris Royse, *Meaning-Native Language Model: Hierarchical Skills + Imagination + Truth* (2026-10-21; https://www.youtube.com/watch?v=TMEiFsyXhwI), supplied transcript. Test grounded transformation, ignorance resolution, hypotheses and typed evidence as **engineering hypotheses**, not a proven new foundation model or universal theory of intelligence. Implements Master PRD v2.9 §33 at read-only Stage 0 design level.

### 15.1 Proposed requirements

| ID | Proposed requirement |
|---|---|
| PRE-R033 | Inventory current capability, skill, planner, execution-state, memory, calibration, governance, trace and evaluation interfaces. Prefer reuse over a new cognitive subsystem. |
| PRE-R034 | Specify typed skill preconditions, effects, expected observations, refusal boundaries, evidence requirements and independent verification without transferring policy authority to a skill. |
| PRE-R035 | Design an actionable-ignorance test set with unknown, conflicting and unavailable observations; score authorized question selection, bounded experimentation, correct stop and false-certainty rates. |
| PRE-R036 | Design a hypothesis/observation ledger with provenance, temporal scope and epistemic status; verify that prediction, stored belief and agent confidence never become observed fact without evidence. |
| PRE-R037 | Replace proposed **human quality evaluations** with independent **evaluator agents** in Stage 0 research, experiments and progressive-supervision measurements. Separate executor from verifier and critic, preserve immutable rubrics/evidence and capture disagreements. |
| PRE-R038 | Validate evaluator agents against deterministic oracles where available, seeded failures, blinded holdouts, evaluator-contamination checks, repeated runs and calibrated false-pass/false-fail metrics. Agent agreement alone is insufficient. |
| PRE-R039 | Specify a fail-closed evaluator protocol: unknown or disputed results block promotion or trigger bounded independent checks; agents cannot self-certify, authorize themselves or edit their evaluation rules. |
| PRE-R040 | Compare baseline versus candidate on correctness, evidence integrity, tool cost, latency, missed-risk rate, stop quality and regression/rollback behavior; report uncertainty and non-improvements. |
| PRE-R041 | Preserve all mandatory operator/maintainer authorization and release decisions. Agent evaluation substitutes for quality grading, **not** for existing policy authority, approval binding or legal human oversight. |

### 15.2 Experiments and acceptance boundaries

**E1 — Grounded skills:** evaluate typed preconditions/effects/refusal/verification against current capability execution. **E2 — Actionable ignorance:** inject missing/conflicting evidence and measure safe question, experiment and stop choices. **E3 — Hypothesis separation:** record predictions before execution and independently verify outcomes, including adversarial cases. Each experiment requires a pinned baseline, fixed task corpus, isolated agents, separate evaluator/critic contexts, immutable criteria, reproducible traces and deterministic checks where possible.

**Outputs:** authority/contract gap map, skill schema proposal, evaluator-agent independence/threat model, three experiment specs, benchmark and risk metrics, rollback criteria and a reuse/defer/reject decision. No model retraining, production learning, policy relaxation, automatic supervision promotion or new autonomous truth engine is authorized.

**Current holds preserved:** Gate B HOLD; F1-E QUALIFIED; Q13 publication HOLD; production simplification HOLD. Q01–Q15 remain unchanged. No implementation or release is authorized by this document.
