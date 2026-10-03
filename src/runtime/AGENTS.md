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

**Backends aggregated (7 sources):**
1. `audit/audit.jsonl` — policy/runtime audit events
2. `governance/governance-audit-events.jsonl` — governance audit events (via `readGovernanceAudit`; user-scoped Inspector auth audit stays out of the project index)
3. `approvals/approvals.json` — approval lifecycle
4. `graphs/*.json` — graph + per-node events
5. `graphs/*.runs.json` — rerun attempts
6. `sessions/*/events.jsonl` — allowlisted session events (16 types)
7. `daemon-tasks.json` — daemon task lifecycle

## Local Contracts

- No new storage — all data read from existing backends at query time.
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
| `src/runtime/execution-state/AGENTS.md` | ExecutionState contract, projector, store |
| `src/runtime/state/AGENTS.md` | Governed patch-only transition harness — StateTransitionProposal → 10-gate → events → ExecutionState |
| `src/runtime/context/AGENTS.md` | State-aware prompt builder P+Σ+O+E+Tools, bounded tiers |
