# Taskgraph Runtime

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 10. TaskGraph Runtime Requirements

| Feature | Requirement |
|---|---|
| Graph planner | Create TaskGraph from user goal, selected SOP, context, memory, and constraints. |
| Node schema | Each node has goal, acceptance criteria, capability requirements, dependencies, risk, sandbox, budget, outputs, and status. |
| Schedulers | Support sequential, parallel, map-reduce, critic-loop, debate, pipeline, and human-gated modes. |
| State machine | `pending → ready → running → blocked → awaiting_approval → done / failed / cancelled / skipped`. |
| Durability | Persist graph state after every node transition. |
| Replay | Replay whole run, node-only, failed-node, or from checkpoint. |
| Aggregation | Merge outputs from parallel nodes with conflict resolution and critic review. |
| Context channels | Share summaries, artifacts, memory refs, and typed outputs between nodes without dumping full logs. |
| Budget guardian | A system node auto-inserted when a budget is declared; see §24. |
| Cancellation | Any node may be cancelled by an authorized actor; see §25. |

---

## 24. Budget Exhaustion Protocol

### 24.1 BudgetExhaustedPolicy Type

```typescript
type BudgetExhaustedPolicy = {
  onTokensExhausted: "pause" | "fail" | "ask";
  onCostExhausted: "pause" | "fail" | "ask";
  onWallClockExhausted: "pause" | "fail" | "ask";
  onToolCallsExhausted: "pause" | "fail" | "ask";
};
```

Default policy: `"ask"` for all dimensions. The `fail` option is available for unattended pipelines. The `pause` option halts execution and waits indefinitely for user input.

### 24.2 BudgetGuardian Behavior

The `budget.guardian` agent is a system node auto-inserted by the scheduler at graph creation when any budget dimension is declared. It runs concurrently with the graph and checks budget consumption after every node transition.

When a budget is exhausted:

1. `budget.guardian` emits a `budget.exhausted` event with the dimension, limit, and current usage.
2. The scheduler moves the graph to `awaiting_approval` state.
3. An approval card is surfaced with the options:
   - **Continue with increased budget** — user provides new limit.
   - **Continue with reduced scope** — user identifies nodes to skip.
   - **Abandon run** — graph transitions to `cancelled`.
4. If no user input is received within `budget.guardian.timeout_ms` (default: 300000 ms), the graph transitions to `failed`.

### 24.3 Pre-emptive Budget Warnings

`budget.guardian` emits a `budget.warning` event at 80% consumption of any dimension. Warnings are visible in the Inspector and TUI but do not pause execution.

### 24.4 Mode-Specific Exhaustion Defaults

Budget exhaustion behavior depends on run mode:

```yaml
budget_exhaustion_defaults:
  interactive:
    default_action: ask
    timeout_action: pause
  ci:
    default_action: fail
    timeout_action: fail
  unattended_research:
    default_action: reduce_scope
    timeout_action: produce_partial_report
  automation:
    default_action: pause
    timeout_action: pause
```

Rules:

- `budget.exhausted` must preserve partial artifacts before terminal failure or cancellation.
- In unattended research mode, ALiX should produce a partial report artifact rather than discard the run.
- In CI mode, budget exhaustion fails fast and exits non-zero.
- In interactive mode, timeout defaults to pause rather than fail unless the user configured fail-fast behavior.

---

## 25. Node Cancellation and Timeout Protocol

### 25.1 Who May Cancel a Node

| Actor | Can Cancel |
|---|---|
| User (via CLI or Inspector) | Any node in any state |
| `orchestrator.core` | Any node it owns |
| `budget.guardian` | Any node when budget is exhausted |
| `policy.guardian` | A node that violates policy during execution |
| A parent node | Its declared child nodes |
| A specialist agent | Only nodes it owns, not sibling nodes |

### 25.2 Cancellation Protocol

Cancellation is idempotent. Repeating cancellation for the same `requestId` or `nodeId` must not create duplicate terminal events, duplicate partial artifacts, or repeated side effects. A TaskNode may have multiple `task.cancel_requested` events but only one terminal `task.cancelled` event.

When a node is cancelled:

