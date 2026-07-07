# P14.8 — Audit Inspection CLI Polish

**Date:** 2026-07-07
**Status:** Plan
**Depends on:** P14.5b (Audit CLI / Export / Redaction), P14.7 (coverage closure)
**Spec:** `docs/architecture/specs/2026-07-07-p14-8-audit-cli-polish.md`

## Overview

Narrow, additive polish to the existing `alix governance audit` CLI. Five improvements: configurable limit + new filters on `list`, a new `timeline` subcommand, `show --related` correlation, bare-`audit` help, and metadata pretty-print. No new intelligence, no new query-engine module.

**All changes are in `src/cli/commands/governance.ts` + one new test file.** No `src/governance/*` edits.

## Exact semantics (added during refinement — unambiguous implementation/review)

**Filters (all case-sensitive exact match, consistent with existing P14.5b filters like `queryByActor`):**

| Flag | Match rule |
|------|-----------|
| `--event-type <t>` | `event.eventType === t` |
| `--subject <s>` | `event.subjectId === s` **OR** `event.subjectType === s` (matches either the id or the type) |
| `--risk <r>` | `event.riskLevel === r` |
| `--limit N` | positive integer; **default 50**; **reject** `0`, negative, or non-numeric with a clear error |

Invalid `--event-type`/`--subject`/`--risk` values (not in the corresponding `VALID_*` set from `audit-types.js`) print a clear error listing valid values. `--subject` accepts both a subjectType and a literal subjectId, so it is not validated against a fixed set — it filters and may yield zero results.

**`show --related` — deterministic correlation order:**

1. Same `traceId` (when the event has one)
2. Same `sessionId` (when the event has one)
3. Parent/child via `parentEventId` (event is the parent OR the child)
4. **De-duplicated by `eventId`**
5. **Chronological order** (oldest→newest)
6. **Exclude the currently shown event**

Presentation-only; no fuzzy matching, no scoring.

**`timeline` human output — intentionally compact (single line per event):**

```
<timestamp>  <eventType>  <actorType>:<actorId>  <subjectType>:<subjectId>  <decision/traceId>
```

**JSON contract:** `--json` returns the **event objects** (or a stable, documented projection) — never a stringified human display. `timeline --json` → chronological array of events; `show --json` (with `--related`) → `{ ...event, related: [...] }`.

## Implementation order

1. Bare `audit` help
2. `list --limit` + filters
3. `show` metadata pretty-print
4. `show --related`
5. `audit timeline`
6. Tests

(`show --related` is the highest-risk item — keep it strictly deterministic per the ordering above.)

## Pre-implementation (CLAUDE.md gate)

Before editing any handler, run `gitnexus_impact({target: "<handlerName>", direction: "upstream"})` for: `runAuditList`, `runAuditShow`, and the `audit` dispatch branch. Report blast radius; proceed only if not HIGH/CRITICAL (expected LOW — these are leaf CLI handlers).

## Tasks

### Task 1 — `list --limit` + new filters

**File:** `src/cli/commands/governance.ts` → `runAuditList` (~line 2405)

- Parse `--limit N` (default 50). Replace the hardcoded `events.slice(0, 50)` and the "... and N more" counter to use the limit.
- Add inline filters (no new module):
  - `--event-type <type>` → `events = events.filter(e => e.eventType === type)`
  - `--subject <type>` → `events = events.filter(e => e.subjectType === type)`
  - `--risk <level>` → `events = events.filter(e => e.riskLevel === level)`
- Apply filters after existing filters, before slicing.
- Validation: if `--event-type`/`--subject`/`--risk` value is invalid, print a clear error listing valid values (reuse `VALID_EVENT_TYPES` / `VALID_SUBJECT_TYPES` / `VALID_RISK_LEVELS` from `audit-types.js`).

### Task 2 — `audit timeline` subcommand

**File:** `src/cli/commands/governance.ts`

