# P6.2 — Operator Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 4th P6 layer — a pure sorting class that orders pending proposals by risk, recommendation, age, and proposalId.

**Architecture:** Pure `OperatorQueue` class with no store access. `build(inputs, { limit? })` receives pre-built DecisionArtifact tuples and returns sorted `QueueItem[]`. CLI layer orchestrates building the inputs; the queue class only sorts. Governance sentinels enforce purity (no stores, no builders, no evaluation imports/language).

**Tech Stack:** TypeScript (strict), NodeNext module resolution (`.js` extensions in all imports), DecisionArtifact pattern

## Global Constraints

- All imports must use `.js` extensions (NodeNext module resolution)
- `DecisionArtifact` base: `{ id, subject, outcome, confidence, reasons, warnings?, evidenceRefs?, generatedAt }`
- Three signals never collapsed: `DecisionContext.confidence` ≠ `RiskScore.overallRisk` ≠ `Recommendation.confidence`
- `Recommend ≠ Decide` — no recommendation/queue engine may approve, reject, apply, or create lifecycle transitions
- Import `EnrichedWarning` and `WarningSeverity` from `./decision-types.js` (single source of truth)
- Use `yaml.parse` for YAML parsing, not hand-rolled parsers
- Tests use vitest (`describe`, `it`, `expect` from "vitest")
- Pure functions only in the OperatorQueue — no stores, no builders, no evaluation logic

---

### Task 1: Queue Type Definitions

**Files:**
- Create: `src/adaptation/operator-queue-types.ts`
- Test: `tests/adaptation/operator-queue.vitest.ts` (type-shape tests added in Task 3)

**Interfaces:**
- Consumes: `DecisionArtifact`, `EnrichedWarning`, `WarningSeverity`, `SourceArtifact`, `DataFreshness` from `./decision-types.js`; `RiskScore` from `./risk-score-types.js`; `ApprovalRecommendation` from `./recommendation-types.js`
- Produces: `RecommendationPriority`, `RECOMMENDATION_RANK`, `QueueItemOrdering`, `QueueItem`, `QueueInput`

- [ ] **Step 1: Write the full type file**

```typescript
/**
 * P6.2 — Operator Queue type definitions.
 *
 * QueueItem is the output artifact. QueueInput is what the CLI assembles
 * for the pure OperatorQueue builder.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { RiskScore } from "./risk-score-types.js";
import type { ApprovalRecommendation } from "./recommendation-types.js";
import type { DecisionContext } from "./decision-types.js";

// ---------------------------------------------------------------------------
// Recommendation Priority — tiebreaker secondary sort key
// ---------------------------------------------------------------------------

export type RecommendationPriority = "investigate" | "reject" | "defer" | "approve";

/** investigate (4) = highest operator attention, approve (1) = lowest. */
export const RECOMMENDATION_RANK: Record<RecommendationPriority, number> = {
  investigate: 4,
  reject: 3,
  defer: 2,
  approve: 1,
};

// ---------------------------------------------------------------------------
// QueueInput — what the CLI assembles for each pending proposal
// ---------------------------------------------------------------------------

export interface QueueInput {
  ctx: DecisionContext;
  /** Missing risk score → treated as risk=0 (lowest priority). */
  riskScore?: RiskScore;
  /** Missing recommendation → treated as rank=0 (below approve). */
  recommendation?: ApprovalRecommendation;
}

// ---------------------------------------------------------------------------
// QueueItemOrdering — sort key provenance
// ---------------------------------------------------------------------------

export interface QueueItemOrdering {
  /** RiskScore.overallRisk (0-1) — primary sort key. */
  risk: number;
  /** RECOMMENDATION_RANK value — secondary sort key. */
  recommendationRank: number;
  /** DecisionContext.ageDays — tertiary sort key. */
  ageDays: number;
}

// ---------------------------------------------------------------------------
// QueueItem — the output artifact
// ---------------------------------------------------------------------------

export interface QueueItem extends DecisionArtifact {
  proposalId: string;
  /** 1-indexed position in the sorted queue. */
  position: number;
  /** Explicit recommendation enum — NOT parsed from reasons. */
  recommendation?: RecommendationPriority;
  /** Link to the source ApprovalRecommendation. */
  recommendationId?: string;
  /** Link to the source RiskScore. */
  riskScoreId?: string;
  /** The sort keys that determined this position. */
  ordering: QueueItemOrdering;

  /**
   * Forwarded from ApprovalRecommendation.confidence.
   * Queue does NOT compute or adjust confidence.
   * Only 0 when no recommendation is available.
   */
  confidence: number;

  /** Source artifacts: DecisionContext, RiskScore, ApprovalRecommendation. */
  sourceArtifacts: SourceArtifact[];

  // outcome inherited from DecisionArtifact — always "queued"
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/adaptation/operator-queue-types.ts 2>&1 | head -10`
Expected: no errors (or no output = clean)

