# P15.3a — Operator Outcome Signals

**Date:** 2026-07-07
**Status:** Design
**Parent:** P15.0 — Governance Observability & Audit Intelligence
**Depends on:** P14.3 (Decision Capture), P14.4 (Action Queue), P14.5a (Audit Store)

## Purpose

Measure whether operator decisions tend to produce stable, useful governance outcomes — without ranking people, judging intent, or creating punitive performance scores. Outcome-linked, explainable signals derived from existing governance/audit events.

## Signals

### 1. Decision stability

For each operator decision recorded via P14.3 (`action_allowed`, `action_denied`, `action_escalated`, `override_applied`), determine whether it was later contradicted or remained stable.

| Signal | Definition | Source |
|--------|------------|--------|
| Reversal rate | % of decisions where a later event on the same `traceId`+`subjectId` contradicts the original decision | Audit trail: `action_allowed` contradicted by later `action_denied` or `override_applied`; `action_denied` contradicted by later `action_allowed` or `override_applied` |
| Override rate | % of escalated decisions where the resulting action proposal was dismissed or marked-executed-elsewhere | Action queue: `appendStatusTransition` |
| Stable window | Decisions with no contradictory event within N days | Default 7 days |

### 2. Escalation effectiveness

For decisions that resulted in escalation (`decisionKind === "escalate"` or `"convert_to_issue"`):

| Signal | Definition | Source |
|--------|------------|--------|
| Escalation → action rate | % of escalations that produced a governance action proposal | P14.3 → P14.4: `actionProposalId` |
| Escalation → resolution rate | % of escalation proposals that reached a terminal status | P14.4: `appendStatusTransition` to terminal |
| Time-to-resolution | Average/median time from escalation to terminal transition | P14.4 transitions |
| Escalations pending | Count of escalation proposals still in "pending" status, grouped by age | P14.4: `list()` with age calculation |

### 3. Review completeness

For operator reviews submitted via P14.2:

| Signal | Standard |
|--------|----------|
| Has notes | Whether `notes !== null` |
| Has classification | Whether `classification !== null` |
| Both present | Both notes AND classification provided |
| Completeness rate | % of reviews that have both |

### 4. Deferred/stale decisions

Decisions of kind `defer` that have not reached a terminal outcome within a configurable window (default 7 days).

| Signal | Definition |
|--------|------------|
| Stale deferred | Deferred decisions older than N days with no terminal resolution (no `action_allowed` or `action_denied` after the deferral) |
| Average stale age | Average days since deferral for unresolved items |

### 5. Throughput context (descriptive only)

| Signal | Definition |
|--------|------------|
| Decisions per operator | Count of `action_*` decisions grouped by `decider` |
| Reviews per operator | Count of review submissions grouped by `reviewer` |
| Time window | All throughput metrics bounded by `--since`/`--until` |

Throughput is not ranked, scored, or compared. It provides context for interpreting stability/effectiveness signals.

## Output type

```typescript
export interface OperatorEffectivenessReport {
  /** Time window of the analysis. */
  windowStart: string;
  windowEnd: string;

  /** Decision stability signals. */
  decisionStability: {
    totalDecisions: number;
    reversed: number;
    reversalRate: number;         // 0–1
    decisionCounts: Record<string, number>;  // by decisionKind
  };

  /** Escalation effectiveness signals. */
  escalationEffectiveness: {
    totalEscalations: number;
    producedProposals: number;
    escalationToActionRate: number;  // 0–1
    resolvedProposals: number;
    resolutionRate: number;          // 0–1 (of proposals)
    medianResolutionMs: number | null;
    pendingEscalations: number;
  };

  /** Review completeness signals. */
  reviewCompleteness: {
    totalReviews: number;
    withNotes: number;
    withClassification: number;
    withBoth: number;
    completenessRate: number;        // 0–1
  };

  /** Deferred/stale decision signals. */
  staleDecisions: {
    totalDeferred: number;
    staleCount: number;
    staleThresholdDays: number;
    averageStaleDays: number | null;
    stale: Array<{ decisionId: string; signalId: string; deferredAt: string; daysSinceDeferral: number }>;
  };

  /** Throughput context (descriptive only, not ranked). */
  throughputContext: {
    decisionsByOperator: Array<{ operatorId: string; count: number }>;
    reviewsByOperator: Array<{ operatorId: string; count: number }>;
    totalDecisions: number;
    totalReviews: number;
  };
}
```

## Architecture

```
CLI (governance.ts: runAuditEffectiveness)
        ↓
operator-effectiveness.ts (pure — zero store access)
  computeEffectiveness(auditEvents, decisions, reviews, actionProposals, transitions, options?)
        ↓       ↔       ↔       ↔
  audit-store  decision-store  action-queue-store  review-store
  (read-only)    (read-only)     (read-only)         (read-only)
```

The pure computation module accepts already-fetched data. The CLI handler fetches stores.

## Files

| File | Change |
|------|--------|
| `src/governance/operator-effectiveness.ts` | **New** — pure module, ~250 lines |
| `src/cli/commands/governance.ts` | Extend audit dispatch (`case "effectiveness"`) + handler, ~80 lines |
| `tests/governance/operator-effectiveness.test.ts` | **New** — unit tests with fixture data, ~250 lines |

## Deterministic sort rules (no ranking)

Throughput lists use alphabetical sort by `operatorId` (ascending). This reinforces "context only" — no count-desc comparison that implies a leaderboard.

- `decisionsByOperator`: sorted by `operatorId` ascending.
- `reviewsByOperator`: sorted by `operatorId` ascending.
- `stale` decisions: sorted by `deferredAt` ascending (oldest first), then `decisionId` ascending.

## Time-window semantics

- `--since` / `--until` uses `[since, until)` — inclusive lower, exclusive upper.
- Filtering applies to `decision.createdAt`, `review.createdAt`, and `event.timestamp`.
- Default window: last 7 days unless explicitly provided.
- The report `windowStart`/`windowEnd` always reflect the actual window used.

## Non-goals

- No operator ranking or leaderboard
- No punitive productivity scoring
- No ML or statistical inference
- No cross-operator fairness claims
- No decision consistency analysis yet (P15.3c)
- No new audit event types
- No changes to P14 stores, decorators, or emission
- No persistent storage of effectiveness reports (computed per CLI invocation)

## Acceptance gate

P15.3a is complete when:
1. All 5 signal sections produce correct results for known fixture data
2. Empty/no-data state produces zero-valued signals (no crashes)
3. All tests pass; TypeScript clean
4. Pure module invariant: zero store imports in `operator-effectiveness.ts`
5. CLI renders human-readable output + `--json`
6. No operator ranking or scoring (throughput is count-only, descriptive)
