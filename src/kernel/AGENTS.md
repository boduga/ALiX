# DOX — Kernel (Graph Execution Engine)

## Purpose

 Owns the graph runtime — planning, executing, projecting, and rerunning TaskGraphs.

## Ownership

- `task-graph.ts` — TaskNode/TaskGraph types, status transitions, risk levels
- `graph-executor.ts` — Sequential multi-node executor with capability resolution, policy enforcement, approval integration
- `graph-ledger.ts` — R2.7 graph-domain dual-write to the transactional ledger (`.alix/runtime-ledger.db`): `mirrorGraphToLedger` (entityType `graph`, events `graph.created`/`graph.persisted`, full TaskGraph payload) + `mirrorGraphAttemptToLedger` (entityType `graphAttempt`, `graph.attempt_recorded`, per-attempt entity, idempotent); `graphLedgerStatus(cwd)` surfaces counted failures (never thrown).
- `graph-ledger-reconcile.ts` — read-only comparison of `.alix/graphs/*.json` + `*.runs.json` against the ledger (`missing_in_ledger` / `record_mismatch` / `projection_missing` / `version_behind` / `ledger_payload_invalid`); counts unknown event types, reports truncated reads. CLI: `alix graph reconcile` (exit 1 on drift).
- `graph-projection.ts` — Reconstruct run state from events and graph JSON
- `graph-planner.ts` — Model-based graph generation from goals (v2 prompt, capability catalog, deterministic normalize, one repair retry)
- `coordination-planner.ts` — Graph → CoordinationRun/workers (registry-sourced cap normalize, goal-path ownership scopes, agentPool labels)
- `coordination-scheduler.ts` — Bounded parallel dispatch (maxConcurrency 8, per-worker timeout watchdog, heartbeats/leases, cancel)
- `coordination-tools.ts` — Run/status/list/results handlers. Inject the worker
  executor through `CoordinationToolDeps.executor` for end-to-end cancellation
  coverage of an in-flight worker and the handler's awaited finalization.
- `subagent-worker-executor.ts` — Workers as subagent child processes (caps→role map, ownedPaths, result map)
- `worker-role.ts` — Capability → role classification shared by planner (ownership) and executor (mode)
- `owner-liveness.ts` — the ONE worker-liveness module (R3.3): `<kind>-<pid>`
  execution-owner liveness probe (unknown owners read alive), heartbeat
  staleness (`heartbeatStale`; missing/unparseable = no evidence), and the
  shared reclaim verdict `shouldReclaimWorker` — a `running`, not-locally-active
  worker is reclaimable only when its owner is PROVABLY dead, or it is
  ownerless with a stale heartbeat. `DEFAULT_ORPHAN_THRESHOLD_MS` lives here.
  Reconciliation, resume, and dead-host sweeps all use this verdict; never
  reintroduce a second liveness rule.
- `coordination-resume.ts` — Reclaim provably dead owners, find Inspector-hosted
  active runs, and cancel dead-host runs while releasing ownership leases and
  marking the persisted TaskGraph cancelled through `markRunGraphCancelled`.
  `reclaimDeadOwnerWorkers` REQUIRES the ownership registry and releases each
  reclaimed worker's leases through `releaseWorkerLeases` BEFORE clearing
  `leaseIds` (R3.4 — the old signature cleared them and left live records
  blocking later runs until TTL).
- `replan-proposal-store.ts` — Atomic durable proposal lifecycle at
  `.alix/coordination/replans/<runId>/<proposalId>.json`; its injected clock
  keeps timestamp assertions deterministic.
- `worker-executor.ts` — In-process runTask executor (CLI default)
- `coordination-worker-context.ts` — Original run objective and bounded, identity-validated direct dependency results supplied to both worker executors.
- `default-worker-review.ts` — Invocation-local event capture and objective review for in-process workers; full tool evidence comes from the task-loop observer, not telemetry previews.

## Local Contracts

- GraphExecutor runs nodes sequentially, stops on first failure.
- **The coordination ledger is authoritative (R2.3); JSON is a compatibility
  projection.** Every mutation (`save`, `updateRun`,
  `updateRunWithRevisionCheck`, `attachAggregateIfUnfinalized`, `delete`)
  appends a `coordination.run.{created,persisted,deleted}` event carrying the
  FULL run record to the shared transactional ledger
  (`src/storage/runtime-ledger.ts`, project `.alix/runtime-ledger.db`) BEFORE
  writing the JSON file — the ledger append is the commit. Append failure
  throws (an unavailable authoritative store must never fall back to a
  JSON-only commit); projection write failure is tolerated and counted in
  `ledgerStatus().projectionFailures`. Reads are ledger-first: `load`/`list`
  reconstruct from the latest ledger event and fall back to JSON only for
  legacy runs with zero ledger facts. Reconcile with `alix coordination
  reconcile` (read-only; exit 1 on drift) or `reconcileCoordinationLedger(cwd)`
  (`coordination-ledger-reconcile.ts`), which reports projection drift
  (missing/stale/mismatch), counts unknown event types, and reports truncated
  reads.
