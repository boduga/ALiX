# P14.1 — Governance Signal Inbox Implementation Plan

**Date:** 2026-07-05
**Status:** Implemented — retrospective plan
**PR:** #230
**Tag:** `alix-p14-1-complete`
**Parent:** P14.0 — Governance Operator Workflow Design

## Objective

Implement the Governance Signal Inbox as the first executable P14 module. The inbox converts P13 advisory outputs into durable `GovernanceSignal` records that operators can later review in P14.2.

## Implementation Summary

P14.1 delivered:

- Governance signal type definitions
- Evidence reference type definitions
- Signal validation
- Append-only file-backed signal store
- Deduplication helpers
- Normalizers for P13.1 through P13.4
- Aggregate signal normalization helper
- CLI inbox listing
- CLI inbox refresh
- Tests covering validation, storage, deduplication, normalizers, and evidence invariants

## Tasks

### 1. Add Governance Signal Model

Create `src/governance/governance-signal.ts`. Define `GovernanceSignal`, `EvidenceRef`, `SignalStatus`, `SignalType`, `ValidationResult`.

### 2. Add Validation

`validateGovernanceSignal(entry)` — require all fields with correct types. Enforce non-empty `evidenceRefs` with per-field validation of `source`, `id`, `description`.

### 3. Add FileSignalStore

Append-only JSONL store at `governance-signals.jsonl`. Methods: `append`, `list`, `getById`, `query`. Validation on write; skip invalid rows on read.

### 4. Add Deduplication

`dedupKey(signal)` → `sourcePhase:signalType:title`. `isDuplicate(existing, candidate)` → only matches against `status === "new"`.

### 5. Add P13.1 Normalizer

`normalizeTrendAlerts(analytics, rollups, now)` → `trend_alert` signals for degrading trend, low approval rate, high risk score.

### 6. Add P13.2 Normalizer

`normalizeFailureClusters(analysis, now)` → `failure_cluster` signals for clusters with severity ≥ medium.

### 7. Add P13.3 Normalizer

`normalizePolicySuggestions(suggestions, now)` → `policy_suggestion` signals. Severity: tighten/remove_rule → high; add_rule/loosen → medium.

### 8. Add P13.4 Normalizer

`normalizeFrictionAlerts(report, now)` → `friction_alert` signals for high-friction gates (score > 0.3) and overall friction.

### 9. Add Aggregate Normalization

`normalizeAllP13Outputs(...)` — runs all four normalizers, deduplicates, returns only new signals. Called by `inbox refresh`.

### 10. Add CLI Inbox Listing

`alix governance inbox [--status] [--source] [--json]` — list signals with optional filters.

### 11. Add CLI Inbox Refresh

`alix governance inbox refresh [--window N] [--json]` — read P13 stores, run analysis, normalize, dedup, append, report.

### 12. Add Tests

`tests/governance/governance-signal.test.ts` — 54 tests across validation, store, dedup, normalizers, aggregate.

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Append-only JSONL | Matches P12.4/P12.5 patterns. Simple, auditable, no schema migrations. |
| Separate store per type | Different query patterns per object type (signals by status, decisions by signal). |
| Dedup key = sourcePhase:signalType:title | Practical trade-off between accuracy and complexity. |
| Dedup only on `new` status | Avoids permanent suppression — reviewed signals can recur. |
| Evidence validation at store level | Enforces P14 invariant 3 structurally rather than relying on normalizer correctness. |
| Normalization per module, not unified | Each P13 module has different output shape — separate functions keep each simple. |

## Out of Scope

Reserved for later P14 phases:

- P14.2 Operator Review Session
- P14.3 Decision Capture
- P14.4 Action Queue
- P14.5 Governance Audit Trail
- P14.6 Full CLI/Dashboard Surface

## Verification

```bash
pnpm build            # ✅
npx tsc --noEmit      # ✅
pnpm test:vitest      # ✅ 2669 tests (256 files)
node --test signal.js # ✅ 54/54 pass
GitNexus detect       # ✅ LOW risk, 0 affected processes
```
