# ALiX Capability Platform — Greenfield Architecture

**Design title:** Capability Platform Redesign — Canonical Catalog, Runtime Registry, Governed Evolution  
**Status:** Proposed  
**Design class:** Greenfield architectural refactor  
**Supersedes:** A7.0 Capability Marketplace and A7.1 Capability Lifecycle Application as implementation architecture  
**Related systems:** M-series Capability Registry, P5.5/P5.6 Capability Evolution Intelligence, A0–A6 Governed Evolution, A4 Governed Execution, A5 Outcome Observation  
**Primary objective:** Establish one canonical capability universe shared by runtime, CLI, governance, analysis, and lifecycle execution.

---

# 1. Executive Summary

ALiX currently has a capability architecture in which capability definitions, runtime registration, lifecycle state, governance history, and CLI visibility have become distributed across multiple surfaces.

The existing architecture exposes this problem through several symptoms:

- runtime capabilities are populated by `registerInitialCapabilities()` and tool-adapter registration;
- the A7 CLI constructs a separate `CapabilityRegistry`;
- the A7 lifecycle ledger contains governance state but not authoritative capability definitions;
- A7 can propose `register` but A7.1 cannot actually create a capability;
- lifecycle state exists as an overlay on the registry;
- governance decisions can be recorded without necessarily corresponding to a runtime mutation;
- runtime capability selection does not yet consistently consume governed lifecycle state;
- the CLI and runtime can therefore describe different capability universes.

These are not independent defects.

They arise because ALiX lacks a single canonical **Capability Catalog**.

This design replaces that architecture with three deliberately separated layers:

```text
Capability Catalog
    │
    │ canonical definitions
    ▼
Capability Registry
    │
    │ current runtime projection
    ▼
Runtime / CLI

P5.5/P5.6
    │
    ▼
A7 Lifecycle Intelligence
    │
    ▼
A0 → A2.5 → A3
    │
    ▼
A4 Capability Mutation Executor
    │
    ▼
Capability Catalog / Registry
    │
    ▼
A5 Measurement
```

The central invariants are:

1. **There is exactly one canonical capability definition universe.**
2. **The Capability Catalog owns definitions.**
3. **The Capability Registry owns current runtime capability state.**
4. **The governance ledger owns lifecycle history, not current capability definitions.**
5. **A7 may analyze and propose capability changes but never directly mutates capabilities.**
6. **A4 is the only authority capable of applying governed capability mutations.**
7. **The runtime and CLI resolve capabilities from the same catalog/registry.**
8. **A capability definition and its lifecycle state are separate concepts.**
9. **A governance decision never implies that a runtime mutation occurred.**
10. **A capability cannot become executable merely because a definition exists; its execution binding must also resolve successfully.**

This architecture also makes capability creation a real governed operation rather than the current deferred `register` placeholder.

---

# 2. Problem Statement

## 2.1 Current architectural problem

The current system conflates several distinct questions:

### What is a capability?

Defined by `Capability`.

### What capabilities exist?

Currently determined by runtime registration/bootstrap paths.

### Can a capability currently be used?

Determined by runtime behavior and execution availability.

### What lifecycle state is a capability in?

Tracked through the A7 lifecycle overlay.

### What did governance approve?

Tracked through A3/A7 governance artifacts.

### What actually happened?

Tracked through A4 execution and A5 observation.

These questions require different authorities.

The current implementation does not consistently maintain those boundaries.

---

# 3. Architectural Diagnosis

The central failure is not the existence of an A7 ledger or an A7 CLI.

The central failure is:

> **There is no canonical persisted capability definition universe shared by all consumers.**

Consequently, multiple capability surfaces emerged:

```text
Runtime
    ↓
registerInitialCapabilities()
tool adapters
    ↓
CapabilityRegistry instance A


A7 CLI
    ↓
new CapabilityRegistry()
    ↓
CapabilityRegistry instance B
```

Both instances have the same TypeScript class but represent different universes.

That is an architectural duplication even though the type is shared.

The greenfield design therefore does **not** attempt to make those two registries synchronize.

It removes the possibility of having two independent definition universes.

---

# 4. Design Goals

## 4.1 Primary goals

The redesign MUST:

- establish one canonical capability definition model;
- provide one catalog containing all known definitions;
- support built-in, tool, plugin, workflow, skill, and custom capabilities;
- persist capability definitions;
- expose the same catalog to CLI and runtime;
- separate definition from lifecycle state;
- support governed creation;
- support governed modification;
- support governed lifecycle transitions;
- support governed consolidation;
- provide explicit execution bindings;
- route all capability mutation through A4;
- preserve A3 as the governance authority;
- preserve A5 as the outcome authority;
- preserve P5.5/P5.6 as capability intelligence authority;
- preserve append-only governance history;
- provide deterministic capability identity and versioning;
- support restart and rehydration without inventing a second source of truth.

## 4.2 Secondary goals

The redesign SHOULD:

- make capability discovery independent of implementation source;
- allow plugins/tool adapters to contribute definitions;
- make capabilities inspectable from the CLI;
- make runtime availability explainable;
- make lifecycle state observable;
- allow future remote/distributed capability catalogs;
- support capability versioning;
- make capability mutation transactional from the runtime's perspective.

---

# 5. Non-Goals

This redesign does NOT attempt to:

