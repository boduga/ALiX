# DOX — RuntimeIndex (Unified Event Index)

**Purpose:** On-demand, read-only aggregation across all ALiX storage backends into a single queryable event list.

**Ownership:**
- `runtime-index.ts` — RuntimeIndexEvent type, buildRuntimeIndex(), query filters (byGraph, bySession, byApproval, byAction).
- CLI commands in `src/cli.ts` — `alix runtime {events|timeline}`.
- Inspector Runtime tab renders from `GET /api/runtime/events`.

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
