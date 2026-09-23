**Bounded System One decisions inside a local-first governed agent
harness**

Project: ALiX \| Jev / System One integration \| Status: delivered (J0-J6)
See ALiX-Jev-Status.md for current state.

Prepared: 20 September 2026

# 1. Design objective

Add Jev as an optional high-speed probabilistic decision capability
without changing ALiX's fundamental architecture: ALiX owns
orchestration and governance, generative models own open-ended
reasoning, tools own effects, and durable state/evidence records what
happened.

# 2. Core architecture

User / API / TUI\
\|\
v\
ALiX deterministic workflow\
\|\
+--\> deterministic policy / governance\
\|\
+--\> Decision Service\
\| \|\
\| +--\> purpose-specific projector\
\| +--\> redactor / remote-boundary validator\
\| +--\> engine registry\
\| +--\> Local Rules\
\| +--\> Local LLM\
\| +--\> Jev (opt-in remote)\
\| +--\> decision journal\
\|\
+--\> Reasoning / Coordinator / Subagents\
\|\
+--\> Tools\
\|\
v\
Observations -\> ExecutionState / Evidence / Events

# 3. Responsibility split

  ----------------------------------------------------------------------------
  Layer           Owns                                 Must not own
  --------------- ------------------------------------ -----------------------
  ALiX workflow   legal workflow, sequencing, state    delegating global
                  transitions, bounded candidate sets  control to Jev

  Deterministic   permissions, approval floor,         being overridden by
  policy          capability/scope rules               probabilistic output

  Jev             atomic classification, scoring,      free-form planning,
                  bounded choice, probability          action invention,
                                                       secrets

  LLM / agents    planning, decomposition, coding,     waiving deterministic
                  synthesis, novel reasoning           governance

  ModelRegistry   tier -\> concrete configured model   letting Jev bind
                                                       provider/model IDs

  Decision        provenance, replay metadata,         uncontrolled sensitive
  journal         calibration evidence                 payload retention
  ----------------------------------------------------------------------------

# 4. Decision API

The domain API should expose semantic operations rather than a generic
'decide anything' call. A shared engine interface may expose choice(),
score() and noul(), but individual ALiX decisions should be named
services with their own projection, candidate schema, threshold profile
and fallback policy.

Conceptual types:

DecisionProvenance {\
engineId\
engineVersion?\
latencyMs\
remote\
projectionHash\
}

ChoiceResult\<T\> {\
kind: "choice"\
choice: T\
confidence?: number\
provenance\
}

ScoreResult {\
kind: "score"\
score: number\
confidence?: number\
provenance\
}

NoulResult {\
kind: "noul"\
probability: number\
provenance\
}

# 5. Projection architecture

Each decision owns a projector. The projector extracts only
decision-relevant fields from ALiX state. This reduces irrelevant
context, makes privacy review tractable, creates stable replay fixtures,
and prevents provider-specific prompts from spreading through the
runtime.

ExecutionState / runtime objects\
\|\
v\
Decision-specific projector\
\|\
v\
Minimal typed projection\
\|\
v\
Redaction + boundary validation\
\|\
+--\> local engine\
\|\
+--\> remote Jev (only if allowed)

# 6. Security boundary

Treat the Jev adapter as a remote trust boundary. The adapter must
accept already-projected input, run a redaction/validation pass, and
reject prohibited material before transport. Tool output and source text
are not inherently safe merely because they came from ALiX; they may
contain secrets or adversarial instructions.

# 7. Governance composition

Probabilistic decisions compose monotonically with deterministic
governance: they may increase caution, request verification, or trigger
review, but may not grant authority that policy withheld.

deterministic required approval ----+\
+--\> final approval requirement\
Jev risk escalation ----------------+

# 8. Model-tier routing

Jev's candidate set is made of stable ALiX compute classes, never model
IDs. The selected tier is passed to the existing canonical model
configuration. This preserves provider independence and the single
source of truth.

Jev Choice: coding\
\|\
v\
models.coding\
\|\
v\
provider/model configured by operator

# 9. Calibration design

Calibration belongs to a specific decision and engine. Store observed
outcomes and compare them with native confidence/probability. Thresholds
are versioned profiles. A profile must not silently transfer from Jev to
an LLM adapter because their probability semantics differ.

# 10. Replay design

The journal should make offline comparison possible: replay the same
redacted/protected fixture against a new Jev version, a local model, or
rules; compare decision agreement, accuracy, latency and cost; then
promote a new threshold profile through normal governance.

# 11. Failure model

-   Remote unavailable/timeout: use decision-specific configured
    fallback or explicit safe failure.

-   Malformed/unknown choice: reject; never coerce to an executable
    action.

-   Projection validation failure: do not call remote provider.

-   No calibrated threshold: run in shadow/observe mode rather than
    silently granting automation.

-   Jev disagreement with deterministic policy: deterministic policy
    wins.

-   Unknown model tier: fail routing validation before provider
    invocation.

# 12. Observability

Expose decision events to existing observability/TUI surfaces without
turning them into workflow authority. Useful fields: decision name,
engine, candidate count, result, native confidence/probability,
threshold profile, latency, fallback, remote/local, and journal ID.

# 13. Initial decision designs

## 13.1 ClaimVerificationDecision

Projection: claim + bounded evidence excerpt/structured evidence.
Choice: supported \| contradicted \| insufficient. Consumer decides what
verification action follows.

## 13.2 ContextRelevanceDecision

Projection: compact objective + one context item. Prefer Noul or bounded
score semantics appropriate to the SDK. Consumer applies
threshold/ranking in code.

## 13.3 ModelTierDecision

Projection: request/task features safe for remote use. Choice candidates
are enabled canonical tiers only. ModelRegistry resolves the returned
tier.

# 14. Future extension rule

A new Jev decision is admitted only when its question is atomic, its
legal output space is code-defined, its projection can be
minimized/redacted, deterministic authority remains intact, and there is
a measurable outcome that can calibrate the decision. Multi-hop planning
questions remain with System Two.
