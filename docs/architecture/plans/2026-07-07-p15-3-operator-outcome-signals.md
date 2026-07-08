# P15.3a — Operator Outcome Signals

**Date:** 2026-07-07
**Status:** Plan
**Depends on:** P14.3 (Decision Capture), P14.4 (Action Queue), P14.5a (Audit Store)
**Spec:** `docs/architecture/specs/2026-07-07-p15-3-operator-outcome-signals.md`

## Overview

Measure whether operator decisions tend to produce stable, useful governance outcomes — without ranking people, judging intent, or creating punitive performance scores. Pure computation module; five signal sections.

## Tasks

### Task 1 — `src/governance/operator-effectiveness.ts` (pure module)

**Data inputs** (all fetched by the CLI handler, passed to the module — zero store access):

```typescript
export function computeEffectiveness(
  auditEvents: GovernanceAuditEvent[],
  decisions: OperatorDecision[],
  reviews: OperatorReview[],
  proposals: GovernanceActionProposal[],
  transitions: ActionProposalStatusTransition[],
  options?: { staleThresholdDays?: number },
): OperatorEffectivenessReport
```

**Signal logic (all pure, zero store access):**

#### 1. Decision stability

For each decision in `input.decisions`:
- Scan `input.auditEvents` for contradictory events on the same `signalId`/`traceId` that occurred AFTER the decision timestamp.
- Contradictory if: decision was `accept`/`allow` and a later `action_denied` exists on the same subject; or decision was `deny`/`dismiss` and a later `action_allowed` exists.
- Count total, reversed, compute rate.

**Contradiction mapping** (same `traceId` + `subjectId`, event timestamp after decision timestamp):

| Decision kind | Contradicted by |
|---------------|----------------|
| `accept` | Later `action_denied` or `override_applied` |
| `dismiss` | Later `action_allowed` or `override_applied` |
| `defer` | No contradiction (stale check only) |
| `escalate` | Not contradicted by later allow/deny; escalated decisions have their own effectiveness path |
| `convert_to_issue` | Not contradicted by later allow/deny |

#### 2. Escalation effectiveness

For each `escalate`/`convert_to_issue` decision:
- Check if `input.proposals` contains a proposal with matching `decisionId`.
- If yes, check `input.transitions` for that proposal's status transitions.
- Compute: escalation→action rate, resolution rate, median time-to-resolution, pending count.

#### 3. Review completeness

For each review in `input.reviews`:
- Check `notes !== null`, `classification !== null`.
- Compute counts and rate.

#### 4. Stale/stuck decisions

For each `defer` decision:
- Find the latest contradictory event in `input.auditEvents` after the deferral.
- If none exists and the decision is older than `staleThresholdDays` (default 7), count as stale.
- Compute average stale days. Stale list sorted by `deferredAt` ascending (oldest first), then `decisionId` ascending.

#### 5. Throughput context

Group `input.decisions` by `decider`, count. Group `input.reviews` by `reviewer`, count. **Sort alphabetically by `operatorId` ascending** (not by count descending — avoids implied leaderboard). No scoring or ranking labels.

### Task 2 — CLI handler

**File:** `src/cli/commands/governance.ts`

Add `case "effectiveness"` to audit dispatch → `runAuditEffectiveness(cwd, args, jsonMode)`.

**Flags:**
- `--since <iso>` — start of analysis window
- `--until <iso>` — end of analysis window
- `--stale-days <N>` — stale threshold (default 7)
- `--json` — machine-readable output

**Time‑window semantics:** `[since, until)` — inclusive lower, exclusive upper. Default window: last 7 days.

Decisions and reviews filtered to `since <= createdAt < until`. Audit events need **wider window**: `since <= timestamp < until + staleThresholdDays`. This ensures contradictions, reversals, and resolution events that occur shortly after a decision are visible. Without lookahead, a decision near `until` falsely appears stable.

**Implementation flow:**

```
1. Parse flags (--since, --until, --stale-days, --json)
2. If no --since/--until, default to last 7 days (now - 7d → now)
3. Validate timestamps
4. Fetch data from:
   - FileAuditStore.list()
   - FileDecisionStore.list()
   - FileReviewStore.list()
   - FileActionQueueStore (proposals + transitions)
5. Apply time filters [since, until) to decisions/reviews
6. Call computeEffectiveness(auditEvents, decisions, reviews, proposals, transitions, { staleThresholdDays })
7. Render human-readable report or --json
```

No operator ranking or comparison in human output. Throughput is a flat list of "operator: N items" without comparison language.

### Task 3 — Unit tests

**File:** `tests/governance/operator-effectiveness.test.ts`

**Fixture:** Build a known set of 10+ operator decisions, reviews, proposals, transitions, and audit events across ~5 operators.

| # | Test | Signal |
|---|------|--------|
| 1 | Accept decisions with no contradictions → reversalRate = 0 | Stability |
| 2 | Accept decisions followed by action_denied → reversalRate > 0 | Stability |
| 3 | Escalate with proposal + resolved transition → resolutionRate = 1.0 | Escalation |
| 4 | Escalate with no proposal → escalationToActionRate = 0 | Escalation |
| 5 | Reviews with notes + classification → completenessRate = 1.0 | Completeness |
| 6 | Reviews with null notes → completenessRate < 1.0 | Completeness |
| 7 | Defer older than stale threshold → staleCount > 0 | Stale |
| 8 | Defer with later terminal event → not stale | Stale |
| 9 | Empty input → all zero-valued results | Edge case |
| 10 | Throughput grouped by operator → correct counts | Throughput |

## Estimated additions

| File | Lines | Change type |
|------|-------|-------------|
| `src/governance/operator-effectiveness.ts` | ~250 | New |
| `src/cli/commands/governance.ts` | ~100 | Extend (dispatch + handler) |
| `tests/governance/operator-effectiveness.test.ts` | ~250 | New |
| **Total new** | ~600 | |

## Dependencies

- `src/governance/audit-types.ts` — event types
- `src/governance/decision-capture.ts` — `OperatorDecision`, `DecisionStore`
- `src/governance/operator-review.ts` — `OperatorReview`
- `src/governance/action-queue.ts` — `GovernanceActionProposal`, `ActionProposalStatusTransition`
- `src/cli/commands/governance.ts` — CLI dispatch + handler

## Acceptance gate

P15.3a is complete when:
1. All 5 signal sections produce correct results for known fixture data
2. Empty/no-data state produces zero-valued signals with no crashes
3. All tests pass; TypeScript clean
4. Pure module invariant: zero store imports in `operator-effectiveness.ts`
5. CLI renders readable output + `--json`
6. No operator ranking or punitive scoring in output
