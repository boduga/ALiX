# ALiX ExecutionState Architecture
## SKILL.state-Inspired Hybrid Execution Substrate

**Status:** Proposed — Architecture / Decision Specification  
**Related Ticket:** #616 — SKILL.state — Decision-Critical Research  
**Parent Decision Map:** #615  
**Date:** 2 September 2026  
**Scope:** ALiX execution runtime, context assembly, state projection, long-horizon agent execution

---

# 1. Executive Summary

ALiX should adopt the central architectural principle demonstrated by **SKILL.state: Scalable Long-Horizon Agent Skills**:

> Replace repeated presentation of an ever-growing execution transcript with a bounded, structured representation of the current execution state.

However, ALiX should **not** adopt a pure SKILL.state architecture.

The correct ALiX architecture is:

> **An event-sourced, governed execution-state substrate in which `ExecutionState` is a bounded decision-making projection and `EventLog` remains the immutable source of truth.**

This distinction is fundamental.

SKILL.state demonstrates that conventional transcript-based agent execution has an unfavorable long-horizon scaling characteristic:

```text
prompt at step t ≈ O(t)

cumulative prompt processing ≈ O(T²)
```

while a bounded state representation can maintain approximately constant prompt size:

```text
prompt ≈ O(|P| + |Σ| + |O|)
```

where:

- `P` = immutable skill specification,
- `Σ` = structured execution state,
- `O` = latest observation.

The research reports substantial long-horizon token reductions while maintaining or improving task accuracy. At T=100, the reported Warehouse benchmark result was approximately 16× lower cumulative token use than the strongest Stateful baseline, and at T=200 the advantage reached approximately 50× against the Memory baseline.

The same research also establishes why pure state-only execution is inappropriate for ALiX: state is lossless only when the state representation remains a sufficient statistic for future execution. The paper identifies dynamic schema discovery, retroactive relevance, and trajectory-as-output tasks as explicit limitations.

ALiX therefore adopts a **hybrid substrate**:

```text
                    EVENT LOG
                 Immutable truth
                       │
                       ▼
               State Projector
                       │
                       ▼
                EXECUTION STATE
               Decision substrate
                       │
                       ▼
                Context Builder
                       │
          ┌────────────┴────────────┐
          │                         │
     Current State             Latest Observation
          │                         │
          └────────────┬────────────┘
                       ▼
                      LLM
                       │
              State Patch + Action
                       │
                       ▼
              Execution Governor
                       │
                       ▼
                 Step Executor
                       │
                       ▼
                    Events
                       │
                       └────────────► EVENT LOG
```

This design preserves ALiX's existing auditability and governance model while introducing bounded long-horizon context.

---

# 2. Decision

## 2.1 Adopt

ALiX will adopt:

1. A first-class `ExecutionState`.
2. Immutable skill specifications.
3. Typed, model-generated state patches.
4. Deterministic harness validation.
5. Deterministic state merge semantics.
6. Explicit state versioning.
7. Rollback/retry for invalid state transitions.
8. Latest-observation context assembly.
9. EventLog-backed state projection.
10. State-aware context construction.
11. Explicit substrate-selection policy.
12. Benchmarking of state projection quality and context reduction.

## 2.2 Do Not Adopt

ALiX will not:

1. Replace EventLog with ExecutionState.
2. Treat ExecutionState as historical truth.
3. delete historical events after state projection.
4. allow the model to directly mutate persisted state.
5. allow the model to define arbitrary state keys.
6. allow the model to replace the entire state object.
7. assume state-only execution is valid for every workload.
8. introduce a giant JSON "memory" object.
9. use summarization as a substitute for structured execution state.
10. introduce shared mutable multi-agent state without deterministic conflict semantics.

---

# 3. Motivation

## 3.1 Current Long-Horizon Problem

Conventional agent execution repeatedly exposes historical context:

```text
step 1:
    thought
    action
    observation

step 2:
    thought
    action
    observation
    previous history

step 3:
    thought
    action
    observation
    previous history
    ...
```

The resulting transcript grows with execution length.

This causes:

- increasing prompt-token consumption,
- increasing latency,
- context-window pressure,
- stale information competing with fresh observations,
- reduced prefix-cache effectiveness,
- context poisoning,
- unnecessary repeated processing of historical information.

