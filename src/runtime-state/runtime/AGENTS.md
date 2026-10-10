# DOX — Runtime (Execution State, Context, Index)

## Purpose

Runtime substrate — execution-state projection, state-aware prompt context, and unified event index. On-demand, read-only aggregation plus bounded decision context for long-horizon execution.

## Ownership

- `runtime-index.ts` — RuntimeIndexEvent type, buildRuntimeIndex(), query filters (byGraph, bySession, byApproval, byAction).
- CLI commands in `src/cli.ts` — `alix runtime {events|timeline}`.
- Inspector Runtime tab renders from `GET /api/runtime/events`.
- `execution-state/` — ExecutionState contract, projector, store (see `execution-state/AGENTS.md`).
- `state/` — Governed patch-only transition harness (see `state/AGENTS.md`).
- `context/` — State-aware prompt builder P+Σ+O+E+Tools (see `context/AGENTS.md`).
- `tool-scheduler.ts` — Concurrency-aware ToolExecutionPolicy {allowParallel, maxParallel:4} + authoritative ToolConcurrency safe/exclusive (fail-closed unknown→serial), effectiveParallel=model&&harness&&safe, Promise.all chunked scheduler.
- `tool-correlation.ts` — Result correlation: hierarchy executionId → invocationId → toolCallId, every parallel result retains all three so call_1 → result_1 never ambiguous; events carry hierarchy, messages retain correlation, next model turn receives full array.
- `continuation-store.ts` — PendingContinuation persistence (`.alix/approvals/continuations.json`), keyed by approvalId. R2.14: the ledger is AUTHORITATIVE — `load()` rebuilds from `readLatestByEntityType("continuation")` (tombstones suppress file copies; file covers legacy zero-fact records; ledger errors count and throw); `persist`/`remove` append `continuation.created`/`updated`/`removed` BEFORE the in-memory mutation and file write (append failure counts then throws — no JSON-only state, memory untouched); file writes are tolerated and counted as `projectionFailures` in `continuationLedgerStatus(cwd)`.
- `continuation-ledger-reconcile.ts` — read-only comparison of `continuations.json` vs ledger (argsHash/integrity fields compared; `missing_in_ledger` / `record_mismatch` / `projection_stale` / `projection_missing` / `version_behind` / `ledger_payload_invalid`); surfaced in the `alix approvals reconcile` output alongside approvals.
- `replay-status-index.ts` — **ledger authoritative (R2.17)**: `load()` rebuilds from `readLatestByEntityType("replay")` (file covers legacy zero-fact entries; ledger errors count and throw); `setStatus` appends `replay.status_created`/`status_updated` FIRST (throws on failure) then writes the index file (tolerated + counted as `projectionFailures` in `replayLedgerStatus(cwd)`).
- `execution-evidence-store.ts` — **ledger authoritative (R2.17)**: `append` appends `evidence.recorded` FIRST (throws on failure; EVERY physical append mirrors — duplicate evidenceIds are legal under the append-only contract, callers own deduplication) then writes JSONL (tolerated + counted); `list()` replays ALL ledger events in seq order (line-level duplicates preserved) merged with legacy JSONL records that have no ledger facts; ledger cwd derived by stripping a trailing `.alix/<x>` segment; ledger errors count and throw. Status: `evidenceLedgerStatus(cwd)`.
- `runtime-evidence-ledger-reconcile.ts` — read-only `reconcileReplayLedger` + `reconcileEvidenceLedger` (evidence reads BOTH production locations: `.alix/governance/execution-evidence.jsonl` and `<cwd>/execution-evidence.jsonl`); sections of `alix runtime reconcile-executions` (exit 1 on any drift).

