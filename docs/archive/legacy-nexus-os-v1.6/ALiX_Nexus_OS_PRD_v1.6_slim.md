# ALiX Nexus OS - Product Requirements Document (Slim)
**PRD Version:** 1.6  
**Date:** 2026-06-08  
**Owner:** Babasola Oduga / ALiX Project  
**Source Baseline:** ALiX Nexus OS PRD v1.5 split pack, updated with Odysseus product borrowings  
**Product Target:** Generic multi-agent OS for coding, research, infrastructure, business automation, and personal workflows

---

## Document Purpose

This slim PRD is the stakeholder-facing source of truth for ALiX Nexus OS. It intentionally avoids implementation schemas and protocol minutiae. Technical details have been moved into supporting architecture, schema, SOP, eval, and milestone documents.

**Frozen execution rule:** M0.9 must not expand product scope. M0.9 exists to stabilize the current ALiX harness, normalize events, wrap runs in WorkflowRun/TaskGraph primitives, validate local model routing, and keep existing behavior working.

---

## 1. Executive Summary

ALiX should evolve from a local-first TypeScript/Node coding-agent harness into **ALiX Nexus OS**: an event-sourced, graph-scheduled, policy-governed, memory-backed multi-agent operating system.

The goal is not to create another chat-based agent framework. The goal is to create an agent control plane where tasks, agents, tools, memory, policies, skills, artifacts, and workflows are first-class OS resources.

The first generic domain is **research**, followed by **homelab/infrastructure automation**, then **business and personal productivity workflows** after governance matures.

---

## 2. Product Baseline

Current ALiX already has the foundation for this transition:

| Current Strength | Generic Agent OS Gap |
|---|---|
| CLI-driven coding loop | Needs WorkflowRun + TaskGraph abstraction |
| Multiple LLM providers | Needs routing by domain, risk, cost, privacy, and historical performance |
| File/shell/patch/web/MCP tools | Needs capability taxonomy, Tool Cards, and policy enforcement |
| Subagent delegation | Needs Agent Cards, registry, selection, mailbox, and lifecycle |
| Event logging and Inspector | Needs canonical events, graph timeline, policy trace, memory trace, replay |
| Basic memory | Needs scoped memory kernel with episodic, semantic, project, skill, workflow, reflection memory |
| Hooks/skills | Needs skill manifests, validation, scoring, and promotion from traces |

---

## 3. Product Vision

ALiX Nexus OS is a local-first operating layer for AI agents. It coordinates specialized agents, tools, memory, policies, skills, and workflows through an event-sourced control plane.

| Not This | But This |
|---|---|
| Another agent chat app | Agent execution, policy, memory, replay, and workflow control plane |
| Many personas chatting | Graph-scheduled agents executing typed tasks |
| Cloud-only automation | Local-first runtime with optional cloud fallback |
| Tool wrapper only | Capability-governed agent/tool/memory/workflow runtime |
| Framework demo | Inspectable, replayable, policy-safe Agent OS |

### 3.1 Product Packaging Lesson from Odysseus

Odysseus demonstrates that local-first AI becomes easier to understand when packaged as a visible self-hosted workspace. ALiX should borrow that product clarity without copying the full app scope.

**Public message:** ALiX is the local-first agent control plane for running safe, inspectable AI workflows on your own machine.

**Strategic distinction:** Odysseus gives users a self-hosted AI workspace. ALiX gives builders the governed agent OS beneath trustworthy workflows.

See `docs/product/odysseus-borrowings.md` for the full comparison and borrowing plan.

---

## 4. Target Users

| Persona | Jobs To Be Done | Critical Needs |
|---|---|---|
| Solo developer / builder | Fix code, scaffold features, refactor safely, create docs | Repo intelligence, verification, patches, low cost |
| Homelab operator | Design, audit, and deploy self-hosted services | Config validation, rollback, policy, infrastructure SOPs |
| Research-heavy user | Gather, verify, compare, and synthesize information | Source verification, citations, claim tracking, report artifacts |
| Small business operator | Draft quotes, contracts, support docs, follow-ups | Templates, approvals, external side-effect governance |
| Agent developer | Create reusable agents, tools, skills, and SOPs | SDK, registry, test harness, observability |
| Local-first AI power user | Run agents privately on local machines | Local models, memory scopes, offline mode, transparent logs |

---

## 5. Goals