SKILL.state's central proposal is to retain the information needed for future decisions in a structured state rather than repeatedly replaying the transcript.

## 3.2 Why This Matters to ALiX

ALiX already supports:

- long-running agent execution,
- tools,
- providers,
- capabilities,
- execution governance,
- evidence,
- EventLog persistence,
- model usage metrics,
- execution intent,
- lifecycle governance,
- risk forecasting.

The existing architecture therefore provides a natural place to introduce a bounded execution-state projection.

The goal is not merely to reduce tokens.

The goal is:

> **Make the information required for the next governed execution decision explicit and machine-validatable.**

---

# 4. Architectural Principle

The core ALiX execution model becomes:

```text
Skill
+
ExecutionState
+
LatestObservation
+
RelevantEvidence
        │
        ▼
      Model
        │
        ▼
StateTransitionProposal
        │
        ▼
Deterministic Runtime
        │
        ├── validate
        ├── authorize
        ├── merge
        └── execute
        │
        ▼
      Events
        │
        ▼
    EventLog
        │
        ▼
 State Projection
```

The model proposes.

The runtime decides.

The EventLog records.

The projection summarizes the current decision state.

---

# 5. Core Concepts

## 5.1 Immutable Skill Specification

The skill specification `P` defines:

- objective,
- available actions,
- state schema,
- field semantics,
- environment rules,
- constraints,
- expected state-transition format.

The skill specification is immutable for the duration of an execution.

Conceptually:

```text
P = immutable execution contract
```

It should be treated similarly to a typed function signature.

The model does not redefine the skill during execution.

---

# 6. ExecutionState

`ExecutionState` represents the **current decision-relevant state** of an execution.

It is not:

- a transcript,
- a conversation history,
- an event log,
- an unconstrained memory store,
- a summary of everything that happened.

Its purpose is:

> Provide the minimum sufficient structured information required to make the next execution decision.

Conceptual contract:

```ts
interface ExecutionState {
  executionId: ExecutionId;
  version: number;
  step: number;

  objective: ExecutionObjective;

  status: ExecutionStatus;

  currentIntent?: ExecutionIntent;

  activeCapabilities: CapabilityState[];

  pendingActions: PendingAction[];

  completedActions: CompletedAction[];

  constraints: ExecutionConstraint[];

  permissions: ExecutionPermission[];

  observations: RelevantObservation[];

  artifacts: ArtifactReference[];

  risks: RiskState[];

  checkpoints: Checkpoint[];

  updatedAt: string;
}
```

This is intentionally a conceptual shape.

The initial implementation must **not** freeze this exact schema before benchmarking determines which fields are genuinely decision-critical.

---

# 7. State Schema Ownership

The model does not own the schema.

The deterministic runtime owns:

- permitted keys,
- types,
- required fields,
- field semantics,
- merge semantics,
- deletion semantics,
- version semantics.

This follows the SKILL.state separation of concerns: the model determines what state transition it wants to propose, while the deterministic runtime validates and applies it.

Therefore:

```text
Skill definition
       │
       ▼
State schema
       │
       ▼
Runtime validator
       │
       ▼
Model-generated patch
```

The model cannot introduce:

```json
{
  "made_up_fact": "...",
  "secret_internal_flag": true
}
```

unless that key is explicitly permitted by the schema.

---

# 8. State Patch

The model must produce a **patch**, never a complete replacement state.

Conceptually:

```json
{
  "state_patch": {
    "current_task": "repair provider routing",
    "provider_status": "unavailable",
    "retry_count": 2
  },
  "action": "resolve_fallback"
}
```

The runtime computes:

```text
Σ(next) = Σ(current) ⊕ ΔΣ
```

The patch only contains fields that change.

This is especially important because the dominant model failure identified in the research was **premature state overwrite/deletion**, accounting for approximately 68% of observed failures for the evaluated small model.

Therefore the runtime must never interpret an omitted field as deletion.

---

# 9. Null-Deletion Semantics

Deletion is explicit:

```json
{
  "state_patch": {
    "temporary_failure": null
  }
}
```

means:

```text
delete temporary_failure
```

whereas:

```json
{}
```

means:

```text
preserve existing state
```

This distinction is mandatory.

