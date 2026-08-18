# A-Series — Autonomous Evolution Roadmap

**Purpose:** Enable ALiX to improve itself through governed autonomous action.

The A-Series sits above both M and P, consuming platform and product capabilities to evolve ALiX itself.

## Status

**A0–A9 are complete.** Completion is verified by annotated git tags (`alix-a*-complete`) and source; the roadmap reflects shipped state, not aspiration.

A7's first implementation (A7.0/A7.1) was completed and merged, then **superseded** by the greenfield capability-platform refactor defined by ADR-0013 — which is itself complete (CAP-1…CAP-12, CAP-N, CAP-O, CAP-P). A7 now governs capabilities through the canonical M-series CapabilityRegistry.

A8 (Organizational Learning, PR #525) and A9 (Pre-Execution Risk Forecast & Governance Gating, PR #552) are complete and merged.

Note: the aspirational "Self-Directed Engineering" (ALiX autonomously planning + executing its own improvements) is unbuilt — it is not what A9 shipped. A9's shipped focus is pre-execution risk forecast and governance gating.

## Evolution Pipeline (A0–A6)

The A-series forms a six-phase pipeline; each phase owns exactly one responsibility and communicates only through typed contracts.

```text
Observe → Discover → Verify → Govern → Execute → Observe Outcome
```

| Phase | Responsibility | Status |
|-------|----------------|--------|
| A0 | Evolution Contract — vocabulary, lifecycle states, lineage rules | ✅ Complete |
| A1 | Pattern Discovery — observe existing system behavior | ✅ Complete |
| A2 | Evolution Verification — project effects of proposed change | ✅ Complete |
| A3 | Governance Decision — accept/reject proposals based on evidence | ✅ Complete |
| A4 | Governed Execution — apply approved changes under deterministic control | ✅ Complete |
| A5 | Outcome Observation — measure actual effects post-execution | ✅ Complete |
| A6 | Knowledge Evolution — curate knowledge base, detect stale data | ✅ Complete |

## Capability Evolution

| Milestone | Focus | Status |
|-----------|-------|--------|
| A7 | Capability Lifecycle Governance — propose, decide, apply, and measure capability changes through the canonical CapabilityRegistry | ✅ Complete — greenfield refactor shipped (CAP-1…CAP-12, CAP-N, CAP-O, CAP-P) |
| A8 | Organizational Learning — learn from all past proposals and outcomes | ✅ Complete (PR #525) |
| A9 | Pre-Execution Risk Forecast & Governance Gating — forecast execution risk before governed change | ✅ Complete (PR #552) |

### A7 architectural boundary

A7 governs **capabilities**, not implementation technologies.

```text
CapabilityRegistry
      |
      +-- semantic capability identity
      +-- lifecycle state
      +-- provider bindings
      |
      +---- native
      +---- tool
      +---- MCP
      +---- external CLI (gh, GitNexus, ...)
      +---- daemon / agent / plugin / remote API
```

There is one canonical capability registry. The `alix capabilities` namespace is a consumer of that registry, not a second registry.

A7 history is append-only governance history; the registry remains authoritative for current capability state. A4 remains the mutation boundary and A5 remains the outcome-observation boundary.

## Rules

- A-series code may depend on P-series and M-series contracts
- A-series must not bypass governance — all autonomous changes go through Propose → Review → Approve → Apply → Measure
- A-series may recommend and propose, but must not silently mutate governed state
- A-series mutations must be read-only until A4's governed execution authorization is satisfied
- Capability lifecycle work must follow ADR-0013's single-registry/provider model