- Preserve current `alix run` behavior while introducing durable WorkflowRun and TaskGraph primitives.
- Make every significant action observable through normalized events.
- Introduce Agent Cards, Tool Cards, Skill Cards, SOP Packs, and a Capability Registry as first-class resources.
- Add local-first memory with scoped retrieval, provenance, confidence, and conflict handling.
- Enforce least privilege for tools, model calls, sidecars, memory writes, graph mutation, and external effects.
- Expose ALiX through MCP first; defer A2A until readiness gates pass.
- Validate local model routing before relying on small-model defaults.
- Add Odysseus-inspired product packaging improvements: a 10-minute first success path, hardware-aware model doctor/cookbook, and role-specific model comparison, without expanding M0.9 product scope.

---

## 6. Non-Goals for M0.9 / Early v1

- No big-bang rewrite.
- No new product domains in M0.9.
- No autonomous external side effects without approval.
- No full distributed execution in v1 core.
- No cloud-only product dependency.
- No foundation-model training or fine-tuning.
- No A2A exposure until policy-boundary tests and readiness gates pass.
- No broad metric catalog implementation before data proves usefulness.

---

## 7. Core Product Concepts

| Concept | Definition |
|---|---|
| WorkflowRun | Top-level execution instance for a user goal |
| TaskGraph | Durable DAG of typed TaskNodes with dependencies, state, risk, capabilities, artifacts, and checkpoints |
| TaskNode | Atomic executable unit assigned to an agent, tool pipeline, or system controller |
| AgentCard | Manifest describing an agent identity, capabilities, permissions, tools, schemas, and model tier |
| ToolCard | Manifest describing tool capabilities, input/output schemas, side effects, sandbox requirements, and cancellation support |
| Capability | Permissioned action or competency used by policy and scheduling |
| SOP Pack | Reusable workflow template for a domain-specific process |
| Memory Record | Scoped typed memory item such as episodic, semantic, skill, reflection, project, workflow, preference, or safety memory |
| PolicyDecision | Argument-bound allow/ask/deny/modify decision for a requested capability |
| Artifact | Output produced by a node or workflow |

---

## 8. Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Every user command creates or maps to a WorkflowRun | P0 |
| FR-002 | Every run creates at least one TaskGraph and TaskNode internally | P0 |
| FR-003 | ALiX emits canonical events for workflow, task, model, tool, policy, artifact, and error activity | P0 |
| FR-004 | Existing `alix run` behavior remains compatible through M0.9 | P0 |
| FR-005 | Tool execution requires a PolicyDecision placeholder in M0.9 and full policy checks later | P0 |
| FR-006 | A model-routing validation spike tests fast/thinking/coding/critic local defaults before they are trusted | P0 |
| FR-007 | Minimal M0.9 metrics are collected before expanding the metrics catalog | P0 |
| FR-008 | Inspector remains usable during the transition and later becomes a durable-state projection | P0 |
| FR-009 | Agent/Tool/Capability manifests become required before Agent OS kernel release | P0 |
| FR-010 | `research.deep_report` becomes the first public showcase after kernel stabilization | P1 |
| FR-011 | MCP server mode exposes selected ALiX capabilities after graph/memory APIs stabilize | P1 |
| FR-012 | A2A remains feature-gated until policy-boundary readiness tests pass | P2 |
| FR-013 | ALiX provides a 10-minute first success path through `alix init`, `alix models doctor`, `alix demo local`, and Inspector launch | P0 for M0.9 demo path |
| FR-014 | ALiX provides hardware-aware model fit/doctor commands and role-specific model comparison before trusting local model defaults | P0 for validation, P1 for full UX |

---

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Local-first | Core workflows run without cloud when local models/tools are configured |
| Reliability | State transitions are persisted; interrupted runs can be diagnosed and later recovered |
| Security | Least privilege, approval gates, argument-bound policy decisions, audit trail, and secret redaction are mandatory |
| Observability | Every meaningful state transition emits a canonical event; M0.9 implements only the minimum useful metric set |
| Extensibility | Agents, tools, SOPs, skills, and sidecars use versioned manifests/schemas |
| Portability | Linux and macOS are first-class; WSL2 should work; remote workers come later |
| Cost control | Model routing and workflow execution respect budget and cost telemetry |
| Privacy | Memory scopes and cloud routing respect local-only and sensitive flags |

---

## 10. MVP Acceptance Criteria

1. Existing `alix run` commands continue to work.
2. Every run emits canonical workflow/task/model/tool events.
3. Every run creates a WorkflowRun and at least one TaskNode internally.
4. A single-node TaskGraph is persisted for legacy runs.
5. No tool executes without a PolicyDecision record, even if permissive.
6. The Inspector still shows a usable timeline during transition.
7. `alix graph inspect <graph-id>` can display the persisted graph.
8. M0.9 model-routing validation produces a report with pass/fail results.
9. M0.9 minimal metrics are emitted and persisted/exported.
10. Documentation is split and frozen before major code work continues.
11. `alix demo local` or equivalent safe demo path shows WorkflowRun, TaskNode, model routing, tool event, PolicyDecision placeholder, and minimal metrics.
12. Model-routing validation includes fast-router, graph-planner, coding, and critic role tests.

