# MA0 — ALiX Architecture 2.0

> **Status:** Proposed architecture governance milestone  
> **Purpose:** Formalize ALiX’s long-term architecture, roadmap taxonomy, ownership boundaries, and dependency rules.  
> **Applies to:** All future ALiX design specs, implementation plans, PR reviews, architectural decisions, and agentic execution workflows.  
> **Recommended repo path:** `docs/architecture/ma0-alix-architecture-2-0.md`

---

## 1. Why MA0 Exists

ALiX has outgrown a single linear roadmap.

The project now contains at least two visible milestone families:

- **M-series** — early platform / coordination / runtime infrastructure
- **P-series** — product intelligence, governance, adaptation, executive decision loops

The P-series has become mature and coherent, especially through P4–P10.  
The M-series contains important foundational work, but it is not yet formalized as a complete platform roadmap.

MA0 creates the missing architectural layer.

It establishes ALiX as a three-roadmap system:

```text
M-Series = Platform
P-Series = Product Intelligence
A-Series = Autonomous Evolution
```

This prevents architectural drift and gives future agents a clear rulebook for where features belong.

---

## 2. Core Architectural Model

```text
                         ALiX Vision
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
   M-Series Roadmap    P-Series Roadmap    A-Series Roadmap
      Platform        Product Intelligence Autonomous Evolution
```

### Summary

| Roadmap | Meaning | Primary Question |
|---|---|---|
| **M** | Platform | How does ALiX work? |
| **P** | Product Intelligence | What does ALiX do? |
| **A** | Autonomous Evolution | How does ALiX improve itself? |

---

## 3. M-Series — Platform Roadmap

The M-series owns ALiX’s reusable operating system.

It should provide stable primitives consumed by all higher-level capabilities.

### Responsibilities

- Runtime
- Agent lifecycle
- Worker framework
- Scheduling
- Coordination
- Context management
- Memory infrastructure
- Planning primitives
- Tool framework
- Model abstraction
- Storage primitives
- Event bus
- Observability
- Security primitives
- Workspace safety

### Rule

> **M-series code must not depend on P-series or A-series code.**

The platform must remain domain-neutral.

---

## 4. P-Series — Product Intelligence Roadmap

The P-series owns ALiX’s user-facing intelligence capabilities.

It consumes M-series platform primitives and turns them into workflows, governance, adaptation, learning, and executive decision-making.

### Responsibilities

- Workflow execution
- Adaptation proposals
- Proposal lifecycle
- Governance
- Learning engine
- Executive health reports
- Baseline intelligence / subsystem health sensing
- Outcome evaluation
- Recommendation generation
- Recommendation persistence
- Recommendation bridge to governance
- Recommendation effectiveness intelligence

### Rule

> **P-series code may depend on M-series contracts, but must not duplicate M-series infrastructure.**

---

## 5. A-Series — Autonomous Evolution Roadmap

The A-series owns ALiX’s future self-improvement capabilities.

It sits above the P-series and uses both platform and product intelligence to improve ALiX itself.

### Responsibilities

- Self-assessment
- Goal management
- Agent generation
- Workflow synthesis
- Architecture evolution
- Code evolution
- Capability discovery
- Strategy refinement
- Self-directed engineering
- Long-horizon improvement loops

### Rule

> **A-series code may consume M and P capabilities, but must not bypass governance.**

Autonomy must remain governed, explainable, and reversible.

---

## 6. Layered Architecture

```text
                    A-Series
              Autonomous Evolution
     self-improvement, agent generation,
     architecture evolution, long-term goals

────────────────────────────────────────────

                    P-Series
              Product Intelligence
     workflow, adaptation, governance,
     learning, executive intelligence,
     baseline intelligence,
     recommendations, effectiveness

────────────────────────────────────────────

                    M-Series
                  Platform
     runtime, workers, tools, planning,
     memory, context, events, storage,
     scheduling, observability, security

────────────────────────────────────────────

            Operating System / Node.js
```

Dependency direction:

```text
A → P → M
```

Forbidden directions:

```text
M → P
M → A
P → A
```

---

## 7. Ownership Matrix

