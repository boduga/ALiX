# P14.4 — Action Queue Design

**Date:** 2026-07-06
**Status:** Design
**Parent:** P14.0 — Governance Operator Workflow Design
**Depends on:** P14.1 (GovernanceSignal), P14.2 (OperatorReview), P14.3 (DecisionCapture)

## Purpose

Introduce **action proposals** — queue records derived from P14.3 decisions. P14.4 captures *what should be done* (escalate for review, convert to GitHub issue) without executing any of those actions. This is the planning layer between decision capture (P14.3) and eventual execution (future phases).

## Non-goals

- **No execution** — no GitHub issue creation, no reviewer assignment, no policy/gate/threshold changes
- **No signal mutation** — `GovernanceSignal.status` is not updated
- **No decision mutation** — decisions are not modified, replayed, or deleted
- **No audit entries** — P14.5 handles audit events
- **No automatic status transitions** — `mark-executed` and `dismiss` are manual CLI operations only

## Architecture

```
P14.3 Decision Store ──┐
                       ├──→ P14.4 Action Queue ──→ Future execution phase
                       │        (append-only proposals)
                       ▼
              P14.4 Action Queue Store
              (governance-action-queue.jsonl)
```

P14.4 is a pure queue layer:
1. Operator decisions of kind `escalate` or `convert_to_issue` can produce action proposals
2. `alix governance actions refresh` scans the decision store and creates proposals for eligible decisions that don't already have one
3. Each proposal backlinks to its originating decision and signal
4. Proposals are append-only; status updates (`dismissed`, `marked_executed_elsewhere`) are manual CLI operations

## Core Objects

### GovernanceActionProposal

```typescript
type ActionProposalKind =
  | "escalation_review"     // Derived from "escalate" decision
  | "github_issue";         // Derived from "convert_to_issue" decision

type ActionProposalStatus =
  | "pending"
  | "marked_executed_elsewhere"
  | "dismissed";
// Used for effective-status display/CLI filtering. Proposals themselves
// always carry status: "pending" — terminal statuses are transition records.

interface GovernanceActionProposal {
  proposalId: string;
  /** Must reference an existing decision in the decision store. */
  decisionId: string;
  /** Preserved from the originating decision's signal backlink. */
  signalId: string;
  kind: ActionProposalKind;
  /** Human-readable title derived from the signal/decision. */
  title: string;
  /** Longer description explaining what action is needed. */
  description: string;
  /** Why this action proposal exists — sourced from the decision rationale. */
  rationale: string;
  /** Literal "pending" — terminal statuses are recorded via ActionProposalStatusTransition, never mutated on the original proposal. */
  status: "pending";
  /**
   * Populated manually via `mark-executed --ref` in P14.4.
   * Remains null for pending proposals.
   */
  executionRef: string | null;
  createdAt: string;
}
```

### ActionProposalStatusTransition

Status transitions are recorded as append-only records — the original proposal is never mutated.

```typescript
interface ActionProposalStatusTransition {
  transitionId: string;
  /** Must reference an existing proposal. */
  proposalId: string;
  /** The new status (never "pending"); the terminal states. */
  status: "marked_executed_elsewhere" | "dismissed";
  /** Human reason for the transition (required for dismiss, optional for mark-executed). */
  reason: string | null;
  /** Execution reference when status is marked_executed_elsewhere (ignored for dismiss). */
  executionRef: string | null;
  createdAt: string;
}
```

### validateActionProposalStatusTransition

```typescript
function validateActionProposalStatusTransition(entry: unknown): ValidationResult
```

### Transition Validation Rules

| Field | Rule |
|---|---|
| `transitionId` | Required, non-empty string |
| `proposalId` | Required, non-empty string |
| `status` | Must be `marked_executed_elsewhere` or `dismissed` |
| `reason` | Required (non-empty) for `dismissed`; optional for `marked_executed_elsewhere` |
| `executionRef` | Required (non-empty) for `marked_executed_elsewhere`; `null` for `dismissed` |
| `createdAt` | Required, non-empty string |

### Derivation Rules

| Decision Kind | Action Proposal Kind | Proposals Created |
|---|---|---|
| `accept` | — | None |
| `dismiss` | — | None |
| `defer` | — | None |
| `escalate` | `escalation_review` | One per decision |
| `convert_to_issue` | `github_issue` | One per decision |

