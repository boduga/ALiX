# M-Series — Platform Roadmap

**Purpose:** Build the reusable operating system of ALiX.

The M-Series owns generic platform capabilities independent of product workflows.

## Proposed Platform Milestones

| Milestone | Focus |
|---|---|
| M0 | Platform Foundation — configuration, runtime bootstrap, filesystem safety |
| M1 | Agent Runtime — agent lifecycle, workers, execution context, scheduling |
| M2 | Memory Platform — context memory, long-term memory, evidence memory |
| M3 | Tool Platform — tool registry, MCP abstraction, permissions, discovery |
| M4 | Planning Platform — planner API, task graphs, goal decomposition, replanning |
| M5 | Orchestration Platform — event bus, coordination, multi-agent execution |
| M6 | Intelligence Platform — model abstraction, provider routing, context compression |
| M7 | Governance Platform — policy engine, permissions, audit, approval primitives |
| M8 | Observability Platform — metrics, tracing, diagnostics, replay |
| M9 | Distributed Platform — remote workers, clustering, federation |

## Status

The M-series is currently in the **proposed** stage. Existing M0.xx work (event envelopes, workflow run, task graphs, policy decisions, metrics, SQLite migrations) forms the foundation that will be normalized into this roadmap.

## Rules

- M-series code must not depend on P-series or A-series code
- M-series exposes stable platform contracts (WorkerAPI, ContextAPI, MemoryAPI, etc.)
- P and A milestones may only depend on documented platform APIs, not internal M implementation details
