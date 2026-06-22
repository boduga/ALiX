# P6.2 — Operator Queue

> **Status:** Spec
> **Slice:** P6.2 Operator Queue (layer 4 of 5 in the P6 Decision Influence framework)
> **Builds on:** P6.0a DecisionContext, P6.0b RiskScore, P6.1 ApprovalRecommendation
> **Blocks:** P6.3 Strategic Brief
> **Risk level:** LOW — read-only, pure sorting, no new stores, no mutation paths

## Core Framing

**Core question:** What deserves attention first?

**Intelligence Law boundary:** Queue orders existing decision artifacts. It must NOT produce new evaluations, re-score risk, or recommend actions. It answers a single question: "Given these N items, which should the operator look at first?"

**Invariant:** Queue ≠ DecisionEngine — the OperatorQueue class is a pure sorting function. It takes pre-built DecisionContext, RiskScore, and ApprovalRecommendation tuples and returns an ordered list. All orchestration (building context/risk/recommendation per proposal) happens at the CLI layer.

### Layer Stack (P6)

```
DecisionContext: What do we know?
     RiskScore: What could go wrong?
Recommendation:  What appears reasonable?
   OperatorQueue: What deserves attention first?       ← here
 StrategicBrief: What patterns matter over time?
````

### Layer Ownership

| Layer | Owns | Must NOT Own |
|-------|------|-------------|
| DecisionContext | Context assembly | Risk evaluation |
| RiskScore | Risk evaluation | Recommendations |
| Recommendation | Decision guidance | Prioritization |
| **Queue** | **Attention ordering** | **Approval decisions** |
| Strategic Brief | Long-horizon synthesis | Operational actions |

## Data Model

### QueueInput — what the CLI assembles for the queue

```typescript
interface QueueInput {
  ctx: DecisionContext;
  riskScore: RiskScore;
  recommendation: ApprovalRecommendation;
}
```

This is the input contract for the OperatorQueue. The CLI layer builds one `QueueInput` per pending proposal before calling `OperatorQueue.build()`.

### Recommendation Prioritiy — tiebreaker rank

```typescript
export type RecommendationPriority = "investigate" | "reject" | "defer" | "approve";

export const RECOMMENDATION_RANK: Record<RecommendationPriority, number> = {
  investigate: 4,  // highest operator attention
  reject: 3,        // trust/integrity circuit breaker
  defer: 2,         // wait / refresh evidence
  approve: 1,       // lowest attention
};
```

`investigate` ranks highest because it signals a nuanced human-review need. `reject` is a narrow trust-circuit-breaker — important but less nuanced. `defer` and `approve` are lower-attention items.

### QueueItemOrdering — sort key provenance

```typescript
interface QueueItemOrdering {
  risk: number;              // RiskScore.overallRisk (0-1) — primary sort key
  recommendationRank: number; // RECOMMENDATION_RANK value — secondary sort key
  ageDays: number;           // DecisionContext.ageDays — tertiary sort key
}
```

### QueueItem — the output artifact

```typescript
interface QueueItem extends DecisionArtifact {
  proposalId: string;
  position: number;             // 1-indexed position in the sorted queue
  recommendationId?: string;    // link to source ApprovalRecommendation
  riskScoreId?: string;         // link to source RiskScore
  ordering: QueueItemOrdering;  // the sort keys that determined this position

  /** Forwarded from ApprovalRecommendation. Queue does not compute confidence. */
  confidence: number;

