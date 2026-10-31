# ALiX — Pre-2.0 Master Product Requirements Document

**Version:** 1.1 — LEAN architecture-first, constrained-hardware agent-operated readiness program  
**Date:** 2026-10-25  
**Status:** FROZEN FOR NEW WORK — D9 dependency-resolution/remediation remains active; no unrelated LEAN workstream advancement or release authorization
**Parent:** [ALiX Master PRD v2.9](ALiX_MASTER_PRD_v2.9.md)  
**Predecessor:** `ALiX_PRE_2_0_HARNESS_PRD_v1.2.md` — separately owned harness-rationalization closeout; not superseded until independently closed and its evidence accepted  
**Derived from:** `ALiX_PRE_2_0_HARNESS_PRD_v1.3.md` (superseded draft), containing Harness², progressive-supervision, and grounded-reasoning research amendments  
**Repository location:** `docs/prd/ALiX_PRE_2_0_MASTER_PRD_v1.1.md`

> **Decision boundary.** The operator requests an **agent-driven program without human-in-the-loop execution, grading, or routine review**. This is an operating-model requirement for delegated work, **not** a change to Q01–Q15, existing approval authority, or legally required human oversight. A task needing authority not already granted must fail closed and remain blocked; an evaluator agent cannot manufacture that authority. Human approval is not silently converted to agent approval.

> **Scoped program freeze (2026-10-28).** New PRE-2.0/LEAN expansion is frozen while the separately owned Harness PRD v1.2 closeout and the already-active D9 execution/security dependency are reconciled. This freeze does **not** stop D9 R4.2 Phase F remediation, qualification, evidence reconciliation, or the minimum changes required to resolve that existing blocker. D9 remains an active dependency-resolution lane because its effect-reconciliation, crash/recovery, authorization, and completion guarantees are required by this PRD and by the Harness PRD Gate E closeout. No unrelated LEAN-02+ implementation, capability expansion, optimization cutover, or new milestone may advance under this exception. LEAN-G01 remains blocked until its own evidence and decision requirements are satisfied.

## 1. Executive summary

Before ALiX 2.0, first measure and simplify the architecture for a constrained reference laptop, then establish a reliable **agent-operated delivery and readiness system**: agents decompose objectives, propose changes, implement within delegated scope, independently verify effects, challenge conclusions, collect durable evidence, remediate failures, and generate an evidence-linked release-readiness recommendation. Deterministic policy enforcement, budgets, durable state, and independent outcome verification remain outside agent discretion.

This document governs **new pre-2.0 work after the v1.2 harness closeout**. It does not reopen, duplicate, or declare complete that predecessor's PRE-R001–PRE-R032 requirements, source audit, or acceptance gates. Those records remain authoritative for their original program. Any outstanding v1.2 requirement is a tracked dependency, not a newly claimed PASS.

## 2. Goals and exclusions

**Goals:** eliminate routine human review of authorized work; minimize agent self-certification; make uncertainty actionable; enable verifiable skill composition; qualify bounded autonomy from independent evidence; preserve crash recovery, policy authority, and release integrity.

**Non-goals:** training a new foundational MNLM, asserting AGI or a universal truth formula, removing mandatory authorization, changing Q01–Q15, clearing release holds by document edit, building a second governance engine, or automatically deploying unqualified code.

**Definition of agent-driven:** all task planning, candidate implementation, quality evaluation, regression review, adversarial critique, evidence reconciliation, and readiness assessment are assigned to agents or deterministic verifiers. The operator may set goals and delegate scopes outside the running workflow. No routine operator review step is introduced. When existing policy requires an operator/maintainer approval, the agent workflow **stops or parks durably** rather than substituting an agent.

## 3. Authority, isolation, and responsibilities