---

## 11. Product Milestones

| Milestone | Theme | Scope |
|---|---|---|
| M0.9 | Stabilize current harness | Preserve current behavior, normalize events, WorkflowRun wrapper, single-node TaskGraph, PolicyDecision placeholder, model-routing spike, minimal metrics |
| M0.10 | WorkflowRun + TaskGraph | First durable graph runtime under current run loop |
| M0.11 | Persistence + replay basics | Graph/checkpoint/artifact persistence and recovery commands |
| M0.12 | Agent/Tool Cards | Capability registry, Agent Cards, Tool Cards, policy-bound tools |
| M1.0-alpha | Kernel primitives | Stable event bus, WorkflowRun, TaskGraph, TaskNode |
| M1.0-beta | Governance primitives | Tool Cards, Capability Registry, PolicyDecision, Artifact model |
| M1.0-rc | Operational primitives | BudgetGuardian, cancellation, recovery, eval suite |
| M1.1 | Research Pack | `research.deep_report` public showcase |
| M1.2 | MCP Server Mode | Expose `run_task`, `run_sop`, `search_memory`, `inspect_graph`, `replay_session` |
| M1.3 | Infrastructure Pack | `infra.docker_compose_audit` showcase |
| M2.0 | Generic Multi-Agent OS | A2A gateway if readiness gates pass, distributed execution, capability economy |

---

## 12. M0.9 Scope Freeze

M0.9 may only include:

- Compatibility preservation for existing `alix run`.
- Canonical event envelope and event emission for existing flows.
- WorkflowRun wrapper.
- Single-node TaskGraph wrapper.
- PolicyDecision placeholder around tools.
- Minimal SQLite migration for workflows, task graphs, task nodes, events, policy decisions, and minimal metrics.
- Model-routing validation spike.
- `alix demo local` safe visible demo path.
- Minimum useful metric set.
- Inspector compatibility.
- Documentation split and freeze.

M0.9 must not include:

- New agent marketplace.
- Full memory kernel.
- A2A.
- Distributed workers.
- New business/personal automation domains.
- Full metric catalog implementation.
- Autonomous external actions.

---

## 13. Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Architecture grows faster than code | Freeze docs and ship M0.9 against slim PRD + M0.9 plan only |
| Small local models fail routing/planning | Run M0.9 model-routing validation spike and adjust defaults based on data |
| Metrics overhead before value | Implement minimal M0.9 metrics only; keep full catalog as future architecture spec |
| Unsafe external automation | Keep all external mutations out of M0.9; enforce PolicyDecision placeholders now |
| A2A remote agents bypass local assumptions | Add policy-boundary test suite before A2A readiness can pass |
| Memory pollution | Defer full memory kernel until scoped memory records/conflict rules are ready |
| Inspector rewrite risk | Keep Inspector compatible first; refactor after durable TaskGraph persistence |
| ALiX feels too abstract compared with app-first workspaces | Borrow Odysseus-style onboarding, model doctor, and visible demo path while keeping the runtime scope frozen |

---

## 14. Unique Product Differentiator

ALiX differentiates with an **Agent Constitution** plus a **Capability Economy**.

The Agent Constitution defines project-level values, forbidden actions, approval rules, and required checks. The Capability Economy scores agents, tools, skills, and models by relevance, success history, cost, latency, risk, and permission fit.

This makes ALiX behave more like an OS scheduler than a simple agent wrapper.

---

## 15. Supporting Specs

This PRD is intentionally slim. Implementation details live in:

- `docs/architecture/migration-map.md`
- `docs/architecture/event-schema.md`
- `docs/architecture/taskgraph-runtime.md`
- `docs/architecture/capability-taxonomy.md`
- `docs/architecture/policy-enforcement.md`
- `docs/architecture/memory-kernel.md`
- `docs/architecture/observability-metrics.md`
- `docs/architecture/persistence-recovery.md`
- `docs/architecture/sidecar-protocol.md`
- `docs/architecture/a2a-readiness.md`
- `docs/evals/model_routing_eval.md`
- `docs/evals/policy_boundary_eval.md`
- `docs/milestones/M0.9_stabilize_harness.md`

---

## 16. References

Research and competitive references remain in the architecture pack. The PRD does not duplicate implementation-specific citations.