---

# 10. State Versioning

Every persisted state has a monotonically increasing version.

Example:

```text
ExecutionState v41
```

The model proposal records:

```json
{
  "base_state_version": 41,
  "state_patch": {},
  "action": {}
}
```

The runtime verifies:

```text
proposal.base_state_version
        ==
current_state.version
```

If not:

```text
state changed underneath proposal
        │
        ▼
reject stale proposal
        │
        ▼
reconstruct context
        │
        ▼
retry model decision
```

This provides optimistic concurrency protection and establishes a foundation for future multi-agent state sharing.

---

# 11. State Transition Lifecycle

The complete ALiX loop becomes:

```text
1. Load ExecutionState
2. Load Skill
3. Obtain latest Observation
4. Select relevant Evidence
5. Assemble bounded Context
6. Invoke Model
7. Receive StateTransitionProposal
8. Validate proposal
9. Validate state version
10. Validate action
11. Apply state patch
12. Persist new state
13. Execute authorized action
14. Emit Evidence
15. Append Events
16. Project resulting state
17. Repeat
```

The important ordering is:

```text
model proposal
      ↓
validation
      ↓
governance
      ↓
state mutation / execution
```

The model must never directly perform persistence.

---

# 12. Invalid State Transition

Invalid patches must never corrupt persistent state.

Example:

```text
Σ41
 │
 ▼
model proposes ΔΣ
 │
 ▼
validator
 │
 ├── valid ──────► Σ42
 │
 └── invalid
          │
          ▼
       rollback
          │
          ▼
    error feedback
          │
          ▼
      model retry
```

The research explicitly describes rollback/retry for malformed or invalid state patches.

For open-weight models, grammar-constrained decoding should be considered as an additional syntax-level mitigation.

---

# 13. EventLog Remains Authoritative

This is the most important ALiX-specific departure from a pure SKILL.state implementation.

`EventLog` remains the immutable historical source of truth.

ExecutionState is a projection.

```text
EventLog
   │
   │ immutable
   ▼
StateProjector
   │
   ▼
ExecutionState
```

Therefore:

```text
EventLog:
    What happened?

ExecutionState:
    What matters now?

Evidence:
    What supports the current state/decision?

ExecutionIntent:
    What are we trying to accomplish?

Governor:
    Are we allowed to do it?
```

No historical event is deleted merely because its information is represented in `ExecutionState`.

---

# 14. State Projection

The projector converts authoritative events and relevant execution information into current state.

Conceptually:

```text
Event 1 ─┐
Event 2 ─┤
Event 3 ─┤
Event 4 ─┤──► StateProjector ──► ExecutionState
Event 5 ─┤
Event N ─┘
```

The projection must be deterministic.

Given the same valid event sequence:

```text
events[1..N]
```

the projector must produce the same:

```text
ExecutionState
```

This allows:

- recovery,
- reproducibility,
- validation,
- testing,
- state rebuilding,
- historical auditing.

---

# 15. State Projection Is an Intelligence Boundary

The projector is not simply a serializer.

It answers:

> Which facts from the historical execution remain relevant to future decisions?

This makes state design a substantive architectural problem.

An excessively large state becomes:

```text
transcript disguised as JSON
```

An excessively small state becomes:

```text
information loss
```

Therefore ALiX must measure projection adequacy rather than assuming the first schema is correct.

---

# 16. Hybrid Context Substrate

ALiX should not use a single context strategy for every task.

The runtime should support multiple substrate modes.

Conceptually:

```text
                 Execution
                     │
                     ▼
             Substrate Policy
                     │
       ┌─────────────┼─────────────┐
       │             │             │
       ▼             ▼             ▼
   State-first   State+Evidence  History-aware
```

Possible initial modes:

```text
STATE_ONLY
STATE_PLUS_EVIDENCE
STATE_PLUS_RELEVANT_HISTORY
HISTORY_AWARE
```

The exact enum should be finalized during implementation planning.

---

# 17. When State-First Is Appropriate

State-first execution is particularly appropriate for:

- deterministic workflows,
- repeated operational procedures,
- long-running tool workflows,
- structured repository operations,
- provider routing,
- capability execution,
- resource management,
- repetitive maintenance,
- tasks with a known state schema.

