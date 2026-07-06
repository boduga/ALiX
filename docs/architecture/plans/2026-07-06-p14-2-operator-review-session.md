# P14.2 — Operator Review Session Plan

**Date:** 2026-07-06
**Status:** Planned — spec ready
**Spec:** `docs/architecture/specs/2026-07-06-p14-2-operator-review-session.md`
**Depends on:** P14.1 (GovernanceSignal, FileSignalStore)

## Thesis

P14.2 gives the operator a structured, append-only review session for any signal in the P14.1 inbox. The operator can inspect a signal (implicitly, via the CLI context), add notes, and optionally re-classify it. No decisions, no action proposals, no audit events, no signal mutation.

## Scope

| In scope | Out of scope |
|---|---|
| `OperatorReview` type | Decisions (accept/dismiss/defer/escalate) |
| `FileReviewStore` (append-only JSONL) | Action proposals |
| `validateOperatorReview()` | GitHub issue conversion |
| `createOperatorReview()` | Audit trail events |
| `resolveReviewer()` | Signal status mutation |
| `alix governance review <signal-id>` CLI | Signal store writes |

## Implementation Order

```
1. OperatorReview type + validateOperatorReview() + resolveReviewer()
2. FileReviewStore (append-only JSONL, methods: append/list/getById/getBySignalId)
3. createOperatorReview() (signal-existence gate)
4. alix governance review <signal-id> CLI dispatch + handlers
5. Terminal rendering + JSON output
6. Tests
```

## Key Design Decisions

### 1. Append-only, no signal mutation

The review record is separate from the signal record. `GovernanceSignal.status` stays `"new"` even after a review. The reviewing state is derived by querying review records for a `signalId`. This gives a complete audit of who reviewed what without mutating the original signal.

### 2. Reviewer resolution precedence

git config > env USER > "operator". The `--as` flag overrides everything. Git-based identity matches the existing development workflow.

### 3. Signal-existence gate

`createOperatorReview` checks the P14.1 `FileSignalStore` before writing. This enforces referential integrity at creation time rather than deferring to a join at query time.

### 4. At least one of notes or classification

Prevents empty reviews. Either free-text notes or a structured classification tag must be present (both is fine).

## Files

```
N: docs/architecture/specs/2026-07-06-p14-2-operator-review-session.md  # This spec
N: docs/architecture/plans/2026-07-06-p14-2-operator-review-session.md  # This plan
N: src/governance/operator-review.ts                                      # Implementation
N: tests/governance/operator-review.test.ts                               # Tests
A: src/cli/commands/governance.ts                                         # Add review subcommand
```

Key: N = new file, A = amend existing file

## Verification

```bash
pnpm build
npx tsc --noEmit
node --test dist/tests/governance/operator-review.test.js
pnpm test:vitest
GitNexus detect-changes
```
