# ALiX Nexus OS - Product Roadmap

This roadmap separates **PRD/document versions** from **product milestones**.

| Milestone | Theme | Exit Criteria |
|---|---|---|
| M0.9 | Stabilize current harness | Existing `alix run` works; canonical events emitted; WorkflowRun and single-node TaskGraph wrappers exist; minimal metrics, model spike, and safe local demo path complete |
| M0.10 | WorkflowRun + TaskGraph | Durable graph runtime operates beneath current CLI |
| M0.11 | Persistence + replay basics | Checkpoints, artifacts, graph inspection, and recovery commands exist |
| M0.12 | Agent/Tool Cards | Capability taxonomy, Agent Cards, Tool Cards, and policy-bound tool calls exist |
| M1.0-alpha | Kernel primitives | Event bus, WorkflowRun, TaskGraph, TaskNode stable |
| M1.0-beta | Governance primitives | Tool Cards, PolicyDecision, Capability Registry, Artifact model stable |
| M1.0-rc | Operational primitives | BudgetGuardian, cancellation, recovery, eval suites pass |
| M1.1 | Research Pack | `research.deep_report` demo passes evals and produces required artifacts |
| M1.2 | MCP Server Mode | ALiX exposes selected MCP tools/resources |
| M1.3 | Infrastructure Pack | `infra.docker_compose_audit` passes evals without unsafe side effects |
| M2.0 | Generic Multi-Agent OS | A2A readiness gate passes; distributed execution may begin |

## M0.9 Freeze Rule

M0.9 is a stabilization milestone. It must not add new product domains, new external automations, distributed workers, or A2A.

## Odysseus-Inspired Product Borrowings

ALiX should borrow Odysseus's product clarity without copying its broad app scope. The roadmap integrates only the pieces that strengthen ALiX's current direction:

| Milestone | Borrowing | Constraint |
|---|---|---|
| M0.9 | `alix demo local` first-success path; model-routing validation spike | No new product domain |
| M0.10 | `alix models doctor` and model-fit reporting | CLI/diagnostic only |
| M0.11 | Inspector begins workspace-style durable projection | No separate runtime state |
| M1.1 | Research demo workspace around `research.deep_report` | Built on TaskGraph/artifacts only |
| M1.3 | Infrastructure audit demo | No deployment or destructive side effect by default |
| Later | Optional workspace UI, notes/tasks/docs surfaces | Only after governance and policy mature |

See `docs/product/odysseus-borrowings.md`.