  /** Source artifacts: DecisionContext, RiskScore, ApprovalRecommendation. */
  sourceArtifacts: SourceArtifact[];
  // outcome inherited from DecisionArtifact: "queued"
}
```

- `confidence` is forwarded verbatim from `ApprovalRecommendation.confidence`. Queue does not compute, adjust, or re-evaluate confidence. The only exception: if no recommendation is available, confidence is 0.
- `outcome` is always `"queued"` — a stable, semantic value independent of queue size. Do NOT move toward `high_priority`, `position_1_of_12`, or similar — those would be secondary evaluations Queue does not own.
- `position` is 1-indexed and meaningful: position 1 = "look at this first"
- `sourceArtifacts` preserves the full decision artifact chain: the DecisionContext, RiskScore, and ApprovalRecommendation that produced this queue position. Format: `[{type: "context", id}, {type: "risk", id}, {type: "recommendation", id}]`.
- `reasons[]` explain *why* it's ordered where it is, not what to do:
  - "Highest risk among pending proposals (0.82)"
  - "Recommendation is investigate"
  - "Proposal is 12 days old; oldest pending item"

## Sort Rules

Four-tier deterministic sort:

1. **Primary:** `RiskScore.overallRisk` descending (highest risk first)
2. **Secondary:** `RecommendationPriority` by `RECOMMENDATION_RANK` descending (investigate → reject → defer → approve)
3. **Tertiary:** `DecisionContext.ageDays` descending (oldest first, since older proposals have been waiting longer)
4. **Final tiebreaker:** `proposalId` ascending (deterministic ordering)

**Edge case — missing RiskScore or Recommendation:** If a pending proposal has insufficient data to produce a RiskScore or Recommendation, its missing values are treated as neutral for sorting:
- Missing risk score → treated as 0 (lowest priority)
- Missing recommendation → treated as rank 0 (lowest rank, below `approve`). NOT mapped to `approve` — missing data is semantically different from a low-priority recommendation.
- The `reasons[]` note the gap: "No recommendation available — treated as lowest priority"

## OperatorQueue — Pure Sorting Class

```typescript
class OperatorQueue {
  /**
   * Sort QueueInput[] into a prioritized QueueItem[].
   *
   * Pure function — no stores, no side effects.
   * Deterministic: same inputs → same outputs.
   */
  build(inputs: QueueInput[], options?: { limit?: number }): QueueItem[];
}
```

- `limit` is applied AFTER sorting (not before): sort all, take top N
- Deterministic: same inputs in any order → same outputs
- No store access, no side effects, no evaluation logic

### CLI Orchestration

The `alix decision queue` command assembles QueueInputs:

```
list pending proposals from ProposalStore
  │
  ▼
for each pending proposal:
  DecisionContextBuilder.build(proposalId)
  RiskScoreBuilder.build(ctx)
  RecommendationEngine.recommend(ctx, riskScore)
  → QueueInput { ctx, riskScore, recommendation }
  │
  ▼
OperatorQueue.build(inputs, { limit })
  → QueueItem[]
  │
  ▼
render terminal output or JSON
```

This orchestration lives in the CLI handler, not in the OperatorQueue class. The queue class stays pure.

## CLI

```bash
alix decision queue              # Show sorted queue (terminal)
alix decision queue --json       # Full JSON output
alix decision queue --limit 5    # Top N items after sorting
```

### Terminal Output

```
Operator Queue: 8 pending proposals
═══════════════════════════════════════

 1. 🔴 prop-2026-06-21-005  investigate  risk: 0.82
    Proposal is 12 days old | Highest risk among pending

 2. 🟠 prop-2026-06-20-012  reject       risk: 0.71
    Lineage integrity failure | Trust circuit breaker

 3. 🟡 prop-2026-06-19-008  investigate  risk: 0.65
    High operational risk | Evidence incomplete

 4. ⚪ prop-2026-06-18-001  defer        risk: 0.45

 ...

 8. ⚪ prop-2026-06-17-003  approve      risk: 0.12
    Low risk, recommendation approve
```

**Icons per recommendation type:**
- 🔴 `investigate` — highest operator attention
- 🟠 `reject` — trust circuit breaker
- 🟡 `defer` — wait / refresh evidence
- ⚪ `approve` — lowest attention

### JSON Output

Raw `QueueItem[]` array — no wrapper for P6.2. A metadata wrapper (`OperatorQueueReport`) can be added in a later slice if needed.

## Governance Sentinels

### OperatorQueue purity sentinel

Tests verify that `operator-queue.ts` does NOT import:
- `RecommendationEngine`
- `RiskScoreBuilder`
- `DecisionContextBuilder`
- `ProposalStore`
- `EvidenceStore`
- Any store (`*-store` pattern)

The `OperatorQueue` must be a pure sorting class. All orchestration lives in the CLI handler.

### No mutation sentinel

Tests verify that `OperatorQueue` never calls `save()`, `update()`, `approve()`, `apply()`, `reject()`, or any lifecycle transition method. (Shared sentinel alongside existing P6 sentinels.)

### Intelligence Law sentinel (first in the codebase)

Tests verify that `operator-queue.ts` does NOT import any module that computes evaluation:
- `decision-confidence` or any confidence-computing module — Queue does not compute confidence
- Any scoring function or risk-calculation module — Queue does not calculate risk
- Any recommendation-rules or decision-logic module — Queue does not recommend

Tests verify that `operator-queue.ts` does NOT contain forbidden language patterns:
- `approve because` — Queue explains ordering, not outcomes
- `reject because` — Queue explains ordering, not outcomes
- `risk score computed as` — Queue only reads existing scores
- Any pattern that introduces new evaluation criteria beyond the four-tier sort

Queue may only: **read existing artifacts, sort, format output**.

## File Structure

```
Create:
  src/adaptation/operator-queue-types.ts   — QueueInput, QueueItem, QueueItemOrdering, RecommendationPriority, RECOMMENDATION_RANK
  src/adaptation/operator-queue.ts          — OperatorQueue class (pure sorting)
  src/adaptation/operator-queue.test.ts     — Unit tests
  tests/adaptation/operator-queue.vitest.ts — Unit tests
  tests/adaptation/queue-governance-sentinels.vitest.ts — Purity + no-mutation sentinels