These workloads have a strong notion of:

```text
current state
+
next transition
```

---

# 18. When History Must Remain Available

History-aware execution remains necessary for:

### 18.1 Dynamic Schema Discovery

When the runtime cannot know in advance what information will become important.

### 18.2 Retroactive Relevance

When an observation that appears irrelevant at step 10 becomes important at step 100.

### 18.3 Provenance / Audit Tasks

When the execution trajectory itself is the output.

### 18.4 Exploratory Engineering

For example:

```text
unknown repository
       ↓
explore
       ↓
discover architecture
       ↓
new hypothesis
       ↓
revisit earlier observation
```

The research explicitly identifies these limitations of pure state-only execution.

---

# 19. Adaptive Substrate Switching

The long-term ALiX architecture should permit runtime switching.

Example:

```text
STATE_FIRST
     │
     │ schema confidence falls
     ▼
STATE_PLUS_HISTORY
     │
     │ execution stabilizes
     ▼
STATE_FIRST
```

The decision should be deterministic and governed.

Possible signals include:

- state projection uncertainty,
- repeated state recovery,
- unresolved historical references,
- model requests for unavailable historical context,
- task classification,
- schema stability,
- context budget,
- execution phase.

This should be implemented only after the basic state substrate is validated.

---

# 20. Context Builder

The Context Builder becomes a first-class component.

Conceptually:

```text
Skill
  +
ExecutionState
  +
LatestObservation
  +
RelevantEvidence
  +
OptionalHistory
  +
Tools
        │
        ▼
     Context
```

The critical property is:

> Historical information is included intentionally rather than automatically.

This is the primary mechanism by which ALiX can achieve bounded long-horizon context.

---

# 21. Latest Observation

The model should receive the latest environment observation directly.

Examples:

```text
tool stdout
API response
database result
provider error
filesystem change
CI result
MCP response
user input
```

Prior observations should not automatically be replayed.

If an earlier observation remains relevant, the information should normally be represented in:

```text
ExecutionState
```

or:

```text
Evidence
```

or retrieved explicitly from:

```text
EventLog
```

---

# 22. Evidence Integration

ALiX's evidence system should remain separate from ExecutionState.

State says:

```text
provider_status = unavailable
```

Evidence can say:

```text
provider returned access-denied at timestamp X
```

The state therefore contains the operational conclusion while evidence retains supporting information.

This creates:

```text
State
   │
   └── supported by ──► Evidence
                           │
                           └── recorded in EventLog
```

This is especially important for governance and auditing.

---

# 23. ExecutionIntent Integration

ExecutionIntent remains the authoritative representation of the intended execution.

ExecutionState should reference the active intent rather than silently redefining it.

Therefore:

```text
ExecutionIntent
       │
       ▼
ExecutionState
       │
       ▼
Model proposal
       │
       ▼
Governor
```

A state transition cannot implicitly change governed intent unless the appropriate ALiX contract explicitly permits such a mutation.

---

# 24. ExecutionGovernor Integration

The Governor remains the final authorization boundary.

The model can propose:

```text
action = "apply_capability_mutation"
```

but cannot decide that the action is permitted.

The flow is:

```text
Model
 │
 ▼
ActionProposal
 │
 ▼
ExecutionGovernor
 │
 ├── denied
 │
 ├── escalated
 │
 └── allowed
        │
        ▼
   StepExecutor
```

State mutation should follow the same governance principles.

---

# 25. Capability Integration

ExecutionState may contain the operational state of active capabilities:

```text
capability
├── id
├── version
├── lifecycle
├── availability
├── health
├── confidence
└── recent outcome
```

But capability lifecycle remains owned by the capability governance subsystem.

ExecutionState is not allowed to redefine:

```text
active
mature
declining
deprecated
```

merely because a model writes a different value.

The state projection must respect authoritative capability events and lifecycle rules.

---

# 26. A9 Integration

A9 should not be part of the initial POC.

Once ExecutionState is stable, however, A9 can consume a bounded current-state representation.

Potential future flow:

```text
ExecutionState
      │
      ├── objective
      ├── capability state
      ├── evidence completeness
      ├── recent outcomes
      ├── failures
      ├── risk indicators
      └── execution trajectory
             │
             ▼
            A9
             │
             ▼
        A9Forecast
             │
             ▼
          RiskBand
             │
             ▼
       GovernanceRecommendation
```

