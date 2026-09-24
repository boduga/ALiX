# DOX — Kernel (Graph Execution Engine)

**Purpose:** Owns the graph runtime — planning, executing, projecting, and rerunning TaskGraphs.

**Ownership:**
- `task-graph.ts` — TaskNode/TaskGraph types, status transitions, risk levels
- `graph-executor.ts` — Sequential multi-node executor with capability resolution, policy enforcement, approval integration
- `graph-projection.ts` — Reconstruct run state from events and graph JSON
- `graph-planner.ts` — Model-based graph generation from goals (v2 prompt, capability catalog, deterministic normalize, one repair retry)
- `coordination-planner.ts` — Graph → CoordinationRun/workers (registry-sourced cap normalize, goal-path ownership scopes, agentPool labels)
- `coordination-scheduler.ts` — Bounded parallel dispatch (maxConcurrency 8, per-worker timeout watchdog, heartbeats/leases, cancel)
- `coordination-tools.ts` — Chat-tool handlers (run/status/list/results; subagent executor when enabled)
- `subagent-worker-executor.ts` — Workers as subagent child processes (caps→role map, ownedPaths, result map)
- `worker-role.ts` — Capability → role classification shared by planner (ownership) and executor (mode)
- `owner-liveness.ts` — `<kind>-<pid>` execution-owner liveness probe (unknown owners read alive)
- `coordination-resume.ts` — Reclaim dead-owner workers to pending; find Inspector-hosted active runs; `cancelDeadOwnerRuns` finalizes runs whose host died mid-execution (SIGKILL)
- `replan-proposal-store.ts` — Durable proposal lifecycle (`.alix/coordination/replans/<runId>/<proposalId>.json`, atomic tmp+rename). Takes an optional `{ now }` clock seam so an update's `updatedAt` is deterministically after `createdAt` (millisecond `toISOString()` can tie).
- `worker-executor.ts` — In-process runTask executor (CLI default)

**Local Contracts:**
- GraphExecutor runs nodes sequentially, stops on first failure.
- Coordination planning preserves truthful ownership: parallel writers with explicit disjoint paths remain concurrent, while vague writers with overlapping inferred claims are deterministically ordered by dependency rather than assigned fabricated scopes.
- Graph strategy is inferred from dependency shape (`>=2` dependency-free roots → `hybrid`, else `sequential`), never from a model-supplied `strategy` label.
- Coordination workers are ordered by `serializeOverlappingWriters`: any two writers whose ownership claims overlap (a vague `**` claim overlaps all) get a dependency edge; disjoint writers and read-only workers stay parallel.
- Coordination plans publish queued/dependency-waiting canonical `agent.*` lifecycle rows before dispatch. Retry-attempt results are non-terminal presentation facts; only scheduler exhaustion/completion publishes terminal worker state, and dependency failure publishes an explicit blocked state.
- Write workers reserve their final two model iterations for mutation/completion tools while owned outputs remain unwritten, preventing broad reconnaissance from consuming the entire bounded iteration budget.
- `--enforce-capabilities` enables two-layer gate (CapabilityResolver + RuntimeGate).
- `graph-projection.ts` returns `GraphRunProjection` with node status, timestamps, attempts.
- All graph definitions persist to `.alix/graphs/<graphId>.json`.
- Rerun attempts append to `.alix/graphs/<graphId>.runs.json`.
- Terminal worker status patches (`completed`/`failed`/`pending` from `executeWorker`) go through bounded `patchWorkerWithRetry` (5 attempts, 50/100/200/400ms); `updateRun` retries transient in-lock loads via `loadWithRetry` (3×, 25/50ms) and all atomic writes go through `writeAtomic` (tmp+rename with EPERM/EACCES/EBUSY rename retry). A silent null from a transient read (e.g. Windows Defender EBUSY) must not orphan a worker as `running` and idle-stop `runUntilIdle`.

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
- `tests/kernel/coordination-scheduler-replan.test.ts` — mid-execution replanning; waits on settled state (`waitUntil`), never a fixed sleep
- `tests/kernel/replan-proposal-store.test.ts` — proposal CRUD; timestamp assertions use the injected clock
