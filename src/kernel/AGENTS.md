# DOX — Kernel (Graph Execution Engine)

**Purpose:** Owns the graph runtime — planning, executing, projecting, and rerunning TaskGraphs.

**Ownership:**
- `task-graph.ts` — TaskNode/TaskGraph types, status transitions, risk levels
- `graph-executor.ts` — Sequential multi-node executor with capability resolution, policy enforcement, approval integration
- `graph-projection.ts` — Reconstruct run state from events and graph JSON
- `graph-planner.ts` — Model-based graph generation from goals

**Local Contracts:**
- GraphExecutor runs nodes sequentially, stops on first failure.
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
- `tests/kernel/graph-planner.test.ts` — plan generation