This can eliminate repeated reconstruction of current execution context from raw history while preserving the EventLog for historical analysis.

---

# 27. Multi-Agent Execution

The first implementation is single-agent.

Shared mutable state across agents must **not** be introduced casually.

The research explicitly identifies concurrent state writes as an unresolved problem requiring deterministic conflict-resolution semantics.

ALiX should therefore initially use:

```text
Agent A
   │
   ▼
State version N
```

and reject stale concurrent writes.

Future multi-agent semantics may use:

```text
Agent A ──► patch A ──┐
                       ├──► deterministic merger
Agent B ──► patch B ──┘
```

but the merge contract must be explicitly defined before implementation.

---

# 28. Observability

The state substrate itself must be observable.

ALiX should introduce metrics such as:

```text
execution_state_size_tokens
execution_state_size_bytes

state_projection_latency
state_projection_failures

state_patch_count
state_patch_rejection_count
state_patch_retry_count

state_version_conflicts

state_recovery_count
state_recovery_steps

history_tokens
state_tokens
evidence_tokens
observation_tokens

context_tokens_total
context_tokens_saved

substrate_mode
```

ALiX already has broad monitoring coverage for agent, LLM, token, performance, health, MCP, WASM, and system metrics, making this an extension of an existing observability direction rather than a new monitoring architecture.

---

# 29. State-Projection Quality Metrics

Token reduction alone is insufficient.

ALiX must measure whether the state preserves the information necessary for correct execution.

Required conceptual metrics:

```text
projection_adequacy
state_recovery_steps
state_omission_rate
state_overwrite_rate
state_patch_invalid_rate
historical_retrieval_rate
decision_success_rate
```

The most important metric is:

> **How often does state-only execution make the correct decision without requiring historical recovery?**

---

# 30. Benchmark

A dedicated ALiX long-horizon benchmark should be created.

The same workload should be executed using:

```text
A. Full History
B. Summary/Compression
C. ExecutionState
D. Hybrid ExecutionState + selective history
```

Horizons:

```text
10
25
50
100
200
500
```

At minimum measure:

| Metric | History | Summary | State | Hybrid |
|---|---:|---:|---:|---:|
| Task success | | | | |
| Action success | | | | |
| Prompt tokens | | | | |
| Cumulative tokens | | | | |
| Completion tokens | | | | |
| Latency | | | | |
| Context overflow | | | | |
| Tool errors | | | | |
| State patch rejection | N/A | N/A | | |
| Recovery steps | | | | |
| Projection errors | N/A | | | |
| Governance violations | | | | |
| Cost | | | | |

---

# 31. Primary Success Criterion

The first POC succeeds only if it demonstrates both:

### Efficiency

Prompt growth remains approximately bounded as execution horizon increases.

### Correctness

Decision/task success does not materially degrade because of information lost during projection.

The target is not:

```text
smaller prompts
```

The target is:

```text
smaller prompts
+
equal or better decisions
```

This distinction is supported strongly by the SKILL.state budget-matched results, where structured state substantially outperformed generic truncation, compression, and summary approaches.

---

# 32. Initial Repository Shape

The first implementation should be isolated.

Proposed structure:

```text
src/runtime/execution-state/

    execution-state.ts
    execution-state-schema.ts
    execution-state-store.ts
    execution-state-projector.ts
    execution-state-version.ts
    state-patch.ts
    state-transition.ts
    state-validator.ts
```

Potential context integration:

```text
src/runtime/context/

    context-builder.ts
    substrate-policy.ts
```

The exact paths should be reconciled with the repository's existing module organization during implementation planning.

---

# 33. Phase 1 — Contract

Define:

```text
ExecutionState
StatePatch
StateTransitionProposal
StateVersion
StateSchema
```

Establish:

- immutable identity,
- versioning,
- patch semantics,
- null deletion,
- permitted fields,
- validation boundaries.

No LLM integration is required yet.

---

# 34. Phase 2 — Projection

Implement:

```text
EventLog
   ↓
ExecutionStateProjector
   ↓
ExecutionState
```

Requirements:

- deterministic,
- replayable,
- testable,
- versioned,
- side-effect controlled.

