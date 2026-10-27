# LEAN-01 — Source-of-truth inventory (static call-site evidence)

Revision: `d412ea15` (dirty worktree). This is a bounded inventory of runtime-ledger owners; it does not establish that no other persistent authorities exist. No gate promotion is implied.

| Entity / state | Source owner | Durable authority | Projection / read surface | Qualification |
|---|---|---|---|---|
| Coordination run and embedded workers | `src/coordination/kernel/coordination-store.ts` | `coordinationRun` ledger events | `.alix/coordination/*.json` compatibility projection | Ledger-first, conditional worker claim implemented locally; inspect all callers |
| Collaboration state | `src/coordination/kernel/collaboration-store.ts` | `collaborationState` ledger events | Collaboration state loader | Writer confirmed |
| Graph / graph attempt | `src/coordination/kernel/graph-ledger.ts` | `graph` / `graphAttempt` ledger events | Graph executor | Writer confirmed |
| Approvals and execution claims | `src/governance/approvals/approval-store.ts` | `approval` ledger events | ApprovalStore projection and event telemetry | Claim/consume path tested; caller authorization still open |
| Daemon task registry | `src/operations/daemon/task-registry.ts` | `daemonTask` ledger events | Global daemon task registry | Global HOME isolation required |
| Continuations | `src/runtime-state/runtime/continuation-store.ts` | `continuation` ledger events | ContinuationManager | Writer confirmed |
| Execution evidence | `src/runtime-state/runtime/execution-evidence-store.ts` | `executionEvidence` ledger events | Evidence emitter/recovery | Emitter can swallow append failure; not an effect claim barrier |
| Execution state | `src/runtime-state/runtime/execution-state/execution-state-store.ts` | `execution` ledger events | Execution-state store | Writer confirmed |
| Replay status | `src/runtime-state/runtime/replay-status-index.ts` | `replay` ledger events | Replay status index | Writer confirmed |
| Remote decision audit | `src/governance/audit/remote-decision-projection.ts` | Reads ledger events | Remote decision projection | Read-only in inspected file |
| Tool logical operations (experimental) | `src/runtime-state/runtime/tool-operation-authority.ts` | `toolOperation` ledger events | Direct authority read | Untracked prototype; NOT wired to executor or approved for production |
| Capability catalog and mutation | `src/capabilities/capability/platform.ts` and registry/mutation port | Catalog plus separate CAP-6 executor; full durability unverified | Capability registry | Bootstrap mutation vs governed mutation boundary unresolved |
| Routing and decisions | `src/runtime-state/runtime/task-router.ts` | Execution route selection, not a durable operation claim | CLI/daemon route consumers | Lifecycle parity unresolved |

## Known periodic work (source-level, not measured)

- Coordination scheduler: polling ~1 s, heartbeat ~15 s, lease renewal ~300 s (`coordination-scheduler-service.ts`).
- Approval watcher: periodic scan (~30 s configured default).
- Scheduled tasks: `daemon-server.ts` 60 s interval.
- Global daemon status heartbeat: `daemon-server.ts` 30 s read/atomic rename of `daemon.json`.
- Runtime retry-controller: timeout and interval are conditional to retry activity; do not count as idle without runtime evidence.

## G01 remaining evidence

- Enumerate all non-ledger mutable authorities (filesystem, config, caches, SQLite, sessions, external providers), with writer and recovery ownership.
- Trace all CLI/TUI/API/daemon/automation entrypoints through policy, dispatch, persistence, cancellation, and restart.
- Isolated pinned workload with live event, timer/wakeup, disk write, token/model and latency rates; repeatable cold/warm runs.
- Independent gate reviewer and immutable evidence references. Unknowns must stay visible; the gate is BLOCKED.

## Non-ledger state and event-channel candidates

- `src/runtime-state/runtime/execution-governor.ts` explicitly describes its `events`, `sessions`, and `heartbeats` Maps as an in-memory implementation replaceable with a database-backed `ExecutionGovernor`. The governor's in-memory state is **not proven durable** across process restart. Distinguish it from the durable `ExecutionStateStore` and `ApprovalStore`.
- `src/interfaces/tui/runtime/context-projection.ts` maintains created/changed/deleted file sets and tool-name maps. Treat as a UI projection pending confirmation of its reconstruction source.
- `src/runtime-state/runtime/runtime-builder.ts` and `src/operations/daemon/daemon-server.ts` construct session `EventLog` instances. Session logs and runtime-ledger events are distinct channels; establish their ordering, failure and replay contracts.
- `src/interfaces/cli/commands/governance-lineage.ts` creates a governance evidence store under `.alix/governance`. Confirm project/root scoping and source-of-truth relationship.
- `src/interfaces/tui/capabilities/capability-service.ts` can construct a temporary EventLog; determine whether this is test/UI telemetry or durable audit evidence.

