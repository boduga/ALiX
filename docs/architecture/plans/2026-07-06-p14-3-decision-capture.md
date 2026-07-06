# P14.3 — Decision Capture Plan

**Date:** 2026-07-06
**Status:** Planned — spec ready
**Spec:** `docs/architecture/specs/2026-07-06-p14-3-decision-capture.md`
**Depends on:** P14.1 (GovernanceSignal), P14.2 (OperatorReview)

## Thesis

P14.3 records explicit operator decisions (accept, dismiss, defer, escalate, convert_to_issue) on P14.1 signals. Decisions are append-only, require rationale, and never execute or enforce — they record intent only.

## Scope

| In scope | Out of scope |
|---|---|
| `OperatorDecision` type with 5 kinds | Action proposal creation |
| `FileDecisionStore` append-only JSONL | GitHub issue creation |
| `validateOperatorDecision()` | Audit trail events |
| `createOperatorDecision()` with signal gate | Signal status mutation |
| `actionProposalId: null` (type-level) | Policy/gate/threshold changes |
| `alix governance decide <signal-id> --<kind> --reason` CLI | Enforcement of any kind |

## Implementation Order

```
1. OperatorDecision type + validateOperatorDecision()
2. FileDecisionStore (append-only, methods: append/list/getById/getBySignalId/getByKind)
3. createOperatorDecision()
   - signal-existence gate
   - rationale required
   - decider resolved deterministically
   - optional reviewId verified against ReviewStore
   - review.signalId must match decision.signalId
4. Reader/display helpers (list decisions by kind, render decision detail)
5. alix governance decide CLI dispatch + handlers:
   a. Parse exactly one kind flag (mutual exclusion)
   b. Validate signal exists, rationale non-empty
   c. Create decision record (actionProposalId: null)
   d. Render decision output
6. Terminal rendering + JSON output
7. Tests
```

## Key Design Decisions

### 1. actionProposalId is null at type level

`actionProposalId: null` (literal type, not `string | null`). This structurally enforces that P14.3 does not create action proposals. P14.4 will widen the type when it introduces the action queue.

### 2. Five decision kinds, mutual exclusivity

Exactly one kind flag required per invocation. The CLI validates that no zero or multiple kind flags are provided.

### 3. Rationale required

Every decision must have a non-empty rationale. This enforces P14 invariant 2 ("every decision requires rationale") at the type + validation level.

### 4. No signal mutation

`GovernanceSignal.status` is untouched. The signal's decided state is derived by querying decision records for a `signalId`. P14.5 will introduce formal lifecycle transitions.

### 5. Review backlink is optional but validated

`reviewId` is `string | null`. When provided, it must reference an existing P14.2 review for the same signalId. This preserves the decision → review → signal chain without requiring every decision to have a review.

## Files

```
N: docs/architecture/specs/2026-07-06-p14-3-decision-capture.md  # Spec
N: docs/architecture/plans/2026-07-06-p14-3-decision-capture.md  # This plan
N: src/governance/decision-capture.ts                               # Implementation
N: tests/governance/decision-capture.test.ts                        # Tests
A: src/cli/commands/governance.ts                                   # Add decide subcommand
```

## Acceptance Checklist

- [ ] Cannot decide on missing signal
- [ ] Decision preserves signalId backlink
- [ ] Rationale is required and non-empty
- [ ] Exactly one decision kind selected (mutual exclusivity)
- [ ] actionProposalId is always `null`
- [ ] Decision store is append-only
- [ ] CLI supports terminal + JSON output
- [ ] No signal mutation (no signal store writes)
- [ ] No GitHub issue creation
- [ ] No audit entry creation
- [ ] Decider identity is recorded (non-empty, resolved deterministically)
- [ ] Optional review backlink is valid (review exists for same signalId)

## Verification

```bash
pnpm build
npx tsc --noEmit
node --test dist/tests/governance/decision-capture.test.js
pnpm test:vitest
GitNexus detect-changes
```