- Add `"timeline"` to the dispatch switch (~line 2379) → `runAuditTimeline(cwd, args, jsonMode)`.
- New `runAuditTimeline`:
  - `const events = await new FileAuditStore(cwd).listChronological()` (oldest→newest).
  - Optional `--trace <id>` / `--actor-id <id>` / `--limit N` (reuse existing `queryByTraceId` / actor filter).
  - Human output: one compact line per event — `TIME  TYPE  DECISION  actorType/actorId  subjectId  eventId` (color via existing `eventTypeColor`). Group-break on traceId change when `--trace` absent? Keep simple: chronological flat list.
  - `--json`: emit the chronological array.

### Task 3 — `show --related`

**File:** `src/cli/commands/governance.ts` → `runAuditShow` (~line 2488)

- Parse `--related` flag.
- After the existing detail block, if `--related` AND the event has `traceId`/`sessionId`/`parentEventId`: query correlated events (exclude the event itself), print a compact "Related events (N)" list (reuse the list-line formatter). `--json` includes a `related: [...]` field.

### Task 4 — Bare `audit` help + metadata pretty-print

**File:** `src/cli/commands/governance.ts`

- (a) In the audit dispatch, when `sub` is undefined/empty (no subcommand), print a help block: subcommand list (`list`, `show`, `timeline`, `trace`, `actor`, `policy`, `verify`, `export`) + 2–3 example invocations. Do not `process.exit(1)` harshly — exit 0 for explicit help.
- (b) In `runAuditShow`, replace `JSON.stringify(event.metadata)` (single line) with an indented key:value render (one line per metadata key), falling back to JSON for nested objects/arrays.

### Task 5 — Tests

**File:** `tests/cli/audit-cli-polish.test.ts` (new)

Seed a `FileAuditStore` in a temp dir with a handful of known events (varying eventType/subject/risk/trace). Assert:

| # | Test | What it proves |
|---|------|----------------|
| 1 | `runAuditList --limit 2` slices to 2 | Limit honored |
| 2 | `runAuditList --event-type action_escalated` filters | eventType filter |
| 3 | `runAuditList --subject proposal` filters | subject filter |
| 4 | `runAuditList --risk high` filters | risk filter |
| 5 | `runAuditList --event-type bogus` errors with valid list | Validation |
| 6 | `runAuditTimeline` outputs chronological order | Oldest→newest |
| 7 | `runAuditTimeline --trace X` groups by trace | Trace grouping |
| 8 | `runAuditShow --related` lists correlated events | Correlation |
| 9 | Bare audit dispatch prints help (no crash) | Help path |

**Note on test approach:** the audit handlers write to stdout and call `process.exit`. Tests should either (a) invoke the underlying query/format logic directly where it's been factored out, or (b) capture stdout via a child process / `util.styleText`-free spy. Prefer factoring small pure format helpers (`formatTimelineLine`, `formatMetadata`) so they're unit-testable without spawning the CLI. If a handler can't be cleanly unit-tested, document that and test via `npx tsx` subprocess + stdout capture for 1–2 representative cases.

## Estimated additions

| File | Lines | Change type |
|------|-------|-------------|
| `src/cli/commands/governance.ts` | ~120 | Extend (list/show/dispatch) + new `runAuditTimeline` |
| `tests/cli/audit-cli-polish.test.ts` | ~220 | New |
| **Total new** | ~340 | |

## Dependencies

- `src/governance/audit-store.ts` — `list`, `listChronological`, `getById`
- `src/governance/audit-query.js` — `queryByTraceId`, `queryByActor` (reused)
- `src/governance/audit-types.js` — `VALID_EVENT_TYPES`, `VALID_SUBJECT_TYPES`, `VALID_RISK_LEVELS`

## Acceptance gate

P14.8 is complete when:
1. `list` honors `--limit` and supports `--event-type`/`--subject`/`--risk` with validation
2. `audit timeline` renders chronological output (+`--trace`, `--json`)
3. `show --related` lists correlated events (+`--json` includes `related`)
4. Bare `audit` prints help; `show` metadata is pretty-printed
5. All new output paths support `--json`
6. No existing subcommand flag/output regresses (additive only)
7. New tests pass; full governance + CLI suites green
8. TypeScript clean
9. GitNexus impact per-handler = LOW; `detect_changes` = LOW risk, 0 affected processes
10. No `src/governance/*` files changed (audit trail read-only under P14.8)
