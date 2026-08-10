# A-Series — Autonomous Evolution Roadmap

**Purpose:** Enable ALiX to improve itself through governed autonomous action.

The A-Series sits above both M and P, consuming platform and product capabilities to evolve ALiX itself.

## Status

**A0–A5 are complete** — a governed, evidence-driven evolution pipeline documented in
ADR-0008. Completion is verified by closure checkpoints
(`docs/architecture/checkpoints/2026-08-10-a{3,4,5}-*.md`) and git tags
(`alix-a{0..5}-*-complete`). **A6–A9 are the frontier** — designed at the roadmap level only, no design specs or code.

## Evolution Pipeline (A0–A5)

The A-series forms a six-phase pipeline; each phase owns exactly one responsibility and communicates only through typed contracts.

```
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

## Frontier Milestones (A6–A9)

| Milestone | Focus | Status |
|-----------|-------|--------|
| A6 | Knowledge Evolution — curate knowledge base, detect stale data | 🔲 Proposed |
| A7 | Capability Marketplace — track capabilities, suggest new ones | 🔲 Proposed |
| A8 | Organizational Learning — learn from all past proposals and outcomes | 🔲 Proposed |
| A9 | Self-Directed Engineering — autonomous plan-execute lifecycle | 🔲 Proposed |

## Rules

- A-series code may depend on P-series and M-series contracts
- A-series must not bypass governance — all autonomous changes go through Propose → Review → Approve → Apply → Measure
- A-series may recommend and propose, but must not silently mutate governed state
- A-series mutations must be read-only until A4's governed execution authorization is satisfied