- redesign A3 governance;
- redesign A4 authorization;
- redesign A5 observation;
- redesign P5.5/P5.6 intelligence;
- replace `EvolutionProposal`;
- create a second governance protocol;
- make A7 responsible for capability execution;
- embed runtime implementations inside capability definitions;
- automatically invent implementations for proposed capabilities;
- make every lifecycle transition executable immediately;
- merge arbitrary implementations automatically.

---

# 6. Core Architectural Principle

The capability platform is based on four distinct concepts:

```text
Definition
State
Governance
Execution
```

They MUST NOT be represented as one object.

---

# 7. Capability Definition

## 7.1 Canonical definition

The canonical artifact is:

```ts
interface CapabilityDefinition {
  id: CapabilityId;
  version: string;

  kind:
    | "core"
    | "tool"
    | "skill"
    | "workflow"
    | "plugin"
    | "custom";

  title: string;
  description: string;

  aliases: string[];
  tags: string[];
  category: string;

  risk: CapabilityRisk;
  requiredPermissions: Permission[];

  argsSchema?: JsonSchema;
  resultSchema?: JsonSchema;

  execution: CapabilityExecution;

  dependencies: CapabilityId[];

  extensions: Record<string, unknown>;
}
```

The definition MUST be:

- serializable;
- deterministic;
- implementation-independent;
- free of runtime state;
- free of lifecycle state;
- free of governance state;
- free of mutable execution objects/functions.

---

# 8. Capability Identity

A capability ID uniquely identifies the logical capability.

Examples:

```text
core.session.list
core.session.show
tool.file.read
tool.shell.run
```

Version is separate:

```text
tool.file.read@1.0
```

The logical identity remains:

```text
tool.file.read
```

while the definition version may change.

The system MUST define whether a version change represents:

- compatible evolution;
- incompatible evolution;
- replacement.

That policy belongs to the capability catalog/versioning layer, not A7.

---

# 9. Capability Execution Binding

A definition declares how a capability executes but does not contain the implementation.

Introduce:

```ts
interface CapabilityExecutionBinding {
  capabilityId: CapabilityId;

  strategy:
    | "native"
    | "tool"
    | "daemon"
    | "agent"
    | "cli"
    | "workflow"
    | "plugin";

  target: string;

  configuration?: Record<string, unknown>;
}
```

Examples:

```ts
{
  capabilityId: "tool.file.read",
  strategy: "tool",
  target: "file.read"
}
```

or:

```ts
{
  capabilityId: "core.session.list",
  strategy: "native",
  target: "session.list"
}
```

This separation is essential.

A capability can exist in the catalog while being unavailable because its binding cannot resolve.

---

# 10. Capability Catalog

Introduce the canonical catalog:

```ts
interface CapabilityCatalog {
  get(id: CapabilityId): CapabilityDefinition | undefined;

  list(): CapabilityDefinition[];

  has(id: CapabilityId): boolean;

  register(
    definition: CapabilityDefinition,
    binding?: CapabilityExecutionBinding
  ): void;

  update(
    id: CapabilityId,
    patch: CapabilityDefinitionPatch
  ): void;

  remove(id: CapabilityId): void;

  getBinding(
    id: CapabilityId
  ): CapabilityExecutionBinding | undefined;
}
```

There MUST be one logical catalog per ALiX project/runtime domain.

---

# 11. Catalog Authority

The Capability Catalog is authoritative for:

> **What capability definitions exist.**

It is NOT authoritative for:

- current lifecycle;
- governance history;
- runtime telemetry;
- authorization;
- outcome effectiveness.

Those belong elsewhere.

---

# 12. Catalog Persistence

The definition catalog MUST be persisted.

Recommended layout:

```text
.alix/
  capabilities/
    definitions.jsonl
    bindings.jsonl
```

Alternative storage implementations may be introduced later, but the logical model remains:

```text
CapabilityCatalogStore
```

The store MUST support:

```ts
interface CapabilityCatalogStore {
  listDefinitions(): CapabilityDefinition[];

  getDefinition(id: CapabilityId):
    CapabilityDefinition | undefined;

  appendDefinition(definition: CapabilityDefinition): void;

  replaceDefinition(definition: CapabilityDefinition): void;

  removeDefinition(id: CapabilityId): void;

  getBinding(id: CapabilityId):
    CapabilityExecutionBinding | undefined;
}
```

---

# 13. Bootstrap Sources

Existing sources such as:

```text
initial-capabilities.ts
tool-registry.ts
tool-adapter cards
```

become **bootstrap providers**, not authorities.

For example:

```ts
interface CapabilityBootstrapProvider {
  load(): CapabilityBootstrapEntry[];
}
```

At initialization:

```text
bootstrap providers
       │
       ▼
CapabilityCatalog
       │
       ▼
persistent catalog
```

After migration, `initial-capabilities.ts` MUST NOT remain an independent definition universe.

It is merely one source used to populate the canonical catalog.

---

# 14. Capability Registry

The Capability Registry becomes a runtime projection.

```ts
interface CapabilityRegistry {
  get(id: CapabilityId): RegisteredCapability | undefined;

  list(): RegisteredCapability[];

  isAvailable(id: CapabilityId): boolean;

  resolve(id: CapabilityId): RuntimeCapability;
}
```

It consumes:

```text
CapabilityCatalog
+
CapabilityLifecycleState
+
ExecutionBinding
+
runtime availability
```

---

# 15. Registered Capability

