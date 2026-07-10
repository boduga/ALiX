# ALiX Master Architecture & Execution Roadmap

## M-Series → P-Series → X-Series → A-Series

**Document Type:** Architecture Roadmap
**Status:** Living Document
**Version:** 1.0

---

# 1. Executive Overview

ALiX is designed as a layered intelligent operations platform.

The architecture consists of four major programs:

| Program  | Purpose                           | Core Question                        |
| -------- | --------------------------------- | ------------------------------------ |
| M-Series | Platform Runtime                  | How does ALiX operate?               |
| P-Series | Product Intelligence & Governance | How does ALiX understand and reason? |
| X-Series | Controlled Execution Platform     | How does ALiX perform approved work? |
| A-Series | Autonomous Evolution              | How does ALiX improve itself?        |

The execution order is:

```text
M-Series
    ↓
P-Series
    ↓
X-Series
    ↓
A-Series
```

Each layer depends on the previous layer.

---

# 2. Core Architectural Principle

ALiX separates intelligence, governance, execution, and evolution. No subsystem bypasses another.

```text
                    Human
                      │
                      ▼
              Intent / Approval
                      │
                      ▼
              Execution Platform
                      │
             Execution Evidence
                      │
                      ▼
             Governance Layer
                      │
      Audit • Replay • Explain • Learn
                      │
                      ▼
             Evolution Proposals
```

---

# 3. Program M — Platform Runtime Foundation

**Purpose:** The M-series provides the operational substrate of ALiX.
**Question answered:** How does ALiX work?

**Status:** Partially Delivered

### M0 — Coordination Kernel

- **M0.1** Agent Coordination — lifecycle management, registry, capability discovery, ownership tracking
- **M0.2** Context Management — task/session/long-running context, compression, transfer
- **M0.3** Replanning Engine — failure detection, plan adjustment, alternative path generation
- **M0.4** Memory Infrastructure — working/episodic/semantic memory, retrieval, provenance
- **M0.5** Event Architecture — event bus, contracts, correlation, replay
- **M0.6** Security & Ownership Registry — permissions, trust boundaries, capability authorization

### M1 — Agent Runtime
Agent lifecycle, worker lifecycle, execution context, cancellation, scheduling, agent registry.

### M2 — Memory Platform
Context memory, long-term memory, evidence memory, vector store abstraction, cache, knowledge indexing.

### M3 — Tool Platform
Tool registry, tool execution, permission framework, discovery, sandboxing.

### M4 — Planning Platform
Planning primitives, DAG execution, plan validation, step orchestration, state management.

### M5 — Orchestration Platform
Multi-agent coordination, handoff, conflict detection, aggregation.

### M6 — Intelligence Platform
Model abstraction, provider routing, model adapters.

### M7 — Governance Platform
Governance primitives consumed by P-series.

### M8 — Observability Platform
Metrics, traces, diagnostics, telemetry.

### M9 — Distributed Platform
Multi-host, multi-workspace, distributed coordination.

---

# 4. Program P — Product Intelligence Layer

**Purpose:** The P-series provides reasoning, intelligence, adaptation, and governance.
**Question answered:** What does ALiX know and how does it reason?

### P1–P4 — Foundational Intelligence
Status: Requires historical recovery and documentation.
Expected areas: Initial reasoning, planning primitives, intelligence services, early learning.

### P5 — Adaptation Lifecycle
Status: Partial / remaining work.
Capabilities: Capability evolution, adaptation tracking, proposal effectiveness.

### P6 — Decision Influence Framework
Status: Completed.
Capabilities: Decision influence tracking, decision analysis.

### P7.5p — Persistence Substrate
Status: Completed.
Capabilities: Persistence foundation, storage abstractions.

### P8 — Adaptive Learning & Evidence Chains
Status: Completed.
Capabilities: Learning loops, evidence chains, knowledge correlation.

### P9 — Meta-Governance & Advisory Layer
Status: Completed.
Capabilities: Governance proposals, advisory mechanisms, dashboards.

### P10 — Executive Intelligence
Status: Completed.
Capabilities: Planning intelligence, evaluation, learning, signals, recommendations.

### P11 — Cognitive Pipeline
Status: Active.
**P11.9** — Issue-to-PR Proposal Loop: Create governed engineering improvement proposals.
Flow: Issue Detection → Analysis → Change Proposal → Human Review → Implementation → Measurement.
Constraints: No autonomous merge, no bypassing review, no uncontrolled code mutation.