| Function | Owner | Authority boundary |
|---|---|---|
| Goal decomposition, planning, dependencies | Planner agent through existing coordination | Cannot authorize its own tool permissions |
| Implementation, probes, bounded retries | Executor agents | Existing policy, sandbox, budget, and ownership constraints |
| Outcome checking | Independent verifier agent + deterministic checks | Read-only evidence and immutable acceptance criteria |
| Adversarial risk review | Critic agent in isolated context | Can flag/block; cannot approve exceptions |
| Evaluation calibration and drift | Existing calibration/evolution authorities using evaluator-agent evidence | No self-promotion or rubric rewriting |
| Policy, permission, approvals, audit | Existing deterministic governance and approval authorities | Agents cannot grant new privileges |
| Release readiness synthesis | Independent readiness agent | Recommendation only; does not replace Q13 maintainer sign-off |
| Human-required actions | Existing operator/maintainer authority | Outside unattended scope; durable BLOCKED/WAITING state |

Use independent contexts and, when justified, independent models for proposer, verifier and critic. Agent consensus is **not** proof of correctness. Prefer deterministic oracles for file content, tests, policies, state transitions and effect reconciliation. Avoid an evaluator reading the executor's private chain-of-thought or inheriting its untrusted instructions.

## 4. Requirements

| ID | Priority | Requirement |
|---|---|---|
| PM-R001 | P0 | Provide an agent-operated work lifecycle: propose → authorize by existing policy → execute → observe → independently verify → critique → remediate or close. |
| PM-R002 | P0 | No routine human-in-the-loop grading, output sampling, triage, or quality sign-off. Assign these to independently isolated evaluator agents, deterministic oracles and risk-scoped critic agents. |
| PM-R003 | P0 | Do not replace mandatory operator/maintainer authorization, Q08 bounded AFK constraints, or Q13 release approval with an agent. On missing authorization, pause/deny durably without a fabricated pass. |
| PM-R004 | P0 | Require independent verification of durable terminal state, artifact effects, policy compliance and task-specific acceptance criteria before declaring success. |
| PM-R005 | P0 | Prevent agent self-certification, evaluator rubric mutation, prompt-injection contamination, shared-answer leakage and evaluator-to-executor privilege escalation. |
| PM-R006 | P0 | Persist immutable evidence references, evaluator identity/configuration, policy revision, timestamps, tool outcomes, confidence/uncertainty and all disagreement or exception decisions. |
| PM-R007 | P0 | Define typed grounded skills with preconditions, intended effects, expected observations, supporting episodes/evidence, refusal boundaries and versioned verification contracts. |
| PM-R008 | P0 | Preserve epistemic states: hypothesis, prediction, observed, verified, disputed and rejected; no stored assertion or forecast is promoted to truth without independent evidence. |
| PM-R009 | P0 | Make ignorance actionable: identify missing observation/skill, propose an authorized question or bounded experiment, and stop safely if resolution is unavailable. |
| PM-R010 | P0 | Keep workflow dependencies and security gates deterministic; bound internal agent loops by iterations, time, tokens, cost and scope. |
| PM-R011 | P0 | On failed/inconclusive/disputed verification, use bounded independent rechecks or durable BLOCKED; never infer success from agent confidence or consensus alone. |
| PM-R012 | P0 | Define agent-evaluator qualification using seeded defects, blinded holdouts, deterministic ground truth where available, repeated trials, false-pass/false-fail rates and contamination tests. |
| PM-R013 | P1 | Qualify full/sampled/exception-based **agent evaluation intensity** by task, capability, model, environment, risk and policy revision; never remove mandatory authorization gates. |
| PM-R014 | P0 | Automatically suspend or downgrade evaluation eligibility on material failures, drift, expired evidence, changed policy/models/tools or compromised traces. |
| PM-R015 | P1 | Permit governed, versioned learning of beliefs, skill strategies and harness configurations only after independent regressions and with reversible rollback; do not alter authority or guardrails implicitly. |
| PM-R016 | P1 | Test Harness²-inspired Propose–Probe–Compose as a pluggable strategy using isolated, credential-restricted experiments, independent agent grading and paired baseline comparisons. |
| PM-R017 | P0 | Reject unsafe upstream defaults including unrestricted network egress, disabled sandboxing and access to evaluation rubrics or holdout answers. |
| PM-R018 | P1 | Produce concise evidence-linked decision artifacts for operator visibility **without requiring operator review as part of routine task completion**. |
| PM-R019 | P0 | Reuse existing governance, planning, memory, coordination, observability, evolution and approvals; no duplicate authority or autonomous truth engine. |
| PM-R020 | P0 | Maintain explicit source-of-truth and migration traceability from v1.2 closeout; no inferred closure, unverified PASS, or unapproved production simplification. |
| PM-R021 | P1 | Track throughput, queue bottlenecks, agent evaluation cost, latency, correctness, false passes, blocked states, missed risks and verified recovery rather than merely reduced human touch time. |
| PM-R022 | P0 | Require isolated worktrees, side-effect controls, secrets isolation, rollback and negative tests before autonomous code-changing experiments. |