1. The cancelling actor emits a `task.cancel_requested` event with `reason` and `requestedBy`.
2. The scheduler marks the node `cancelling` (transient state, not persisted as terminal).
3. The scheduler sends a cancellation signal to all in-flight tool calls assigned to that node:
   - For stdio sidecars: send `{"type": "cancel", "requestId": "<id>"}` on the sidecar's stdin.
   - For MCP tool calls: call the tool's `cancel` endpoint if available; otherwise send SIGTERM to the subprocess.
   - For shell execs: send SIGTERM; escalate to SIGKILL after `cancellation_grace_ms` (default: 5000 ms).
4. Partial outputs from the node are saved as a `partial` artifact tagged `retention: temporary`.
5. The node transitions to `cancelled` and emits `task.cancelled`.
6. Downstream nodes that depend only on the cancelled node transition to `skipped`.
7. Downstream nodes with other fulfilled dependencies continue normally.

### 25.3 Timeout Protocol

Each TaskNode may declare `timeoutMs`. When a node exceeds its timeout:

1. The scheduler emits `task.timeout_exceeded`.
2. The node is cancelled following the cancellation protocol above.
3. The retry policy is consulted: if `retryPolicy.repairOnFailure` is true, a repair node is injected.
4. If no repair is possible, the node transitions to `failed`.

### 25.4 Side-Effect State on Cancellation

If a node was executing a side-effecting tool call at the time of cancellation, the `task.cancelled` event must include:

```typescript
sideEffectState: "none" | "partial" | "complete" | "unknown"
```

- `"partial"` or `"unknown"` states are surfaced as warnings in the Inspector.
- On `alix recover resume`, nodes with `partial` or `unknown` side-effect state require explicit approval before retry.

---

## 29. TaskGraph and TaskNode Schemas

TaskGraph is the execution primitive for ALiX Nexus OS. Even a simple request is represented as a graph with one node.

### 29.1 TaskGraph Schema

```typescript
type TaskGraph = {
  id: string;
  schemaVersion: "1.0";
  workflowId: string;
  rootGoal: string;
  status: "draft" | "ready" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  strategy: "sequential" | "parallel" | "map_reduce" | "critic_loop" | "human_gated" | "hybrid";
  nodes: TaskNode[];
  edges: TaskEdge[];
  budget: {
    maxTokens?: number;
    maxCostUsd?: number;
    maxWallClockMs?: number;
    maxToolCalls?: number;
    exhaustedPolicy?: BudgetExhaustedPolicy;
  };
  createdAt: string;
  updatedAt: string;
};
```

### 29.2 TaskNode Schema

```typescript
type TaskNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "awaiting_approval"
  | "cancelling"           // transient: in-flight tool calls being aborted
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

type TaskNode = {
  id: string;
  graphId: string;
  title: string;
  goal: string;
  domain: string;
  status: TaskNodeStatus;
  dependencies: string[];
  assignedAgent?: string;
  requiredCapabilities: string[];
  forbiddenCapabilities?: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  approvalMode: "auto" | "ask" | "deny";
  retryPolicy: {
    maxAttempts: number;
    backoffMs?: number;
    repairOnFailure: boolean;
  };
  timeoutMs?: number;
  cancellationGraceMs?: number;   // override default 5000ms
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  artifacts: string[];
  memoryRefs: string[];
  sideEffectState?: "none" | "partial" | "complete" | "unknown";  // set on cancellation
  failureReason?: "interrupted" | "timeout" | "tool_failed" | "policy_denied" | "budget_exhausted" | "cancelled" | "unknown";
  displayStatus?: "interrupted"; // derived display-only status; not a persisted terminal enum
  createdAt: string;
  updatedAt: string;
};
```

### 29.3 TaskEdge Schema

```typescript
type TaskEdge = {
  id: string;
  graphId: string;
  from: string;
  to: string;
  type: "requires" | "informs" | "blocks" | "critiques" | "approves";
};
```

### 29.4 Graph Mutation Rules

- `planner.graph` and `orchestrator.core` may create nodes by default.
- Specialist agents may propose graph mutations but cannot directly mutate the graph unless policy grants `graph.mutate`.
- Every graph mutation must emit `graph.mutated` with before/after summaries.
- A running node cannot be deleted; it may only be cancelled or superseded.
- A completed node is immutable except for metadata annotations.
- Dynamic graph expansion must preserve all prior events and checkpoints.

---
