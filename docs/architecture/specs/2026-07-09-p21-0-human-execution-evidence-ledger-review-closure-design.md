# P21.0 — Human Execution Evidence Ledger & Review Closure Design Spec

**Status:** Design — approved for implementation planning
**Phase:** P21 — Human Execution Evidence Ledger & Review Closure
**Builds on:** P17 (Approved Execution Lifecycle), P18 (Governance Workbench), P19 (Automation Readiness), P20 (Handoff Packages)
**Approach:** Append-only evidence ledger; reviewable closure states; audited persistence; no autonomous execution

## 1. Purpose

P21 closes the loop after manual operator action by turning prepared handoff records and operator-submitted evidence into **reviewable, audited closure artifacts**.

P20 can prepare a handoff record and validate evidence. P21 persists that evidence in an append-only ledger, assigns closure states (accepted, rejected, incomplete, needs-follow-up), and records closure decisions through audited store boundaries.

```text
handoff record + operator evidence
  → append-only evidence ledger
  → closure review (accepted/rejected/incomplete/follow-up)
  → audited closure record
```

## 2. Architectural Decision

P21 uses an **append-only evidence ledger** with audited closure recording rather than mutable handoff state or inline execution persistence.

### 2.1 Why append-only ledger

- Evidence is immutable once captured — appending prevents tampering.
- Closure states are separate from evidence — a review can be reopened without losing prior evidence.
- Audit stores already exist in the governance subsystem — P21 connects to them rather than creating a new audited store.
- The ledger is a write-once, read-many structure — no updates, no deletes, no mutations.

### 2.2 Rejected alternatives

| Alternative | Rejection reason |
|---|---|
| Mutable handoff package status | Violates P20 invariants — handoff packages are immutable |
| Store evidence in P17 recorder | Recorder expects execution attempts, not closure evidence |
| Use filesystem directly | Bypasses audit store boundaries |
| No ledger at all | Evidence is lost after prepare-record |

## 3. Hard Boundary

P21 must not:

- execute actions autonomously or on a timer;
- invoke shell, network, MCP, browser, or tool executors;
- mutate plans, approvals, remediations, policies, or external systems;
- perform external side effects;
- import direct audit emitters (must use audited store boundaries);
- create a new approval path or bypass P17 approval;
- rank, score, compare, or infer operator performance;
- modify or delete evidence once appended;
- allow closure without evidence ledger entry.

P21 may:

- append operator-submitted evidence to an append-only ledger;
- assign and transition closure states through explicit review;
- persist closure decisions through audited store boundaries;
- surface pending, accepted, rejected, incomplete, and follow-up-required closures in reports.

## 4. Scope

| Slice | Deliverable |
|---|---|
| P21.0 | Design spec and implementation plan |
| P21.1 | Evidence Ledger Store |
| P21.2 | Closure Review Model |
| P21.3 | Audit-Safe Closure Recorder |
| P21.4 | Closure Report + CLI |
| P21.5 | Checkpoint |

Out of scope: autonomous execution, shell/network/tool execution, policy mutation, execution adapters, operator ranking, evidence mutation or deletion, handoff package mutation, P17/P18/P19/P20 bypass.

## 5. Evidence Ledger Contract

### 5.1 Ledger entry

```typescript
interface EvidenceLedgerEntry {
  entryId: string;
  handoffId: string;
  planId: string;
  remediationId: string;
  operatorId: string;
  evidence: Record<string, HandoffCaptureEvidence>;
  preparedRecord: GovernanceExecutionAttempt;
  appendedAt: string;
}
```

### 5.2 Append-only rules

1. Entries are appended, never updated or deleted.
2. `entryId` is a deterministic SHA-256 hash over `["p21.1", handoffId, appendedAt]`.
3. The ledger is backed by the existing governance append store (`GovernanceStore`).

## 6. P21.1 — Evidence Ledger Store

### 6.1 Purpose

Append-only store for operator-submitted evidence refs and prepared handoff records.

