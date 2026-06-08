# M0.9 Stabilize Current Harness - Implementation Plan

## Objective

Ship a stabilization milestone that preserves current ALiX behavior while introducing the minimum Agent OS kernel primitives under the existing runtime.

M0.9 must ship in a fixed implementation window and must not expand product scope.

## Scope

M0.9 includes only:

1. Existing `alix run` compatibility.
2. Canonical event envelope.
3. WorkflowRun wrapper.
4. Single-node TaskGraph wrapper.
5. PolicyDecision placeholder around tool calls.
6. Minimal SQLite migration.
7. Minimal metrics.
8. Model routing validation spike.
9. Safe visible demo path (`alix demo local` or equivalent).
10. Inspector compatibility.
11. Documentation freeze.

## Out of Scope

- Full Agent Registry.
- Full Memory Kernel.
- Multi-node graph planning beyond internal scaffolding.
- MCP server mode.
- A2A.
- Distributed workers.
- New business/personal automation domains.
- Full metrics catalog.

## Work Breakdown

### Workstream A - Event Envelope

Deliverables:

- `src/kernel/event-envelope.ts`
- canonical event types
- event writer interface
- adapter that wraps existing events into canonical envelope

Acceptance:

- Existing flows emit `workflow.created`, `task.started`, `model.requested`, `tool.requested`, `tool.completed/failed`, `workflow.completed/failed`.
- Legacy event payload can be preserved under `payload.legacy`.

### Workstream B - WorkflowRun Wrapper

Deliverables:

- `src/kernel/workflow-run.ts`
- WorkflowRun ID creation
- start/end timestamps
- goal/mode/budget/policy context fields

Acceptance:

- Every `alix run` produces a WorkflowRun.
- Existing CLI output remains compatible.

### Workstream C - Single-Node TaskGraph

Deliverables:

- `src/kernel/task-graph.ts`
- single-node graph generated for legacy run
- `alix graph inspect <graph-id>` displays persisted graph

Acceptance:

- Every run has one graph and at least one node.
- Node status transitions persist.

### Workstream D - PolicyDecision Placeholder

Deliverables:

- `src/kernel/policy-decision.ts`
- argument hash helper
- permissive default policy mode
- deny path blocks tool execution

Acceptance:

- No tool executes without a PolicyDecision record.
- Tool arguments are hashed and bound to the decision.

### Workstream E - Minimal Metrics

Deliverables:

- `src/kernel/minimal-metrics.ts`
- metric events/counters for M0.9 minimum set

Acceptance:

- M0.9 metrics appear in CLI/debug output and/or persisted event-derived report.

### Workstream F - Model Routing Validation Spike

Deliverables:

- curated eval prompts
- runner command or script
- results report

Acceptance:

- `qwen3:4b` fast-tier classification is tested against threshold.
- `qwen3:8b` planning/critic is tested.
- `qwen2.5-coder:7b` coding tasks are tested against baseline.
- Results inform whether defaults remain unchanged.

### Workstream G - Safe Visible Demo Path

Deliverables:

- `alix demo local` command or equivalent documented demo flow
- demo task: summarize current repo or inspect a safe local directory
- output showing WorkflowRun ID, TaskNode ID, model route, tool event, PolicyDecision placeholder, and minimal metrics

Acceptance:

- Demo runs without external side effects.
- Demo does not introduce new product domain scope.
- Demo completes on default local-first setup or clearly reports missing model/tool prerequisites.

### Workstream H - Inspector Compatibility

Deliverables:

- Inspector still reads legacy event payloads.
- Inspector displays WorkflowRun and TaskGraph IDs if present.

Acceptance:

- No Inspector regression for current sessions.

## Implementation Order

1. Add schemas/types without changing runtime behavior.
2. Add event envelope adapter.
3. Wrap `alix run` in WorkflowRun.
4. Create single-node TaskGraph internally.
5. Add PolicyDecision placeholder around tool boundary.
6. Add minimal metrics.
7. Add DB migration and doctor command if required.
8. Add model routing validation spike.
9. Add safe visible demo path.
10. Verify Inspector compatibility.
11. Freeze M0.9.

## M0.9 Exit Criteria

- Existing tests pass.
- Existing `alix run` works.
- New kernel primitives are present under the hood.
- Minimal metrics available.
- Model routing spike completed.
- Safe local demo path completed.
- No scope creep introduced.
