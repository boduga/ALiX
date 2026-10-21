# ALiX — Pre-2.0 Harness Rationalization PRD

**Version:** 1.1 (proposed; operator-attention amendment)  
**Date:** 2026-10-20  
**Status:** DRAFT — implementation not authorized by this document  
**Parent:** ALiX Master PRD v2.8, Stage 0; Q01–Q15 unchanged  
**Program:** Pre-2.0 harness complexity audit, measured simplification, and legacy cutover readiness

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

Read-only P0-A/B/C may proceed during Gate 7 HOLD. Experiments must use isolated fixtures and policy-approved providers; they do not clear security holds. Production cutover is explicitly outside this PRD's authorization.

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

These are expected future outputs; none is represented as already completed.

## 11. Traceability and governance

Parent Master PRD: v2.8 Stage 0, §§5–8, 10, 14, 18–19, 22, 28, and retained v2.7 §29. Preserve approved Q01–Q15 verbatim. Feature statuses distinguish proposed, designed, implemented-unverified, verified-on-candidate, verified-on-main and released.

**Decision:** proceed with documentation and read-only audit. **Not authorized:** production edits, merge, push, deployment, release or waiver of Gate 7 publication HOLD.


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

**Reported audit state (not independently revalidated from this copy):** P0-D3 verified 5/10 strata and measured cost in 0/10; F1-A/B/C and effective-dated pricing F1-D were reported complete; F1-E remained blocked on credentials in a non-interactive shell. These are historical progress notes, not a Gate B PASS or authorization to publish. Q13 publication HOLD, simplification HOLD and dirty-root preservation remain unchanged.