## 5. Workstreams and dependency order

### W0 — v1.2 predecessor closeout reconciliation

**Entry:** read the separately maintained v1.2 document and its actual acceptance/evidence matrix. **Exit:** a version-pinned inventory of accepted, failed, pending and deferred outcomes, with explicit dependencies; no invented completion. Existing Gate B, F1-E and Q13 statuses are read from current authoritative records, not copied as permanent truths.

### W1 — Agent evaluation architecture

Map existing authority boundaries and evaluator capabilities. Specify immutable rubrics, independent evidence snapshots, proposer/executor/verifier/critic isolation, deterministic oracles, failure classification, disagreement and stop handling. Test seeded defects and prompt-injection negatives before agent grading can gate readiness.

### W2 — Grounded skills and actionable ignorance

Inventory current skill/capability contracts. Prototype typed preconditions/effects/refusal/verification **without replacing existing policy gates**. Evaluate deliberately missing and conflicting evidence; distinguish asking, experimenting, refusing and stopping.

### W3 — Hypothesis, observation and memory integrity

Version claim provenance and temporal scope. Record predictions before execution and compare with actual effects. Verify that memory updates and natural-language summaries preserve uncertainty, contradictory observations and rollback history.

### W4 — Governed harness experimentation

Use isolated Propose–Probe–Compose trials with pinned source, paired baseline, independent evaluator agents, blinded holdouts, controlled egress, and explicit time/cost budgets. Reject any candidate that weakens policy or safety regardless of throughput.

### W5 — Agent-operated supervision qualification

Define per-task evaluation intensity, risk thresholds, ongoing automated sampling, exception monitoring, expiry and automatic downgrade. Do **not** treat lower evaluation intensity as permission to bypass approval. Demonstrate fail-closed behavior when evaluators are unavailable or disagree.

### W6 — Integration and readiness

Run full agent-operated integration exercises covering coordination, tool effects, governance, persistence, crash/restart, Workbench evidence, regression, recovery and rollback. Readiness agent produces evidence-linked PASS/FAIL/BLOCKED recommendation; release still follows existing maintainer authorization and security publication restrictions.

**Sequence:** W0 → W1 → (W2 and W3 in parallel) → W4 → W5 → W6. W1 security/evaluator independence is a prerequisite for later promotion. W2/W3 may run as isolated research before W0 closes only if they do not depend on predecessor migration outcomes or modify production.

## 6. Required research experiments

| Experiment | Baseline vs candidate | Independent agent evaluation | Stop condition |
|---|---|---|---|
| E1 Grounded skills | Existing capability execution vs typed contracts | Verify effects, refusals, ownership and regressions | Policy bypass, incorrect verified success |
| E2 Actionable ignorance | Existing uncertainty handling vs missing-evidence planner | Seed unknowns/conflicts; score questions, bounded probes, correct stop | Unapproved tool use or fabricated certainty |
| E3 Hypothesis integrity | Existing memory/evidence representation vs typed claim ledger | Compare preregistered predictions with independent observations | Predicted ≡ verified without evidence |
| E4 Evaluator qualification | Current verification vs isolated verifier/critic | Blinded defects, deterministic oracles, contamination, disagreement | False passes above policy threshold or unmeasured risk |
| E5 Harness optimization | Pinned harness baseline vs candidate | Separate evaluation and safety checks on held-out tasks | Sandbox/egress breach, rubric exposure, regression |
| E6 Autonomous readiness | Current orchestration vs agent-operated end-to-end | Independent agent checks and durable trace reconciliation | Missing effect evidence, self-approval, unrecoverable state |

