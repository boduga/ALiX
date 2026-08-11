# ALiX Master Architecture & Execution Roadmap

## M-Series → P-Series → X-Series → A-Series

**Document Type:** Architecture Roadmap
**Status:** Living Document
**Version:** 1.1

---

# 1. Executive Overview

ALiX is designed as a layered intelligent operations platform.

| Program | Purpose | Core Question |
|---|---|---|
| M-Series | Platform Runtime | How does ALiX operate? |
| P-Series | Product Intelligence & Governance | How does ALiX understand and reason? |
| X-Series | Controlled Execution Platform | How does ALiX perform approved work? |
| A-Series | Autonomous Evolution | How does ALiX improve itself? |

Execution order remains:

```text
M-Series
   ↓
P-Series
   ↓
X-Series
   ↓
A-Series
```

---

# 2. Core Architectural Principle

ALiX separates intelligence, governance, execution, and evolution. No subsystem bypasses another.

```text
Intent → Reasoning → Proposal → Governance → Approved Execution → Evidence → Outcome → Learning
```

Capability architecture is governed by ADR-0013:

```text
CapabilityRegistry
      |
      +-- semantic capability identity
      +-- lifecycle state
      +-- provider bindings
      |
      +-- native
      +-- tool
      +-- MCP
      +-- external CLI (gh, GitNexus, ...)
      +-- daemon / agent / plugin / remote API
```

There is exactly one canonical current-state `CapabilityRegistry` per runtime composition.

---

# 3. Program M — Platform Runtime Foundation

**Purpose:** operational substrate of ALiX.

Major areas:

- coordination and agent lifecycle;
- context and memory;
- replanning;
- event architecture;
- security and ownership;
- tool platform;
- planning and orchestration;
- model/provider routing;
- observability;
- distributed execution.

The Capability Platform is part of the M-series runtime foundation and is governed by:

`docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`

The capability system provides one semantic catalog consumed by runtime, CLI, TUI, Web UI, agents, and governance.

---

# 4. Program P — Product Intelligence Layer

**Purpose:** reasoning, intelligence, adaptation, and governance.

Current major areas include:

- P5 adaptation and capability-evolution intelligence;
- P6 decision influence;
- P8 adaptive learning/evidence chains;
- P9 meta-governance;
- P10 executive intelligence;
- P11 cognitive pipeline.

P5.5/P5.6 remain the owners of capability health, gap, overlap, and drift analysis. A7 consumes these signals; it does not recreate their analysis.

---

# 5. P14–P30 Governance Layer — COMPLETE

The governance layer provides observational governance and evidence lineage.

```text
Evidence → Detection → Review → Human Decision → Outcome Ledger
       → Replay → Calibration → Learning → Explanation → Compliance
```

Governance does not bypass the A-series execution boundary.

---

# 6. Program X — Controlled Execution Platform

**Purpose:** safe execution of approved work.

The X-series provides execution contracts, planning, providers, runtime, rollback, cancellation, and safety controls.

A4 governed evolution execution reuses the same execution principles: an approved decision is required before mutation, execution is deterministic, and rollback/evidence are explicit.

---

# 7. Program A — Autonomous Evolution

**Purpose:** enable governed self-improvement.

```text
Observe → Assess → Propose → Review → Approve → Apply → Measure → Learn
```

## A0–A6

| Phase | Responsibility | Status |
|---|---|---|
| A0 | Evolution Contract | ✅ Complete |
| A1 | Pattern Discovery | ✅ Complete |
| A2 | Evolution Verification | ✅ Complete |
| A3 | Governance Decision | ✅ Complete |
| A4 | Governed Execution | ✅ Complete |
| A5 | Outcome Observation | ✅ Complete |
| A6 | Knowledge Evolution | ✅ Complete |

## A7 — Capability Lifecycle Governance

**Status:** Greenfield refactor proposed.

A7's responsibility survives: govern the lifecycle of capabilities through proposal, decision, application, and measurement.

The previous A7.0/A7.1 implementation is historical and superseded architecturally. The replacement is defined by ADR-0013 and the greenfield capability design/plan.

### Canonical A7 boundary

```text
P5.5/P5.6 capability intelligence
            ↓
      A7 lifecycle analysis
            ↓
      EvolutionProposal
            ↓
      A3 GovernanceDecision
            ↓
      A4 governed execution
            ↓
      CapabilityRegistry
            ↓
      A5 outcome observation
```

The A7 ledger is append-only governance history. It is not a second capability registry.

### Capability/provider rule

A7 governs semantic capabilities.

```text
github.issue.create
      |
      +-- MCP GitHub provider
      +-- gh external CLI provider
      +-- future native/API provider
```

Changing the provider does not inherently change the capability identity.

### Operator surface

```text
alix capabilities
  list
  inspect <id>
  history <id>
  health
  recommend
  propose
  apply
  measure
```

This namespace is a consumer of the canonical registry, not a separate capability store.

## A8–A9

| Milestone | Focus | Status |
|---|---|---|
| A8 | Organizational Learning | 🔲 Proposed |
| A9 | Self-Directed Engineering | 🔲 Proposed |

---

# 8. Capability Greenfield Refactor

The next capability increment must proceed in this order:

```text
Canonical contract
    ↓
Provider model
    ↓
Canonical registry
    ↓
Definition persistence
    ↓
Provider resolver
    ↓
Native/tool/MCP/external-CLI providers
    ↓
CapabilityService
    ↓
A7 governance rebuild
    ↓
CLI/TUI/Web parity
    ↓
Runtime lifecycle enforcement
```

Hard requirements:

1. one registry;
2. semantic capability identity;
3. provider-independent identity;
4. complete governed registration artifact;
5. A4 remains the mutation boundary;
6. A5 measures outcomes;
7. CLI/TUI/Web/runtime consume the same capability system.

---

# 9. Final Execution Order

```text
PHASE 1 — Complete/maintain M-Series runtime foundation

PHASE 2 — Complete remaining P-Series work

PHASE 3 — Maintain sealed governance foundation P14–P30

PHASE 4 — Build/extend X-Series controlled execution

PHASE 5 — Greenfield A7 capability architecture

PHASE 6 — A8/A9 autonomous evolution frontier
```

---

# 10. Long-Term Vision

```text
Intent → Reasoning → Planning → Approval → Execution → Evidence → Governance → Learning → Evolution
```

ALiX becomes progressively more capable while preserving human control, explainability, auditability, reversibility, and governance integrity.

---

# 11. Canonical References

- Capability architecture: `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
- Capability greenfield design: `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
- Capability greenfield plan: `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`
- A-series roadmap: `docs/roadmap/a-series-autonomous-evolution.md`
- A-series governed evolution architecture: `docs/architecture/a-series-governed-evolution.md`
