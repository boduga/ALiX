# ALiX Nexus OS - MVP Acceptance Criteria

## M0.9 MVP

1. Existing `alix run` commands continue to work.
2. Every run emits canonical `workflow.*`, `task.*`, `model.*`, `tool.*`, and `error.*` events.
3. Every run creates a persisted WorkflowRun.
4. Every run creates a persisted single-node TaskGraph.
5. Tool execution writes a PolicyDecision placeholder before execution.
6. Minimal metrics are emitted: workflow runs, durations, model calls, tool calls, tool failures, policy decisions, policy denials, task events, run errors.
7. Inspector continues to show a useful timeline.
8. Model-routing validation spike produces a pass/fail report.
9. No new product scope is introduced.
10. Documentation split is complete and frozen.

## M1.0 Kernel MVP

1. Multi-node TaskGraphs execute.
2. Tool Cards and Agent Cards validate against schema.
3. Capability checks run before tool calls.
4. Risky actions trigger approval UX.
5. Recovery/replay works for non-side-effecting nodes.
6. Eval suites for graph, policy, budget, cancellation, and basic coding pass.