Thresholds and sample sizes must be set by existing governance based on risk and evidence. **No numerical threshold is invented by this PRD.** All measurements distinguish designed tests from executed results.

## 7. Acceptance gates

| Gate | Evidence required | Owner and outcome |
|---|---|---|
| PM-G0 | v1.2 closeout inventory, source commit and unresolved dependencies | Reconciliation agent: VERIFIED / BLOCKED |
| PM-G1 | Evaluator independence, immutable rubrics, seeded-defect and prompt-injection negative tests | Verifier + critic agents; deterministic policy |
| PM-G2 | Grounded-skill, ignorance and claim-ledger paired benchmark | Independent evaluator agents |
| PM-G3 | Harness candidate isolation, baseline advantage and rollback evidence | Independent evaluator agents + deterministic security checks |
| PM-G4 | Qualification, expiry, downgrade and exception handling under failure injection | Evaluator agents + existing governance |
| PM-G5 | Durable end-to-end integration, crash recovery and no fabricated success | Readiness agent + independent evidence |
| PM-G6 | Final evidence-linked readiness recommendation and unresolved HOLD list | Readiness agent; **not** a release authorization |

A gate is BLOCKED if required evidence is missing, evaluation independence is compromised, or authority is unavailable. A failed candidate cannot be promoted by majority vote. Gate success does not silently clear the parent PRD's release restrictions.

## 8. Deliverables

- `pre-2.0-v1.2-closeout-reconciliation.md` — predecessor evidence and remaining dependencies.
- `agent-evaluator-contract.md` — roles, isolation, evidence, rubric immutability and threat model.
- `grounded-skill-contract.md` — typed transformation and policy integration.
- `actionable-ignorance-experiment.md` — missing-evidence scenarios and scoring.
- `hypothesis-observation-ledger.md` — epistemic states, provenance and versioning.
- `harness-optimization-experiment.md` — safe, pinned, independently evaluated comparison.
- `autonomy-qualification-matrix.md` — per-task evaluation intensity and downgrade.
- `pre-2.0-agent-readiness-report.md` — evidence-linked PASS/FAIL/BLOCKED recommendation.

These are proposed outputs, not files claimed to exist.

## 9. Decisions, conflicts and change control

1. **No human in the routine evaluation loop:** agent-driven evaluation is the default design of this program. This does not waive any explicit authorization already established by Q01–Q15.
2. **No self-authorizing agents:** evaluation verdicts are not permission grants. If an operation requires human approval and none is available, mark it BLOCKED and preserve evidence.
3. **No automatic predecessor closure:** v1.2 remains independently controlled until closed with actual evidence.
4. **No new authority subsystem:** reuse existing owners and require a boundary review for any new interface.
5. **No speculative science claims:** MNLM concepts are engineering hypotheses; external benchmark gains are not ALiX results.
6. **No release-status laundering:** Gate B HOLD, F1-E QUALIFIED (as last observed in the predecessor), Q13 publication HOLD and production simplification HOLD are historical snapshots, not assertions about future gate state. Resolve current statuses from authoritative records before each decision.
7. **No implied implementation authorization:** this PRD specifies the next program; code changes, promotions, merges, deployment and publication require separately delegated authority.

## 10. Traceability

- Parent product direction: `docs/prd/ALiX_MASTER_PRD_v2.9.md`, especially §§31–33.
- Predecessor: `ALiX_PRE_2_0_HARNESS_PRD_v1.2.md` and its audit/acceptance evidence; confirm exact canonical path during W0.
- Prior draft: `ALiX_PRE_2_0_HARNESS_PRD_v1.3.md`, used as a source for research requirements, not as a second active PRD.
- Research: Harness² (Google Research); Evan Kormos (progressive supervision); Chris Royse (grounded skills/uncertainty/hypothesis ideas). Claims from talks and external experiments require independent ALiX verification.
- Governance: approved Q01–Q15 and existing security, policy, audit and release authorities take precedence over this draft.