- **Capability enforcement is ON by default (R1.5).** `enforceCapabilities`
  defaults to `true`; the composed gate (CapabilityResolver → RuntimeGate →
  ApprovalStore) evaluates before `runTask`. Missing policyGate/config blocks
  the node instead of running ungoverned. `rerunNode` runs the same gate —
  reruns require fresh authorization. `enforceCapabilities: false` remains the
  explicit opt-out for tests and read-only demos; the CLI
  `--enforce-capabilities` flag is a no-op (always enforced).
- Cancellation is terminal. `cancelRun` marks running/pending/ready workers,
  the run, and persisted TaskGraph cancelled and releases ownership leases.
  Set run status explicitly; do not re-derive an idle cancelled run as blocked.
  Scheduler `tick` and `runUntilIdle` treat cancelled runs as final.
- **Worker liveness is ONE verdict (R3.3).** `shouldReclaimWorker` in
  `owner-liveness.ts` merges the two pre-R3 rules (heartbeat staleness in
  reconciliation, PID probe in resume) that disagreed: reconciliation used to
  reclaim any stale different-owner worker — including a live-but-slow foreign
  host's — while resume refused unknown owners and never reclaimed ownerless
  workers. The merged rule requires a provably dead owner (or ownerless +
  stale heartbeat) and never touches locally-active executions;
  `ReconciliationDeps` no longer carries `daemonInstanceId` for orphan checks.
- **Leases release through ONE path (R3.4).** `releaseWorkerLeases`
  (`coordination-ownership.ts`) releases a worker's leases and clears its
  `leaseIds`; completion, cancellation, orphan recovery, and dead-owner
  reclaim all call it. Clearing `leaseIds` without releasing leaves active
  registry records that block every later run in the workspace until TTL.
- `alix_coordination_run` threads operator abort into cancellation and awaits
  finalization before throwing `ExecutionCancelledError`. `createCancelGuard`
  and `createCancelFailureRecorder` own this path. Bind recorder inputs before
  cancel sites and pass its session id explicitly, never via a later-declared
  captured constant.
- `executeWorker` checks abort on both resolved and thrown outcomes so a killed
  child returning failure cannot overwrite cancellation or launch a retry.
  Attach cancellation rejection handling immediately: failed finalization
  remains an operator cancellation and emits `coordination.cancel.failed`,
  rather than becoming a tool failure or unhandled rejection. A live owner's
  unfinished cancellation cannot be recovered by dead-owner sweeps.
