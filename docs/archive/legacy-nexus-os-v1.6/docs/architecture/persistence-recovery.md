# Persistence Recovery

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 17. Data Model

```
SQLite tables:
  workflows
  task_graphs
  task_nodes
  task_edges
  agents
  agent_capabilities
  agent_versions           -- NEW: version history for Agent Cards
  tools
  tool_invocations
  tool_versions            -- NEW: version history for Tool Cards
  events
  checkpoints
  artifacts
  memories
  memory_conflicts         -- NEW: conflict log for memory curator
  skills
  sop_packs
  sop_pack_versions        -- NEW: version history for SOP Packs
  policies
  approvals
  budget_events            -- NEW: budget exhaustion and guardian decisions
  evaluations
  eval_rubrics             -- LLM-as-judge rubric records
  eval_baselines           -- NEW: promoted evaluation baselines and regression gates
  skill_versions           -- NEW: version history for Skill Cards
  metrics_events           -- NEW: Agent OS metric emission records when exported from event stream
  model_calls
  costs
  workers
  vector_collections
  sidecar_invocations
  model_profiles
  capability_registry      -- NEW: canonical capability taxonomy

Indexes:
  events(session_id, timestamp)
  task_nodes(graph_id, status)
  memories(scope, type, created_at)
  memories(scope, confidence, last_used_at)   -- NEW: for staleness queries
  tool_invocations(tool_name, success)
  agents(domain, enabled)
  skills(domain, score)
  budget_events(workflow_id, timestamp)        -- NEW
```

---

## 31. Persistence and Crash-Recovery Rules

### 31.1 Transaction Rules

- A TaskNode state transition and its corresponding event must be written in the same SQLite transaction.
- A tool invocation must write `tool.requested` before execution.
- A tool invocation must write exactly one terminal event: `tool.completed`, `tool.failed`, or `tool.cancelled`.
- A model call must write `model.requested` before request dispatch and `model.completed` or `model.failed` after return.
- Checkpoints must include graph ID, node statuses, artifact IDs, memory write IDs, and cost totals.
- No replay may use in-memory state as the source of truth.
- Budget events must be written atomically with the graph state transition they cause.

### 31.2 Crash Recovery

On restart, ALiX must:

1. Load the latest persisted WorkflowRun and TaskGraph states.
2. Mark any node in `running` or `cancelling` state without a terminal event as `interrupted` (a synthetic status for display; stored as `failed` with `reason: "interrupted"`).
3. Surface recoverable workflows through `alix recover list`.
4. Allow replay from the last completed checkpoint.
5. Never repeat a side-effecting tool call without explicit approval.

**Partial side-effect state on resume:**

Nodes that were interrupted while executing a side-effecting tool call are flagged with `sideEffectState: "unknown"`. On `alix recover resume`, the user is shown a warning:

```
Node "github.write_pr" was interrupted during execution.
It is unknown whether the GitHub write completed.
Before retrying, please verify the state manually.
[Retry anyway] [Skip this node] [Abandon run]
```

This dialog cannot be bypassed programmatically.

### 31.3 Database Commands

```
alix db migrate
alix db doctor
alix db export --format jsonl
alix db compact
alix recover list
alix recover resume <workflow-id>
alix recover abandon <workflow-id>
```

---