```typescript
export class EvidenceLedgerStore {
  constructor(basePath: string);
  append(entry: EvidenceLedgerEntry): Promise<void>;
  getByHandoffId(handoffId: string): Promise<EvidenceLedgerEntry | null>;
  list(options?: { since?: string; until?: string }): Promise<EvidenceLedgerEntry[]>;
}
```

### 6.2 Store rules

1. Append-only: no update, no delete, no overwrite.
2. Backed by file-based JSONL via `GovernanceStore` or similar append store.
3. Listing supports `[since, until)` time filtering on `appendedAt`.
4. `getByHandoffId` returns the latest entry for that handoff (by `appendedAt`).

## 7. P21.2 — Closure Review Model

### 7.1 Purpose

Review completed handoffs and assign closure states.

```typescript
type ClosureState = "pending_review" | "accepted" | "rejected" | "incomplete" | "needs_follow_up";

interface ClosureReview {
  reviewId: string;
  handoffId: string;
  planId: string;
  remediationId: string;
  entryId: string;
  state: ClosureState;
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
  previousState: ClosureState | null;
}
```

### 7.2 Closure transitions

| From | To | Condition |
|------|----|-----------|
| `pending_review` | `accepted` | Evidence complete, operator confirms success |
| `pending_review` | `rejected` | Evidence incomplete or operator reports failure |
| `pending_review` | `incomplete` | Some actions completed, others pending |
| `pending_review` | `needs_follow_up` | Issues found that need separate remediation |
| `accepted` | `needs_follow_up` | Post-acceptance issues discovered |
| `rejected` | `pending_review` | Operator re-submits with updated evidence |

## 8. P21.3 — Audit-Safe Closure Recorder

### 8.1 Purpose

Persist closure decisions through audited store boundaries only.

```typescript
export function recordClosureReview(
  review: ClosureReview,
  store: GovernanceStore,
): Promise<void>;
```

### 8.2 Recording rules

1. Validate closure state transition is allowed (see §7.2).
2. If invalid transition, throw a typed error.
3. Append review to the governance store through `store.append()`.
4. `store.append()` is the only write path — no direct filesystem access.
5. The function is async and returns after the store acknowledges the write.

## 9. P21.4 — Closure Report + CLI

### 9.1 Purpose

Read-only operator view of completed, incomplete, rejected, and follow-up-required handoffs.

```typescript
interface ClosureReportItem {
  handoffId: string;
  planId: string;
  remediationId: string;
  state: ClosureState;
  evidenceCount: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

interface ClosureReport {
  items: ClosureReportItem[];
  totals: Record<ClosureState, number>;
}
```

### 9.2 CLI commands

```text
alix governance closure review <handoff-id> --state <state> --rationale <text> --input <path> [--json]
alix governance closure report --input <path> [--json] [--since <iso>] [--until <iso>]
```

## 10. P21.5 — Checkpoint

- Phase report: `docs/architecture/reports/p21-human-execution-evidence-ledger-review-closure-report.md`
- Checkpoint doc
- Tag: `alix-p21-human-execution-evidence-ledger-review-closure-complete`
- Verify: no autonomous execution, no execution adapter, no operator ranking, audited closure only

## 11. Acceptance Criteria

P21 complete when:
1. Evidence can be appended to a ledger (append-only).
2. Ledger entries are retrievable by handoff ID and time window.
3. Closure states can be assigned and transitioned.
4. Closure decisions are persisted through audited store boundaries only.
5. Reports surface pending, accepted, rejected, incomplete, and follow-up states.
6. No autonomous execution capability exists.
7. No execution adapter or tool invocation exists.
8. No handoff package mutation exists.
9. All sentinel and behavioral tests pass.

## 12. Invariants

1. Evidence ledger is append-only (no update, no delete, no overwrite).
2. No execution adapter, executor import, or tool invocation exists.
3. No direct audit emitter imports — audited stores own audit emission.
4. Closure decisions use audited store boundaries only.
5. Handoff packages are never mutated.
6. Operator ranking is never stored or surfaced.
7. P17 approval remains required.
8. P19 readiness remains required.
9. P20 evidence validation remains required.
