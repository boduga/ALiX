**Context, locked decisions, constraints, implementation boundaries, and
next actions**

Project: ALiX \| Jev / System One integration \| Status: proposed
hand-off

Prepared: 20 September 2026

# 1. Purpose

This hand-off transfers the current architectural decisions for
introducing TypeSafe System One / Jev into ALiX. It is intentionally
implementation-oriented: a new engineer or agent should be able to
continue without reopening settled architectural questions.

# 2. Executive hand-off

-   ALiX remains the orchestrator. Jev is a bounded probabilistic
    decision primitive; it is not the agent loop or operating system.

-   Deterministic policy remains authoritative for permissions, scope,
    approvals, ownership and safety. Jev may escalate a restriction; it
    may not relax a deterministic restriction.

-   Do not send raw ExecutionState, raw source files, raw tool output or
    secrets to Jev. Build purpose-specific projections and redact before
    any remote call.

-   ALiX remains local-first. Jev is an opt-in remote DecisionEngine;
    local rules / local LLM behavior must remain usable when Jev is
    disabled or unavailable.

-   Initial production experiments are limited to: claim verification,
    per-item context relevance, and model-tier routing.

-   Model-tier routing returns ALiX compute classes such as
    fast/coding/thinking. The canonical models configuration resolves
    those tiers to actual provider/model IDs.

-   Decision results retain their native semantics: Choice, Score and
    Noul are not flattened into one universal confidence-bearing result.

-   Thresholds are per decision, per engine and risk context; they are
    calibrated from ALiX outcomes rather than treated as universal
    constants.

-   Every remote decision is journaled sufficiently for audit, replay,
    comparison and calibration.

# 3. Why this architecture

Jev is useful where ALiX already knows the legal decision space and
needs a fast classification, score or probabilistic judgment. Generative
models remain responsible for decomposition, planning, coding, research,
synthesis and other open-ended reasoning. This preserves explicit
workflow control and avoids turning a decision model into another
unconstrained agent.

# 4. Locked invariants

  ----------------------------------------------------------------------------
  Invariant   Rule
  ----------- ----------------------------------------------------------------
  JEV-1       Jev may select or score candidates supplied by ALiX; it may not
              invent executable actions.

  JEV-2       No raw ExecutionState crosses the Jev boundary. Each call uses a
              minimal purpose-specific projection.

  JEV-3       Secrets never cross the remote decision boundary.

  JEV-4       Raw tool output never crosses the remote boundary by default;
              extract only fields required by the question.

  JEV-5       Raw source files do not cross the remote boundary by default.

  JEV-6       Remote decisions use minimum-necessary, redacted projections.

  JEV-7       Disabling Jev must not make ALiX unusable.

  JEV-8       Deterministic policy is a floor. Jev can escalate approval/risk
              but cannot waive mandatory policy.

  JEV-9       Threshold profiles are engine-specific; Jev calibration is not
              transferable to LLM fallbacks.

  JEV-10      Jev never selects concrete provider/model IDs; it selects only
              canonical ALiX tiers.
  ----------------------------------------------------------------------------

# 5. Initial use cases

## 5.1 Claim verification

Input projection: one claim plus the minimum evidence required to judge
it. Output should be an enumerated result such as supported /
contradicted / insufficient, with native Jev result metadata.

## 5.2 Per-item context relevance

Evaluate one candidate context item against a compact objective/task
projection. ALiX filters or ranks in code. Do not ask Jev to reason over
an entire memory dump.

## 5.3 Model-tier routing

Choose among canonical ALiX tiers (for example tiny, fast, default,
coding, thinking, critic). ModelRegistry then resolves the tier from the
single canonical models configuration.

# 6. Explicit non-goals for first integration

-   No Jev-controlled agent while-loop.

-   No free-form next-action generation.

-   No Jev task decomposition or dependency-graph construction.

-   No numeric worker-count prediction; select bounded candidate domains
    and count in code if later needed.

-   No replacement of ALiX governance, approvals, capability ownership,
    execution state, or model registry.

-   No assumption that LLM fallback probabilities are calibrated like
    Jev.

-   No mandatory cloud dependency.

# 7. Proposed integration seams

Create a decision subsystem behind narrow typed contracts. Keep
transport/provider details below the domain API.

Suggested conceptual structure:\
src/decision/\
contracts.ts\
registry.ts\
projections/\
redaction/\
journal/\
calibration/\
engines/\
local-rules/\
local-llm/\
jev/\
decisions/\
claim-verification/\
context-relevance/\
model-tier/

# 8. Decision result semantics

Preserve the distinction between Choice, Score and Noul. Do not
normalize them to {value, confidence}. Choice/Score may expose
confidence according to the provider contract; Noul is a
probability-bearing result. The ALiX wrapper should expose native
semantics while adding common provenance fields.

# 9. Decision journal minimum record

-   decisionId, executionId/runId and timestamp

-   engine ID and exact engine/model/version string when available

-   decision type and question type

-   input projection hash and relevant state/version identifier

-   candidate set for bounded choices

-   native result (choice/score/noul) and native confidence/probability
    fields

-   threshold profile ID/version used by the consumer

-   policy/routing version relevant to the decision

-   latency, error/fallback metadata and whether remote redaction was
    applied

-   optional protected debug payload retention controlled separately
    from the primary ledger

# 10. Security and local-first requirements

-   Default decision path must work without Jev.

-   Remote Jev use must be explicit in configuration.

-   Projection occurs before redaction; redaction occurs before remote
    transport.

-   Secrets/API keys/tokens/private credentials must be rejected at the
    boundary, not merely masked opportunistically.

-   Log the projection hash rather than blindly persisting sensitive
    projection contents.

-   Remote failure must degrade to an allowed local engine or a safe
    explicit failure according to the decision's policy.

# 11. Approval rule

Approval logic is fail-closed relative to deterministic policy. A
representative shape is: needsApproval = policy.requiresApproval(action)
OR probabilisticRiskExceedsConfiguredThreshold. A low Jev risk score
must never cancel an approval already required by policy.

# 12. Parallel-agent boundary

Planning/decomposition and dependency reasoning stay with the existing
ALiX reasoning/coordinator layer. If Jev is later used, it should answer
atomic questions over candidate domains/actions already produced by
ALiX. ALiX validates ownership and dependencies and computes worker
counts deterministically.

# 13. Definition of done for first milestone

-   Jev can be enabled/disabled without changing core runtime behavior.

-   Three narrow decisions are available through typed contracts.

-   Remote calls receive only redacted projections.

-   Decision journal supports replay-oriented provenance.

-   Model-tier decision resolves through canonical models.\*
    configuration only.

-   Policy tests prove Jev cannot bypass mandatory approval.

-   Fallback behavior is tested for timeout, API error, malformed
    response and unavailable engine.

-   No agent loop depends on Jev.

# 14. Immediate next action

Begin with J0 only: contracts, engine registry, projection/redaction
boundary, configuration and decision journal. Do not wire Jev into
runtime routing until J0 tests establish the invariants.