---

# 5. P14–P30 Governance Layer — ✅ COMPLETE

The governance layer is the first fully sealed ALiX subsystem.

**Purpose:** Provide complete observational governance.

Governance observes, records, explains, correlates, packages, and navigates.
Governance does **not** execute, mutate, decide, rank, predict, or prescribe.

### Governance Pipeline

```text
Evidence → Detection → Review Candidate → Human Decision → Outcome Ledger
       → Replay → Calibration → Learning → Explanation → Compliance Package
       → Evidence Navigation
```

### Completed Governance Phases

| Phase | Capability |
|-------|-----------|
| P14 | Auditability |
| P15 | Observability |
| P16 | Safe Response & Remediation |
| P17 | Approved Execution Lifecycle |
| P18 | Governance Workbench |
| P19 | Automation Readiness Projection |
| P20 | Controlled Manual Execution Handoff |
| P21 | Human Execution Evidence Ledger |
| P22 | Closure Intelligence |
| P23 | Governance Replay |
| P24 | Calibration & Policy Drift Intelligence |
| P25 | Policy Review Candidate Lifecycle |
| P26 | Outcome Ledger |
| P27 | Learning Synthesis |
| P28 | Governance Explainability |
| P29 | Compliance Packages |
| P30 | Evidence Navigation & Lineage Browsing |

### Governance Permanent Exclusions

| Capability | Status |
|-----------|--------|
| Autonomous execution | ❌ |
| Automatic policy changes | ❌ |
| Policy recommendations | ❌ |
| Reviewer ranking | ❌ |
| Predictive governance | ❌ |
| Threshold mutation | ❌ |
| Background governance agents | ❌ |

---

# 6. Program X — Controlled Execution Platform

**Purpose:** Provide safe execution capabilities separate from governance.
**Question answered:** How does ALiX perform approved work?

**Status:** Not started.

### X0 — Execution Contracts
Define ExecutionIntent, ExecutionPlan, ExecutionStep, ExecutionResult, ExecutionEvidence.

### X1 — Planning Integration
Intent translation, dependency graphs, preconditions, validation, dry runs.

### X2 — Provider SDK
Initial providers: Docker, Kubernetes, Proxmox, Incus/LXC, VMware, XCP-ng, Hyper-V, cloud platforms, storage systems, DNS, networking.

### X3 — Execution Runtime
Step execution, retry handling, rollback, cancellation, progress tracking, evidence generation.

### X4 — Execution Safety Layer
Approval gates, resource locking, capability checks, maintenance controls.

---

# 7. Program A — Autonomous Evolution

**Purpose:** Enable governed self-improvement.
**Question answered:** How does ALiX improve itself?

**Status:** Not started.

### Autonomous Evolution Contract

```text
Observe → Assess → Propose → Review → Approve → Apply → Measure → Learn
```

### A0 — Self-Assessment
Architecture analysis, gap detection, drift detection, improvement proposals.

### A1 — Goal Management
Long-term goals, progress tracking, conflict resolution.

### A2 — Agent Generation
Candidate agents, capability definitions, registration proposals.

### A3 — Workflow Synthesis
Workflow creation, requirement analysis, process design.

### A4 — Architecture Evolution
Architecture proposals, change analysis.

### A5 — Code Evolution
Code proposals, PR generation, review lifecycle.

### A6 — Knowledge Evolution
Knowledge updates, controlled learning.

### A7 — Capability Marketplace
Capability discovery, capability sharing.

### A8 — Organizational Learning
Pattern discovery, system learning.

### A9 — Self-Directed Engineering
Long-horizon improvement, engineering optimization.

---

# 8. Final Execution Order

```text
PHASE 1 — Complete M-Series (Runtime, Memory, Events, Security, Coordination)

PHASE 2 — Complete Remaining P-Series (P1-P4 recovery, P5 adaptation, P11.9 proposal loop)

PHASE 3 — Maintain Governance Foundation (P14-P30 sealed)

PHASE 4 — Build X-Series (Execution contracts, Planning, Providers, Runtime, Safety)

PHASE 5 — Enable A-Series (Self assessment, Evolution proposals, Governed improvement)
```

---

# 9. ALiX Long-Term Vision

```text
Intent → Reasoning → Planning → Approval → Execution → Evidence → Governance → Learning → Evolution
```

ALiX becomes progressively more capable while preserving human control, explainability, auditability, reversibility, and governance integrity.
