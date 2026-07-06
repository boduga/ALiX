# P14.2 — Operator Review Session Design

**Date:** 2026-07-06
**Status:** Design

## Purpose

Let an operator open a signal from the P14.1 inbox, inspect its evidence chain, add free-text observations, and optionally re-classify it. The review record is append-only and does **not** mutate the signal or introduce decisions, action proposals, or audit events.

P14.2 is the pure review layer before P14.3 decision capture.

## Non-goals

- **No decisions** — accept, dismiss, defer, escalate, and convert_to_issue are out of scope.
- **No action proposals** — the review layer creates no follow-up actions.
- **No audit trail** — P14.5 handles audit events. P14.2 reviews are stored but not forwarded to an audit ledger.
- **No signal mutation** — the `GovernanceSignal` record is not updated. Reviewing status is derived from the presence of review records for a given `signalId`.
- **No enforcement** — reviews do not change policy, gates, risk thresholds, or any governance state.

## Architecture

```
P14.1 Signal Store ──┐
                     ├──→ P14.2 Review Session ──→ P14.3 Decision Capture
                     │        (append-only)
                     ▼
            P14.2 Review Store
            (governance-reviews.jsonl)
```

P14.2 is a pure data-collection layer:
1. Operator runs `alix governance review <signal-id> [--notes "..." ] [--classification "..."]`
2. CLI resolves the reviewer identity, verifies the signal exists in P14.1 store
3. An `OperatorReview` record is created and appended to `FileReviewStore`
4. The store is append-only — reviews are never mutated or deleted

## Core Objects

### OperatorReview

```typescript
interface OperatorReview {
  reviewId: string;                    // uuid
  signalId: string;                    // must reference an existing signal
  reviewer: string;                    // resolved identity
  notes: string | null;                // free-text observations
  classification: string | null;       // optional re-classification
  createdAt: string;                   // ISO timestamp
}
```

### Validation Rules

| Field | Rule |
|---|---|
| `reviewId` | Required, non-empty string |
| `signalId` | Required, non-empty string |
| `reviewer` | Required, non-empty string |
| `notes` | Optional — may be null only if `classification` is provided |
| `classification` | Optional — may be null only if `notes` is provided |
| `createdAt` | Required, non-empty string |

At least one of `notes` or `classification` must be present on every review.

## Reviewer Resolution

The reviewer identity is resolved with the following precedence:

1. Explicit `--as` flag on the CLI (overrides all)
2. `git config user.name` from the current working directory
3. `USER` environment variable
4. Fallback literal `"operator"`

## State Storage

Append-only JSONL store matching the P14.1 `FileSignalStore` pattern.

```
governance-reviews.jsonl        # in the same baseDir (process.cwd())
```

### Store Interface

```typescript
interface ReviewStore {
  append(review: OperatorReview): Promise<void>;
  list(limit?: number): Promise<OperatorReview[]>;
  getById(reviewId: string): Promise<OperatorReview | null>;
  getBySignalId(signalId: string): Promise<OperatorReview[]>;
}
```

### Invariant: No Review for Missing Signal

`createOperatorReview()` checks the P14.1 signal store before appending a review. If the signal does not exist, the review is rejected with a clear error. This enforces the review → signal backlink at creation time rather than relying on referential integrity at query time.

## CLI Interface

```bash
alix governance review <signal-id>                        # Show signal + prior reviews (read-only — no review created)
alix governance review <signal-id> --notes "observed..."  # Create review with notes
alix governance review <signal-id> --classification "..." # Create review with classification
alix governance review <signal-id> --notes "..." --classification "..."
alix governance review <signal-id> --json                 # Machine-readable output
alix governance review <signal-id> --as "Jane"            # Explicit reviewer identity
```

### Flags

| Flag | Description |
|---|---|
| `--notes` | Free-text observations (at least one of `--notes` or `--classification` required to create) |
| `--classification` | Optional re-classification of the signal |
| `--json` | Machine-readable JSON output |
| `--as` | Explicit reviewer identity override |

### Behaviour

- **No creation flags (`--notes` and `--classification` both absent):** CLI shows the signal detail and any prior reviews for that signal. Read-only — no review record is created. If the signal has no prior reviews, it shows "No prior reviews."
- **Creation flags present (`--notes` or `--classification`):** CLI validates the signal exists, resolves reviewer identity, creates an `OperatorReview`, appends it to the store, and renders the result.
- **Signal missing:** CLI exits with error: "Signal not found: <signal-id>. Cannot create review for missing signal."
- **No notes or classification on create:** CLI requires at least one. Error: "At least one of --notes or --classification must be provided to create a review."
- **`--interactive` (future):** A proposed flag for interactive prompt mode — not implemented in P14.2.

## Workflow

### Read-only view (no flags)

```
Operator
  │
  ▼
alix governance review <signal-id>
  │
  ├── Signal exists? ──No──→ Error: signal not found
  │
  Yes
  │
  ▼
Show signal detail + any prior reviews (read-only)
  │
  ▼
No review record created — operator inspects, then returns to shell
```

### Create review (--notes or --classification)

```
Operator
  │
  ▼
alix governance review <signal-id> --notes "..." --classification "..."
  │
  ├── Signal exists? ──No──→ Error: signal not found
  │
  Yes
  │
  ├── Has notes or classification? ──No──→ Error: requires at least one
  │
  Yes
  │
  ▼
Resolve reviewer identity (--as → git → env → "operator")
  │
  ▼
Create OperatorReview record (validate + append to store)
  │
  ▼
Render review session (terminal or JSON)
```

## Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Review cannot be created for missing signal | `createOperatorReview` throws when signal not found |
| 2 | Review preserves signalId backlink | `review.signalId` matches the CLI argument |
| 3 | Reviewer identity is resolved deterministically | `resolveReviewer()` with known precedence |
| 4 | Notes or classification must be present | Validation rejects null for both |
| 5 | Store is append-only | No update/delete methods on FileReviewStore |
| 6 | CLI renders review session and JSON output | Terminal + `--json` both functional |
| 7 | P14.1 signal inbox behavior unchanged | No writes to signal store; no status changes |
| 8 | No decision/action/audit behavior introduced | No types or code paths for those concepts |

## Invariants

| # | Invariant | Enforcement |
|---|---|---|
| 1 | **No review for missing signal** — `createOperatorReview` verifies signal exists | Check against P14.1 signal store on creation |
| 2 | **Review records are append-only** — no update, no delete | Store interface lacks mutating methods |
| 3 | **Signal is not mutated** — review does not change `GovernanceSignal.status` | No writes to signal store from P14.2 |
| 4 | **Reviewer identity is recorded** — all reviews have a non-empty `reviewer` | Validation rejects empty reviewer |
| 5 | **At least one of notes or classification** — no empty reviews | Validation rejects when both are null/empty |

## Files

```
src/governance/operator-review.ts               # Create — types, store, validation, createOperatorReview
tests/governance/operator-review.test.ts         # Create — tests
src/cli/commands/governance.ts                   # Amend — add review subcommand handler and switch case
```