These are source-backed candidates, not proof of defects.

## Governor lifecycle source trace

`src/runtime-state/runtime/governed-route-executor.ts` constructs a **new** `ExecutionGovernorImpl` for each `executeRouteGoverned` invocation (unless `governorFactory` injected), pre-seeded with one `CREATED` event. It then authors an `APPROVED` event with an explicit `auto-approved: low-risk route kind` reason, validates, authorizes, starts, and completes the route. This is a per-invocation in-memory governor, **not** a durable approval record by itself. Verify which route kinds can reach this wrapper, their independent lower-level policy gates, and how governor events are persisted via evidence emitter. Do not infer an approval bypass from the existence of auto-approval without the lower-level authorization trace.

## Confirmed daemon-vs-session lifecycle split

`src/operations/daemon/daemon-server.ts:491-508` sends every non-agent route directly to `executeRoute(route, runtimeCtx, daemonExecutor)`, then updates the task registry and ends the session. It loads a project `ApprovalStore` and passes it into runtime context. By contrast, `src/agents/agent/session/turn.ts:385` calls `executeRouteGoverned` for its routed turn and attaches a fire-and-forget `PersistenceEvidenceEmitter`. Therefore the daemon non-agent branch **does not pass through the `executeRouteGoverned` wrapper**. This is a confirmed outer lifecycle/evidence difference, **not** proof that daemon route tools skip `PolicyGate` or `ApprovalStore`; both branches may share lower-level tool authorization. LEAN-G01 needs a route-by-route transition/evidence matrix and authorization tests before judging parity.

## HIGH PRIORITY: daemon adapter drops approval-store dependency (static trace)

`daemon-server.ts` loads `daemonApprovalStore` and places it in `runtimeCtx.approvalStore` for the non-agent route. However, `DaemonRuntimeExecutor.executeTool(route, _ctx)` ignores that context and calls `executeToolBehavior` with `{eventLog,cwd,renderApprovalPrompt:false,signal}` **without `approvalStore`** (`daemon-runtime-executor.ts:107-115`). `executeToolBehavior` builds the executor via `makeToolExecutor`, which passes `deps.approvalStore` to `createToolExecutor` (`route-execution.ts:352-357`). The local adapter **does** forward `ctx.approvalStore` (`route-executor.ts:135-139`). The daemon grounded-chat adapter similarly omits approvalStore in its dependency object.

**Confirmed dependency-propagation divergence; security effect unverified.** It may cause ask-mode to fail closed, or trigger a different store/default path depending on ToolExecutor/PolicyGate composition. Do not call it a proven approval bypass. Required follow-up: inspect `createToolExecutor` and policyGate default, then write a negative daemon-adapter contract test using a denied/ask-mode mutation, asserting no tool side effect and expected pending approval behavior. Do not fix production code during read-only LEAN-01.

## Approval-store missing outcome confirmed

`createToolExecutor` forwards the optional `approvalStore` without synthesizing a replacement (`src/capabilities/tools/tool-executor-factory.ts`). `ToolExecutor.policyGate()` passes its instance store directly to `PolicyGate`. For an `ask` decision, `PolicyGate` with no store returns **deny**, reason `Approval required but no approval store configured`, except explicitly headless-safe `web.search`, `web.fetch`, and `task.complete`. Consequently the daemon adapter omission is a **confirmed inability to create an approval request through this path**, rather than evidence of an approval bypass for state-changing ask-mode calls. It may also cause the client to receive a terminal denial instead of an actionable pending approval. This conclusion is static-path-specific and needs an integration test to rule out alternate dispatch paths or config-dependent allowances.

**Proposed post-G01 fix:** forward `ctx.approvalStore` through both daemon tool and grounded-chat adapter calls; add parity tests for `ask` and `deny`, and preserve explicit headless-safe read behavior. LEAN-01 remains read-only.

## Additional non-ledger persistent authorities — 2026-10-25

