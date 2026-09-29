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
- `coordination-resume.ts` — Reclaim dead-owner workers to pending; find Inspector-hosted active runs; `cancelDeadOwnerRuns` finalizes runs whose host died mid-execution (SIGKILL), releasing the dead host's ownership leases (detaching `leaseIds` alone leaves active records that block every later run until the TTL) and marking run + graph `cancelled`; `markRunGraphCancelled` keeps the persisted TaskGraph in step with the run record
- `replan-proposal-store.ts` — Durable proposal lifecycle (`.alix/coordination/replans/<runId>/<proposalId>.json`, atomic tmp+rename). Takes an optional `{ now }` clock seam so an update's `updatedAt` is deterministically after `createdAt` (millisecond `toISOString()` can tie).
- `worker-executor.ts` — In-process runTask executor (CLI default)

**Local Contracts:**
- GraphExecutor runs nodes sequentially, stops on first failure.
- Cancellation is terminal for coordination runs: `cancelRun` marks running/pending/ready workers `cancelled`, releases their ownership leases, sets the run status `cancelled` (explicitly — `recomputeRunStatus` maps an all-idle run to `blocked`, which the resume sweeps still treat as active) and marks the persisted TaskGraph `cancelled`. `coordination.run` threads the operator-cancel signal into that path, so an aborted turn finalizes the run it started instead of leaving it running for a later sweep to collide with; the abort surfaces as an `ExecutionCancelledError`, never a tool failure.
- `coordination.run` sweeps dead-owner `cli` runs before planning (`cancelDeadOwnerRuns` with the ownership registry), so a stranded run cannot leave leases that block the next run's claims.
- Coordination planning preserves truthful ownership: parallel writers with explicit disjoint paths remain concurrent, while vague writers with overlapping inferred claims are deterministically ordered by dependency rather than assigned fabricated scopes.
- Before dispatch, coordination planning checks stated worker counts, `own only`/`owns only`, `owned path only`, and `exclusive owned path` outputs, and dependencies against the model graph, including named and numbered worker lists. Only path-shaped captures are ownership claims: prose that happens to follow the clause ("each worker owns ONLY its one file") is ignored, while a path-shaped capture that cannot be resolved to a workspace path still blocks planning. Trailing sentence punctuation never becomes part of a path. Explicit outputs override inferred input paths and domain scopes; mismatches or unmappable dependencies block planning. Unstated constraints keep normal planning behavior.
- A planned node goal names its output whether the path follows `to`/`into`/`at`/`as`/`in` or a write verb. A bare filename claim (`owns only project.md`) resolves to the single node goal naming that basename, so the worker is scoped to the directory the plan writes into instead of a same-named file at the workspace root; the same resolver maps worker sections to nodes, so named worker lists keep their declared dependencies verifiable.
- `coordination.status` answers the per-worker identity questions callers ask by name — worker id, task label, agent, status, attempt/maxAttempts, plan order, dependencies, owned scope, result reference — so run-state reads stay inside the tool. `.alix/coordination/**` remains a sensitive path that raw `file.read`/`shell.run` cannot open, and it is not made approvable.
- Auxiliary nodes are not workers. When a goal declares owned paths, the stated worker count is satisfied by the 1:1 path→writer mapping, and a node that claims no declared path is allowed when it is read-only or a writer whose mentions are only declared files inside a declared directory (directory prep, verification). A writer that names an undeclared file, or references no declared location, still blocks planning. Auxiliary writers are scoped to the declared directory they touch, never to broad domain defaults.
- A rejected coordination plan is retryable: the goal text is the caller's own input, so `coordination.run` returns `retryable: true` with a recovery hint (one owned path per worker; auxiliary steps do not count as workers) instead of a fatal verdict.
- Direct graph dependencies with explicit single-file outputs enter the consumer worker's `Input paths:` manifest and persisted `inputPaths` as full workspace-relative paths. The subagent receives this structured list and resolves only uniquely matching bare read filenames. Ordering-only dependencies and vague ownership scopes never fabricate input files.
- A coordination subagent's `partial` result is an execution failure, eligible for bounded retry. Only a `success` result completes a worker and contributes to a successful aggregate.
- Graph strategy is inferred from dependency shape (`>=2` dependency-free roots → `hybrid`, else `sequential`), never from a model-supplied `strategy` label.
- Coordination workers are ordered by `serializeOverlappingWriters`: any two writers whose ownership claims overlap (a vague `**` claim overlaps all) get a dependency edge; disjoint writers and read-only workers stay parallel.
- Coordination plans publish queued/dependency-waiting canonical `agent.*` lifecycle rows before dispatch. Retry-attempt results are non-terminal presentation facts; only scheduler exhaustion/completion publishes terminal worker state, and dependency failure publishes an explicit blocked state.
- Write workers reserve their final two model iterations for mutation/completion tools while owned outputs remain unwritten, preventing broad reconnaissance from consuming the entire bounded iteration budget.
- `--enforce-capabilities` enables two-layer gate (CapabilityResolver + RuntimeGate).
- `graph-projection.ts` returns `GraphRunProjection` with node status, timestamps, attempts.
- All graph definitions persist to `.alix/graphs/<graphId>.json`.
- Rerun attempts append to `.alix/graphs/<graphId>.runs.json`.
- Terminal worker status patches (`completed`/`failed`/`pending` from `executeWorker`) go through bounded `patchWorkerWithRetry` (5 attempts, 50/100/200/400ms); `updateRun` retries transient in-lock loads via `loadWithRetry` (3×, 25/50ms) and all atomic writes go through `writeAtomic` (tmp+rename with EPERM/EACCES/EBUSY rename retry). A silent null from a transient read (e.g. Windows Defender EBUSY) must not orphan a worker as `running` and idle-stop `runUntilIdle`.
- Terminal execution status is not completion. `status: "completed"` means the workers finished; aggregation, aggregate outcome and verification are separate dimensions derived by `deriveCoordinationCompletion` (`coordination-types.ts`), pinned by invariant tests. A terminal transition finalizes the run — `createCoordinationScheduler` (the only production construction path; `new CoordinationScheduler(` in `src/` is a wiring bug that a test scans for) injects a `CoordinationCompletionService`, and `maybeFinalizeRun` is no longer dead optional behaviour. Finalization is idempotent at the store boundary: `CoordinationStore.attachAggregateIfUnfinalized` does check-and-attach inside the per-run lock holding the same aggregation source fingerprint, so two schedulers cannot both attach and `coordination.aggregate.completed` is emitted exactly once (the loser returns the winner's aggregate). A different fingerprint is a fresh finalization after a replan and does attach. Aggregation failure is its own evidence (`coordination.aggregate.failed`) and never rewrites `run.status` or becomes an execution failure. Test schedulers may still omit `completionService`, but that omission is explicit.

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