**Backends aggregated (7 sources):**
1. `audit/audit.jsonl` — policy/runtime audit events
2. `governance/governance-audit-events.jsonl` — governance audit events (via `readGovernanceAudit`; user-scoped Inspector auth audit stays out of the project index)
3. `approvals/approvals.json` — approval lifecycle
4. `graphs/*.json` — graph + per-node events
5. `graphs/*.runs.json` — rerun attempts
6. `sessions/*/events.jsonl` — allowlisted session events (16 types)
7. `daemon-tasks.json` — daemon task lifecycle

## Local Contracts

- **Containment predicate is one function.** `relativeIsOutside(rel)` in
  `workspace-path.ts` is the single lexical check for a resolved
  `relative(root, target)` result (`rel === ".." || rel.startsWith("../") ||
  isAbsolute(rel)`); it backs `WorkspacePathResolver` and every resolved-path
  backstop (tool-router, file-tools, patch-engine, coordination). Never
  re-inline the `relative`+`startsWith` pattern. Raw-input sanitizers
  (`isTraversalSafe`, `isPathSafe`) validate unresolved strings and are their
  own heuristics — do not confuse them with this predicate.
- **The R2 transactional ledger is a storage authority, not a query-time
  backend.** Domains that flipped (execution-state R2.12, continuations
  R2.14, replay + evidence R2.17) read and write
  `<root>/.alix/runtime-ledger.db` through `src/runtime-state/storage/runtime-ledger.ts`;
  their JSON files are compatibility projections rebuilt from the ledger.
  The read-only runtime index still aggregates the seven file backends below.
- **Execution intents carry authorization provenance (R1.5).** `createExecutionIntent`
  tags source from the `AuthorizationSource` union
  (`src/runtime-state/contracts/authorized-execution-port.ts`): synthesized `auto:` approvals
  are `"system"`, caller-supplied approval references default `"policy"`, and
  `"operator"` is only ever passed explicitly — X-series self-approval can
  never be read as an operator decision. `verificationPassed` on governor
  evidence remains an outcome claim, never authorization.
- `ExecutionAuthorization` preserves an execution request's canonical `agentId` when delegating tool or capability decisions to `PolicyGate`; approval correlation must not substitute `workerId`.
- Sorted newest-first by default; `order=asc` reverses.
- Session events use an allowlist to filter out noisy event types.
- Silent failure on unreadable/missing backends (never crashes).
- Layer-3 route prompts: only the intents that actually reach a route carry dedicated text; misrouted intents (e.g. `workspace_mutation` on the chat/direct path) share one neutral read-only fallback and log a warning. Chat `workspace_*` intents are read-only because they route to `agent`, never `chat`.
- The grounded route offers manifest names and resolves model calls through `resolveExecutableToolName` before dispatch. `route.allowedTools` holds internal executor IDs; `tests/runtime/grounded-selection-observation.test.ts` checks the resolved dispatch identity.

## Work Guidance

- Adding a new source means adding a new block in `buildRuntimeIndex()` and adding the source string to the `RuntimeIndexEvent.source` union type.
- The API supports `?graphId=`, `?sessionId=`, `?approvalId=`, `?action=`, `?limit=`, `?order=` query params.

## Verification

- `tests/runtime/runtime-index.test.ts` — empty index, sources, merge, sort, filters.
- `tests/runtime/tool-scheduler.vitest.ts` — safe parallel overlap, exclusive/unknown/model-disabled serial execution, bounded chunking, independent governance.
- `tests/runtime/parallel-tool-execution.vitest.ts` — parallel calls retain execution, invocation, and tool-call correlation in events and model results.

## Child DOX Index

| Path | Scope |
|------|-------|
| `src/runtime-state/runtime/execution-state/AGENTS.md` | ExecutionState contract, projector, store |
| `src/runtime-state/runtime/state/AGENTS.md` | Governed patch-only transition harness — StateTransitionProposal → 10-gate → events → ExecutionState |
| `src/runtime-state/runtime/context/AGENTS.md` | State-aware prompt builder P+Σ+O+E+Tools, bounded tiers |