```ts
interface RegisteredCapability {
  definition: CapabilityDefinition;

  binding?: CapabilityExecutionBinding;

  lifecycle: CapabilityLifecycleState;

  availability: CapabilityAvailability;
}
```

Availability:

```ts
interface CapabilityAvailability {
  enabled: boolean;

  reason?:
    | "missing_binding"
    | "binding_unavailable"
    | "deprecated"
    | "disabled"
    | "dependency_unavailable"
    | "authorization"
    | "runtime_error";
}
```

---

# 16. Lifecycle State

Lifecycle state is separate from the definition.

```ts
type CapabilityLifecycleState =
  | "emerging"
  | "active"
  | "mature"
  | "stagnant"
  | "declining"
  | "deprecated";
```

The definition does NOT contain:

```ts
lifecycleState
```

Instead:

```text
CapabilityDefinition
        +
CapabilityLifecycleState
        =
RegisteredCapability
```

---

# 17. Governance State

Governance state is also separate:

```ts
type CapabilityGovernanceStatus =
  | "none"
  | "proposed"
  | "approved"
  | "rejected"
  | "applied"
  | "measured";
```

A capability can therefore have:

```text
Lifecycle:
    active

Governance:
    approved

Requested:
    deprecated
```

This means:

> The capability is currently active. Governance approved a proposal to deprecate it. The transition has not yet been applied.

No artificial lifecycle value such as:

```text
APPROVED_PENDING_APPLICATION
```

is required.

---

# 18. Capability State Projection

The runtime-facing state becomes:

```ts
interface CapabilityState {
  definition: CapabilityDefinition;

  lifecycle: {
    current: CapabilityLifecycleState;
  };

  governance: {
    status: CapabilityGovernanceStatus;

    pendingProposalId?: string;
    lastDecisionId?: string;
    lastExecutionId?: string;
    lastMeasurementId?: string;
  };

  availability: CapabilityAvailability;
}
```

This object is derived.

It MUST NOT become a second persistent authority.

---

# 19. Capability Lifecycle Transitions

Supported transitions are explicitly defined.

Example:

```text
emerging → active
active → mature
active → declining
mature → declining
declining → deprecated
stagnant → active
stagnant → deprecated
```

The exact state graph should be validated by a lifecycle policy.

A7 does not invent lifecycle states or transition rules.

P5.5/P5.6 owns lifecycle intelligence.

A4 owns execution of an approved transition.

---

# 20. Capability Governance Operations

Instead of vague lifecycle intents, define explicit mutations.

```ts
type CapabilityMutation =
  | CapabilityCreateMutation
  | CapabilityUpdateMutation
  | CapabilityTransitionMutation
  | CapabilityConsolidateMutation
  | CapabilityRemoveMutation;
```

---

# 21. Create Mutation

```ts
interface CapabilityCreateMutation {
  operation: "capability.create";

  definition: CapabilityDefinition;

  binding?: CapabilityExecutionBinding;

  initialLifecycle: "emerging";
}
```

This solves the current `register` problem.

A new capability proposal contains an actual definition.

There is no approved-but-unexecutable placeholder.

---

# 22. Update Mutation

```ts
interface CapabilityUpdateMutation {
  operation: "capability.update";

  capabilityId: CapabilityId;

  patch: CapabilityDefinitionPatch;
}
```

Example:

```ts
{
  operation: "capability.update",
  capabilityId: "tool.file.read",
  patch: {
    description: "Read a file from the workspace",
    requiredPermissions: ["operator"],
    tags: ["file", "read"]
  }
}
```

The exact mutation is governed.

A7 does not later invent the modification.

---

# 23. Lifecycle Transition Mutation

```ts
interface CapabilityTransitionMutation {
  operation: "capability.transition";

  capabilityId: CapabilityId;

  from: CapabilityLifecycleState;

  to: CapabilityLifecycleState;
}
```

The explicit `from` value provides a precondition.

If runtime state differs:

```text
expected: active
actual: deprecated
```

A4 MUST refuse execution.

This prevents stale governance decisions from silently mutating current state.

---

# 24. Consolidation Mutation

Consolidation becomes explicit:

```ts
interface CapabilityConsolidateMutation {
  operation: "capability.consolidate";

  sources: CapabilityId[];

  target: CapabilityId;

  sourceDisposition:
    | "deprecate"
    | "remove";
}
```

A7.1's existing interpretation of consolidation as simply deprecating related capabilities is therefore replaced by an explicit operation.

If true implementation merging is not supported, the operation MUST say so.

For the first implementation:

```text
consolidate
=
preserve target
+
deprecate source capabilities
```

No definition merge is implied.

---

# 25. Removal

Removal should be distinct from deprecation.

```ts
interface CapabilityRemoveMutation {
  operation: "capability.remove";

  capabilityId: CapabilityId;

  reason: string;
}
```

Whether removal is allowed should be policy-controlled.

A deprecated capability may remain in the catalog for historical/reference purposes.

---

# 26. A7 Responsibility

A7 becomes an **intelligence and proposal layer**, not a mutation layer.

Its flow is:

```text
P5.5/P5.6
    │
    ▼
A7 analyzer
    │
    ▼
CapabilityEvolutionCandidate
    │
    ▼
EvolutionProposal
    │
    ▼
A2.5
    │
    ▼
A3
```

A7 MUST NOT:

- mutate the catalog;
- mutate the registry;
- execute capability changes;
- directly register capabilities;
- directly deprecate capabilities.

---

# 27. Capability Evolution Candidate