Existing historical events must remain unchanged.

---

# 35. Phase 3 — State Store

Introduce durable state persistence.

The implementation may initially use the existing ALiX persistence mechanisms rather than introducing a new database.

Requirements:

- atomic writes,
- version checks,
- recovery,
- deterministic serialization,
- corruption detection,
- state rebuild from EventLog.

---

# 36. Phase 4 — Context Builder

Introduce state-aware prompt assembly:

```text
Skill
+
ExecutionState
+
LatestObservation
+
RelevantEvidence
+
Tools
```

History remains available behind an explicit policy.

---

# 37. Phase 5 — Model State Patches

Extend the model execution contract to produce:

```json
{
  "state_patch": {},
  "action": {}
}
```

The runtime validates the patch before applying it.

The model does not receive write access to the state store.

---

# 38. Phase 6 — Governor Integration

Integrate:

```text
StateTransitionProposal
       │
       ▼
ExecutionGovernor
       │
       ▼
StepExecutor
```

This ensures the SKILL.state mechanism does not create an alternate execution path outside ALiX governance.

---

# 39. Phase 7 — Benchmark

Run the four substrate variants:

```text
FULL_HISTORY
SUMMARY
STATE
HYBRID
```

against long-horizon workloads.

Do not expand the architecture based solely on theoretical benefit.

Benchmark first.

---

# 40. Phase 8 — Adaptive Substrate

Only after the benchmark establishes:

- state quality,
- projection failure modes,
- workload boundaries,

should ALiX introduce adaptive switching.

---

# 41. Security and Integrity Invariants

The implementation must enforce:

### Invariant 1 — Event immutability

ExecutionState cannot modify historical EventLog entries.

### Invariant 2 — Schema ownership

The runtime owns the state schema.

### Invariant 3 — Patch-only mutation

The model cannot submit a complete replacement state.

### Invariant 4 — Version correctness

Stale state transitions are rejected.

### Invariant 5 — Atomicity

Invalid patches never partially mutate persistent state.

### Invariant 6 — Governance preservation

State transitions cannot bypass the ExecutionGovernor.

### Invariant 7 — Evidence preservation

State projection cannot delete supporting evidence.

### Invariant 8 — Deterministic projection

Identical event histories produce identical projected states.

### Invariant 9 — Explicit deletion

Only `null` or an explicitly defined deletion operation can remove state.

### Invariant 10 — Historical recoverability

ExecutionState can be reconstructed from authoritative historical records.

---

# 42. Failure Handling

## Malformed JSON

```text
model
 ↓
parse failure
 ↓
retry
```

## Invalid key

```text
validator
 ↓
reject
 ↓
retry
```

## Invalid type

```text
validator
 ↓
reject
 ↓
retry
```

## Stale version

```text
version conflict
 ↓
reload
 ↓
rebuild context
 ↓
retry
```

## Projection failure

```text
projection failure
 ↓
do not fabricate state
 ↓
fallback to authoritative history
 ↓
emit diagnostic event
```

## State insufficiency

```text
state insufficient
 ↓
retrieve relevant history
 ↓
continue in hybrid mode
```

---

# 43. What ALiX Should Learn From the 68% Failure Mode

The paper's largest model failure was premature state overwrite/deletion.

ALiX should therefore treat state preservation as a runtime contract rather than a prompt instruction.

The runtime should verify:

```text
new_state
=
old_state
+
explicit_changes
```

rather than:

```text
new_state
=
whatever JSON the model returned
```

The model can forget a field.

The runtime must not.

---

# 44. What ALiX Should Not Copy From SKILL.state Blindly

The research is persuasive but does not establish that one fixed state schema is universally optimal.

Therefore ALiX should not assume:

```text
one schema
+
every task
+
state only
```

Instead:

```text
domain skill
      ↓
domain state schema
      ↓
execution substrate policy
```

The state representation should be authored at the appropriate domain/skill level.

---

# 45. Relationship to Memory

ExecutionState is **not memory**.

A useful ALiX conceptual distinction is:

```text
Memory
├── durable facts
├── retrieved knowledge
└── learned information

ExecutionState
├── current objective
├── current conditions
├── active work
├── pending actions
└── decision-relevant operational state

Evidence
├── supporting observations
└── decision justification

EventLog
└── immutable historical record
```

