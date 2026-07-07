# P14.8 — Audit Inspection CLI Polish

**Date:** 2026-07-07
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.5b (Audit CLI / Export / Redaction), P14.7 (coverage closure)

## Purpose

The P14 audit spine (P14.5a → P14.7) is functionally complete: tamper-evident storage, decorated single-emission boundary, and a feature-rich inspection CLI. P14.8 is a **narrow operator-facing polish slice** — it improves the ergonomics and readability of the *existing* audit CLI without adding governance intelligence or a new analysis engine.

This is the last slice before the P14 → P15 phase boundary.

## Current audit CLI surface (P14.5b, already shipped)

`alix governance audit <subcommand>` in `src/cli/commands/governance.ts`:

| Subcommand | Status | Notes |
|------------|--------|-------|
| `list` | ✅ | Filters: `--decision`, `--actor-type`, `--actor-id`, `--policy`, `--trace`, `--from`, `--to`. Output **hardcoded to first 50** with "... and N more". |
| `show <event-id>` | ✅ | Full event detail. Metadata printed as single-line `JSON.stringify`. |
| `trace <trace-id>` | ✅ | Events for a trace. |
| `actor`, `policy` | ✅ | Filtered views. |
| `verify` | ✅ | Hash-chain verification. |
| `export` | ✅ | File export (separate handler). |

## Polish scope (P14.8)

Five narrow, additive improvements. **No new query-engine module, no analysis, no new event types.**

| # | Improvement | Where | What changes |
|---|-------------|-------|--------------|
| 1 | `list --limit N` | `runAuditList` | Replace hardcoded magic `50` with a configurable limit (default 50). |
| 2 | `list --event-type`, `--subject`, `--risk` filters | `runAuditList` | Inline `.filter()` on existing event fields (no new helper module). |
| 3 | `audit timeline` (new subcommand) | new `runAuditTimeline` | Compact chronological one-line-per-event view (oldest→newest via `listChronological`), optional `--trace`/`--actor-id` grouping. Presentation only. |
| 4 | `show --related` | `runAuditShow` | After the detail view, list correlated events sharing `traceId`/`sessionId`/`parentEventId` (reuses `queryByTraceId` etc.). |
| 5 | Bare `audit` help + metadata pretty-print | dispatch + `runAuditShow` | (a) `audit` with no subcommand prints subcommand list + examples; (b) `show` metadata rendered as indented key:value instead of one-line JSON. |

## Non-goals

- No new governance intelligence / analysis engine
- No new query functions exported from `audit-query.js` (inline filters only)
- No new audit event types
- No changes to GovernanceAuditEvent core types
- No changes to decorators, stores, or emission behavior
- No changes to export/redaction behavior (P14.5b is final)
- No new CLI commands outside the `audit` subtree
- No P15 concerns (trends, anomaly detection, effectiveness joins)

## Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Extend `runAuditList`, `runAuditShow`; add `runAuditTimeline`; add bare-`audit` help in dispatch |
| `tests/cli/audit-cli-polish.test.ts` | New: assertion tests for new flags, timeline output, `--related`, help text |

No changes to `src/governance/*` (query helpers, stores, types, decorators all unchanged).

## Dependencies

- `src/governance/audit-store.ts` — `FileAuditStore.list()` / `listChronological()` / `getById()`
- `src/governance/audit-query.js` — existing `queryByTraceId`, `queryByActor`, etc. (reused, not extended)
- `src/cli/commands/governance.ts` — audit handlers + dispatch

## Invariants preserved

- Audit trail is read-only under P14.8 (no writes, no audit emission)
- All new output paths support `--json` (machine-readable) alongside human-readable
- Existing subcommands keep their current flags and output (additive only)
- CLAUDE.md: GitNexus impact analysis run per-handler before edit; `detect_changes` before commit
