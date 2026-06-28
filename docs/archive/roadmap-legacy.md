# ALiX Roadmap

## Completed Milestones

### M0.9 — Stabilize Harness + Governance Baseline (2026-06-08)
**Tag:** `m0.9-governance-demo-baseline`

Core kernel wrappers implemented without breaking existing behavior:

| Workstream | Status | Evidence |
|-----------|--------|----------|
| Event envelope adapter | ✅ | `src/kernel/event-envelope.ts`, 10 tests |
| WorkflowRun wrapper | ✅ | `src/kernel/workflow-run.ts`, 4 tests, wired into agent-loop |
| Single-node TaskGraph | ✅ | `src/kernel/task-graph.ts`, 7 tests, wired into agent-loop |
| PolicyDecision placeholder | ✅ | `src/kernel/policy-decision.ts`, 6 tests, per-tool-call |
| Minimal metrics | ✅ | `src/kernel/minimal-metrics.ts`, 4 tests, `alix metrics` command |
| SQLite migrations | ✅ | `src/db/manager.ts`, `alix db doctor/migrate` |
| Model routing validation | 🔶 Spike ready, needs GPU | See `docs/evals/model_routing_eval.md` |
| Demo + Inspector | ✅ | `alix demo local`, mutation guard, workflow/graph IDs in Inspector |
| Governance audit | ✅ | Repair→hash→policy→execute order, terminal events on failure, bypass disclosure |

**Pre-M0.9 hardening (independent):**
- CLI run arg parser (38 tests)
- Capability mapping + argument hash (26 tests)
- Event metadata field (5 tests)
- Session artifact output refs (4 tests)

**Tests:** 1495 pass, 0 fail

## Planned

### M0.10 — Multi-Node TaskGraph + Real SOP Execution
**After M0.9 baseline is stable.**

- Multi-node graph planner (research.deep_report SOP)
- Graph scheduling (sequential → parallel → critic loop)
- Context channels between nodes
- Graph replay from checkpoints
- First full SOP execution

### M0.11 — Persistence + Replay
- Event → DB projection
- Full graph replay from SQLite
- `alix recover resume` from checkpoints

### M0.12 — Agent + Tool Cards
- Agent Registry with Agent Cards
- Tool Cards with capability validation
- Capability taxonomy as queryable registry