- `alix_coordination_run` sweeps dead-owner `cli` runs before planning (`cancelDeadOwnerRuns` with the ownership registry), so a stranded run cannot leave leases that block the next run's claims.
- Coordination planning preserves truthful ownership: parallel writers with explicit disjoint paths remain concurrent, while vague writers with overlapping inferred claims are deterministically ordered by dependency rather than assigned fabricated scopes.
- Before dispatch, coordination planning checks stated worker counts, `own only`/`owns only`, `owned path only`, and `exclusive owned path` outputs, and dependencies against the model graph, including named and numbered worker lists. Only path-shaped captures are ownership claims: prose that happens to follow the clause ("each worker owns ONLY its one file") is ignored, while a path-shaped capture that cannot be resolved to a workspace path still blocks planning. Trailing sentence punctuation never becomes part of a path. Explicit outputs override inferred input paths and domain scopes; mismatches or unmappable dependencies block planning. Unstated constraints keep normal planning behavior.
- A planned node goal names its output whether the path follows `to`/`into`/`at`/`as`/`in` or a write verb. A bare filename claim (`owns only project.md`) resolves to the single node goal naming that basename, so the worker is scoped to the directory the plan writes into instead of a same-named file at the workspace root; the same resolver maps worker sections to nodes, so named worker lists keep their declared dependencies verifiable.
- `alix_coordination_status` answers the per-worker identity questions callers ask by name — worker id, task label, agent, status, attempt/maxAttempts, plan order, dependencies, owned scope, result reference — so run-state reads stay inside the tool. `.alix/coordination/**` remains a sensitive path that raw `alix_file_read`/`alix_shell_run` cannot open, and it is not made approvable.
- Auxiliary nodes are not workers. When a goal declares owned paths, the stated worker count is satisfied by the 1:1 path→writer mapping, and a node that claims no declared path is allowed when it is read-only or a writer whose mentions are only declared files inside a declared directory (directory prep, verification). A writer that names an undeclared file, or references no declared location, still blocks planning. Auxiliary writers are scoped to the declared directory they touch, never to broad domain defaults.
- A rejected coordination plan is retryable: the goal text is the caller's own input, so `alix_coordination_run` returns `retryable: true` with a recovery hint (one owned path per worker; auxiliary steps do not count as workers) instead of a fatal verdict.
- Direct graph dependencies with explicit single-file outputs enter the consumer worker's `Input paths:` manifest and persisted `inputPaths` as full workspace-relative paths. The subagent receives this structured list and resolves only uniquely matching bare read filenames. Ordering-only dependencies and vague ownership scopes never fabricate input files.
- Every worker receives the original run objective alongside its assigned task. Scheduler dispatch loads actual direct-dependency findings through `CoordinationResultStore`, validates run/worker/agent/attempt identity, and supplies bounded summaries with URLs, uncertainty and explicit missing-result warnings as untrusted data. Result references alone are not findings; workers never read protected result paths directly. Collaboration snapshots are passed to execution rather than merely persisted.
- A coordination subagent's `partial` result is an execution failure, eligible for bounded retry. Only a `success` result completes a worker and contributes to a successful aggregate.
- Graph strategy is inferred from dependency shape (`>=2` dependency-free roots → `hybrid`, else `sequential`), never from a model-supplied `strategy` label.
- Coordination workers are ordered by `serializeOverlappingWriters`: any two writers whose ownership claims overlap (a vague `**` claim overlaps all) get a dependency edge; disjoint writers and read-only workers stay parallel.
- Planned worker spawn and task-assignment events carry copied dependency IDs; dependency-bearing assignments explicitly publish dependency-waiting state.
- Coordination plans publish queued/dependency-waiting canonical `agent.*` lifecycle rows before dispatch. Retry-attempt results are non-terminal presentation facts; only scheduler exhaustion/completion publishes terminal worker state, and dependency failure publishes an explicit blocked state.
- Write workers reserve their final two model iterations for mutation/completion tools while owned outputs remain unwritten, preventing broad reconnaissance from consuming the entire bounded iteration budget.
- `--enforce-capabilities` enables two-layer gate (CapabilityResolver + RuntimeGate).
- **The collaboration ledger is authoritative (R2.16); `state.json` is a
  compatibility projection.** `mutate` (per-run lock) appends
  `collaboration.state_created`/`state_updated` (full `CollaborationState`)
  BEFORE the file write — the append IS the commit (counted, then thrown;
  the in-memory revision bump is discarded on the next `loadState`, so no
  JSON-only state can exist); `saveState` failures are tolerated and counted
  as `projectionFailures` in `collaborationLedgerStatus(cwd)`. `loadState`
  reads the ledger first (`lastEvent("collab:<runId>",
  "collaborationState")`; file only for legacy zero-fact states; ledger db
  errors count and throw). The ledger entity id is namespaced
  `collab:<runId>` — `runtime_entities` keys by entity_id alone and the raw
  runId belongs to the coordination domain. Reconciled as a section of
  `alix coordination reconcile`.
- **Ledger reconcilers are scoped by entityType.** All seven domain
  reconcilers (`coordination`/`collaboration`/`approvals`/`continuations`/
  `execution`/`graphs`/`daemonTasks`) drain only their own entity types, and
  `CoordinationStore.loadFromLedger` reads `lastEvent(runId, "coordinationRun")`
  — multi-domain ledgers share one workspace file, so unscoped reads mix
  domains (false orphans, wrong payload errors).
- `graph-projection.ts` returns `GraphRunProjection` with node status, timestamps, attempts.
- **The graph ledger is authoritative (R2.13); JSON files are a
  compatibility projection.** `mirrorGraphToLedger`/
  `mirrorGraphAttemptToLedger` append BEFORE each graph-file write — the
  append IS the commit (counted, then THROWN; no JSON-only mutation);
  projection writes are tolerated and counted via
  `countGraphProjectionFailure`. Sites: `persistGraph` (planner),
  `rerunNode` graph+attempt (executor), `markRunGraphCancelled` (resume,
  still best-effort at the call site — append failures counted in
  `graphLedgerStatus()` before the throw is absorbed). `loadGraph` reads
  the ledger first (`lastEvent(graphId, "graph")`, file only for legacy
  zero-fact graphs; ledger errors throw).
- All graph definitions persist to `.alix/graphs/<graphId>.json`.
- Rerun attempts append to `.alix/graphs/<graphId>.runs.json`.
- Terminal worker status patches (`completed`/`failed`/`pending` from `executeWorker`) go through bounded `patchWorkerWithRetry` (5 attempts, 50/100/200/400ms); `updateRun` retries transient in-lock loads via `loadWithRetry` (3×, 25/50ms) and all atomic writes go through `writeAtomic` (tmp+rename with EPERM/EACCES/EBUSY rename retry). A silent null from a transient read (e.g. Windows Defender EBUSY) must not orphan a worker as `running` and idle-stop `runUntilIdle`.
- Terminal execution status is separate from aggregate generation, outcome,
  and verification. `deriveCoordinationCompletion` derives these dimensions.
  Production schedulers must use `createCoordinationScheduler`, which injects
  `CoordinationCompletionService`; direct scheduler construction in source is
  a wiring defect. Test-only omission is explicit.
