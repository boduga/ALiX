# M-Series — Platform Roadmap

**Purpose:** Build the reusable operating system of ALiX.

The M-Series owns generic platform capabilities independent of product workflows.

## Status

The M-series is not "proposed" — M-level platform work ships continuously and the
M0.x foundation is mature, but it has not been normalized into the milestone
framework below. Recent work (Context Manager addendum, single-source model
configuration, credential security, agent-runtime hardening) landed **untagged**,
outside the M0/M1/M2 structure. This roadmap formalizes what already exists.

## Milestones

| Milestone | Focus | Coverage |
|---|---|---|
| M0 | Platform Foundation — configuration, runtime bootstrap, filesystem safety | 🟡 Substantial — event envelopes, workflow run, task graphs, policy decisions, metrics, SQLite migrations (tags `m0.67`–`m0.9`) |
| M1 | Agent Runtime — agent lifecycle, workers, execution context, scheduling | 🟡 Substantial — agent runtime, subagents, execution context, `runtime/` |
| M2 | Memory Platform — context memory, long-term memory, evidence memory | 🟡 Substantial — `src/context/` (Context Manager, calibration, tiering), memory stores |
| M3 | Tool Platform — tool registry, MCP abstraction, permissions, discovery | 🟡 Substantial — `src/tools/`, MCP transport, tool cards, capability map |
| M4 | Planning Platform — planner API, task graphs, goal decomposition, replanning | 🟢 Partial — graph plan/run, task graphs |
| M5 | Orchestration Platform — event bus, coordination, multi-agent execution | 🟢 Partial — daemon, multi-agent coordination, runtime event index |
| M6 | Intelligence Platform — model abstraction, provider routing, context compression | 🟡 Substantial — `src/providers/` (anthropic, minimax, gemini, deepseek, groq…), circuit breaker, catalog |
| M7 | Governance Platform — policy engine, permissions, audit, approval primitives | 🟡 Substantial — `src/policy/`, `src/audit/`, `src/approvals/`, safe shell |
| M8 | Observability Platform — metrics, tracing, diagnostics, replay | 🟡 Substantial — `src/metrics/`, observability commands, metrics projection |
| M9 | Distributed Platform — remote workers, clustering, federation | 🔴 Not started |

**Legend:** 🟡 Substantial = core capability ships, not fully normalized to platform API contracts. 🟢 Partial = some capability, not a platform surface. 🔴 Not started.

## Rules

- M-series code must not depend on P-series or A-series code
- M-series exposes stable platform contracts (WorkerAPI, ContextAPI, MemoryAPI, etc.)
- P and A milestones may only depend on documented platform APIs, not internal M implementation details

## Open question

The M0.x work was tagged `m0.67`–`m0.9` through mid-July, then went **untagged**.
The M0.75 Ownership Registry plan (`m75-ownership-registry-plan.md`) is the most
recent planned M milestone. Normalizing M-series (re-baselining tags and mapping
recent platform work to M1–M8) is the open task here.
