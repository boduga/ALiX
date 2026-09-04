# DOX — Runtime (Execution State, Context, Index)

**Purpose:** Runtime substrate — execution-state projection, state-aware prompt context, and unified event index. On-demand, read-only aggregation plus bounded decision context for long-horizon execution.

**Ownership:**
- `runtime-index.ts` — RuntimeIndexEvent type, buildRuntimeIndex(), query filters (byGraph, bySession, byApproval, byAction).
- CLI commands in `src/cli.ts` — `alix runtime {events|timeline}`.
- Inspector Runtime tab renders from `GET /api/runtime/events`.
- `execution-state/` — ExecutionState contract, projector, store (see `execution-state/AGENTS.md`).
- `state/` — Governed patch-only transition harness (see `state/AGENTS.md`).
- `context/` — State-aware prompt builder P+Σ+O+E+Tools (see `context/AGENTS.md`).
- `tool-scheduler.ts` — T4 concurrency-aware ToolExecutionPolicy {allowParallel, maxParallel:4} + authoritative ToolConcurrency safe/exclusive (fail-closed unknown→serial), effectiveParallel=model&&harness&&safe, Promise.all chunked scheduler.
- `tool-correlation.ts` — T5 result correlation wiring: hierarchy executionId → invocationId → toolCallId, every parallel result retains all three so call_1 → result_1 never ambiguous; events carry hierarchy, messages retain correlation, next model turn receives full array (tracer bullet #636).

**Backends aggregated (6 sources):**
1. `audit/audit.jsonl` — policy/runtime audit events
2. `approvals/approvals.json` — approval lifecycle
3. `graphs/*.json` — graph + per-node events
4. `graphs/*.runs.json` — rerun attempts
5. `sessions/*/events.jsonl` — allowlisted session events (16 types)
6. `daemon-tasks.json` — daemon task lifecycle

**Local Contracts:**
- No new storage — all data read from existing backends at query time.
- Sorted newest-first by default; `order=asc` reverses.
- Session events use an allowlist to filter out noisy event types.
- Silent failure on unreadable/missing backends (never crashes).

**Work Guidance:**
- Adding a new source means adding a new block in `buildRuntimeIndex()` and adding the source string to the `RuntimeIndexEvent.source` union type.
- The API supports `?graphId=`, `?sessionId=`, `?approvalId=`, `?action=`, `?limit=`, `?order=` query params.

**Verification:**
- `tests/runtime/runtime-index.test.ts` — empty index, audit, approvals, graphs, runs, sessions, merge, sort, filters (9 tests).
- `tests/runtime/tool-scheduler.vitest.ts` — T4 policy/scheduler: safe+safe→parallel overlap proof, exclusive/unknown/model-false→serial, maxParallel chunking, independent governance (19 tests).
- T5 proof — ad-hoc `/tmp/t5-proof.mjs` + `/tmp/t5-proof-fail.mjs`: same invocation → 2 toolCalls → executionId/invocationId/toolCallId in every tool.* event, overlapping started→completed (A.start < B.end && B.start < A.end) and distinct success/failure messages both returned to next turn via correlated `<tool_result id invocationId executionId>` (see events.jsonl payload proof above).

**Child DOX Index:**

| Path | Scope |
|------|-------|
| `src/runtime/execution-state/AGENTS.md` | ExecutionState contract, projector, store |
| `src/runtime/state/AGENTS.md` | Governed patch-only transition harness — StateTransitionProposal → 10-gate → events → ExecutionState |
| `src/runtime/context/AGENTS.md` | State-aware prompt builder P+Σ+O+E+Tools, bounded tiers |