## 11. LEAN architecture-first optimization amendment (v1.1)

**Unique namespace:** This program uses **LEAN-01–LEAN-06**, **LEAN-R001–LEAN-R018**, and **LEAN-G01–LEAN-G06** exclusively for new optimization work. These are **new identifiers**, not renames or assertions of completion of existing ALiX P/X/A/Q/PRE milestones. The predecessor v1.2 retains its original IDs and ownership.

**Evidence:** [Read-only architecture baseline](ALiX_LEAN_ARCHITECTURE_BASELINE_2026-10-25.md) is an initial static inventory, not a completed audit or benchmark. The laptop is the mandatory performance reference; its CPU/RAM/storage configuration and controlled baseline must be captured before selecting thresholds. Better workstation performance is a scaling hypothesis, not an automatic guarantee.

### 11.1 Architecture rules

- **Single authoritative owner:** one writer per durable decision or lifecycle transition; other components consume projections. Explicitly document session, coordination, agent, execution, governance, model and memory boundaries.
- **One canonical execution lifecycle:** CLI, TUI, API, daemon and unattended jobs share the same core state machine and tool authorization path; interface code does not fork business logic.
- **Minimal always-on core:** optional capabilities are lazy-loaded; idle loops, eager services, background watchers and polling must justify their measured cost.
- **Event-driven scheduling by default:** eligible work wakes coordination; timers are only for bounded deadlines, retries or proven necessary reconciliation. Coalesce or suppress noncritical no-op telemetry only after proving no consumers or audit obligations depend on it.
- **Resource-aware concurrency:** CPU, RAM, provider limits and token budgets govern worker admission and backpressure. Prefer useful work over maximum worker count.
- **Deterministic-first decisions:** avoid LLM calls for operations that code can evaluate correctly. Cache only with clear ownership, invalidation and bounded memory.
- **No blind deletion:** every removal or merge needs call-site evidence, live trace evidence where applicable, compatibility/migration analysis, tests and rollback.
- **Agent-operated quality control:** independent evaluator/critic agents plus deterministic oracles grade changes. They cannot grant permissions or override existing mandatory approvals.

### 11.2 Requirements

| ID | Priority | Requirement |
|---|---|---|
| LEAN-R001 | P0 | Pin repository revision, dirty-state manifest, device specifications and reproducible workload before claiming a baseline. |
| LEAN-R002 | P0 | Measure idle CPU/RSS, cold/warm startup, task latency, coordination wakeups/no-ops, model calls/tokens, disk writes, throughput and recovery. |
| LEAN-R003 | P0 | Map entrypoints to canonical session/coordination/execution lifecycle, including failure and restart paths. |
| LEAN-R004 | P0 | Identify every authoritative mutable state owner and any duplicate writer, cache or projection; require evidence before consolidation. |
| LEAN-R005 | P0 | Build a keep/merge/remove/defer register for each complexity candidate, with measured benefit, risks, consumers, migration and rollback. |
| LEAN-R006 | P0 | Preserve policy, approval binding, audit, durable transition, effect reconciliation and Q01–Q15 invariants during every optimization. |
| LEAN-R007 | P0 | Require one shared core lifecycle for all interfaces and automation; no competing agent or tool execution engines without explicit exception. |
| LEAN-R008 | P1 | Minimize idle core by lazy loading, bounded background work and justified polling; verify actual resource savings. |
| LEAN-R009 | P1 | Benchmark event-driven coordination, no-op tick/event suppression and backpressure without losing liveness or required evidence. |
| LEAN-R010 | P1 | Bound agent concurrency dynamically using memory/CPU/model budgets and measure performance on the reference laptop. |
| LEAN-R011 | P1 | Reduce unnecessary model calls and context duplication through deterministic checks, scoped caches and validated invalidation. |
| LEAN-R012 | P0 | Use independent evaluator agents, critic agents and deterministic oracles for regression, security and performance qualification, with no routine human grading. |
| LEAN-R013 | P0 | Require repeatable before/after measurements with matched workload, warm/cold distinction, variability, confidence and negative tests. |
| LEAN-R014 | P0 | Do not accept faster changes that degrade correctness, isolation, recovery, authorization or verified outcomes. |
| LEAN-R015 | P1 | Demonstrate that stronger hardware improves useful throughput without a separate architecture; avoid claims unsupported by measurements. |
| LEAN-R016 | P0 | Keep predecessor v1.2 closeout independent; never overwrite active work or treat an unverified milestone as passed. |