This prevents the state object from becoming an unbounded general-purpose memory system.

---

# 46. Relationship to Context Management

The existing ALiX context-overflow strategy should evolve from:

```text
"How do we fit history into the context window?"
```

toward:

```text
"What information is necessary for the next decision?"
```

The state substrate becomes one of the primary answers.

The context manager can then spend its token budget on:

```text
current state
+
latest observation
+
important evidence
+
only necessary historical material
```

rather than repeatedly replaying the entire trajectory.

---

# 47. Architectural End State

The intended mature ALiX execution architecture is:

```text
                       ┌──────────────┐
                       │     Skill    │
                       │  immutable   │
                       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Execution    │
                       │    State     │
                       │   version N  │
                       └──────┬───────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
          Observation     Evidence      History
          latest only     relevant      selective
                │             │             │
                └─────────────┼─────────────┘
                              ▼
                       ┌──────────────┐
                       │   Context    │
                       │   Builder    │
                       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │     LLM      │
                       └──────┬───────┘
                              │
                StatePatch + ActionProposal
                              │
                              ▼
                       ┌──────────────┐
                       │  Validator   │
                       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │   Governor   │
                       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │  StepExecutor│
                       └──────┬───────┘
                              │
                              ▼
                         Evidence +
                           Events
                              │
                              ▼
                       ┌──────────────┐
                       │   EventLog   │
                       │ immutable    │
                       └──────┬───────┘
                              │
                              ▼
                       State Projector
                              │
                              ▼
                       ExecutionState N+1
```

---

# 48. Final Architectural Position

SKILL.state should be considered an **execution-substrate pattern**, not an ALiX memory replacement.

The ALiX adaptation is:

```text
SKILL.state
     +
Event-sourced architecture
     +
ALiX governance
     +
Evidence
     +
ExecutionIntent
     +
Capability governance
     +
A9 risk forecasting
     +
adaptive context policy
```

This produces a stronger architecture:

> **ALiX maintains immutable historical truth while presenting the model with a bounded, governed, decision-oriented projection of the current execution.**

The result is not merely:

```text
less context
```

but:

```text
less context
+
better information density
+
deterministic state transitions
+
governance
+
auditability
+
recoverability
```

---

# 49. Decision Checklist

Before implementation begins, the following must be locked:

- [ ] `ExecutionState` contract
- [ ] `StatePatch` contract
- [ ] `StateTransitionProposal` contract
- [ ] state version semantics
- [ ] null-deletion semantics
- [ ] schema ownership
- [ ] projection determinism
- [ ] state persistence strategy
- [ ] context-builder integration boundary
- [ ] governor integration boundary
- [ ] EventLog projection relationship
- [ ] fallback-to-history semantics
- [ ] substrate-policy contract
- [ ] benchmark workload
- [ ] projection-adequacy metrics
- [ ] state-overwrite protection
- [ ] concurrency policy
- [ ] recovery semantics

No CAP or A9 redesign is required for the initial POC.

---

# 50. Final Decision

**APPROVED IN PRINCIPLE — HYBRID IMPLEMENTATION**

ALiX should implement SKILL.state-inspired execution state as a **new governed projection layer over the existing event-sourced execution architecture**.

The governing architectural invariant is:

```text
                EVENT LOG
             immutable truth
                    │
                    ▼
             STATE PROJECTOR
                    │
                    ▼
            EXECUTION STATE
           bounded decision view
                    │
                    ▼
             CONTEXT BUILDER
                    │
                    ▼
                   LLM
                    │
           patch + action proposal
                    │
                    ▼
                GOVERNOR
                    │
                    ▼
                EXECUTOR
                    │
                    ▼
                 EVENTS
                    │
                    └────────────► EVENT LOG
```

**EventLog remains authoritative.  
ExecutionState is derived.  
The model proposes.  
The runtime validates.  
The Governor authorizes.  
The Executor acts.  
Evidence explains.**

The first implementation should be a **small, benchmark-driven POC**, not a broad runtime rewrite.

Only after the POC demonstrates bounded context growth **without unacceptable projection loss** should ALiX expand the substrate into adaptive state/history switching and deeper integration with CAP and A9.