# A-Series — Autonomous Evolution Roadmap

**Purpose:** Enable ALiX to improve itself through governed autonomous action.

The A-Series sits above both M and P, consuming platform and product capabilities to evolve ALiX itself.

## Status

**A0–A6 are complete.** A7's first implementation (A7.0/A7.1) was completed and merged, but its capability-surface architecture has been **superseded** by the greenfield capability-platform refactor defined by ADR-0013.

The A7 implementation remains a historical checkpoint; new capability work must follow:

- `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`
- `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-design.md`
- `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`

A7 is therefore **architecturally reset, not deleted**: the lifecycle governance responsibility survives, while its implementation boundary is rebuilt around the canonical M-series CapabilityRegistry.

**A8–A9 remain the frontier** — designed at roadmap level only, with no active implementation dependency on the superseded A7 surface.

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
| A7 | Capability Lifecycle Governance — propose, decide, apply, and measure capability changes through the canonical CapabilityRegistry | 🔄 Greenfield refactor proposed |
| A8 | Organizational Learning — learn from all past proposals and outcomes | 🔲 Proposed |
| A9 | Self-Directed Engineering — autonomous plan-execute lifecycle | 🔲 Proposed |

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