### 11.3 New work sequence

| New work ID | Outcome | Evidence before advancing |
|---|---|---|
| LEAN-01 | Static architecture audit + controlled laptop profiling | Entrypoint/state/timer/model-call maps and pinned performance baseline |
| LEAN-02 | Target architecture and owner contracts | Reviewed boundary contracts, canonical execution path and migration design |
| LEAN-03 | Evidence-backed simplification | Candidate-by-candidate keep/merge/remove register, independent regression and rollback |
| LEAN-04 | Lean runtime and adaptive scheduling | Idle resource, event-rate, latency and concurrency before/after evidence |
| LEAN-05 | Independent agent-driven qualification | Isolated verifier/critic, seeded failures, deterministic security and recovery checks |
| LEAN-06 | Laptop acceptance and scaling evidence | Repeated constrained-device runs, no regressions and documented higher-end scaling assumptions |

**Dependencies:** LEAN-01 → LEAN-02 → LEAN-03 → LEAN-04 → LEAN-05 → LEAN-06. Independent research from original W2/W3 may proceed only in isolation and cannot bypass these optimization gates. Original W0–W6 and PM-R/PM-G remain historical design structure; **LEAN is the execution sequence** for the architecture-first program, not a claim that those other gates passed.

### 11.4 Qualification gates

| Gate | Pass condition |
|---|---|
| LEAN-G01 | Pinned, reproducible laptop baseline and full source-of-truth inventory, with unknowns recorded |
| LEAN-G02 | No unowned lifecycle transition, ambiguous decision authority or unexplained alternate execution path in target design |
| LEAN-G03 | Every consolidation has evidence, migration, rollback and independent correctness/security verification |
| LEAN-G04 | Measured improvements on laptop, with no regression in required liveness, audit, recovery or authorization |
| LEAN-G05 | Independent evaluator-agent reliability demonstrated by seeded failures and deterministic oracles; no self-certification |
| LEAN-G06 | End-to-end constrained-device qualification and evidence-linked readiness recommendation, preserving release holds |

Numerical budgets are deliberately **not fabricated**: after LEAN-01, record baseline distributions and set explicit acceptance thresholds via existing governance. Each gate returns PASS, FAIL or BLOCKED with immutable evidence references; agents do not self-authorize promotions or release.

### 11.5 Immediate next step

Complete **LEAN-01 read-only** first. Capture machine specs, source and state ownership, live event/polling/model-call rates, and controlled benchmark results. Do not edit source, remove components, start an optimization implementation, or mark this audit complete merely because a directory inventory exists. Respect the concurrently active v1.2 closeout and dirty worktree.


## 12. JARVIS-style intent routing and governed capability expansion

**Status:** proposed design requirements, not implementation or approval to install capabilities. This section extends LEAN-02 target-architecture work and LEAN-05 qualification; it does not supersede the LEAN-01 evidence gate or Q01–Q15 authorization.

### 12.1 Additional requirements