### Validation Rules

| Field | Rule |
|---|---|
| `proposalId` | Required, non-empty string |
| `decisionId` | Required, non-empty string — must reference existing decision |
| `signalId` | Required, non-empty string — preserved from decision |
| `kind` | Must be one of `escalation_review` or `github_issue` |
| `title` | Required, non-empty string |
| `description` | Required, non-empty string |
| `rationale` | Required, non-empty string |
| `status` | Must be one of the three `ActionProposalStatus` values |
| `executionRef` | Null or non-empty string |
| `createdAt` | Required, non-empty string |

## State Storage

Append-only JSONL store matching the P14.1/P14.2/P14.3 pattern.

```
governance-action-queue.jsonl        # in the same baseDir (process.cwd())
```

### Store Interface

```typescript
interface ActionQueueStore {
  append(proposal: GovernanceActionProposal): Promise<void>;
  list(limit?: number): Promise<GovernanceActionProposal[]>;
  getById(proposalId: string): Promise<GovernanceActionProposal | null>;
  getByDecisionId(decisionId: string): Promise<GovernanceActionProposal[]>;
  /** Append-only status transition — never mutates the original proposal record. */
  appendStatusTransition(transition: ActionProposalStatusTransition): Promise<void>;
  /** Returns all transitions for a given proposal, newest-first. */
  getTransitions(proposalId: string): Promise<ActionProposalStatusTransition[]>;
}
```

**How status works in practice:** The effective status of a proposal is derived by reading all its transitions. If the most recent transition sets a terminal status, the proposal is considered in that state. The CLI's `mark-executed` and `dismiss` commands append a transition record, then display the effective state by combining the proposal's initial `"pending"` status with its transitions.

## Key Functions

### createActionProposal

Creates a `GovernanceActionProposal` from an existing `OperatorDecision`.

**Signature:**
```typescript
async function createActionProposal(
  proposalId: string,
  decision: OperatorDecision,
  signal: { signalId: string; title: string; description?: string; severity?: string },
  now: string,
): Promise<GovernanceActionProposal>
```

**Behaviour:**
- Throws if decision kind is not `escalate` or `convert_to_issue`
- Maps `escalate` → `escalation_review`, `convert_to_issue` → `github_issue`
- Preserves `decision.signalId` as the proposal's `signalId`
- Derives `title` and `description` from the signal's title/description/severity
- Sets `status` to `"pending"`
- Sets `executionRef` to `null`
- Validates the resulting proposal via `validateActionProposal`

### validateActionProposal

Validates a `GovernanceActionProposal` structure. Returns `ValidationResult`.

### refreshProposals

Scans the decision store for eligible decisions without existing proposals.

**Signature:**
```typescript
async function refreshProposals(
  signalStore: SignalStore,
  decisionStore: DecisionStore,
  actionQueueStore: ActionQueueStore,
  now: string,
): Promise<GovernanceActionProposal[]>
```

**Behaviour:**
1. Fetches all decisions from the decision store
2. Filters to `escalate` and `convert_to_issue` decisions only
3. For each eligible decision, checks if a proposal already exists for that `decisionId` + `kind` across **all** existing proposals (regardless of status). This prevents dismissed or executed proposals from being recreated on subsequent refresh runs
4. For each decision without an existing proposal, fetches the signal, creates a proposal via `createActionProposal`
5. Appends new proposals to the action queue store
6. Returns the list of newly created proposals

## CLI Interface

### List actions

```bash
alix governance actions                    # List all proposals (terminal output)
alix governance actions --status pending   # Filter by status
alix governance actions --kind github_issue # Filter by kind
alix governance actions --json             # Raw JSON output
```

### Refresh actions (derive from decisions)

```bash
alix governance actions refresh            # Scan decisions, create pending proposals
alix governance actions refresh --json     # JSON output with newly created proposals
```

### Manual status operations (optional but useful)

```bash
alix governance actions mark-executed <proposal-id> --ref "manual/github#123"
alix governance actions dismiss <proposal-id> --reason "Not needed"
```

### Flags