```ts
interface CapabilityEvolutionCandidate {
  capabilityIds: CapabilityId[];

  intent:
    | "create"
    | "promote"
    | "update"
    | "consolidate"
    | "deprecate";

  evidenceRefs: EvidenceReference[];

  proposedMutation: CapabilityMutation;

  rationale: string;
}
```

The candidate contains the concrete intended change.

---

# 28. Mapping Existing A7 Signals

A7 consumes P5.5/P5.6 signals without redefining them.

| Candidate | Signal |
|---|---|
| create | capability gap + suggested capability |
| promote | emerging/active health + adoption |
| update | drift |
| consolidate | overlap/consolidation candidate |
| deprecate | declining/stagnant + adoption |

A7 MUST NOT create duplicate thresholds.

---

# 29. Creating a New Capability

The greenfield creation flow becomes:

```text
P5.5 capability gap
        │
        ▼
A7 candidate
        │
        │ definition required
        ▼
CapabilityDefinition proposal
        │
        ▼
A2.5 recommendation
        │
        ▼
A3 decision
        │
     APPROVE
        │
        ▼
A4
        │
        ▼
CapabilityMutationExecutor
        │
        ├── persist definition
        ├── persist binding
        └── initialize lifecycle = emerging
        │
        ▼
CapabilityRegistry projection
```

If the proposal lacks sufficient definition information:

```text
REQUEST_MORE_EVIDENCE
```

rather than creating a placeholder capability.

---

# 30. Capability Definition Completeness

A `capability.create` proposal MUST contain enough information to establish an executable or explicitly non-executable capability.

Required validation:

```text
id
version
kind
title
description
risk
permissions
execution strategy
```

For executable capabilities:

```text
execution binding
```

must resolve.

A definition without an implementation may exist only if the catalog explicitly supports dormant capabilities.

---

# 31. Execution Binding Validation

Before A4 applies:

```text
CapabilityMutationExecutor
        │
        ▼
validate definition
        │
        ▼
validate binding
        │
        ▼
validate dependencies
        │
        ▼
apply
```

A capability MUST NOT enter runtime-available state if its implementation binding is invalid.

---

# 32. A4 Capability Mutation Executor

Introduce:

```ts
class CapabilityMutationExecutor
  implements StepExecutor
```

It handles:

```text
capability.create
capability.update
capability.transition
capability.consolidate
capability.remove
```

A7 does not own this executor.

It belongs to the A4 execution layer because mutation is governed execution.

---

# 33. A4 Execution Flow

The canonical application path becomes:

```text
EvolutionProposal
       │
       ▼
GovernanceDecision
       │
       ▼
ExecutionRequest
       │
       ▼
authorizeExecution()
       │
       ▼
createExecutionPlan()
       │
       ▼
GovernedExecutionRuntime
       │
       ▼
CapabilityMutationExecutor
       │
       ▼
CapabilityCatalog / Registry
```

There is no:

```text
A7 gate
→ A7 mutation
```

shortcut.

---

# 34. Preconditions

Every mutation SHOULD include explicit preconditions.

Example:

```ts
{
  operation: "capability.transition",
  capabilityId: "tool.shell.run",
  from: "active",
  to: "deprecated"
}
```

The executor verifies:

```text
actual === from
```

before mutation.

This protects against stale decisions.

---

# 35. Rollback

Capability mutations MUST be reversible when technically possible.

The executor captures:

```text
pre-definition
pre-binding
pre-lifecycle
pre-availability
```

before mutation.

For a transition:

```text
active
   ↓
deprecated
```

rollback restores:

```text
active
```

For create:

```text
not present
   ↓
present
```

rollback removes the newly created artifact.

For update:

```text
definition A
   ↓
definition B
```

rollback restores A.

---

# 36. Atomicity

The execution architecture MUST avoid:

```text
registry changed
+
no durable mutation record
```

The preferred sequence is:

```text
authorize
   ↓
plan
   ↓
capture pre-state
   ↓
execute
   ↓
verify
   ↓
commit durable catalog mutation
   ↓
record execution
```

If durable commit fails:

```text
restore pre-state
```

using the A4 executor's compensating rollback mechanism.

No new A7 execution journal is required.

---

# 37. Governance Ledger

A7 retains an append-only lifecycle ledger.

Its responsibility is historical governance traceability.

```ts
interface CapabilityGovernanceEvent {
  eventId: string;

  timestamp: string;

  capabilityIds: CapabilityId[];

  event:
    | "proposed"
    | "decided"
    | "applied"
    | "measured";

  proposalId?: string;
  decisionId?: string;
  executionId?: string;
  measurementId?: string;

  evidenceRefs: string[];
}
```

The ledger MUST NOT become the canonical capability catalog.

---

# 38. Artifact Ownership

The system should retain the full artifacts in their owning subsystems.

```text
A0
 └── EvolutionProposal

A2.5
 └── GovernanceRecommendation

A3
 └── GovernanceDecision

A4
 └── ExecutionReport

A5
 └── VerificationEvidence

A7
 └── Governance/Lifecycle Events
```

The A7 ledger references these artifacts.

It does not need to become a container for them.

---

# 39. Rehydration

After restart:

```text
CapabilityCatalogStore
        │
        ▼
CapabilityCatalog
        │
        ▼
Lifecycle state store
        │
        ▼
CapabilityRegistry
        │
        ▼
Runtime
```

