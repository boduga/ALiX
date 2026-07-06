# P14.5 — Governance Audit Trail Plan

**Date:** 2026-07-06
**Status:** Plan
**Depends on:** P14.1, P14.2, P14.3, P14.4 (shipped)
**Spec:** `docs/architecture/specs/2026-07-06-p14-5-governance-audit-trail.md`

## Overview

Implement the **P14.5a core slice** — storage/model/hash-chain/query helpers only. No API, CLI, export, redaction, or live integration with existing governance stores. This is the tamper-evident foundation that P14.5b and P14.5c build on.

## Tasks

### Task 1 — Core types and enums

**File:** `src/governance/audit-types.ts`

- `GovernanceEventType` — 13 event types union
- `ActorType` — `"human" | "agent" | "system" | "policy_engine"`
- `SubjectType` — 10 subject types union
- `GovernanceDecision` — `"allowed" | "denied" | "escalated" | "deferred" | "overridden"`
- `RiskLevel` — `"low" | "medium" | "high" | "critical"`
- `GovernanceAuditEvent` interface — all fields including `previousHash` and `eventHash`
- `validateAuditEvent()` — structural validator returning `{ valid: boolean; errors: string[] }`

Validation rules:
- `eventId` — required, non-empty
- `timestamp` — required, non-empty (ISO 8601 string)
- `eventType` — must be one of the 13 valid types
- `actorType` — must be one of the 4 valid types
- `actorId` — required, non-empty
- `subjectType` — must be one of the 10 valid types
- `action` — required, non-empty
- `decision` — must be one of the 5 valid decisions
- `reason` — required, non-empty
- `evidenceRefs` — must be array of strings
- `requiresHumanReview` — must be boolean
- `metadata` — must be object (or could be `Record<string, unknown>`)
- `previousHash` — must be string or null
- `eventHash` — required, non-empty string

### Task 2 — `computeEventHash()` and hash helpers

**File:** `src/governance/audit-store.ts`

- `computeEventHash(event)` — strips `eventHash`, canonical-stringifies remaining fields, SHA-256 via `canonicalHash`
- `computePreviousHash(readChronological)` — returns the last event's `eventHash` (or null for empty store)
- Reuses `canonicalStringify`/`canonicalHash` from `src/security/audit/canonical-json.ts`

Hash formula:
```
eventHash = canonicalHash(event minus eventHash field)
```

Where `canonicalHash` = `sha256("alix-audit-v1:" + canonicalStringify(value))`.

### Task 3 — `AuditStore` interface and `FileAuditStore`

**File:** `src/governance/audit-store.ts`

Interface:
- `append(event)` — validates, computes previousHash, computes eventHash, writes to JSONL
- `list()` — all events, newest-first
- `listChronological()` — events in file order (oldest first, for verification)
- `getById(eventId)` — single event lookup
- `size()` — event count

Implementation — `FileAuditStore`:
- Store file: `governance-audit-events.jsonl` under `.alix/governance/`
- `append()` flow:
  1. Validate incoming event (must have all fields except `previousHash` and `eventHash` — or accept fully-formed for testability)
  2. Read file to determine previousHash
  3. Compute eventHash via `computeEventHash()`
  4. Set `previousHash` and `eventHash`
  5. Write complete event as JSONL line
- `list()` — read file, split lines, parse JSON, filter malformed, reverse (newest-first)
- `listChronological()` — same but no reverse
- `getById()` — linear scan (acceptable for audit-scale data)

### Task 4 — Chain verification

**File:** `src/governance/audit-chain.ts`

- `verifyChain(events)` — returns `{ valid: boolean; findings: ChainFinding[] }`
- `computeEventHash(event)` — re-hash a single event to verify
- `findBrokenLinks(events)` — returns array of `{ index: number; eventId: string; expectedHash: string; actualHash: string }` for mismatches

ChainFinding types:
- `"ok"` — hash matches
- `"hash_mismatch"` — event hash doesn't match recomputed hash
- `"previous_hash_break"` — previousHash doesn't match predecessor's eventHash
- `"chain_break"` — missing predecessor

Verification algorithm:
1. Walk events in chronological order (index 0 = oldest)
2. For each event, recompute eventHash and compare
3. For each event (except first), verify previousHash matches prior event's eventHash
4. Collect all findings; return `valid: findings.length === 0`

### Task 5 — Query helpers

**File:** `src/governance/audit-query.ts`

All take an event array and filter parameters:
- `queryByActor(events, actorType, actorId)` — filter by actor type + ID
- `queryByPolicy(events, policyId)` — filter by policy ID
- `queryByTraceId(events, traceId)` — filter by trace ID
- `queryByDecision(events, decision)` — filter by decision outcome
- `queryByTimeRange(events, fromIso, toIso)` — filter by ISO timestamp range

### Task 6 — Tests

**File:** `tests/governance/audit-store.test.ts`

| # | Test | What it covers |
|---|---|---|
| 1 | Validates valid event | Happy path |
| 2 | Rejects missing eventId | Required field |
| 3 | Rejects invalid eventType | Enum gate |
| 4 | Rejects missing actorId | Required field |
| 5 | Rejects invalid decision | Enum gate |
| 6 | Rejects non-array evidenceRefs | Type gate |
| 7 | Rejects missing eventHash (for fully-formed validation) | Required field |
| 8 | computeEventHash is deterministic | Same input → same hash |
| 9 | computeEventHash changes when payload changes | Different input → different hash |
| 10 | Store appends and lists newest-first | Append order |
| 11 | Store lists chronological | File order preserved |
| 12 | Store getById returns matching event | Lookup |
| 13 | Store getById returns null for missing | Absent lookup |
| 14 | Store rejects invalid event on append | Write gate |
| 15 | Store creates directory on first append | Auto-init |
| 16 | Store doesn't update existing event | Append-only invariant |
| 17 | Chain verification passes for valid chain | Happy path |
| 18 | Chain verification fails after hash tampering | Tamper detection |
| 19 | Chain verification fails after previousHash tampering | Link detection |
| 20 | queryByActor filters correctly | Actor query |
| 21 | queryByPolicy filters correctly | Policy query |
| 22 | queryByTraceId filters correctly | Trace query |
| 23 | queryByDecision filters correctly | Decision query |
| 24 | queryByTimeRange filters correctly | Time range query |

## Estimated additions

| File | Lines |
|------|-------|
| `src/governance/audit-types.ts` | ~120 |
| `src/governance/audit-store.ts` | ~150 |
| `src/governance/audit-chain.ts` | ~80 |
| `src/governance/audit-query.ts` | ~60 |
| `tests/governance/audit-store.test.ts` | ~350 |
| **Total new** | ~760 |

## Dependencies

- `src/security/audit/canonical-json.ts` — `canonicalStringify`, `canonicalHash`
- Node.js `node:crypto` — `createHash` (used by canonical-json)
- Node.js `node:fs/promises` — `readFile`, `appendFile`, `mkdir`
- Node.js `node:path` — `join`
- Node.js `node:fs` — `existsSync`, `mkdirSync` (for sync init)

## Development order

1. Types + validation (Task 1)
2. Hash helper + store (Tasks 2, 3)
3. Chain verification (Task 4)
4. Query helpers (Task 5)
5. Tests (Task 6)