- **One completion-service assembly (R3.5).** `createCompletionService`
  (`coordination-completion-service.ts`) is the ONLY place a
  `CoordinationCompletionService` is constructed; the scheduler factory, the
  `alix_coordination_results` tool, and the `alix coordination` CLI all build
  through it (a construction-wiring test fails on a stray `new`). Idempotency
  itself lives at the store/lock boundary (`attachAggregateIfUnfinalized` +
  `CoordinationFinalizationLock`), pinned by
  `tests/kernel/coordination-finalization.test.ts` — a double finalize emits
  exactly one aggregate event.
- `maybeFinalizeRun` is idempotent at the store boundary.
  `CoordinationStore.attachAggregateIfUnfinalized` checks and attaches under
  the per-run lock and source fingerprint. Concurrent finalizers return the
  same winning aggregate and emit one completed-aggregate event. A changed
  replan fingerprint permits new finalization. `runUntilIdle` awaits
  finalization on completed/failed termination, and
  `CoordinationCompletionService.finalize` awaits the
  `coordination.aggregate.completed` append, so verification evidence is
  durable before a blocking driver returns; tick and worker paths stay
  fire-and-forget.
- Aggregation failure emits independent evidence without changing execution
  status. Verification derives from persisted fields and the matching aggregate
  event across loop, tools, view, collaboration context, and CLI; no stored
  verified flag or session-terminal prerequisite is allowed. The session gate
  yields `completed_unverified` for missing evidence.
- `deriveCoordinationEvidence` takes file.created/file.deleted/patch.changed_files
  events and worker-reported mutation paths; worker status and ownership grants
  are not evidence. Keep
  artifacts in `artifactEvidence` unless the caller asserts their contract
  proves creation/modification. Normalize and containment-check every candidate
  through `WorkspacePathResolver`; reject glob/scope/outside paths and return
  a sorted deduplicated list. Writes count even when the worker later fails.
- Aggregation failure persists source fingerprint, timestamp, and reason in
  `aggregationFailure` and emits `coordination.aggregate.failed` without
  changing run status. Only the current source's marker applies; successful
  attach clears that source's marker in the same locked write.
- Verification requires `matchesAttachedAggregateEvent` to match the run id,
  attached `aggregateResultRef`, and attached source fingerprint against a
  durable `coordination.aggregate.completed` event. Older events cannot verify
  replanned aggregates; an aggregate without its event remains unverified.

## Work Guidance

- Before modifying `graph-executor.ts`, understand the full enforcement flow: CapabilityResolver → RuntimeGate → ApprovalStore → runTask.
- Projection data flows to the Inspector UI via `/api/graphs/{id}/projection`. Any new node fields must be added to `NodeRunInfo` in `graph-projection.ts`.

## Verification

- `tests/kernel/graph-executor.test.ts` — executor, sorting, enforcement, rerun
- `tests/kernel/graph-projection.test.ts` — projection reconstruction
- `tests/kernel/graph-planner.test.ts` — plan generation, cap normalize, repair retry
- `tests/kernel/graph-ledger-dualwrite.test.ts` — graph/attempt mirrors, cancel mirror, reconciliation drift (legacy/tamper/attempt both directions), ledger-failure tolerance
- `tests/kernel/collaboration-ledger-dualwrite.test.ts` — authority reads over tampered files, append-fail fail-closed, projection-failure tolerance, namespaced entity id, reconciliation drift (legacy/tamper)
- `tests/kernel/coordination-planner.test.ts` — workers, scopes, agentPool labels
- `tests/kernel/coordination-scheduler.test.ts` — dispatch, watchdog, heartbeats
- `tests/kernel/coordination-tools.test.ts` — chat handlers
- `tests/kernel/subagent-worker-executor.test.ts` — role map, parallel, cancel
- `tests/kernel/coordination-scheduler-replan.test.ts` — mid-execution replanning; waits on settled state (`waitUntil`), never a fixed sleep
- `tests/kernel/replan-proposal-store.test.ts` — proposal CRUD; timestamp assertions use the injected clock
- `tests/kernel/coordination-ledger-dualwrite.test.ts` — ledger-first authority (tampered projection ignored), append-failure fail-closed, projection-failure tolerance, legacy fallback, reconciliation drift (status/worker/missing/stale/unknown-type), delete semantics

## Child DOX Index

None.
