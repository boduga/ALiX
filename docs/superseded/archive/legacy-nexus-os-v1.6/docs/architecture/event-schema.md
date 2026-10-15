# Event Schema

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 28. Canonical Event Schema

ALiX Nexus OS is event-sourced. Events are the durable spine for replay, audit, evaluation, Inspector projections, memory formation, policy review, cost tracking, and debugging.

### 28.1 Event Envelope

```typescript
type AlixEvent = {
  id: string;
  schemaVersion: "1.0";
  timestamp: string;
  sessionId: string;
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  actorType: "user" | "agent" | "tool" | "model" | "system" | "sidecar" | "policy";
  actorId: string;
  eventType: string;
  payload: unknown;
  visibility: "public" | "internal" | "sensitive";
  causality?: {
    parentEventId?: string;
    traceId?: string;
    spanId?: string;
  };
  integrity?: {
    payloadHash?: string;
    previousEventHash?: string;
  };
};
```

### 28.2 Required Event Families

| Family | Examples | Purpose |
|---|---|---|
| `workflow.*` | `workflow.created`, `workflow.completed`, `workflow.failed` | Lifecycle of a complete user request |
| `graph.*` | `graph.created`, `graph.node_added`, `graph.edge_added`, `graph.mutated` | Durable task graph state |
| `task.*` | `task.ready`, `task.started`, `task.blocked`, `task.completed`, `task.failed`, `task.cancel_requested`, `task.cancelled`, `task.timeout_exceeded`, `task.skipped` | Node execution state |
| `agent.*` | `agent.selected`, `agent.spawned`, `agent.message_sent`, `agent.completed`, `agent.unavailable` | Agent lifecycle and communication |
| `tool.*` | `tool.requested`, `tool.approved`, `tool.started`, `tool.completed`, `tool.failed`, `tool.cancel_sent` | Tool execution trace |
| `model.*` | `model.requested`, `model.completed`, `model.failed`, `model.routed` | Model call and routing trace |
| `policy.*` | `policy.evaluated`, `policy.denied`, `policy.interrupted` | Governance decisions |
| `approval.*` | `approval.requested`, `approval.approved`, `approval.denied`, `approval.modified` | Human-in-the-loop checkpoints |
| `memory.*` | `memory.proposed`, `memory.written`, `memory.rejected`, `memory.used`, `memory.superseded`, `memory.conflict_detected`, `memory.pruned` | Memory lifecycle |
| `artifact.*` | `artifact.created`, `artifact.updated`, `artifact.exported` | Output tracking |
| `sidecar.*` | `sidecar.started`, `sidecar.requested`, `sidecar.completed`, `sidecar.crashed`, `sidecar.cancel_sent`, `sidecar.cancelled` | Python/worker sidecar lifecycle |
| `eval.*` | `eval.started`, `eval.assertion_passed`, `eval.assertion_failed`, `eval.completed` | Evaluation and regression tests |
| `budget.*` | `budget.warning`, `budget.exhausted`, `budget.extended`, `budget.abandoned` | Budget lifecycle |
| `error.*` | `error.captured`, `error.recovered`, `error.unrecoverable` | Failure handling |

### 28.3 Event Rules

- All state transitions must emit exactly one canonical event.
- Tool calls must emit a pending event before execution and a completion or failure event after execution.
- Sensitive payloads must be redacted or stored with `visibility: sensitive`.
- Events are append-only. Corrections are represented as new events, not edits.
- Every event must include enough IDs to reconstruct a session, workflow, graph, node, and trace.
- `task.cancel_requested` is not terminal; `task.cancelled` is the terminal event.
- Cancellation events are idempotent. Duplicate cancel requests must converge on one terminal event.
- A node/tool/model/sidecar invocation may have only one terminal event in a given trace.

---
