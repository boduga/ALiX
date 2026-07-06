# P14.3 — Decision Capture Design

**Date:** 2026-07-06
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.1 (GovernanceSignal), P14.2 (OperatorReview)

## Purpose

Record explicit operator decisions on signals from the P14.1 inbox. P14.3 captures the **what** and **why** of an operator's decision — accept, dismiss, defer, escalate, or convert to issue — without executing or enforcing any of those decisions.

P14.3 is the pure decision-recording layer before P14.4 action queue and P14.5 audit trail.

## Non-goals

- **No action proposals** — `actionProposalId` remains `null` in P14.3. Action proposals are P14.4's domain.
- **No execution** — escalate and convert_to_issue record intent only. No GitHub issues, no enforcement, no policy changes.
- **No audit trail** — P14.5 handles audit events. Decisions are stored but not forwarded to an audit ledger.
- **No signal mutation** — `GovernanceSignal.status` is not updated. Decision state is derived from decision records for a given `signalId`.
- **No policy or gate changes** — decisions do not change governance state.

## Architecture

```
P14.1 Signal Store ──┐
P14.2 Review Store ──┤
                     ├──→ P14.3 Decision Capture ──→ P14.4 Action Queue
                     │        (append-only)
                     ▼
            P14.3 Decision Store
            (governance-decisions.jsonl)
```

P14.3 is a pure data-collection layer:
1. Operator runs `alix governance decide <signal-id> --<kind> --reason "..."`
2. CLI validates the signal exists, selects exactly one decision kind, and captures the rationale
3. An `OperatorDecision` record is created and appended to `FileDecisionStore`
4. The store is append-only — decisions are never mutated or deleted

## Core Objects

### OperatorDecision

```typescript
interface OperatorDecision {
  decisionId: string;
  /** Must reference an existing signal in the signal store. */
  signalId: string;
  /** Exactly one decision kind. */
  decision: DecisionKind;
  /** Required — rationale for the decision. Must be non-empty. */
  rationale: string;
  /** Decision-maker identity (resolved via --as → git → env → "operator"). */
  decider: string;
  /** Optional backlink to a P14.2 review. Must be for the same signalId. */
  reviewId: string | null;
  /**
   * Placeholder for P14.4. Always null in P14.3 — no action proposals
   * are created by this phase.
   */
  actionProposalId: null;
  createdAt: string;
}

type DecisionKind =
  | "accept"      // Operator agrees with P13 recommendation
  | "dismiss"     // Operator overrides — signal not actionable
  | "defer"       // Postpones — needs more info or context
  | "escalate"    // Warrants higher-level review
  | "convert_to_issue"; // Signal should be tracked as a GitHub issue
```

### Validation Rules

| Field | Rule |
|---|---|
| `decisionId` | Required, non-empty string |
| `signalId` | Required, non-empty string |
| `decision` | Must be one of the five `DecisionKind` values |
| `rationale` | Required, non-empty string |
| `decider` | Required, non-empty string |
| `reviewId` | Optional — must reference an existing review for the same `signalId` |
| `actionProposalId` | Always `null` in P14.3 |
| `createdAt` | Required, non-empty string |

## Decision Kinds

| Kind | Meaning | P14.3 handling |
|---|---|---|
| `accept` | Operator agrees with P13 recommendation | Record only — no follow-up in P14.3 |
| `dismiss` | Operator overrides — not actionable | Record only. Signal preserved for training material (per P14 invariant 5). |
| `defer` | Needs more info or context | Record only. `createdAt` records when the defer was made. A `deferUntil` field is reserved for a future reminder/scheduling phase. |
| `escalate` | Warrants higher-level review | Record intent only. P14.4 will create action proposals from these. |
| `convert_to_issue` | Should be a GitHub issue | Record intent only. P14.4 will bridge to P4.4 issue flow. |

## State Storage

Append-only JSONL store matching the P14.1/P14.2 pattern.

```
governance-decisions.jsonl        # in the same baseDir (process.cwd())
```

### Store Interface

```typescript
interface DecisionStore {
  append(decision: OperatorDecision): Promise<void>;
  list(limit?: number): Promise<OperatorDecision[]>;
  getById(decisionId: string): Promise<OperatorDecision | null>;
  getBySignalId(signalId: string): Promise<OperatorDecision[]>;
  getByKind(kind: DecisionKind): Promise<OperatorDecision[]>;
}
```

## CLI Interface

