# ALiX — Pre-2.0 Master Product Requirements Document

**Version:** 1.0 — agent-operated readiness program  
**Date:** 2026-10-25  
**Status:** DRAFT — proposed requirements; no implementation or release authorization  
**Parent:** [ALiX Master PRD v2.9](ALiX_MASTER_PRD_v2.9.md)  
**Predecessor:** `ALiX_PRE_2_0_HARNESS_PRD_v1.2.md` — separately owned harness-rationalization closeout; not superseded until independently closed and its evidence accepted  
**Derived from:** `ALiX_PRE_2_0_HARNESS_PRD_v1.3.md` (superseded draft), containing Harness², progressive-supervision, and grounded-reasoning research amendments  
**Repository location:** `docs/prd/ALiX_PRE_2_0_MASTER_PRD_v1.0.md`

> **Decision boundary.** The operator requests an **agent-driven program without human-in-the-loop execution, grading, or routine review**. This is an operating-model requirement for delegated work, **not** a change to Q01–Q15, existing approval authority, or legally required human oversight. A task needing authority not already granted must fail closed and remain blocked; an evaluator agent cannot manufacture that authority. Human approval is not silently converted to agent approval.

## 1. Executive summary

Before ALiX 2.0, establish a reliable **agent-operated delivery and readiness system**: agents decompose objectives, propose changes, implement within delegated scope, independently verify effects, challenge conclusions, collect durable evidence, remediate failures, and generate an evidence-linked release-readiness recommendation. Deterministic policy enforcement, budgets, durable state, and independent outcome verification remain outside agent discretion.

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