| Capability | Owner | Notes |
|---|---|---|
| Runtime | M | Process, execution, filesystem safety |
| Worker framework | M | Generic workers, lifecycle, cancellation |
| Tool framework | M | Tool registry, permissions, discovery |
| Memory platform | M | Storage, recall, indexing, persistence |
| Context platform | M | Budgeting, relevance, compression |
| Planning primitives | M | Generic planning, replanning, DAGs |
| Coordination | M | Conflict detection, aggregation, handoff |
| Event bus | M | Events, replay, durable logs |
| Model abstraction | M | Provider routing, model adapters |
| Observability | M | Metrics, traces, diagnostics |
| Workflow engine | P | Product-level execution workflows |
| Adaptation lifecycle | P | Proposals, approve/apply/revert |
| Governance | P | Product governance policy and review |
| Executive intelligence | P | Health, objectives, plans, execution, outcomes |
| Baseline intelligence | P | Subsystem health sensing, provider framework, drift classification |
| Remediation lifecycle | P | Child proposal generation, remediate wizards, specification |
| Plan orchestration | P | Plan execution, step-state mgmt, apply reconciliation, resume |
| Recommendation engine | P | Signal detection and recommendation generation |
| Recommendation effectiveness | P | Operator action and outcome intelligence |
| Self-assessment | A | System evaluates its own architecture |
| Agent factory | A | Creates and modifies agents under governance |
| Workflow synthesis | A | Designs new workflows |
| Architecture evolution | A | Proposes architectural change |
| Code evolution | A | Proposes code changes through governed lifecycle |

---

## 8. Platform Contract

The M-series exposes stable contracts that P and A milestones may consume.

Recommended contract documents:

```text
docs/architecture/platform-contract.md
docs/architecture/product-contract.md
docs/architecture/autonomy-contract.md
```

### M-Series Platform Contract

The platform should expose:

- `RuntimeAPI`
- `WorkerAPI`
- `ToolAPI`
- `MemoryAPI`
- `ContextAPI`
- `StorageAPI`
- `EventAPI`
- `SchedulerAPI`
- `ModelAPI`
- `ObservabilityAPI`
- `SecurityAPI`

### Rule

> A P milestone may only depend on documented platform APIs, not internal M implementation details.

---

## 9. Product Contract

The P-series exposes product intelligence capabilities to the A-series.

Examples:

- `ProposalStore`
- `OutcomeReportStore`
- `RecommendationReportStore`
- `ExecutiveTrendStore`
- `GovernanceProposalBridge`
- `RecommendationEffectivenessAnalyzer`
- `BaselineRegistry`
- `BaselineComparator`

### Rule

> A-series autonomy must use P-series contracts rather than directly mutating product state.

---

## 10. Autonomy Contract

The A-series must remain governed.

Any autonomous action that changes code, architecture, agents, tools, workflows, policies, or persistent state must go through:

```text
Propose → Review → Approve → Apply → Measure
```

### Rule

> A-series may recommend and propose, but must not silently mutate governed state.

---

## 11. Required Sections in Future Specs

Every future design spec must include these sections.

### 11.1 Roadmap Classification

```markdown
## Roadmap Classification

| Field | Value |
|---|---|
| Roadmap | M / P / A |
| Layer | Platform / Product / Autonomy |
| Depends On | ... |
| Owns | ... |
```

### 11.2 Dependency Declaration

```markdown
## Dependencies

| Capability | Provider | Contract |
|---|---|---|
| Memory | M-Series | MemoryAPI |
| Proposal lifecycle | P-Series | ProposalStore |
```

### 11.3 Boundary Statement

```markdown
## Hard Boundary

This milestone may:
- ...

This milestone may not:
- ...
```

### 11.4 Ownership Declaration

```markdown
## Ownership

This milestone owns:
- ...

This milestone consumes:
- ...
```

---

## 12. Dependency Rules

### Rule 1 — Platform Independence

M-series milestones must not import or depend on P-series or A-series modules.

### Rule 2 — Product Uses Platform

P-series milestones may depend on M-series contracts.

### Rule 3 — Autonomy Uses Product and Platform

A-series milestones may depend on P-series and M-series contracts.

### Rule 4 — No Reverse Dependency

Lower layers must never depend on higher layers.

### Rule 5 — No Duplication

If a capability belongs to M, P and A must consume it rather than reimplementing it.

### Rule 6 — Missing Primitive Creates Platform Work

If a P or A milestone needs a new generic primitive, create an M milestone first.

### Rule 7 — Autonomy Must Be Governed

A-series changes must pass through the proposal/governance lifecycle.

---

## 13. Milestone Naming Standard

| Prefix | Meaning |
|---|---|
| **M** | Platform |
| **P** | Product Intelligence |
| **A** | Autonomous Evolution |
| **S** | Security hardening |
| **D** | Developer experience |
| **I** | Infrastructure |
| **R** | Research / experiments |

Examples:

```text
M1.0 Agent Runtime
M2.0 Memory Platform
P10.8 Recommendation Effectiveness
P10.9 Executive Lifecycle
P10.10 Baseline Intelligence
A0.1 Self-Assessment
S1.0 Supply Chain Integrity
D1.0 Generator Tooling
I1.0 CI/CD Infrastructure
R1.0 Experimental Planner
```