The system MUST NOT reconstruct the capability universe solely from A7 history.

The catalog persists definitions directly.

Governance history remains historical.

---

# 40. Runtime Consumption

The runtime MUST consume lifecycle state.

Current:

```text
ToolRetriever
    ↓
capability
    ↓
execute
```

becomes:

```text
ToolRetriever
    ↓
CapabilityRegistry
    ↓
CapabilityEligibilityPolicy
    ↓
permissions
    ↓
execution binding
    ↓
executor
```

---

# 41. Lifecycle Eligibility Policy

Introduce:

```ts
interface CapabilityEligibilityPolicy {
  evaluate(
    capability: RegisteredCapability,
    context: ExecutionContext
  ): EligibilityResult;
}
```

Examples:

```text
deprecated
    → unavailable

emerging
    → available under restricted conditions

active
    → normal

mature
    → normal / preferred

declining
    → available but deprioritized
```

The exact policy is configurable.

Tool retrieval should not contain lifecycle-specific business rules.

---

# 42. Runtime Deprecation

A deprecated capability MUST no longer be selected for normal execution.

This is the actual consequence of:

```text
A3 APPROVE
→ A4 APPLY
→ lifecycle = deprecated
```

Without this integration, governance would merely write paperwork.

The runtime projection therefore makes A7 meaningful.

---

# 43. CLI Architecture

The CLI MUST resolve the same services used by runtime.

There MUST NOT be:

```ts
new CapabilityRegistry()
```

inside the CLI command handler.

Instead:

```text
CLI
 │
 ▼
CapabilityService
 │
 ├── CapabilityCatalog
 ├── CapabilityRegistry
 ├── Governance
 └── LifecycleLedger
```

---

# 44. CLI Commands

Recommended surface:

```text
alix capabilities
├── list
├── inspect <id>
├── search <query>
├── health
├── history <id>
├── recommend
├── propose
├── apply <id>
└── measure <id>
```

Potential governance operations may remain under:

```text
alix governance
```

rather than duplicating approval commands under capabilities.

---

# 45. `capabilities list`

Should display:

```text
ID                    KIND    LIFECYCLE   AVAILABLE   TITLE
core.session.list     core    active      yes         List sessions
tool.file.read        tool    active      yes         Read file
tool.shell.run        tool    active      yes         Run shell
core.old              core    deprecated  no          Old capability
```

The list is directly backed by the canonical runtime projection.

---

# 46. `capabilities inspect`

Should show:

```text
Definition
-----------
ID
Version
Kind
Title
Description
Tags
Risk
Permissions
Schemas
Execution strategy
Execution binding
Dependencies

Runtime
-------
Lifecycle
Availability
Availability reason

Governance
----------
Pending proposal
Last decision
Last execution
Last measurement

History
-------
Relevant lifecycle events
```

This makes the CLI an operator view rather than a separate capability system.

---

# 47. `capabilities recommend`

Must remain read-only.

```text
P5.5/P5.6
    ↓
A7 analyzer
    ↓
candidates
    ↓
render
```

No:

- catalog mutation;
- registry mutation;
- ledger mutation;
- A3 decision.

---

# 48. `capabilities propose`

This is the governed proposal operation:

```text
analyze
   ↓
candidate
   ↓
EvolutionProposal
   ↓
A2.5
   ↓
A3
   ↓
decision
   ↓
ledger event
```

It does not apply the mutation.

---

# 49. `capabilities apply`

Apply MUST:

1. locate the authoritative approved proposal;
2. locate the corresponding A3 decision;
3. verify current capability state;
4. authorize through A4;
5. create execution plan;
6. execute through `GovernedExecutionRuntime`;
7. mutate the catalog/registry through `CapabilityMutationExecutor`;
8. record execution;
9. append A7 `applied` event.

No direct mutation is allowed in the CLI.

---

# 50. `capabilities measure`

Measurement:

```text
latest applied execution
        ↓
pre-application baseline
        ↓
current telemetry/P5.5 evidence
        ↓
A5 observation
        ↓
measurement artifact
        ↓
A7 measured event
```

A5 remains authoritative for effectiveness.

A7 does not decide whether an outcome was successful.

---

# 51. Capability Health

`alix capabilities health` should simply surface P5.5/P5.6 capability intelligence.

It must not recreate:

- health calculations;
- drift thresholds;
- overlap scoring;
- adoption formulas.

A7 consumes those signals.

---

# 52. Capability History

History is a projection over:

```text
proposal
decision
execution
measurement
```

Example:

```text
2026-08-10  proposed
  capability: tool.shell.run
  intent: deprecate

2026-08-10  decided
  decision: APPROVE

2026-08-10  applied
  execution: exec-123

2026-08-11  measured
  measurement: meas-456
```

This is history, not current state.

---

# 53. Capability Creation Workflow

The complete greenfield creation workflow is:

```text
                    GAP
                     │
                     ▼
               P5.5 signal
                     │
                     ▼
              A7 candidate
                     │
                     ▼
        CapabilityDefinition
        + ExecutionBinding
                     │
                     ▼
             EvolutionProposal
                     │
                     ▼
                    A3
                     │
                 APPROVE
                     │
                     ▼
                    A4
                     │
                     ▼
        CapabilityMutationExecutor
                     │
             ┌───────┴────────┐
             ▼                ▼
          Catalog          Registry
             │                │
             └───────┬────────┘
                     ▼
                  Runtime
                     │
                     ▼
                   A5
```

