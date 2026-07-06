# P14.5 — Governance Audit Trail Design

**Date:** 2026-07-06
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.1 (GovernanceSignal), P14.2 (OperatorReview), P14.3 (DecisionCapture), P14.4 (ActionQueue)

## Purpose

Convert ALiX governance from **observable** to **auditable**. Every governance-relevant decision — policy evaluation, permission check, approval, override — gets a durable, queryable, tamper-evident trail.

Governance audit events are **not metrics**. Metrics answer *"how is the system behaving?"* The audit trail answers *"why did ALiX do that, who authorized it, under what policy, and can we prove the record was not changed?"*

## Non-goals

- **No metrics** — monitoring layer (health checks, alerts, dashboards) remains separate
- **No runtime action auditing** — only governance-boundary events in this slice
- **No API endpoints** — that's P14.5b
- **No CLI commands** — that's P14.5b
- **No integration with existing governance modules** — P14.5a defines the storage layer; integration points are P14.5b/c

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Governance Audit Trail                 │
│                                                         │
│  P14.5a ─── Storage/Model/Hash-Chain (this slice)       │
│    ├── GovernanceAuditEvent (canonical event type)       │
│    ├── FileAuditStore (append-only JSONL + SHA-256)      │
│    ├── ChainVerification (tamper-evident integrity)      │
│    └── Query helpers (actor, policy, trace, decision)    │
│                                                         │
│  P14.5b ─── API/CLI/Export (future slice)               │
│    ├── REST endpoints                                    │
│    ├── CLI commands                                      │
│    └── JSON/JSONL export with redaction                  │
│                                                         │
│  P14.5c ─── Integration (future slice)                   │
│    ├── Policy engine → POLICY_EVALUATED events           │
│    ├── Permission checks → TOOL_PERMISSION_CHECKED       │
│    ├── Human approval → HUMAN_APPROVAL_* events          │
│    └── Override detection → OVERRIDE_APPLIED             │
└─────────────────────────────────────────────────────────┘
```

### Storage layer

```
P14.1–14.4 Stores ──→ P14.5 Audit Store ──→ Chain Verification
                         (append-only)           │
                         .alix/governance/        ├── verifyAll()
                         ├── audit-events.jsonl   ├── verifyEventHash()
                         └── (head.json future)   └── findBrokenLinks()
```

The audit store is a **plain JSONL file with hash-chaining**, following the same pattern as existing governance stores (`FileActionQueueStore`, `FileSignalStore`). Unlike those stores, each event carries a cryptographic hash that covers the event payload plus the previous event's hash, forming a chain.

### Hash chain design

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Event N-1   │    │ Event N     │    │ Event N+1   │
│ previousHash │◄──│ previousHash│◄──│ previousHash│
│    = null    │   │  = hash(N-1)│   │  = hash(N)  │
│ eventHash   │    │ eventHash   │    │ eventHash   │
│  = sha256(…) │    │  = sha256(…)│    │  = sha256(…)│
└─────────────┘    └─────────────┘    └─────────────┘
```

Each event's `eventHash` = `canonicalHash(eventWithoutEventHash)` — covers every field including `previousHash` but excluding `eventHash` itself. Uses the existing `canonicalStringify`/`canonicalHash` from the security audit module (`src/security/audit/canonical-json.ts`), which produces deterministic sorted-key JSON with a domain prefix.

## Core Objects

### GovernanceAuditEvent

```typescript
interface GovernanceAuditEvent {
  eventId: string;             // Unique event identifier
  timestamp: string;           // ISO 8601

  eventType: GovernanceEventType;

  actorType: ActorType;        // human | agent | system | policy_engine
  actorId: string;

  subjectType: SubjectType;
  subjectId: string | null;

  action: string;              // What was being attempted
  decision: GovernanceDecision; // allowed | denied | escalated | deferred | overridden

  policyId: string | null;
  policyVersion: string | null;
  ruleId: string | null;

  reason: string;              // Human-readable why
  evidenceRefs: string[];      // References to supporting evidence

  requestId: string | null;
  traceId: string | null;
  sessionId: string | null;
  parentEventId: string | null;

  riskLevel: RiskLevel;        // low | medium | high | critical
  requiresHumanReview: boolean;

  metadata: Record<string, unknown>;  // Extensible payload

  previousHash: string | null; // SHA-256 of previous event (null for first)
  eventHash: string;           // SHA-256 of this event (excluding eventHash)
}
```