| ID | Priority | Requirement |
|---|---|---|
| LEAN-R017 | P0 | Provide one prompt-to-intent-to-capability decision contract across CLI, TUI, API and daemon. Recognize chat, code, projects, image, video, research, automation and compositional requests; select a minimal execution strategy, models and authorized tools without requiring the user to select an engine. Deterministic routing precedes lightweight classification and escalated reasoning. Unsupported capabilities produce explicit limitations and proposed next steps, not fabricated execution. |
| LEAN-R018 | P0 | Govern the full capability lifecycle: discover → propose → acquire or develop in authorized isolation → verify → request explicit scoped approval → activate → monitor → quarantine, update or rollback. Installation of executable dependencies, new credentials/egress/filesystem privileges, activation and materially changed code or scope must be approved by an authorized operator. Approval is bound to artifact digest, version, origin, permission manifest, scope, expiry and rollback. Agents cannot approve their own proposals or broaden authority. |

### 12.2 Target decision contract

A request is first normalized into a typed `IntentDecision` containing: request identity, goal, intent candidates and confidence, requested output modalities, required capability IDs and versions, allowed effects, constraints, execution strategy (`direct` / `single-agent` / `workflow` / `parallel` / `scheduled`), resource estimate, uncertainty and reasons. The decision is a **proposal**, not permission. The existing governance owner authorizes effects separately. Multi-modal, multi-step tasks may compose capabilities through one coordination graph; a simple conversational answer must not spawn a graph without justification.

The capability registry must expose: capability identity and version, interface/IO schema, source/provenance, artifact digest, dependencies, declared effects and permission scopes, supported platforms, resource estimate, health/verification status, approval binding, and activation state. Capability selection checks both **availability** and **current authorization**. An unavailable capability may generate a proposal but must not silently install or execute itself.

### 12.3 Approval and lifecycle invariants

1. **Separate prepare from activate.** Discovery, code drafting and isolated tests may occur only within already delegated permissions. Installation, privilege changes, activation, and materially changed artifacts require a new explicit authorization.
2. **Immutable approval target.** Approval is tied to the exact tested artifact digest, version, source and declared permissions; a changed artifact invalidates the approval. Existing governance/approval owners remain authoritative; no new parallel approval database or agent-created permission grants.
3. **Least privilege and isolation.** Untrusted capability code starts disabled, is scanned and exercised in a restricted sandbox with denied-by-default network, secrets, host filesystem and side effects; capabilities cannot bypass policy by calling another capability.
4. **Fail closed and recover.** Missing, expired, rejected or mismatched approval blocks activation. Durable lifecycle states and audit events support crash recovery, rollback, revocation and quarantine. Approval alone cannot override failed mandatory verification.
5. **Existing approved use.** Repeated use within the exact active approved scope does not require gratuitous approval prompts. Permission expansion, code changes or sensitive new effects trigger reevaluation and, where required, reapproval.
6. **Capability claims are tested.** A successful install is not proof of functionality. Verify schema, expected outputs, adversarial failure handling, resource impact and security boundaries before marking active.

### 12.4 Acceptance evidence and qualification

- Intent-routing test corpus spanning obvious, ambiguous and composite prompts, including general chat, coding, projects, images, video, research and recurring automation; evaluate selection correctness, abstention and unnecessary model calls.
- Route-by-host parity matrix covering policy, approval, streaming, cancellation, persistence, retry, evidence and recovery; agent and non-agent paths must not silently diverge.
- Capability lifecycle tests for unapproved installation, unapproved activation, changed digest, permission escalation, stale approval, failed verification, rollback, revocation, malicious plugin, and crash/restart replay.
- Laptop baseline for router cost and idle registry overhead; lazy-load optional media providers and extension runtimes. A missing image/video backend must not increase ordinary chat's idle footprint materially without measured justification.
- Independent verifier and deterministic authorization oracle; evaluator verdicts cannot grant authority.

**Sequencing:** LEAN-01 inventories current routing, capability registry and approval owners. LEAN-02 specifies `IntentDecision` and `CapabilityManifest` interfaces and route parity. LEAN-03/04 simplify and implement only evidence-backed changes. LEAN-05 verifies the lifecycle and adversarial cases. LEAN-06 qualifies the integrated system on the reference laptop. No new milestone namespace or preexisting milestone is reused.
