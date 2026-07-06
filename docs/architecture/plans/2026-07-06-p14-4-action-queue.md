# P14.4 — Action Queue Plan

**Date:** 2026-07-06
**Status:** Plan
**Depends on:** P14.1, P14.2, P14.3 (shipped)
**Spec:** `docs/architecture/specs/2026-07-06-p14-4-action-queue.md`

## Overview

Introduce action proposals derived from P14.3 decisions. P14.4 is the queue layer between decision capture (P14.3) and future execution. Decisions of kind `escalate` and `convert_to_issue` produce `escalation_review` and `github_issue` proposals respectively. `accept`, `dismiss`, and `defer` produce nothing.

All proposals are append-only. Status transitions (`marked_executed_elsewhere`, `dismissed`) are also append-only via transition records — the original proposal is never mutated.

## Tasks

### Task 1 — Core types and validation

**File:** `src/governance/action-queue.ts`

- `ActionProposalKind` — `"escalation_review" | "github_issue"`
- `ActionProposalStatus` — `"pending" | "marked_executed_elsewhere" | "dismissed"` (used for effective-status display/CLI filtering)
- `GovernanceActionProposal` interface — `status: "pending"` literal type (not `ActionProposalStatus`); terminal statuses are transition records only
- `ActionProposalStatusTransition` interface
- `validateActionProposal()` function
- `validateActionProposalStatusTransition()` function with rules:
  - `transitionId` — required, non-empty
  - `proposalId` — required, non-empty
  - `status` — must be `marked_executed_elsewhere` or `dismissed` (rejects `pending`)
  - `reason` — required (non-empty) for `dismissed`; optional for `marked_executed_elsewhere`
  - `executionRef` — required (non-empty) for `marked_executed_elsewhere`; must be `null` for `dismissed`
  - `createdAt` — required, non-empty

### Task 2 — `createActionProposal()` function

**File:** `src/governance/action-queue.ts`

Takes a decision and signal, returns a proposal. Rules:
- Throws for non-eligible decision kinds (`accept`, `dismiss`, `defer`)
- Maps `escalate` → `escalation_review`, `convert_to_issue` → `github_issue`
- Preserves `decision.decisionId` and `decision.signalId`
- Sets status `"pending"`, `executionRef` `null`

### Task 3 — `FileActionQueueStore`

**File:** `src/governance/action-queue.ts`

Append-only JSONL store at `governance-action-queue.jsonl`. Methods:
- `append(proposal)` — validates then appends
- `list(limit?)` — newest-first
- `getById(proposalId)` — single lookup
- `getByDecisionId(decisionId)` — proposals for a decision
- `appendStatusTransition(transition)` — append-only status change
- `getTransitions(proposalId)` — all transitions for a proposal, newest-first

Transitions stored in a separate file: `governance-action-queue-transitions.jsonl`.

### Task 4 — `refreshProposals()` function

**File:** `src/governance/action-queue.ts`

Scans decision store for eligible decisions without existing proposals. Deduplicates by `decisionId + kind` across **all** existing proposals (not just pending). Returns newly created proposals.

### Task 5 — Tests

**File:** `tests/governance/action-queue.test.ts`