### Event types

```typescript
type GovernanceEventType =
  | "policy_evaluated"
  | "action_allowed"
  | "action_denied"
  | "action_escalated"
  | "human_approval_requested"
  | "human_approval_granted"
  | "human_approval_denied"
  | "override_applied"
  | "tool_permission_checked"
  | "agent_permission_checked"
  | "memory_access_checked"
  | "model_routing_decision"
  | "security_boundary_checked";
```

### Actor types

```typescript
type ActorType = "human" | "agent" | "system" | "policy_engine";
```

### Subject types

```typescript
type SubjectType =
  | "signal" | "decision" | "proposal" | "action"
  | "policy" | "rule"
  | "tool" | "agent" | "memory" | "model";
```

### Decision outcomes

```typescript
type GovernanceDecision = "allowed" | "denied" | "escalated" | "deferred" | "overridden";
```

### Risk levels

```typescript
type RiskLevel = "low" | "medium" | "high" | "critical";
```

## Store operations

| Operation | Description |
|-----------|-------------|
| `append(event)` | Validate, compute hash-chain link, write to JSONL |
| `list()` | All events, newest-first |
| `listChronological()` | All events in file order (for verification) |
| `getById(eventId)` | Single event lookup |
| `size()` | Count of events |

## Chain verification

| Function | Description |
|----------|-------------|
| `verifyChain(events)` | Verify all hashes + previous_hash links |
| `computeEventHash(event)` | Recompute a single event's hash |
| `findBrokenLinks(events)` | Return list of broken chain positions |

## Query helpers

| Function | Description |
|----------|-------------|
| `queryByActor(events, actorType, actorId)` | Filter by actor |
| `queryByPolicy(events, policyId)` | Filter by policy |
| `queryByTraceId(events, traceId)` | Filter by trace |
| `queryByDecision(events, decision)` | Filter by decision outcome |
| `queryByTimeRange(events, from, to)` | Filter by time range |

## Hash invariants

1. Audit events are append-only.
2. Existing events cannot be updated through public APIs.
3. Existing events cannot be deleted through public APIs.
4. Every event after the first has `previousHash` set to the prior event's `eventHash`.
5. Chain verification must fail if any historical event is altered.
6. Secrets, tokens, raw prompts, and private credentials must never be stored directly.

## Files

| File | Purpose |
|------|---------|
| `src/governance/audit-types.ts` | All types, enums, validation |
| `src/governance/audit-store.ts` | FileAuditStore + hash computation |
| `src/governance/audit-chain.ts` | Chain verification |
| `src/governance/audit-query.ts` | Query helpers |
| `tests/governance/audit-store.test.ts` | All tests (types, store, chain, query) |

## Dependencies

- `src/security/audit/canonical-json.ts` — `canonicalStringify`, `canonicalHash` for deterministic JSON and SHA-256
- Node.js `node:crypto` — `createHash`
- Node.js `node:fs/promises` — `readFile`, `appendFile`, `mkdir`
- Node.js `node:path` — `join`

## Integration points (P14.5b/c)

| Area | Event type |
|------|------------|
| Policy engine | `POLICY_EVALUATED` |
| Tool permission checks | `TOOL_PERMISSION_CHECKED` |
| Agent registry changes | `AGENT_PERMISSION_CHECKED` |
| Memory access | `MEMORY_ACCESS_CHECKED` |
| Model routing | `MODEL_ROUTING_DECISION` |
| Human approval workflow | `HUMAN_APPROVAL_REQUESTED / GRANTED / DENIED` |
| Overrides | `OVERRIDE_APPLIED` |