---

## 14. Proposed M-Series Roadmap

The existing M0.xx work should be normalized into a complete platform roadmap.

```text
M0  Platform Foundation
M1  Agent Runtime
M2  Memory Platform
M3  Tool Platform
M4  Planning Platform
M5  Orchestration Platform
M6  Intelligence Platform
M7  Governance Platform
M8  Observability Platform
M9  Distributed Platform
```

### M0 — Platform Foundation

- Configuration
- Runtime bootstrap
- Filesystem safety
- Workspace path resolver
- Error model
- Logging
- Dependency injection
- Versioning

### M1 — Agent Runtime

- Agent lifecycle
- Worker lifecycle
- Execution context
- Cancellation
- Scheduling
- Agent registry

### M2 — Memory Platform

- Context memory
- Long-term memory
- Evidence memory
- Vector store abstraction
- Cache
- Knowledge indexing

### M3 — Tool Platform

- Tool registry
- Tool permissions
- MCP abstraction
- Tool discovery
- Resource access
- Tool audit

### M4 — Planning Platform

- Planner API
- Task graph
- Goal decomposition
- Replanning
- Simulation
- Plan validation

### M5 — Orchestration Platform

- Coordinator
- Event bus
- Message routing
- Workflow runtime
- Multi-agent execution
- Conflict detection

### M6 — Intelligence Platform

- Model abstraction
- Provider routing
- Local/cloud routing
- Context compression
- Cost/quality routing
- Model fallback

### M7 — Governance Platform

- Policy engine
- Permission model
- Audit primitives
- Provenance
- Approval primitives
- Trust boundaries

### M8 — Observability Platform

- Metrics
- Tracing
- Diagnostics
- Replay
- Profiling
- Health reporting primitives

### M9 — Distributed Platform

- Remote workers
- Clustering
- Shared state
- Federation
- High availability
- Cross-node coordination

---

## 15. Proposed P-Series Roadmap

The P-series remains the active product intelligence roadmap.

```text
P4   Workflow / orchestration integration
P5   Adaptation and proposal lifecycle
P8   Learning
P9   Governance
P10  Executive intelligence
P11  Strategic planning
P12  Operator experience
```

### P4 — Workflow

- Issue execution
- Workflow state
- Orchestrator bridge
- Execution lifecycle

### P5 — Adaptation

- Recommendation-to-proposal conversion
- Proposal lifecycle
- Apply/revert
- Proposal effectiveness

### P8 — Learning

- Memory-derived learning
- Trend detection
- Cross-run learning

### P9 — Governance

- Governance proposals
- Approval hardening
- Explainability
- Policy enforcement

### P10 — Executive Intelligence

- Health assessment
- Trend store
- Priority and objective generation
- Planning engine (plan create, approve, start, run, resume)
- Execution engine (step execution, state management, approval gates)
- Plan-to-proposal bridge (step → adaptation proposal)
- Outcome evaluation (including automatic hook)
- Recommendation engine
- Recommendation persistence
- Governance bridge (recommendation → governance proposal)
- Effectiveness intelligence
- Remediation wizard (child proposal generation from executive requests)
- Lifecycle orchestration (proposal → step state reconciliation)
- Baseline intelligence
- **P10.9** — Execution lifecycle (subdivided):
  - **P10.9.1** — Operational completeness: auto-baseline, lifecycle introspection, help normalization
  - **P10.9.2** — Remediation & orchestration: proposal readiness, remediation wizard, lifecycle orchestration, stabilization, completion semantics
- **P10.10** — Baseline intelligence (subdivided):
  - **P10.10.1** — Framework: provider interface, registry, comparator, health score, CLI, demo provider ✅
  - **P10.10.2** — Real providers: Governance (persistent), MemoryHealth (ephemeral), Demo (fixture)
  - **P10.10.3** — More providers: Skills, Agents, Workflow
  - **P10.10.3b** — Model cleanup: add `providerType: persistent | ephemeral`, consider `capture()` unification
  - **P10.10.4** — Executive integration: feed health scores into dashboard, plans, recommendations
  - **P10.10.5** — Predictive intelligence: trend analysis, adaptive baselines, forecasting

### P11 — Strategic Planning

- Long-range objective planning
- Roadmap reasoning
- Priority arbitration
- Resource allocation

### P12 — Operator Experience

- Dashboards
- Summaries
- Explainability UI
- Review workflows
- Human-in-the-loop controls

---

## 16. Proposed A-Series Roadmap

The A-series should begin only after MA0 is accepted.

