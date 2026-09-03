# DOX — Runtime (Execution State, Context, Index)

**Purpose:** Runtime substrate — execution-state projection, state-aware prompt context, and unified event index. On-demand, read-only aggregation plus bounded decision context for long-horizon execution.

**Ownership:**
- `runtime-index.ts` — RuntimeIndexEvent type, buildRuntimeIndex(), query filters (byGraph, bySession, byApproval, byAction).
- CLI commands in `src/cli.ts` — `alix runtime {events|timeline}`.
- Inspector Runtime tab renders from `GET /api/runtime/events`.
- `execution-state/` — ExecutionState contract, projector, store (see `execution-state/AGENTS.md`).
- `state/` — Governed patch-only transition harness (see `state/AGENTS.md`).
- `context/` — State-aware prompt builder P+Σ+O+E+Tools (see `context/AGENTS.md`).

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

**Child DOX Index:**

| Path | Scope |
|------|-------|
| `src/runtime/execution-state/AGENTS.md` | ExecutionState contract, projector, store |
| `src/runtime/state/AGENTS.md` | Governed patch-only transition harness — StateTransitionProposal → 10-gate → events → ExecutionState |
| `src/runtime/context/AGENTS.md` | State-aware prompt builder P+Σ+O+E+Tools, bounded tiers |