A new capability therefore becomes a real system object.

---

# 54. Modification Workflow

```text
drift
 ↓
P5.5
 ↓
A7
 ↓
CapabilityUpdateMutation
 ↓
A3
 ↓
A4
 ↓
CapabilityMutationExecutor
 ↓
Catalog update
 ↓
Registry projection
 ↓
A5
```

No mutation can occur outside this path.

---

# 55. Deprecation Workflow

```text
declining/stagnant
        ↓
P5.5
        ↓
A7
        ↓
capability.transition
active → deprecated
        ↓
A3 APPROVE
        ↓
A4
        ↓
Registry lifecycle = deprecated
        ↓
EligibilityPolicy excludes capability
        ↓
A5 measures outcome
```

This creates an actual closed loop.

---

# 56. Consolidation Workflow

```text
overlap
  ↓
P5.5
  ↓
A7
  ↓
consolidation proposal
  │
  ├── source A
  ├── source B
  └── target C
  ↓
A3
  ↓
A4
  ↓
deprecate A
deprecate B
preserve C
  ↓
A5
```

True implementation merging can be introduced later as a separate executor capability.

---

# 57. Error Handling

The system MUST distinguish:

### Definition error

```text
InvalidCapabilityDefinitionError
```

### Binding error

```text
CapabilityBindingUnavailableError
```

### Lifecycle conflict

```text
CapabilityStateConflictError
```

### Governance failure

```text
CapabilityNotApprovedError
```

### Execution failure

```text
CapabilityExecutionError
```

### Measurement failure

```text
CapabilityMeasurementError
```

These errors should carry structured kinds.

---

# 58. Stale Governance Protection

Suppose A3 approved:

```text
active → deprecated
```

but before execution another process changed the capability to:

```text
mature
```

A4 MUST refuse:

```text
expected lifecycle: active
actual lifecycle: mature
```

The proposal does not automatically retarget.

The operator must create a new proposal.

This preserves governance integrity.

---

# 59. Concurrency

Capability mutations MUST be serialized per capability.

For example:

```text
tool.shell.run
```

cannot simultaneously receive:

```text
active → deprecated
```

and:

```text
active → mature
```

Both may be individually valid proposals, but only one can execute against the same current state.

The second encounters a precondition conflict.

---

# 60. Determinism

A7 analysis MUST remain deterministic.

Given:

```text
same catalog
same P5.5/P5.6 signals
same evidence
same telemetry snapshot
```

the analyzer MUST produce:

```text
same candidates
same ordering
same mutation payloads
```

No random candidate IDs or timestamps should affect candidate ordering.

---

# 61. Evidence

Every lifecycle proposal MUST contain evidence references.

Example:

```ts
evidenceRefs: [
  "health:...",
  "gap:...",
  "adoption:...",
  "outcome:..."
]
```

Evidence remains external.

A7 does not embed authoritative evidence documents inside capability definitions.

---

# 62. Security Model

Capability definitions MUST be treated as potentially privileged artifacts.

Changes to:

```text
requiredPermissions
execution binding
risk
dependencies
schemas
```

require governance.

An update to a low-risk descriptive field may still pass through the same mutation system initially.

Fine-grained policy can be added later.

---

# 63. Capability Risk

Risk belongs to the definition:

```ts
risk:
  | "low"
  | "medium"
  | "high"
  | "critical";
```

But changing risk is itself a governed mutation.

A capability cannot silently change from:

```text
low → critical
```

outside A4.

---

# 64. Dependency Integrity

Before applying a mutation:

```text
Capability A
   depends on
Capability B
```

A4 validates that B remains available.

Deprecating B may therefore require:

```text
REQUEST_MORE_EVIDENCE
```

or:

```text
REJECT
```

unless the proposal also handles dependent capabilities.

---

# 65. Versioning

Capability definition changes SHOULD create versions rather than silently mutating historical definitions.

Example:

```text
tool.file.read
  1.0
  1.1
  2.0
```

The catalog can retain historical definitions.

The runtime resolves the active version.

Governance history references the exact version affected.

---

# 66. Historical Immutability

Once a proposal, decision, execution, or measurement artifact is recorded:

> It is immutable.

Corrections create new artifacts.

The lifecycle ledger remains append-only.

The catalog may change because it represents current state, but historical artifacts MUST continue referring to the exact affected version/state.

---

# 67. Relationship Between Catalog and Ledger

The correct relationship is:

```text
Catalog:
    "What exists now?"

Ledger:
    "What governance decisions happened?"

A4:
    "What mutation was executed?"

A5:
    "What happened afterward?"
```

Never:

```text
Ledger:
    "What capabilities exist?"
```

That is the catalog's responsibility.

---

# 68. Relationship Between Registry and Catalog

```text
Catalog
    ↓
definition

Registry
    ↓
definition + current runtime state
```

The registry MUST NOT invent definitions.

If the catalog doesn't contain:

```text
tool.foo
```

the registry cannot legitimately contain:

```text
tool.foo
```

---

# 69. Relationship Between CLI and Runtime

Both resolve:

```text
CapabilityCatalog
CapabilityRegistry
CapabilityService
```

Therefore:

```text
alix capabilities list
```

and:

```text
runtime capability retrieval
```

operate on the same capability universe.

This eliminates the two-surface problem.

---

# 70. Migration From Existing Architecture

The migration should be staged.

## Stage 1 — Extract canonical definitions