| # | Test | What it covers |
|---|---|---|
| 1 | Validation accepts valid proposal | Happy path |
| 2 | Validation rejects non-object | Type guard |
| 3 | Validation rejects missing proposalId | Required field |
| 4 | Validation rejects invalid kind | Kind enum |
| 5 | Validation rejects invalid status | Status enum |
| 6 | Validation accepts null executionRef | Optional field |
| 7 | validateActionProposalStatusTransition accepts valid transition | Happy path |
| 8 | validateActionProposalStatusTransition rejects non-object | Type guard |
| 9 | validateActionProposalStatusTransition rejects missing transitionId | Required field |
| 10 | validateActionProposalStatusTransition rejects missing proposalId | Required field |
| 11 | validateActionProposalStatusTransition rejects status pending | Terminal-only gate |
| 12 | validateActionProposalStatusTransition requires executionRef for marked_executed_elsewhere | Cross-field rule |
| 13 | validateActionProposalStatusTransition requires reason for dismissed | Cross-field rule |
| 14 | validateActionProposalStatusTransition rejects executionRef non-null for dismissed | Cross-field rule |
| 15 | createActionProposal creates escalation_review from escalate | Kind mapping |
| 16 | createActionProposal creates github_issue from convert_to_issue | Kind mapping |
| 17 | createActionProposal throws for accept | Non-eligible kind |
| 18 | createActionProposal throws for dismiss | Non-eligible kind |
| 19 | createActionProposal throws for defer | Non-eligible kind |
| 20 | createActionProposal preserves decisionId backlink | Backlink invariant |
| 21 | createActionProposal preserves signalId backlink | Signal chain invariant |
| 22 | Store appends and lists newest-first | Append order |
| 23 | Store getById returns matching proposal | Lookup |
| 24 | Store getById returns null for missing | Absent lookup |
| 25 | Store getByDecisionId filters correctly | Decision grouping |
| 26 | Store rejects invalid proposal on append | Write gate |
| 27 | Store creates directory on first append | Auto-init |
| 28 | Store appendStatusTransition writes to transition file | Append-only transition |
| 29 | Store getTransitions returns transitions newest-first | Transition order |
| 30 | Store getTransitions returns empty for unknown proposal | Absent transitions |
| 31 | Refresh creates proposals from eligible decisions | Happy path |
| 32 | Refresh skips decisions with existing proposals | Dedup |
| 33 | Refresh skips decisions with existing dismissed proposals | Dedup across all statuses |
| 34 | Refresh skips decisions with existing executed proposals | Dedup across all statuses |
| 35 | Refresh does nothing when no eligible decisions | No-op |
| 36 | Refresh skips decisions where signal is missing | Partial success |

### Task 6 — CLI: `alix governance actions` (list)

**File:** `src/cli/commands/governance.ts`

- Parses `--status`, `--kind`, `--json` flags
- Dispatches to `FileActionQueueStore.list()`
- Renders terminal table or JSON output
- Handles empty store gracefully

### Task 7 — CLI: `alix governance actions refresh`

**File:** `src/cli/commands/governance.ts`

- Calls `refreshProposals()` with stores wired
- Reports count of new proposals created
- Supports `--json` for machine-readable output

### Task 8 — CLI: `alix governance actions mark-executed`

**File:** `src/cli/commands/governance.ts`

- Takes `<proposal-id>` positional + `--ref <string>` flag
- Validates proposal exists and has no terminal transition yet
- Appends `ActionProposalStatusTransition` via `appendStatusTransition()`
- Renders terminal or JSON output

### Task 9 — CLI: `alix governance actions dismiss`

**File:** `src/cli/commands/governance.ts`

- Takes `<proposal-id>` positional + `--reason <string>` flag
- Validates proposal exists and has no terminal transition yet
- Appends `ActionProposalStatusTransition` via `appendStatusTransition()`
- Renders terminal or JSON output

### Task 10 — Wire CLI dispatch

**File:** `src/cli/commands/governance.ts`

Add `actions` handler to the governance command dispatch table with subcommands:
- `actions` → list
- `actions refresh` → refresh
- `actions mark-executed` → mark-executed
- `actions dismiss` → dismiss

## Estimated additions

| File | Lines |
|---|---|
| `src/governance/action-queue.ts` | ~280 |
| `tests/governance/action-queue.test.ts` | ~400 |
| `src/cli/commands/governance.ts` (amended) | ~+150 |
| **Total new** | ~680 |

## Dependencies

- `src/governance/decision-capture.ts` — `OperatorDecision`, `DecisionKind`, `DecisionStore` interface
- `src/governance/governance-signal.ts` — `GovernanceSignal`, `SignalStore` interface
- `src/cli/commands/governance.ts` — existing `alix governance` dispatch

## Development order

1. Types + validation (Task 1)
2. `createActionProposal` (Task 2)
3. `FileActionQueueStore` — proposals (Task 3, first half)
4. `FileActionQueueStore` — transitions (Task 3, second half)
5. `refreshProposals` (Task 4)
6. Tests (Task 5)
7. CLI list + refresh (Tasks 6, 7)
8. CLI mark-executed + dismiss (Tasks 8, 9)
9. CLI dispatch wiring (Task 10)