Modify:
  src/cli/commands/decision.ts             — Add `queue` subcommand handler + case in switch
```

## Tests

### QueueItem type tests

| Test | Scenario |
|------|----------|
| QueueItem extends DecisionArtifact | Has outcome, confidence, reasons, warnings, evidenceRefs, generatedAt |
| QueueItem has proposalId, position, ordering, sourceArtifacts | Shape match |
| outcome is "queued" | Stable semantic value |
| confidence is forwarded from recommendation | Queue does not compute or adjust confidence |
| confidence is 0 when no recommendation | Missing data case |
| sourceArtifacts lists context, risk, recommendation | Provenance chain preserved |

### Sort correctness

| Test | Scenario |
|------|----------|
| Primary sort by risk descending | Higher risk first |
| Secondary sort by recommendation rank | investigate > reject > defer > approve |
| Tertiary sort by age descending | Older proposals first when risk and recommendation tie |
| Final tiebreaker by proposalId | Deterministic alphabetical |
| Full 4-tier sort integrated | All four levels compose correctly |

### Limit

| Test | Scenario |
|------|----------|
| No limit returns all items | Default behavior |
| Limit applied after sort | Given 10 items sorted, limit 5 returns top 5 |
| Limit 0 or negative returns empty | Edge case |

### Edge cases

| Test | Scenario |
|------|----------|
| Empty input returns empty | No pending proposals |
| Missing risk score (0) | Treated as lowest priority |
| Missing recommendation (rank 0) | Treated as lowest rank, below approve — not semantically overloaded |
| Determinism | Same inputs in shuffled order → same outputs |

### Governance sentinel tests

| Test | Scenario |
|------|----------|
| No store imports | operator-queue.ts doesn't import ProposalStore, EvidenceStore, or any `*-store` pattern |
| No builder/engine imports | Doesn't import DecisionContextBuilder, RiskScoreBuilder, RecommendationEngine |
| No mutation calls | Never calls save/update/approve/apply/reject |
| Intelligence Law — no evaluation imports | Doesn't import confidence, scoring, or recommendation modules |
| Intelligence Law — no evaluation language | No `approve because`, `reject because`, `risk score computed as`, or new evaluation criteria |

## Acceptance Criteria

1. `QueueItem` type matches this spec exactly (DecisionArtifact extension, position, ordering, sourceArtifacts, stable `"queued"` outcome)
2. `QueueItem.confidence` is forwarded from `ApprovalRecommendation.confidence` — Queue does not compute or adjust
3. `QueueItem.sourceArtifacts` preserves context, risk, and recommendation provenance
4. `OperatorQueue.build(inputs)` returns deterministic, risk-first sorted items
5. `OperatorQueue.build(inputs, { limit: 5 })` returns top 5 after sorting
6. Missing risk score (0) handled gracefully; missing recommendation → rank 0, not "approve"
7. CLI `alix decision queue` renders terminal output with correct icons
8. CLI `alix decision queue --json` outputs valid `QueueItem[]` JSON
9. CLI `alix decision queue --limit 5` applies limit after sort
10. Governance sentinels pass (purity + no mutation + Intelligence Law)
11. All existing tests pass
12. Queue is computed fresh each run — no persistence

## Out of Scope

| Feature | Belongs to | Reason |
|---------|-----------|--------|
| Queue persistence / store | Future | Queue is a view, not a source of truth |
| Pagination beyond limit | Future | YAGNI for current scale |
| Filter by recommendation type | Future | YAGNI — can be added via `--filter` later |
| Multi-factor scoring | Never — would violate Intelligence Law | Would duplicate RiskScore/Recommendation reasoning |
| Auto-skip / auto-approve low-priority items | Never — would violate Recommend≠Decide | |
| Queue metadata wrapper | P6.3+ | YAGNI — raw array sufficient |