Move definitions currently found in:

```text
initial-capabilities.ts
tool-registry.ts
tool-adapter cards
```

into catalog bootstrap providers.

Do not change behavior yet.

---

## Stage 2 — Introduce persistent catalog

Create:

```text
.alix/capabilities/definitions.jsonl
.alix/capabilities/bindings.jsonl
```

Populate from bootstrap sources.

---

## Stage 3 — Change runtime

Runtime initialization becomes:

```text
load catalog
    ↓
build registry
    ↓
resolve bindings
```

---

## Stage 4 — Change CLI

Remove:

```ts
new CapabilityRegistry()
```

from the CLI.

Inject the same application-level `CapabilityService`.

---

## Stage 5 — Migrate lifecycle overlay

Move lifecycle state out of the ad-hoc A7 registry overlay into the canonical runtime-state model.

---

## Stage 6 — Introduce A4 CapabilityMutationExecutor

Support:

```text
create
update
transition
consolidate
remove
```

---

## Stage 7 — Rewrite A7

A7 becomes proposal generation against the canonical capability catalog.

---

## Stage 8 — Integrate runtime eligibility

Make runtime capability selection respect lifecycle and availability.

---

## Stage 9 — Retire old surfaces

Remove:

```text
independent initial registry
CLI registry
A7 direct mutation
A7-specific lifecycle applier
```

---

# 71. Proposed Module Layout

```text
src/capability/
├── definition.ts
├── identity.ts
├── lifecycle.ts
├── state.ts
├── execution-binding.ts
│
├── catalog/
│   ├── catalog.ts
│   ├── catalog-store.ts
│   ├── bootstrap.ts
│   └── migration.ts
│
├── registry/
│   ├── registry.ts
│   ├── runtime-projection.ts
│   └── eligibility-policy.ts
│
├── mutation/
│   ├── mutation-types.ts
│   ├── validator.ts
│   └── capability-mutation-executor.ts
│
└── service/
    └── capability-service.ts
```

A7:

```text
src/evolution/capability/
├── analyzer.ts
├── proposal-builder.ts
├── governance-bridge.ts
└── lifecycle-ledger.ts
```

A4:

```text
src/evolution/execution/
├── capability-mutation-executor.ts
└── ...
```

---

# 72. Capability Service

Introduce an application-level facade:

```ts
interface CapabilityService {
  list(): CapabilityState[];

  inspect(id: CapabilityId): CapabilityState | undefined;

  search(query: string): CapabilityState[];

  health(): CapabilityHealthReport;

  recommend(): CapabilityEvolutionCandidate[];

  propose(candidate: CapabilityEvolutionCandidate): Promise<...>;

  apply(id: CapabilityId): Promise<...>;

  measure(id: CapabilityId): Promise<...>;

  history(id: CapabilityId): CapabilityGovernanceEvent[];
}
```

The CLI and other operator interfaces consume this service.

A future web UI can consume the same service.

This is important given that ALiX will have both TUI and web UI surfaces.

---

# 73. UI Architecture

Both:

```text
TUI
Web UI
CLI
```

should ultimately consume the same capability service/projection.

None should directly inspect:

```text
definitions.jsonl
lifecycle.jsonl
```

or construct registry instances.

This makes the capability platform UI-independent.

---

# 74. Observability

Every mutation should emit structured events:

```text
capability.proposed
capability.decided
capability.execution.started
capability.execution.completed
capability.execution.failed
capability.applied
capability.measured
```

The event system and lifecycle ledger serve different purposes.

Events support operational observability.

The ledger supports durable governance history.

---

# 75. Metrics

Useful metrics:

```text
capability.count
capability.available
capability.unavailable
capability.deprecated
capability.emerging
capability.mature

capability.proposals
capability.approvals
capability.rejections
capability.applications
capability.measurements

capability.execution.failures
capability.binding.failures
capability.lifecycle.conflicts
```

P5.5 consumes telemetry rather than A7 recomputing it.

---

# 76. Testing Strategy

## Catalog

Test:

- create;
- read;
- update;
- remove;
- persistence;
- restart;
- duplicate ID;
- versioning.

## Registry

Test:

- projection;
- availability;
- binding resolution;
- lifecycle filtering;
- dependency handling.

## Mutation executor

Test:

- create;
- update;
- transition;
- consolidation;
- rollback;
- stale-state rejection;
- invalid binding;
- dependency failure.

## A7 analyzer

Test:

- health triggers;
- gap triggers;
- overlap;
- drift;
- adoption;
- determinism;
- frozen inputs.

## A3 bridge

Test:

- exact proposal;
- evidence;
- decision;
- rejected proposal;
- approved proposal.

## CLI

Test:

- same capabilities as runtime;
- list;
- inspect;
- recommend read-only;
- propose;
- apply;
- measure;
- error exit codes.

## Integration

The most important end-to-end test:

```text
create capability
    ↓
catalog
    ↓
runtime registry
    ↓
use capability
    ↓
telemetry
    ↓
P5.5
    ↓
A7 recommendation
    ↓
A3 approval
    ↓
A4 apply
    ↓
runtime state changes
    ↓
A5 measurement
    ↓
P5.5 observes outcome
```

---

# 77. Critical Invariants

### Invariant 1 — One definition universe

```text
CLI definitions === runtime definitions === governance definitions
```

All resolve through the same catalog.

### Invariant 2 — No unauthorized mutation