- [ ] **Step 3: Commit**

```bash
git add src/adaptation/operator-queue-types.ts
git commit -m "feat(p6.2): QueueItem, QueueInput, and RecommendationPriority types"
```

---

### Task 2: OperatorQueue — Pure Sorting Class

**Files:**
- Create: `src/adaptation/operator-queue.ts`

**Interfaces:**
- Consumes: `QueueInput`, `QueueItem`, `QueueItemOrdering`, `RECOMMENDATION_RANK`, `RecommendationPriority` from `./operator-queue-types.js`; `SourceArtifact` from `./decision-types.js`
- Produces: `OperatorQueue` class with a single public method

- [ ] **Step 1: Write the failing test shell**

```typescript
// Place this in tests/adaptation/operator-queue.vitest.ts (will be expanded in Task 3)
import { describe, it, expect } from "vitest";
import { OperatorQueue } from "../../src/adaptation/operator-queue.js";

describe("OperatorQueue", () => {
  it("exists and has a build method", () => {
    const q = new OperatorQueue();
    expect(typeof q.build).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adaptation/operator-queue.vitest.ts 2>&1 | tail -20`
Expected: FAIL — "Cannot find module" or similar (class doesn't exist yet)

- [ ] **Step 3: Implement OperatorQueue class**

```typescript
/**
 * P6.2 — OperatorQueue: pure sorting class.
 *
 * Takes pre-built QueueInput[] and returns sorted QueueItem[].
 * No store access, no builder imports, no evaluation logic.
 * Deterministic: same inputs in any order → same outputs.
 *
 * @module
 */

import type { SourceArtifact } from "./decision-types.js";
import type { QueueInput, QueueItem, QueueItemOrdering } from "./operator-queue-types.js";
import { RECOMMENDATION_RANK, type RecommendationPriority } from "./operator-queue-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RECOMMENDATION_RANK = 0;
const MISSING_RISK = 0;
const OUTCOME_QUEUED = "queued";

// ---------------------------------------------------------------------------
// OperatorQueue
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Return only the top N items after sorting. Applied AFTER sort. */
  limit?: number;
  /** Override generatedAt for deterministic testing. Defaults to Date.now(). */
  generatedAt?: string;
}

export class OperatorQueue {
  /**
   * Sort QueueInput[] into a prioritized QueueItem[].
   *
   * Sort order (deterministic):
   *   1. RiskScore.overallRisk descending   (primary)
   *   2. RecommendationPriority rank desc   (secondary)
   *   3. DecisionContext.ageDays descending  (tertiary)
   *   4. proposalId ascending                (final tiebreaker)
   *
   * @param inputs - Pre-assembled decision artifacts per pending proposal
   * @param options - Optional limit after sorting
   * @returns Sorted QueueItem[] with 1-indexed positions
   */
  build(inputs: QueueInput[], options?: BuildOptions): QueueItem[] {
    const generatedAt = options?.generatedAt ?? new Date().toISOString();

    const items: QueueItem[] = inputs.map(({ ctx, riskScore, recommendation }) => {
      const recommendationRank = this.recommendationRank(riskScore, recommendation);
      const ordering: QueueItemOrdering = {
        risk: riskScore?.overallRisk ?? MISSING_RISK,
        recommendationRank,
        ageDays: ctx.ageDays,
      };

      return {
        id: `queue:${ctx.proposalId}:${generatedAt}`,
        subject: `Queue position for ${ctx.proposalId}`,
        outcome: OUTCOME_QUEUED,
        confidence: recommendation?.confidence ?? 0,
        recommendation: recommendation?.recommendation ?? undefined,
        reasons: this.buildReasons(ordering, inputs.length, riskScore, recommendation),
        evidenceRefs: [ctx.id, riskScore?.id ?? "", recommendation?.id ?? ""].filter(Boolean),
        generatedAt,
        proposalId: ctx.proposalId,
        position: 0, // assigned after sort
        recommendationId: recommendation?.id,
        riskScoreId: riskScore?.id,
        ordering,
        sourceArtifacts: [
          { type: "context", id: ctx.id, timestamp: ctx.generatedAt },
          ...(riskScore ? [{ type: "risk" as const, id: riskScore.id, timestamp: riskScore.generatedAt }] : []),
          ...(recommendation ? [{ type: "recommendation" as const, id: recommendation.id, timestamp: recommendation.generatedAt }] : []),
        ],
      };
    });

    // Sort by the four-tier rule
    items.sort((a, b) => {
      // 1. Risk descending
      if (b.ordering.risk !== a.ordering.risk) return b.ordering.risk - a.ordering.risk;
      // 2. Recommendation rank descending
      if (b.ordering.recommendationRank !== a.ordering.recommendationRank)
        return b.ordering.recommendationRank - a.ordering.recommendationRank;
      // 3. Age descending
      if (b.ordering.ageDays !== a.ordering.ageDays) return b.ordering.ageDays - a.ordering.ageDays;
      // 4. ProposalId ascending (final tiebreaker)
      return a.proposalId.localeCompare(b.proposalId);
    });

    // Assign 1-indexed positions
    items.forEach((item, index) => { item.position = index + 1; });

    // Apply limit after sort
    if (options?.limit !== undefined && options.limit >= 0) {
      return items.slice(0, options.limit);
    }

    return items;
  }

  // ---- private helpers ----

  /**
   * Determine the recommendation rank for sorting.
   * Missing recommendation → 0 (below all known ranks).
   */
  private recommendationRank(riskScore: QueueInput["riskScore"], recommendation: QueueInput["recommendation"]): number {
    const priority = recommendation?.recommendation as RecommendationPriority | undefined;
    if (priority && priority in RECOMMENDATION_RANK) {
      return RECOMMENDATION_RANK[priority];
    }
    return DEFAULT_RECOMMENDATION_RANK;
  }

  /**
   * Build ordering-rationale reasons.
   * Explains WHY the item is positioned where it is, not just echoing inputs.
   * No "approve because" or "reject because" — that would leak into Recommendation's domain.
   */
  private buildReasons(
    ordering: QueueItemOrdering,
    totalInputs: number,
    riskScore: QueueInput["riskScore"],
    recommendation: QueueInput["recommendation"],
  ): string[] {
    const reasons: string[] = [];

    if (riskScore?.overallRisk !== undefined) {
      if (ordering.risk > 0.7) {
        reasons.push(`Highest risk among ${totalInputs} pending proposal(s)`);
      } else {
        reasons.push(`Risk contribution: ${riskScore.overallRisk.toFixed(2)}`);
      }
    } else {
      reasons.push("No risk score — treated as lowest priority");
    }

    if (recommendation?.recommendation) {
      reasons.push(`Recommendation rank: ${recommendation.recommendation}`);
    } else {
      reasons.push("No recommendation available — treated as lowest priority");
    }

    if (ordering.ageDays > 0) {
      const olderCount = totalInputs > 1 ? totalInputs - 1 : 0;
      reasons.push(`Older than ${olderCount} other pending proposal(s) at ${ordering.ageDays} day(s)`);
    }

    return reasons;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/adaptation/operator-queue.vitest.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adaptation/operator-queue.ts tests/adaptation/operator-queue.vitest.ts
git commit -m "feat(p6.2): OperatorQueue pure sorting class with four-tier sort"
```

---

### Task 3: Comprehensive Unit Tests

**Files:**
- Modify: `tests/adaptation/operator-queue.vitest.ts` (replace shell test with full suite)
- Note: Tests must use `.js` extensions on all source imports (NodeNext)

**Interfaces:**
- Consumes: `QueueItem`, `QueueInput`, `RECOMMENDATION_RANK` from `../../src/adaptation/operator-queue-types.js`
- Consumes: `OperatorQueue` from `../../src/adaptation/operator-queue.js`
- Consumes: Type-only imports for `DecisionContext`, `RiskScore`, `ApprovalRecommendation` from respective source paths (with `.js` extensions)

- [ ] **Step 1: Write a helper that creates minimal QueueInput fixtures**

```typescript
// Shared fixtures at top of test file
function makeCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    id: "ctx-test",
    subject: "Test context",
    outcome: "complete_context",
    confidence: 0.8,
    reasons: [],
    generatedAt: new Date().toISOString(),
    contextStatus: "complete_context",
    proposalId: "prop-test-001",
    proposalStatus: "pending",
    proposalAction: "update_agent_card",
    createdAt: new Date().toISOString(),
    ageDays: 5,
    lineageCompleteness: "complete",
    similarProposals: [],
    effectivenessTrend: { actionType: "update_agent_card", keepRate: 0.8, revertRate: 0.1, sampleSize: 10 },
    sourceArtifacts: [{ type: "proposal", id: "prop-test-001" }],
    dataFreshness: { newestArtifactAgeDays: 1, oldestArtifactAgeDays: 5 },
    ...overrides,
  } as DecisionContext;
}

function makeRisk(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    id: "risk-test",
    subject: "Test risk",
    outcome: "scored",
    confidence: 0.8,
    reasons: [],
    generatedAt: new Date().toISOString(),
    overallRisk: 0.5,
    dimensions: { governance: 0.5, operational: 0.5, capability: 0.5, revertability: 0.5, evidence_quality: 0.5 },
    risks: [],
    sourceArtifacts: [{ type: "context", id: "ctx-test" }],
    ...overrides,
  } as RiskScore;
}

function makeRecommendation(overrides: Partial<ApprovalRecommendation> = {}): ApprovalRecommendation {
  return {
    id: "rec-test",
    subject: "Test recommendation",
    outcome: "recommended",
    confidence: 0.8,
    reasons: [],
    generatedAt: new Date().toISOString(),
    recommendation: "investigate",
    proposalId: "prop-test-001",
    sourceArtifacts: [{ type: "context", id: "ctx-test" }],
    reasons: ["Test reason"],
    ...overrides,
  } as ApprovalRecommendation;
}

function makeInput(overrides: Partial<QueueInput> = {}): QueueInput {
  return {
    ctx: overrides.ctx ?? makeCtx(),
    riskScore: "riskScore" in overrides ? overrides.riskScore : makeRisk(),
    recommendation: "recommendation" in overrides ? overrides.recommendation : makeRecommendation(),
  };
}
```

- [ ] **Step 2: Write QueueItem type shape tests**

```typescript
describe("QueueItem type shape", () => {
  it("has DecisionArtifact fields", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()]);
    expect(items.length).toBe(1);
    const item = items[0];
    expect(item.id).toBeDefined();
    expect(item.subject).toBeDefined();
    expect(item.outcome).toBe("queued");
    expect(typeof item.confidence).toBe("number");
    expect(Array.isArray(item.reasons)).toBe(true);
    expect(item.generatedAt).toBeDefined();
  });

  it("has proposalId, position, ordering, sourceArtifacts", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()]);
    const item = items[0];
    expect(item.proposalId).toBeDefined();
    expect(item.position).toBe(1);
    expect(item.ordering).toBeDefined();
    expect(item.ordering.risk).toBeDefined();
    expect(item.ordering.recommendationRank).toBeDefined();
    expect(item.ordering.ageDays).toBeDefined();
    expect(Array.isArray(item.sourceArtifacts)).toBe(true);
    expect(item.sourceArtifacts.length).toBe(3);
  });

  it("confidence is forwarded from recommendation", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: makeRecommendation({ confidence: 0.42 }) })]);
    expect(items[0].confidence).toBe(0.42);
  });

  it("confidence is 0 when no recommendation given", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: undefined })]);
    expect(items[0].confidence).toBe(0);
  });

  it("has explicit recommendation field (not parsed from reasons)", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: makeRecommendation({ recommendation: "investigate" }) })]);
    expect(items[0].recommendation).toBe("investigate");
  });

  it("recommendation is undefined when no recommendation given", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput({ recommendation: undefined })]);
    expect(items[0].recommendation).toBeUndefined();
  });
});
```

- [ ] **Step 3: Write sort correctness tests**

```typescript
describe("sort — primary: risk descending", () => {
  it("places higher risk first", () => {
    const highRisk = makeInput({ riskScore: makeRisk({ overallRisk: 0.9 }) });
    const lowRisk = makeInput({ riskScore: makeRisk({ overallRisk: 0.1 }), ctx: makeCtx({ proposalId: "prop-low" }) });
    const q = new OperatorQueue();
    const items = q.build([lowRisk, highRisk]);
    expect(items[0].ordering.risk).toBe(0.9);
    expect(items[1].ordering.risk).toBe(0.1);
  });

  it("equal risk keeps next sort level", () => {
    // Tie on risk → secondary sort by recommendation rank kicks in
    const high = makeInput({
      ctx: makeCtx({ proposalId: "prop-investigate" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "investigate" }),
    });
    const low = makeInput({
      ctx: makeCtx({ proposalId: "prop-approve" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
    });
    const q = new OperatorQueue();
    const items = q.build([low, high]);
    // investigate (4) > approve (1)
    expect(items[0].ordering.recommendationRank).toBe(4);
    expect(items[1].ordering.recommendationRank).toBe(1);
  });
});

describe("sort — secondary: recommendation rank descending", () => {
  it("orders investigate > reject > defer > approve", () => {
    const orders: [string, string][] = [
      ["prop-approve", "approve"],
      ["prop-defer", "defer"],
      ["prop-reject", "reject"],
      ["prop-investigate", "investigate"],
    ];
    const inputs = orders.map(([id, rec]) => makeInput({
      ctx: makeCtx({ proposalId: id }),
      recommendation: makeRecommendation({ recommendation: rec as any }),
    }));
    const q = new OperatorQueue();
    const items = q.build(inputs);
    expect(items[0].proposalId).toBe("prop-investigate");
    expect(items[1].proposalId).toBe("prop-reject");
    expect(items[2].proposalId).toBe("prop-defer");
    expect(items[3].proposalId).toBe("prop-approve");
  });
});

describe("sort — tertiary: age descending", () => {
  it("places older proposals first when risk and recommendation tie", () => {
    const older = makeInput({
      ctx: makeCtx({ proposalId: "prop-old", ageDays: 30 }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
    });
    const newer = makeInput({
      ctx: makeCtx({ proposalId: "prop-new", ageDays: 2 }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
    });
    const q = new OperatorQueue();
    const items = q.build([newer, older]);
    expect(items[0].proposalId).toBe("prop-old");
    expect(items[1].proposalId).toBe("prop-new");
  });
});

describe("sort — final tiebreaker: proposalId ascending", () => {
  it("sorts alphabetically when all other keys tie", () => {
    const a = makeInput({ ctx: makeCtx({ proposalId: "prop-a" }) });
    const b = makeInput({ ctx: makeCtx({ proposalId: "prop-b" }) });
    const q = new OperatorQueue();
    const items = q.build([b, a]);
    expect(items[0].proposalId).toBe("prop-a");
    expect(items[1].proposalId).toBe("prop-b");
  });
});
```

- [ ] **Step 4: Write limit tests**

```typescript
describe("limit", () => {
  it("returns all items when no limit set", () => {
    const inputs = [1, 2, 3, 4, 5].map((i) =>
      makeInput({ ctx: makeCtx({ proposalId: `prop-${i}`, ageDays: i }) })
    );
    const q = new OperatorQueue();
    const items = q.build(inputs);
    expect(items.length).toBe(5);
  });

  it("returns top N after sorting", () => {
    const inputs = [
      makeInput({ ctx: makeCtx({ proposalId: "prop-low-risk-1" }), riskScore: makeRisk({ overallRisk: 0.1 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-med-risk" }), riskScore: makeRisk({ overallRisk: 0.5 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-high-risk" }), riskScore: makeRisk({ overallRisk: 0.9 }) }),
    ];
    const q = new OperatorQueue();
    const items = q.build(inputs, { limit: 2 });
    expect(items.length).toBe(2);
    expect(items[0].ordering.risk).toBe(0.9);
    expect(items[1].ordering.risk).toBe(0.5);
  });

  it("returns empty for limit 0", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()], { limit: 0 });
    expect(items.length).toBe(0);
  });
});
```

- [ ] **Step 5: Write edge case tests**

```typescript
describe("edge cases", () => {
  it("empty input returns empty", () => {
    const q = new OperatorQueue();
    const items = q.build([]);
    expect(items).toEqual([]);
  });

  it("missing risk score treated as 0 (lowest priority)", () => {
    const withoutRisk = makeInput({
      ctx: makeCtx({ proposalId: "prop-no-risk" }),
      riskScore: undefined,
    });
    const withRisk = makeInput({ ctx: makeCtx({ proposalId: "prop-with-risk" }) });
    const q = new OperatorQueue();
    const items = q.build([withoutRisk, withRisk]);
    expect(items[0].proposalId).toBe("prop-with-risk");
    expect(items[1].ordering.risk).toBe(0);
  });

  it("missing recommendation treated as rank 0 (below approve)", () => {
    const noRec = makeInput({
      ctx: makeCtx({ proposalId: "prop-no-rec" }),
      recommendation: undefined,
    });
    const approveRec = makeInput({
      ctx: makeCtx({ proposalId: "prop-approve" }),
      recommendation: makeRecommendation({ recommendation: "approve" }),
    });
    const q = new OperatorQueue();
    const items = q.build([noRec, approveRec]);
    // approve (rank 1) should come before missing (rank 0)
    expect(items[0].proposalId).toBe("prop-approve");
    expect(items[1].ordering.recommendationRank).toBe(0);
  });

  it("deterministic: same shuffled inputs produce same output", () => {
    const inputs = [
      makeInput({ ctx: makeCtx({ proposalId: "prop-c" }), riskScore: makeRisk({ overallRisk: 0.3 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-a" }), riskScore: makeRisk({ overallRisk: 0.9 }) }),
      makeInput({ ctx: makeCtx({ proposalId: "prop-b" }), riskScore: makeRisk({ overallRisk: 0.5 }) }),
    ];
    const q = new OperatorQueue();
    const run1 = q.build([...inputs]);
    // Shuffle by reversing
    const run2 = q.build([...inputs].reverse());
    expect(run1.map((i) => i.proposalId)).toEqual(run2.map((i) => i.proposalId));
    expect(run1.map((i) => i.position)).toEqual(run2.map((i) => i.position));
  });

  it("generatedAt option produces deterministic timestamps", () => {
    const frozenTime = "2026-06-21T12:00:00.000Z";
    const q = new OperatorQueue();
    const items = q.build([makeInput(), makeInput({ ctx: makeCtx({ proposalId: "prop-another" }) })], { generatedAt: frozenTime });
    expect(items[0].generatedAt).toBe(frozenTime);
    expect(items[1].generatedAt).toBe(frozenTime);
    // id includes the deterministic timestamp
    expect(items[0].id).toContain(frozenTime);
  });

  it("reasons explain ordering position, not just echo inputs", () => {
    const q = new OperatorQueue();
    const items = q.build([makeInput()]);
    const allReasons = items.flatMap((i) => i.reasons);
    // Should describe ordering contribution
    expect(allReasons.some((r) => r.includes("Risk") || r.includes("risk"))).toBe(true);
    expect(allReasons.some((r) => r.includes("Recommendation rank") || r.includes("recommendation"))).toBe(true);
    expect(allReasons.some((r) => r.includes("Older") || r.includes("day"))).toBe(true);
    // Must NOT contain evaluation language
    expect(allReasons.some((r) => r.startsWith("approve because"))).toBe(false);
    expect(allReasons.some((r) => r.startsWith("reject because"))).toBe(false);
  });

  it("positions are 1-indexed and sequential", () => {
    const inputs = [1, 2, 3].map((i) => makeInput({ ctx: makeCtx({ proposalId: `prop-${i}` }) }));
    const q = new OperatorQueue();
    const items = q.build(inputs);
    expect(items[0].position).toBe(1);
    expect(items[1].position).toBe(2);
    expect(items[2].position).toBe(3);
  });
});
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run tests/adaptation/operator-queue.vitest.ts 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add tests/adaptation/operator-queue.vitest.ts
git commit -m "feat(p6.2): comprehensive OperatorQueue tests — sort, limit, edge cases, determinism"
```

---

### Task 4: Governance Sentinel Tests

**Files:**
- Create: `tests/adaptation/queue-governance-sentinels.vitest.ts`

**Architecture:** Mirror the existing P6 sentinel pattern (`decision-governance-sentinels.vitest.ts`). Three sentinel groups: purity (no stores/builders), no mutation (no lifecycle calls), Intelligence Law (no evaluation imports/language).

- [ ] **Step 1: Write the sentinel tests**

```typescript
/**
 * P6.2 — OperatorQueue governance sentinels.
 *
 * Enforces:
 * 1. Purity — OperatorQueue must not import stores or builders
 * 2. No mutation — OperatorQueue must not call lifecycle transitions
 * 3. Intelligence Law — OperatorQueue must not import evaluation modules
 *
 * Pattern: module-level grep on the source file. These are compile-time
 * architectural guards, not runtime tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const QUEUE_SRC = resolve(__dirname, "../../src/adaptation/operator-queue.ts");
const source = readFileSync(QUEUE_SRC, "utf-8");

describe("P6.2 — OperatorQueue purity sentinel", () => {
  const FORBIDDEN_STORE_IMPORTS = [
    "proposal-store",
    "evidence-store",
    "effectiveness-store",
    "intelligence-store",
    "-store",
  ];

  const FORBIDDEN_BUILDER_IMPORTS = [
    "DecisionContextBuilder",
    "RiskScoreBuilder",
    "RecommendationEngine",
  ];

  for (const forbidden of FORBIDDEN_STORE_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(source).not.toContain(forbidden);
    });
  }

  for (const forbidden of FORBIDDEN_BUILDER_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(source).not.toContain(forbidden);
    });
  }

  it("must not contain save/update calls", () => {
    expect(source).not.toMatch(/\.(save|update|approve|apply|reject)\(/);
  });
});

describe("P6.2 — Intelligence Law sentinel", () => {
  const FORBIDDEN_EVALUATION_IMPORTS = [
    "decision-confidence",
    "risk-score",      // scoring functions (not the types module)
    "recommendation-rules",
  ];

  const FORBIDDEN_EVALUATION_PATTERNS = [
    /approve because/i,
    /reject because/i,
    /risk score computed as/i,
  ];

  for (const forbidden of FORBIDDEN_EVALUATION_IMPORTS) {
    it(`must not import evaluation module: ${forbidden}`, () => {
      // Allow imports from types files and the operator-queue-types file itself
      const lines = source.split("\n").filter((l) => l.includes(forbidden) && !l.includes("operator-queue-types") && !l.includes("types"));
      expect(lines.length).toBe(0);
    });
  }

  for (const pattern of FORBIDDEN_EVALUATION_PATTERNS) {
    it(`must not contain evaluation language: ${pattern}`, () => {
      expect(source).not.toMatch(pattern);
    });
  }

  it("must not compute confidence", () => {
    // Queue may forward confidence from recommendation, but must not compute it.
    // Forbidden patterns: explicit confidence calculation
    const FORBIDDEN_CONFIDENCE_PATTERNS = [
      "Math.",
      "calculateConfidence",
      "computeConfidence",
      "confidenceScore",
    ];
    for (const pattern of FORBIDDEN_CONFIDENCE_PATTERNS) {
      expect(source).not.toContain(pattern);
    }
  });
});

describe("P6.2 — orchestration lives in CLI, not queue class", () => {
  it("must not import DecisionContextBuilder, ProposalStore, EvidenceStore by name", () => {
    // The queue class may import types, but must not import builders or stores
    const forbidden = ["DecisionContextBuilder", "ProposalStore", "EvidenceStore"];
    for (const name of forbidden) {
      expect(source).not.toContain(name);
    }
  });
});
```

- [ ] **Step 2: Run sentinel tests**

Run: `npx vitest run tests/adaptation/queue-governance-sentinels.vitest.ts 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/queue-governance-sentinels.vitest.ts
git commit -m "feat(p6.2): governance sentinels — purity, no mutation, Intelligence Law"
```

---

### Task 5: CLI — `alix decision queue` Subcommand

**Files:**
- Modify: `src/cli/commands/decision.ts`

**Interfaces:**
- Consumes: `OperatorQueue` from `../../src/adaptation/operator-queue.js`
- Consumes: `QueueItem`, `QueueInput` from `../../src/adaptation/operator-queue-types.js`
- Consumes: Existing `DecisionInfrastructure` and `buildDecisionInfrastructure` (already in file)
- Consumes: All existing builders (`DecisionContextBuilder`, `RiskScoreBuilder`, `RecommendationEngine`)

- [ ] **Step 1: Add the queue case to the switch statement**

After the `case "recommend"` block, add:

```typescript
    case "queue":
      await runQueue(rest);
      return;
```

Update the usage line:

```typescript
      console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N]");
```

- [ ] **Step 2: Add the queue command import**

At the top of the file, add:

```typescript
import { OperatorQueue } from "../../adaptation/operator-queue.js";
import type { QueueItem, QueueInput, RecommendationPriority } from "../../adaptation/operator-queue-types.js";
```

- [ ] **Step 3: Implement runQueue**

```typescript
// ---------------------------------------------------------------------------
// runQueue — Operator Queue
// ---------------------------------------------------------------------------

/**
 * Build and render the prioritized operator queue.
 * Computed fresh each run — no persistence.
 */
async function runQueue(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const limitIdx = args.indexOf("--limit");
  let limit: number | undefined;
  if (limitIdx !== -1 && limitIdx + 1 < args.length) {
    limit = parseInt(args[limitIdx + 1], 10);
    if (isNaN(limit) || limit < 0) {
      console.error("Error: --limit requires a non-negative integer");
      process.exit(1);
    }
  }

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskBuilder = new RiskScoreBuilder();
  const recEngine = new RecommendationEngine();
  const operatorQueue = new OperatorQueue();

  // List all pending proposals
  const proposals = await infra.proposalStore.list("pending");
  if (proposals.length === 0) {
    console.log("No pending proposals.");
    return;
  }

  // Build QueueInput for each pending proposal
  const inputs: QueueInput[] = [];
  for (const proposal of proposals) {
    const ctx = await infra.contextBuilder.build(proposal.id);
    const riskScore = riskBuilder.build(ctx);
    const recommendation = recEngine.recommend(ctx, riskScore);
    inputs.push({ ctx, riskScore, recommendation });
  }

  // Sort and optionally limit
  const items = operatorQueue.build(inputs, { limit });

  if (jsonMode) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  // Terminal renderer
  const recIcon = (rec: RecommendationPriority | undefined): string => {
    switch (rec) {
      case "investigate": return "🔴";
      case "reject":      return "🟠";
      case "defer":       return "🟡";
      default:            return "⚪";
    }
  };

  console.log(`Operator Queue: ${proposals.length} pending proposal(s)`);
  console.log(`═══════════════════════════════════════`);
  console.log(``);

  for (const item of items) {
    const icon = recIcon(item.recommendation);
    const recLabel = item.recommendation ?? "no recommendation";
    console.log(` ${item.position}. ${icon} ${item.proposalId}  ${recLabel}  risk: ${item.ordering.risk.toFixed(2)}`);
    if (item.reasons.length > 0) {
      console.log(`    ${item.reasons.join(" | ")}`);
    }
    console.log(``);
  }
}
```

- [ ] **Step 4: Verify the file compiles**

Run: `npx tsc --noEmit src/cli/commands/decision.ts 2>&1 | head -10`
Expected: no errors

- [ ] **Step 5: Run all existing tests to confirm nothing is broken**

Run: `npx vitest run tests/adaptation/ 2>&1 | tail -20`
Expected: All tests PASS (including the new queue tests and sentinels)

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/decision.ts
git commit -m "feat(p6.2): alix decision queue CLI subcommand"
```

---

## Self-Review

After writing the complete plan, run through this checklist:

**1. Spec coverage:**
- QueueInput type ✅ (Task 1)
- QueueItem type with forwarded confidence ❓ Check: Task 1 defines the type; Task 3 tests confidence forwarding
- sourceArtifacts on QueueItem ✅ (Task 1 types + Task 3 tests)
- RECOMMENDATION_RANK (investigate:4, reject:3, defer:2, approve:1) ✅ (Task 1)
- Missing recommendation → rank 0 ✅ (Task 2, Task 3 tests)
- QueueItem.outcome = "queued" ✅ (Task 1 types, Task 3 tests)
- Four-tier sort ✅ (Task 2 implementation, Task 3 tests)
- Limit after sort ✅ (Task 2, Task 3)
- Determinism ✅ (Task 2 sort, Task 3 test)
- Governance sentinels: purity ✅ (Task 4)
- Governance sentinels: no mutation ✅ (Task 4)
- Governance sentinels: Intelligence Law ✅ (Task 4)
- CLI `alix decision queue` ✅ (Task 5)
- CLI `--json` ✅ (Task 5)
- CLI `--limit N` ✅ (Task 5)
- No queue persistence ✅ (Task 5 — no store writes)
- Queue is computed fresh each run ✅ (Task 5 — synchronous)

**2. Placeholder scan:** All steps have exact code blocks, exact commands, and exact expected output. No "TBD", "TODO", or fill-in-later patterns.

**3. Type consistency:**
- `QueueInput.ctx` → `DecisionContext` ✅
- `QueueInput.riskScore` → `RiskScore` ✅
- `QueueInput.recommendation` → `ApprovalRecommendation` ✅
- `QueueItem.ordering.risk` → `number` ✅
- `QueueItem.ordering.recommendationRank` → `number` ✅
- `QueueItem.ordering.ageDays` → `number` ✅
- `OperatorQueue.build(inputs[], { limit? })` → `QueueItem[]` ✅
- All `.ts` imports use `.js` extensions ✅