| State | Writer / owner | Location and durability | Restart/recovery qualification |
|---|---|---|---|
| Scheduled task definitions | `src/operations/schedule/scheduled-task-store.ts` `ScheduledTaskStore` | `ALIX_SCHEDULED_TASKS_PATH` override or `~/.alix/scheduled-tasks.json`; `writeJsonFileAtomic`; serialized in-process save promise | `load()` falls back to empty on read/parse failure; queued save failures are logged and swallowed. Assess operator visibility, concurrent-process writer behavior and durability separately from daemonTask ledger. |
| Kernel SQLite primitives | `src/operations/db/manager.ts` `DatabaseManager` | Default `~/.alix/alix.db`, `better-sqlite3` with WAL and foreign keys | Separate DB from runtime ledger. Inspect consumers/migrations and whether any runtime authority depends on it. |
| Session event history | `src/runtime-state/events/event-log.ts` `EventLog` | `<sessionDir>/events.jsonl`; runtime builder uses `<root>/.alix/sessions/<sessionId>` | Append-only lock/resync logic; session event stream distinct from runtime entity ledger. Ordering/replay guarantees across channels unverified. |
| File-backed generic cache | `src/operations/utils/cache-manager.ts` `PersistentCacheManager` | Caller-provided directory, encoded key `.cache` files; synchronous writes | Write errors ignored by design; optional cache, not a verified authority. Enumerate construction sites and invalidation semantics. |
| Ephemeral generic cache | `src/operations/utils/cache-manager.ts` `InMemoryCacheManager` | Process-local Map | No restart durability expected. |
| Runtime SQLite entity ledger | `src/runtime-state/storage/runtime-ledger.ts` | `better-sqlite3`, WAL, `synchronous=FULL` verified at open | Distinct from kernel DB and session EventLog; entity authority depends on each registered writer. |

**Open:** inventory config writers, model/provider credentials, embedding caches, MCP schema caches, and project-level projections. Verify actual constructor usage and filesystem root resolution before calling any of these active authorities. Source inspection only; no controlled benchmark or independent gate review.

## Config, credentials, and cache qualification — 2026-10-25

| State | Source-backed location / consumer | Classification | Remaining verification |
|---|---|---|---|
| User and project configuration | `src/operations/config/loader.ts`: `~/.config/alix/config.json`, `<cwd>/.alix/config.json`; project overrides user. `tui.ts:90` and `daemon-server.ts:72,437,523` invoke `loadConfig`. | Mutable operational configuration; not a runtime execution ledger | Check effective config snapshots, trust mode at each composition root, hot reload and failure behavior. |
| Configuration mutation provenance | `src/operations/config/mutation.ts`: `ConfigMutationService` writes config and bounded provenance via temp file + rename with restrictive file modes. | Mutable configuration and change history | Verify provenance path, crash durability and consistency across config/provenance writes; check other writers. |
| API credentials | `src/operations/config/loader.ts`: `cred://` references resolved via credential store/keychain selection; resolved keys can be inherited from trusted parent over private IPC; API keys also loaded from user/project config and injected into environment. | Sensitive security authority, not cache | Review actual backend, plaintext compatibility, environment exposure, keychain failure, and worker IPC boundary without displaying secret values. |
| Semantic/code embeddings | `src/context/repomap/embedding-cache.ts`: `<root>/.alix/embeddings/<config.label>/<hash>.json`, SHA-256 text-derived key (truncated to 16 hex characters); `context-compiler.ts:53-54` constructs semantic and code caches. | Derived persistent cache | Model/config change invalidation, collision and stale cache semantics; save failures warn and do not block inference. |
| MCP schema cache | `src/capabilities/mcp/tool-cache.ts`: `SchemaCache` uses process-local Map and access-order array, optional TTL/max size; `meta-tool.ts` accepts an optional schemaCache interface. | Ephemeral derived metadata | No `new SchemaCache(...)` construction was found in the inspected `src` search; determine whether injected by external/bootstrap caller before treating as active. |
| Kernel SQLite consumer | `src/interfaces/cli/commands/metrics-db-memory.ts:104` constructs `DatabaseManager`. | Separate SQLite subsystem | Confirm whether any other consumer relies on it for active coordination state; none established in this pass. |

**Qualification:** source-level only, no credentials opened or copied, no benchmark run. Do not infer that `cred://` storage is encrypted without inspecting the selected backend. The earlier remote safety block was not bypassed; subsequent normal, narrower source-inspection commands were permitted. LEAN-G01 remains BLOCKED.