```text
A7 cannot mutate CapabilityCatalog.
```

### Invariant 3 — A4 is the mutation authority

```text
All governed capability mutations pass through A4.
```

### Invariant 4 — Decision ≠ application

```text
APPROVE
```

does not mean:

```text
APPLIED
```

### Invariant 5 — Current state ≠ history

Registry/catalog state is current.

Ledger is historical.

### Invariant 6 — Definition ≠ lifecycle

A capability definition does not contain lifecycle state.

### Invariant 7 — Stale decisions cannot mutate

A4 validates expected pre-state.

### Invariant 8 — Executability requires binding

A definition without a valid implementation binding cannot become runtime-available.

### Invariant 9 — Runtime consumes governance

Applied lifecycle state affects runtime eligibility.

### Invariant 10 — Measurement is observational

A5 determines effectiveness.

A7 does not invent outcome conclusions.

---

# 78. What Happens to the Existing A7.0/A7.1 Design?

The existing work should not simply be discarded.

It provides useful contracts and discoveries.

Retain conceptually:

- `EvolutionTargetKind = "capability"`;
- A7 evidence consumption;
- P5.5/P5.6 signal ownership;
- A2.5/A3 integration;
- append-only lifecycle history;
- A5 measurement;
- governed proposal boundary;
- explicit separation between proposal and application.

Replace structurally:

- A7-specific registry overlay;
- A7-specific lifecycle applier;
- direct A7 registry mutation;
- CLI-owned registry;
- non-executable `register`;
- ledger-based capability rehydration;
- duplicated capability definition sources;
- fake `APPROVED_PENDING_APPLICATION` runtime state.

---

# 79. Greenfield Replacement Principle

The existing A7.1 implementation should be treated as a **design-discovery artifact**, not the architectural foundation.

Its review findings are valuable because they exposed the actual missing abstractions:

```text
missing canonical catalog
missing persistent definition source
missing capability mutation primitive
missing implementation binding boundary
missing runtime governance consumption
missing shared CLI/runtime service
```

The greenfield refactor should address those abstractions directly rather than adding more compensating logic to A7.1.

---

# 80. Final Architecture

The final architecture is:

```text
                        ┌─────────────────────────┐
                        │   Capability Catalog    │
                        │                         │
                        │ Canonical definitions   │
                        │ Persistent source       │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │   Capability Registry   │
                        │                         │
                        │ Current runtime state   │
                        │ Lifecycle               │
                        │ Availability            │
                        │ Bindings                │
                        └────────────┬────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
                  Runtime           CLI              TUI/Web
                    │
                    ▼
              Capability usage
                    │
                    ▼
              Adoption telemetry
                    │
                    ▼
              ┌─────────────┐
              │ P5.5 / P5.6 │
              │ Intelligence│
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │     A7      │
              │ Evolution   │
              │ Intelligence│
              └──────┬──────┘
                     │
             EvolutionProposal
                     │
                     ▼
                    A2.5
                     │
                     ▼
                    A3
                     │
              GovernanceDecision
                     │
                     ▼
                    A4
                     │
          CapabilityMutationExecutor
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        Create     Update    Transition
          │          │          │
          └──────────┼──────────┘
                     ▼
              Catalog / Registry
                     │
                     ▼
                   Runtime
                     │
                     ▼
                    A5
                     │
                     ▼
               Outcome evidence
                     │
                     ▼
                 P5.5 / P5.6


        ┌──────────────────────────────────────┐
        │      Capability Governance Ledger    │
        │                                      │
        │ proposed → decided → applied        │
        │                         → measured   │
        │                                      │
        │ Historical references only           │
        └──────────────────────────────────────┘
```

---

# 81. Architectural Decision

**Decision:**

ALiX will refactor the capability platform around a **single canonical Capability Catalog**, with the Capability Registry representing current runtime state and the A7 ledger representing governance history.

Capability creation, modification, lifecycle transitions, consolidation, and removal are explicit A4-governed mutations.

A7 is exclusively responsible for capability evolution intelligence and proposal formation.

A3 remains the sole governance decision authority.

A4 remains the sole mutation authority.

A5 remains the outcome observation authority.

P5.5/P5.6 remain the capability intelligence authority.

The CLI, TUI, web UI, runtime, and governance machinery all consume the same canonical capability universe.

**The fundamental architectural invariant is:**

> **One capability definition universe. One runtime projection. One governed mutation path. One historical governance ledger. No second capability surface.**

---

# 82. Recommended Implementation Program

The implementation should be treated as a new capability-platform program rather than another A7 patch wave.

Recommended increments:

```text
CAP-1  Canonical Capability Definition
CAP-2  Persistent Capability Catalog
CAP-3  Runtime Registry Projection
CAP-4  Execution Binding Model
CAP-5  Capability Mutation Contract
CAP-6  A4 Capability Mutation Executor
CAP-7  Runtime Lifecycle Eligibility
CAP-8  CLI/TUI/Web Capability Service
CAP-9  A7 Greenfield Proposal Integration
CAP-10 A5 Measurement Integration
CAP-11 Remove Legacy Capability Surfaces
CAP-12 End-to-End Capability Evolution
```

The final checkpoint should only be declared when:

```text
runtime
CLI
TUI
web
A7
A4
A5
P5.5/P5.6
```

all resolve the same canonical capability universe.

That is the point at which ALiX has a **Capability Platform**, rather than a runtime capability registry plus a separate governance capability surface.