```text
A0  Self-Assessment
A1  Goal Management
A2  Agent Generation
A3  Workflow Synthesis
A4  Architecture Evolution
A5  Code Evolution
A6  Knowledge Evolution
A7  Capability Marketplace
A8  Organizational Learning
A9  Self-Directed Engineering
```

### A0 — Self-Assessment

- System evaluates its own architecture
- Finds gaps
- Detects drift
- Recommends improvement areas

### A1 — Goal Management

- Maintains long-term goals
- Tracks goal progress
- Resolves goal conflicts
- Suggests priorities

### A2 — Agent Generation

- Creates candidate agents
- Defines capabilities
- Registers agents through governance
- Measures usefulness

### A3 — Workflow Synthesis

- Proposes new workflows
- Simulates execution
- Measures expected value
- Submits for approval

### A4 — Architecture Evolution

- Detects architectural drift
- Proposes refactors
- Updates architecture docs
- Routes through governance

### A5 — Code Evolution

- Proposes code changes
- Runs tests
- Creates PRs
- Tracks regressions

### A6 — Knowledge Evolution

- Curates knowledge base
- Detects stale knowledge
- Updates memory
- Compresses long-term context

### A7 — Capability Marketplace

- Tracks available capabilities
- Measures capability usefulness
- Suggests new capabilities
- Deprecates weak capabilities

### A8 — Organizational Learning

- Learns from all past proposals, recommendations, outcomes, and operator choices
- Improves decision quality over time

### A9 — Self-Directed Engineering

- Selects work
- Plans implementation
- Executes through governed PR lifecycle
- Measures downstream impact

---

## 17. Repository Organization Target

Current structure may remain during transition, but the long-term organization should clarify ownership.

Recommended target:

```text
src/
  platform/
    runtime/
    workers/
    tools/
    memory/
    context/
    planning/
    orchestration/
    observability/
    security/

  product/
    workflow/
    adaptation/
    governance/
    learning/
    executive/
    baseline/
    recommendations/

  autonomy/
    assessment/
    goals/
    agents/
    workflows/
    architecture/
    code/
    knowledge/
```

Migration should be incremental. Do not reorganize the repository without a dedicated migration milestone.

---

## 18. PR Review Rules

Every PR must answer:

1. Which roadmap does this belong to?
2. Which layer owns the changed files?
3. Are dependency directions valid?
4. Does this duplicate a lower-layer capability?
5. Does this introduce a new platform primitive?
6. Does this require an M milestone first?
7. Does this mutate governed state?
8. Does it need evidence, audit, or approval?
9. Are tests aligned with the layer?
10. Are docs updated?

---

## 19. Legacy PR Handling

Old PRs from the M0.xx era should not be merged directly if they conflict with current main or predate the P-series architecture.

Each old PR should be classified as:

| Classification | Meaning | Action |
|---|---|---|
| Superseded | Current architecture already covers it | Close |
| Valuable concept | Idea still useful, implementation stale | Re-spec as new M/P/A slice |
| Still valid | Applies cleanly to current architecture | Review normally |
| Historical | Useful only as reference | Close with note |

### Rule

> Never merge unrelated-history PRs directly into current main.

Use old branches as design references, not merge targets.

---

## 20. Architecture Decision Records

All major architectural changes should use ADRs.

Recommended path:

```text
docs/architecture/adrs/
```

ADR template:

```markdown
# ADR-XXXX — Title

## Status

Proposed / Accepted / Superseded

## Context

## Decision

## Consequences

## Alternatives Considered

## Related Milestones
```

---

## 21. Definition of Done for Architecture Milestones

An architecture milestone is not complete until it includes:

- Design spec
- Implementation plan
- Dependency declaration
- Boundary statement
- Tests
- Documentation
- Review checklist
- Migration notes if applicable
- Supersession notes if replacing older work

---

## 22. MA0 Deliverables

MA0 should deliver the following:

- This architecture governance document
- Platform contract document
- Product contract document
- Autonomy contract document
- Roadmap map for M/P/A
- Ownership matrix
- Dependency rules
- PR review checklist
- Legacy PR classification process
- ADR template
- Migration strategy for old M-series work

---

## 23. Immediate Next Steps

Recommended follow-up slices:

```text
MA0a — Commit Architecture 2.0 governance document
MA0b — Write Platform Contract
MA0c — Write Product Contract
MA0d — Write Autonomy Contract
MA0e — Create M/P/A roadmap index
MA0f — Classify legacy PRs
MA0g — Add architecture review checklist
```

---

## 24. Final Principle

ALiX should evolve without losing architectural coherence.

The M/P/A model gives ALiX a stable long-term structure:

```text
M = the platform ALiX runs on
P = the intelligence ALiX provides
A = the autonomy ALiX grows into
```

Every future milestone should preserve that separation.
