# Observability and Metrics Integration

ALiX Nexus OS must extend the existing ALiX monitoring architecture rather than replace it. The full future metrics catalog remains an architecture target, but M0.9 implements only the minimum useful metric set.

## Metric Types

Use the existing metric types:

| Type | Purpose |
|---|---|
| Counter | Monotonically increasing counts |
| Gauge | Point-in-time values |
| Histogram | Distribution values |
| Timer | Duration measurements |
| Label | Metadata and status labels |

## M0.9 Minimum Useful Metrics

| Metric | Type | Purpose |
|---|---|---|
| `workflow_runs_total` | Counter | Number of WorkflowRuns created |
| `workflow_duration_ms` | Timer | End-to-end run duration |
| `model_calls_total` | Counter | Number of model calls |
| `tool_calls_total` | Counter | Number of tool calls |
| `tool_failures_total` | Counter | Failed tool executions |
| `policy_decisions_total` | Counter | Policy decisions created |
| `policy_denials_total` | Counter | Denied policy decisions |
| `task_events_total` | Counter | Task lifecycle events emitted |
| `run_errors_total` | Counter | Captured unrecoverable run errors |

## M0.9 Rules

- Do not implement the full future metric catalog in M0.9.
- All M0.9 metrics must be derivable from canonical events where possible.
- If a metric is not used in a CLI report, Inspector view, or eval report, defer it.
- Future Agent OS metrics belong in this architecture document until validated by real runs.

## Future Metrics Backlog

- `taskgraph_node_duration_ms`
- `graph_queue_depth`
- `agent_selection_score`
- `memory_conflict_count`
- `memory_retrieval_relevance_score`
- `sidecar_crash_count`
- `checkpoint_recovery_success_rate`
- `budget_exhaustion_count`