| Flag | Subcommand | Required | Description |
|---|---|---|---|
| `--status` | `actions` | No | Filter by status: `pending`, `marked_executed_elsewhere`, `dismissed` |
| `--kind` | `actions` | No | Filter by kind: `escalation_review`, `github_issue` |
| `--json` | `actions`, `actions refresh` | No | Machine-readable JSON output |
| `--ref` | `mark-executed` | Yes | Execution reference (e.g., URL, ticket ID) |
| `--reason` | `dismiss` | Yes | Explanation for dismissal |

## Behaviour

### `alix governance actions`
- **Store exists, has proposals:** lists proposals newest-first, terminal output. Effective status is derived by checking if the proposal has terminal transitions; a pending proposal with no transitions or only non-terminal records shows as `pending`.
- **Store exists, filtered:** applies status/kind filter
- **Store does not exist or empty:** empty list, informative message
- **JSON mode:** raw array output

### `alix governance actions refresh`
- **Eligible decisions found:** creates proposals, reports count
- **All eligible decisions already have proposals:** no duplicates created, reports "all up to date"
- **No eligible decisions (no escalate/convert_to_issue):** reports "no eligible decisions found"
- **Signal missing for a decision:** skips that decision, continues processing others (partial success)

### `alix governance actions mark-executed`
- **Proposal exists and is pending:** appends a transition record with status `marked_executed_elsewhere` and the provided `executionRef`
- **Proposal already has a terminal transition:** reports current status, does not append a second transition
- **Proposal not found:** error

### `alix governance actions dismiss`
- **Proposal exists and is pending:** appends a transition record with status `dismissed` and the provided `reason`
- **Proposal already has a terminal transition:** reports current status, does not append a second transition
- **Proposal not found:** error

## Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Cannot derive proposal from missing decision | `refreshProposals` skips or errors clearly when decision is unavailable |
| 2 | Proposal preserves decisionId backlink | `proposal.decisionId` matches the originating decision |
| 3 | Proposal preserves signalId backlink | `proposal.signalId` matches `decision.signalId` |
| 4 | Only escalate creates escalation_review proposal | `createActionProposal` maps escalate → escalation_review |
| 5 | Only convert_to_issue creates github_issue proposal | `createActionProposal` maps convert_to_issue → github_issue |
| 6 | accept/dismiss/defer create no proposals | `createActionProposal` throws for non-eligible decision kinds |
| 7 | Action queue store is append-only | No update/delete methods on FileActionQueueStore; status changes are append-only transition records |
| 8 | Refresh deduplicates across all proposals | `refreshProposals` checks decisionId+kind across all existing proposals (not just pending) |
| 9 | Dismissed proposals are not recreated by refresh | After dismiss, the same decisionId+kind pair blocks recreation |
| 10 | CLI supports terminal + JSON output | Both output modes functional |
| 11 | No GitHub issue creation | No issue bridge code in P14.4 |
| 12 | No signal mutation | No writes to signal store from P14.4 code |
| 13 | No decision mutation | No writes to decision store from P14.4 code |
| 14 | No audit entry creation | No audit store or write calls |

## Invariants

| # | Invariant | Enforcement |
|---|---|---|
| 1 | **Only eligible decisions produce proposals** — escalate and convert_to_issue only | `createActionProposal` validates decision.kind |
| 2 | **Decision backlink preserved** — every proposal references its originating decision | `proposal.decisionId` set from decision |
| 3 | **Signal backlink preserved** — every proposal preserves the full signal backlink chain | `proposal.signalId` set from decision.signalId |
| 4 | **Queue store is append-only** — primary write path is append; status changes are append-only transition records | `append()` and `appendStatusTransition()` are the only write methods — no mutation |
| 5 | **Refresh is idempotent** — running refresh multiple times creates no duplicates | Deduplication by decisionId + kind across all existing proposals, regardless of status |
| 6 | **No execution** — P14.4 never calls external APIs or mutates governance state | No issue bridge, no signal/decision/policy mutation |
| 7 | **Status transitions are append-only** — original proposal is never mutated | `appendStatusTransition` writes a new record; `getTransitions` derives effective state |

## Files

```
N: docs/architecture/specs/2026-07-06-p14-4-action-queue.md    # This spec
N: docs/architecture/plans/2026-07-06-p14-4-action-queue.md    # Companion plan
N: src/governance/action-queue.ts                                # Implementation
N: tests/governance/action-queue.test.ts                         # Tests
A: src/cli/commands/governance.ts                                # Add actions subcommands
```