```bash
alix governance decide <signal-id> --accept --reason "Agree with P13"      # Accept
alix governance decide <signal-id> --dismiss --reason "False positive"     # Dismiss
alix governance decide <signal-id> --defer --reason "Need team input"      # Defer
alix governance decide <signal-id> --escalate --reason "Requires review"   # Escalate
alix governance decide <signal-id> --convert-to-issue --reason "Track this" # Issue

alix governance decide <signal-id> --json                   # Machine-readable output
alix governance decide <signal-id> --as "Jane"              # Explicit reviewer as decision-maker
alix governance decide <signal-id> --review <review-id>     # Optional backlink to a review
```

### Flags

| Flag | Required | Description |
|---|---|---|
| `--accept` | One of (exclusive) | Signal is actionable — operator agrees |
| `--dismiss` | One of (exclusive) | Signal is not actionable |
| `--defer` | One of (exclusive) | Postpone decision |
| `--escalate` | One of (exclusive) | Needs higher-level review |
| `--convert-to-issue` | One of (exclusive) | Should become a GitHub issue |
| `--reason` | Yes | Operator rationale (non-empty) |
| `--json` | No | Machine-readable JSON output |
| `--as` | No | Explicit decision-maker identity |
| `--review` | No | Optional backlink to a P14.2 review |

Exactly one decision kind flag must be provided. They are mutually exclusive.

### Behaviour

- **Signal exists, valid kind, non-empty reason:** decision is created and appended. Terminal output shows the decision record.
- **Signal missing:** CLI exits with error.
- **No decision kind or multiple kinds:** CLI exits with error listing valid choices.
- **Empty rationale:** CLI exits with error: "Rationale is required and must be non-empty."
- **No action proposal created:** Every decision record has `actionProposalId: null`. Confirmed in terminal output.

## Workflow

```
Operator
  │
  ▼
alix governance decide <signal-id> --accept --reason "..."
  │
  ├── Signal exists? ──No──→ Error: signal not found
  │
  Yes
  │
  ├── Exactly one kind flag? ──No──→ Error: exactly one required
  │
  Yes
  │
  ├── Rationale non-empty? ──No──→ Error: rationale required
  │
  Yes
  │
  ▼
Resolve reviewer identity (--as → git → env → "operator")
  │
  ▼
Create OperatorDecision record (actionProposalId: null)
  │
  ▼
Validate + append to decision store
  │
  ▼
Render decision (terminal or JSON)
  │
  ▼
No enforcement — decision is recorded, not executed
```

## Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Cannot decide on missing signal | `createOperatorDecision` throws when signal missing |
| 2 | Decision preserves signalId backlink | `decision.signalId` matches the CLI argument |
| 3 | Rationale is required and non-empty | Validation rejects empty rationale |
| 4 | Exactly one decision kind selected | CLI validates mutual exclusivity |
| 5 | Decision store is append-only | No update/delete methods on FileDecisionStore |
| 6 | CLI supports terminal + JSON output | Both output modes functional |
| 7 | `actionProposalId` is always null | Type is `null`, not `string` — no proposal created |
| 8 | No signal mutation | No writes to signal store from P14.3 |
| 9 | No GitHub issue creation | No issue bridge code in P14.3 |
| 10 | No audit entry creation | No audit store or write calls |
| 11 | Decider identity is recorded | `decision.decider` is non-empty and resolved deterministically |
| 12 | Optional review backlink is valid | `reviewId` exists and `review.signalId` matches `decision.signalId` |

## Invariants

| # | Invariant | Enforcement |
|---|---|---|
| 1 | **No decision on missing signal** — signal must exist in P14.1 store | `createOperatorDecision` checks signal is truthy |
| 2 | **Rationale required** — all decisions must have non-empty rationale | Validation rejects empty or whitespace-only rationale |
| 3 | **Exactly one decision kind** — cannot accept and dismiss simultaneously | CLI validates mutual exclusivity |
| 4 | **No action proposals created** — `actionProposalId` is always `null` | Type literal `null`, not `string \| null` |
| 5 | **Decision store is append-only** — no update, no delete | Store interface lacks mutating methods |
| 6 | **Signal is not mutated** — decision does not change signal records | No writes to signal store from P14.3 code |
| 7 | **Decider identity is recorded** — every decision has a non-empty `decider` | Validation rejects empty decider |
| 8 | **Review backlink integrity** — optional `reviewId` must point to a review for the same `signalId` | `createOperatorDecision` validates the backlink when provided |

## Files

```
N: docs/architecture/specs/2026-07-06-p14-3-decision-capture.md    # This spec
N: docs/architecture/plans/2026-07-06-p14-3-decision-capture.md    # Companion plan
N: src/governance/decision-capture.ts                                # Implementation
N: tests/governance/decision-capture.test.ts                         # Tests
A: src/cli/commands/governance.ts                                    # Add decide subcommand
```
