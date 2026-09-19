# DOX — Kernel (Graph Execution Engine)

**Purpose:** Owns the graph runtime — planning, executing, projecting, and rerunning TaskGraphs.

**Ownership:**
- `task-graph.ts` — TaskNode/TaskGraph types, status transitions, risk levels
- `graph-executor.ts` — Sequential multi-node executor with capability resolution, policy enforcement, approval integration
- `graph-projection.ts` — Reconstruct run state from events and graph JSON
- `graph-planner.ts` — Model-based graph generation from goals (v2 prompt, capability catalog, deterministic normalize, one repair retry)
- `coordination-planner.ts` — Graph → CoordinationRun/workers (registry-sourced cap normalize, goal-path ownership scopes, agentPool labels)
- `coordination-scheduler.ts` — Bounded parallel dispatch (maxConcurrency 8, per-worker timeout watchdog, heartbeats/leases, cancel)
- `coordination-tools.ts` — Chat-tool handlers (run/status/results; subagent executor when enabled)
- `subagent-worker-executor.ts` — Workers as subagent child processes (caps→role map, ownedPaths, result map)
- `worker-executor.ts` — In-process runTask executor (CLI default)

**Local Contracts:**
- GraphExecutor runs nodes sequentially, stops on first failure.
- Coordination planning preserves truthful ownership: parallel writers with explicit disjoint paths remain concurrent, while vague writers with overlapping inferred claims are deterministically ordered by dependency rather than assigned fabricated scopes.
- `--enforce-capabilities` enables two-layer gate (CapabilityResolver + RuntimeGate).
- `graph-projection.ts` returns `GraphRunProjection` with node status, timestamps, attempts.
- All graph definitions persist to `.alix/graphs/<graphId>.json`.
- Rerun attempts append to `.alix/graphs/<graphId>.runs.json`.

**Work Guidance:**
- Before modifying `graph-executor.ts`, understand the full enforcement flow: CapabilityResolver → RuntimeGate → ApprovalStore → runTask.
- Projection data flows to the Inspector UI via `/api/graphs/{id}/projection`. Any new node fields must be added to `NodeRunInfo` in `graph-projection.ts`.

**Verification:**
- `tests/kernel/graph-executor.test.ts` — executor, sorting, enforcement, rerun
- `tests/kernel/graph-projection.test.ts` — projection reconstruction
- `tests/kernel/graph-planner.test.ts` — plan generation, cap normalize, repair retry
- `tests/kernel/coordination-planner.test.ts` — workers, scopes, agentPool labels
- `tests/kernel/coordination-scheduler.test.ts` — dispatch, watchdog, heartbeats
- `tests/kernel/coordination-tools.test.ts` — chat handlers
- `tests/kernel/subagent-worker-executor.test.ts` — role map, parallel, cancel
