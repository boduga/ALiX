# P6.5a — Governance Review Council Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GovernanceReviewCouncil types, deterministic aggregation, Queue integration, and governance sentinels — the foundation layer (P6.5a). Actual LLM lens execution is deferred to P6.5b.

> **P6.5a vs P6.5b:** P6.5a ships types, LensAgent interface, prompt templates, deterministic aggregation, queue sort integration, and sentinels. No LLM calls. CLI `review` subcommand stubs as "unavailable." P6.5b (future) adds real LLM lens execution, `alix decision review` meaningful output, and `--with-reviews` queue flag.

**Architecture:** Interface-first — `LensAgent` interface and prompt templates as specification. `GovernanceReviewCouncil` aggregates scores deterministically (plurality vote, severity-based tiebreaker, confidence computation). Queue gains reviewSeverity as a quaternary sort modifier. No LLM calls, no persisted reviews in this layer. All existing P6 invariants preserved.

**Tech Stack:** TypeScript (NodeNext), vitest

## Global Constraints

- **NodeNext module resolution:** All cross-file imports MUST use `.js` extension (e.g., `./decision-types.js`)
- **GovernanceReview ≠ Decision:** No approve/reject fields on GovernanceReview. No mutation calls. No store writes.
- **Review severity is a late tiebreaker, not a priority override:** Missing review = severity 0 (no sort impact)
- **Reviews are ephemeral:** No GovernanceReviewStore. No persistence. Computed on demand.
- **Sort order (P6.5):** Risk desc → Recommendation rank desc → Age desc → **Review severity desc** → proposalId asc
- **Queue integration optional and non-blocking (P6.5b):** Default queue = zero LLM calls. `--with-reviews` runs synchronously. Failure = warning, not block.
- **Prompt sentinels ban authority language, not ordinary words:** Ban `"I approve"`, `"I reject"`, `"apply this"`, `"execute this"`, `"final decision"`, `"must approve"`, `"must reject"`. Do NOT ban `approve`/`reject`/`recommend` globally.

---

## P6.5b Deferral

The following items are **explicitly deferred to P6.5b** and are NOT implemented in this plan:
- Real LLM lens execution (calling an LLM via `LensAgent.run()`)
- `alix decision review <id>` producing meaningful output (lens stubs output `review: unavailable (P6.5a foundation)`)
- `--with-reviews` flag on `alix decision queue` (requires real lenses to be meaningful)
- Any persistence of review results

P6.5a delivers: types, LensAgent interface + prompt templates, deterministic council aggregation, queue optional review field (unconnected), governance sentinels. The architecture is honest about what ships — no fake "agree" reviews.

### Task 1: Governance Review Types + SourceArtifactType

**Files:**
- Create: `src/adaptation/governance-review-types.ts`
- Modify: `src/adaptation/decision-types.ts` (add `"review"` to `SourceArtifactType`)

**Interfaces:**
- Consumes: `DecisionArtifact`, `SourceArtifact` from `./decision-types.js`; `ApprovalRecommendation` from `./recommendation-types.js`; `DecisionContext` from `./decision-types.js`; `RiskScore` from `./risk-score-types.js`
- Produces: `GovernanceVerdict`, `GovernanceReview`, `LensScore`, `CouncilVote`, `GovernanceReviewInput`

- [ ] **Step 1: Write the failing test shell**

```typescript
// Place in tests/adaptation/governance-review-types.vitest.ts
import { describe, it, expect } from "vitest";
import type { GovernanceReview, GovernanceVerdict, LensScore, CouncilVote, GovernanceReviewInput } from "../../src/adaptation/governance-review-types.js";

describe("GovernanceReview type shape", () => {
  it("type exists and has required DecisionArtifact fields", () => {
    const r: GovernanceReview = {
      id: "rev-test", subject: "Test", outcome: "reviewed",
      confidence: 0.5, reasons: [], generatedAt: "t",
      recommendationId: "r", proposalId: "p", verdict: "agree",
      concerns: [], blindSpots: [], historicalAnalogies: [],
      lensScores: [],
      councilVote: { agree: 0, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    expect(r).toBeDefined();
    expect(r.id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adaptation/governance-review-types.vitest.ts 2>&1 | tail -10`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create governance-review-types.ts**

```typescript
/**
 * P6.5 — Governance Review Council type definitions.
 *
 * GovernanceReview is an LLM-augmented critique artifact between
 * Recommendation and Queue. It answers "What might the deterministic
 * governance layer be missing?" without making decisions.
 *
 * Pure data types with no storage dependencies.
 * No approve/reject fields. No decision authority.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { ApprovalRecommendation } from "./recommendation-types.js";
import type { DecisionContext } from "./decision-types.js";
import type { RiskScore } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// GovernanceVerdict
// ---------------------------------------------------------------------------

export type GovernanceVerdict =
  | "agree"
  | "agree_with_concerns"
  | "challenge"
  | "insufficient_information";

export const GOVERNANCE_VERDICT_SEVERITY: Record<GovernanceVerdict, number> = {
  agree: 0,
  agree_with_concerns: 1,
  challenge: 2,
  insufficient_information: 3,
};

// ---------------------------------------------------------------------------
// LensScore — individual lens output
// ---------------------------------------------------------------------------

export type LensName = "red_team" | "historian" | "policy_auditor" | "confidence_critic";

export interface LensScore {
  lens: LensName;
  recommendedVerdict: GovernanceVerdict;
  confidence: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// CouncilVote — aggregation result
// ---------------------------------------------------------------------------

export interface CouncilVote {
  agree: number;
  agreeWithConcerns: number;
  challenge: number;
  insufficientInformation: number;
}

// ---------------------------------------------------------------------------
// GovernanceReviewInput — context assembled by CLI for each lens
// ---------------------------------------------------------------------------

export interface GovernanceReviewInput {
  recommendation: ApprovalRecommendation;
  decisionContext: DecisionContext;
  riskScore?: RiskScore;
  historicalSummary?: string;
  governanceRules?: string;
}

// ---------------------------------------------------------------------------
// GovernanceReview — output artifact
// ---------------------------------------------------------------------------

export interface GovernanceReview extends DecisionArtifact {
  /** The recommendation this review critiques. */
  recommendationId: string;
  /** Proposal being reviewed. */
  proposalId: string;
  /** Council verdict — NOT a decision. */
  verdict: GovernanceVerdict;
  /** Specific concerns raised by the council. */
  concerns: string[];
  /** Blind spots the review identified. */
  blindSpots: string[];
  /** Historical analogs surfaced (from Historian lens). */
  historicalAnalogies: string[];
  /** Per-lens scores (each lens contributes independently). */
  lensScores: LensScore[];
  /** Council aggregation (how the verdict was reached). */
  councilVote: CouncilVote;
  /** Source artifacts consumed. */
  sourceArtifacts: SourceArtifact[];

  // outcome inherited from DecisionArtifact — always "reviewed"
}
```

- [ ] **Step 4: Add "review" to SourceArtifactType**

Modify `src/adaptation/decision-types.ts` line 69 (add `"review"` to the union):

```typescript
export type SourceArtifactType =
  | "proposal"
  | "lineage"
  | "effectiveness"
  | "intelligence"
  | "priority"
  | "context"
  | "risk"
  | "recommendation"
  | "review";
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/adaptation/governance-review-types.vitest.ts 2>&1
npx tsc --noEmit src/adaptation/governance-review-types.ts 2>&1
```
Expected: test passes, types compile

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/governance-review-types.ts src/adaptation/decision-types.ts tests/adaptation/governance-review-types.vitest.ts
git commit -m "feat(p6.5): GovernanceReview types and SourceArtifactType update"
```

---

### Task 2: LensAgent Interface + Prompt Templates

**Files:**
- Create: `src/adaptation/lens-agent.ts`

**Interfaces:**
- Consumes: `GovernanceReviewInput`, `LensScore`, `LensName` from `./governance-review-types.js`
- Produces: `LensAgent` interface, `LENS_PROMPTS` constant map

- [ ] **Step 1: Write the failing test**

```typescript
// Place in tests/adaptation/governance-review-types.vitest.ts (or separate file)
// Actually, since LensAgent is an interface with no implementation in this task,
// just verify the module compiles:
import { describe, it, expect } from "vitest";
import { LENS_PROMPTS } from "../../src/adaptation/lens-agent.js";

describe("LensAgent prompt templates", () => {
  it("has prompts for all 4 lenses", () => {
    expect(LENS_PROMPTS.size).toBe(4);
  });
});
```

- [ ] **Step 2: Create src/adaptation/lens-agent.ts**

```typescript
/**
 * P6.5 — LensAgent interface and prompt templates.
 *
 * Defines the LensAgent contract and standard prompt templates for each of
 * the four governance review lenses. LensAgent is an interface (not a class)
 * to avoid baking in a specific LLM provider — real agents and test doubles
 * both implement it.
 *
 * @module
 */

import type { GovernanceReviewInput, LensScore, LensName } from "./governance-review-types.js";

// ---------------------------------------------------------------------------
// LensAgent interface
// ---------------------------------------------------------------------------

/**
 * A single governance review lens.
 * Stateless — all context is in the input. No side effects.
 */
export interface LensAgent {
  /** Run the lens and return its score. */
  run(input: GovernanceReviewInput): Promise<LensScore>;
}

// ---------------------------------------------------------------------------
// Default prompt templates
// ---------------------------------------------------------------------------

/**
 * Each lens has one job, one prompt, one output.
 * Prompts must stay in critique-only territory — no decision language.
 */
export const LENS_PROMPTS: Record<LensName, string> = {
  red_team:
    `You are a red-team reviewer. Given a recommendation and its context, identify ` +
    `concrete failure scenarios the deterministic model may have missed. ` +
    `Do not make a decision — only surface risks. Focus on: operational failures, ` +
    `edge cases, human factors, adversarial misuse.`,

  historian:
    `You are a historian reviewer. Given a recommendation and historical context, ` +
    `identify relevant past analogs, their outcomes, and lessons learned. ` +
    `Look for: similar action types with poor outcomes, capability areas with ` +
    `elevated revert rates, patterns that suggest repeating past mistakes.`,

  policy_auditor:
    `You are a policy auditor. Given a recommendation and governance context, ` +
    `identify any policy violations. Be precise — cite the violated rule. ` +
    `Check: Recommend≠Decide invariant, human approval requirements, ` +
    `capability routing constraints, constitutional rules.`,

  confidence_critic:
    `You are a confidence critic. Given a recommendation and its evidence base, ` +
    `identify what evidence is missing, weak, or stale. Focus on: context completeness, ` +
    `sample sizes, data freshness, unwarranted confidence levels.`,
};
```

- [ ] **Step 3: Run test**

```bash
npx vitest run tests/adaptation/governance-review-types.vitest.ts 2>&1
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/adaptation/lens-agent.ts
git commit -m "feat(p6.5): LensAgent interface and prompt templates"
```

---

### Task 3: GovernanceReviewCouncil — Deterministic Aggregation

**Files:**
- Create: `src/adaptation/governance-review-council.ts`

**Interfaces:**
- Consumes: `GovernanceReview`, `GovernanceReviewInput`, `GovernanceVerdict`, `LensScore`, `CouncilVote`, `GOVERNANCE_VERDICT_SEVERITY` from `./governance-review-types.js`; `SourceArtifact` from `./decision-types.js`
- Produces: `GovernanceReviewCouncil` class with `aggregate(reviewId, proposalId, recommendationId, lensScores, options?)` method

- [ ] **Step 1: Write the failing test shell**

```typescript
// Place in tests/adaptation/governance-review-council.vitest.ts
import { describe, it, expect } from "vitest";
import { GovernanceReviewCouncil } from "../../src/adaptation/governance-review-council.js";

describe("GovernanceReviewCouncil", () => {
  it("exists and has an aggregate method", () => {
    const c = new GovernanceReviewCouncil();
    expect(typeof c.aggregate).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/adaptation/governance-review-council.vitest.ts 2>&1 | tail -10
```
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create src/adaptation/governance-review-council.ts**

```typescript
/**
 * P6.5 — GovernanceReviewCouncil: deterministic aggregation logic.
 *
 * Takes four independent LensScores and produces a single GovernanceReview
 * artifact. All logic is deterministic — no LLM calls, no side effects.
 * Same inputs always produce the same output.
 *
 * @module
 */

import type {
  GovernanceReview,
  GovernanceVerdict,
  LensScore,
  CouncilVote,
  GovernanceReviewInput,
} from "./governance-review-types.js";
import { GOVERNANCE_VERDICT_SEVERITY } from "./governance-review-types.js";
import type { SourceArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_LENSES = 4;
const OUTCOME_REVIEWED = "reviewed";
const DEFAULT_GENERATED_AT = ""; // sentinel — replaced by options or Date.now()

// ---------------------------------------------------------------------------
// GovernanceReviewCouncil
// ---------------------------------------------------------------------------

export interface CouncilOptions {
  /** Override generatedAt for deterministic testing. */
  generatedAt?: string;
}

export class GovernanceReviewCouncil {
  /**
   * Aggregate four lens scores into a single GovernanceReview.
   *
   * Steps:
   * 1. Count votes by verdict (plurality).
   * 2. On tie: most severe verdict among tied wins.
   * 3. Compute confidence from definitive-lens agreement.
   * 4. Deduplicate concerns and blind spots.
   *
   * @param reviewId - Stable review identifier
   * @param proposalId - Proposal being reviewed
   * @param recommendationId - Source recommendation
   * @param lensScores - Four lens scores (expected length = 4)
   * @param input - Original input context (for source artifacts)
   * @param options - Optional generatedAt override
   * @returns GovernanceReview artifact
   */
  aggregate(
    reviewId: string,
    proposalId: string,
    recommendationId: string,
    lensScores: LensScore[],
    input: GovernanceReviewInput,
    options?: CouncilOptions,
  ): GovernanceReview {
    const generatedAt = options?.generatedAt ?? new Date().toISOString();

    // Step 1: Count votes
    const councilVote = this.#countVotes(lensScores);

    // Step 2: Determine verdict (plurality, tie = most severe)
    const verdict = this.#determineVerdict(councilVote);

    // Step 3: Compute confidence
    const confidence = this.#computeConfidence(lensScores, verdict);

    // Step 4: Merge concerns, blind spots, analogies
    const concerns = this.#mergeConcerns(lensScores);
    const blindSpots = this.#mergeBlindSpots(lensScores);
    const historicalAnalogies = this.#mergeAnalogies(lensScores);

    // Step 5: Build source artifacts
    const sourceArtifacts: SourceArtifact[] = [
      { type: "recommendation", id: recommendationId, timestamp: input.recommendation.generatedAt },
      { type: "context", id: input.decisionContext.id, timestamp: input.decisionContext.generatedAt },
      ...(input.riskScore
        ? [{ type: "risk" as const, id: input.riskScore.id, timestamp: input.riskScore.generatedAt }]
        : []),
      { type: "review" as const, id: reviewId, timestamp: generatedAt },
    ];

    return {
      id: reviewId,
      subject: `Governance Review: ${proposalId}`,
      outcome: OUTCOME_REVIEWED,
      verdict,
      recommendationId,
      proposalId,
      concerns,
      blindSpots,
      historicalAnalogies,
      lensScores,
      councilVote,
      confidence,
      reasons: this.#buildReasons(verdict, councilVote, confidence, lensScores),
      generatedAt,
      sourceArtifacts,
    };
  }

  // ---- private helpers ----

  /** Count lens scores by verdict. */
  #countVotes(scores: LensScore[]): CouncilVote {
    const vote: CouncilVote = { agree: 0, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 };
    for (const s of scores) {
      switch (s.recommendedVerdict) {
        case "agree":                     vote.agree++; break;
        case "agree_with_concerns":       vote.agreeWithConcerns++; break;
        case "challenge":                 vote.challenge++; break;
        case "insufficient_information":  vote.insufficientInformation++; break;
      }
    }
    return vote;
  }

  /**
   * Determine aggregate verdict.
   * Plurality rule — most votes wins.
   * On tie: most severe among tied verdicts wins (severity order:
   * insufficient_information > challenge > agree_with_concerns > agree).
   *
   * NOTE — cautious tiebreaking for insufficient_information:
   * When 2 lenses vote "agree" and 2 vote "insufficient_information",
   * the verdict is "insufficient_information" (severity wins).
   * This is intentional: missing data should increase caution.
   * The confidence formula handles the mixed-signal case separately
   * (see #computeConfidence).
   */
  #determineVerdict(vote: CouncilVote): GovernanceVerdict {
    const entries = Object.entries(vote) as [keyof CouncilVote, number][];
    const maxVotes = Math.max(...entries.map(([, v]) => v));
    const tied = entries.filter(([, v]) => v === maxVotes).map(([k]) => k);

    if (tied.length === 1) {
      return this.#councilKeyToVerdict(tied[0]);
    }

    // Tie: most severe among tied
    tied.sort((a, b) => {
      const aV = GOVERNANCE_VERDICT_SEVERITY[this.#councilKeyToVerdict(a)];
      const bV = GOVERNANCE_VERDICT_SEVERITY[this.#councilKeyToVerdict(b)];
      return bV - aV;
    });
    return this.#councilKeyToVerdict(tied[0]);
  }

  /**
   * Compute review confidence.
   * When verdict is insufficient_information, confidence = count(insufficient) / total.
   * Otherwise: definitiveRatio × agreementFactor × avgLensConfidence.
   */
  #computeConfidence(scores: LensScore[], verdict: GovernanceVerdict): number {
    if (verdict === "insufficient_information") {
      const insufficientCount = scores.filter(
        (s) => s.recommendedVerdict === "insufficient_information",
      ).length;
      return insufficientCount / scores.length;
    }

    const definitive = scores.filter((s) => s.recommendedVerdict !== "insufficient_information");
    if (definitive.length === 0) return 0;

    const definitiveRatio = definitive.length / scores.length;
    const agreementCount = definitive.filter((s) => s.recommendedVerdict === verdict).length;
    const agreementFactor = agreementCount / definitive.length;
    const avgLensConfidence = definitive.reduce((sum, s) => sum + s.confidence, 0) / definitive.length;

    return definitiveRatio * agreementFactor * avgLensConfidence;
  }

  /** Merge concerns from all lenses (dedup by exact text match). */
  #mergeConcerns(scores: LensScore[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of scores) {
      const lines = s.rationale.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const key = line.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(line);
        }
      }
    }
    return result;
  }

  /** Extract blind spots from lens rationales (placeholder — enhanced by real lenses). */
  #mergeBlindSpots(_scores: LensScore[]): string[] {
    // TODO — P6.5b: enhanced blind-spot extraction from real lens output
    return [];
  }

  /** Extract historical analogies from lens rationales. */
  #mergeAnalogies(_scores: LensScore[]): string[] {
    // TODO — P6.5b: enhanced passage from historian lens output
    return [];
  }

  /** Build explanatory reasons for the review. */
  #buildReasons(
    verdict: GovernanceVerdict,
    vote: CouncilVote,
    confidence: number,
    _scores: LensScore[],
  ): string[] {
    return [
      `Council verdict: ${verdict} (${vote.agree}/${vote.agreeWithConcerns}/${vote.challenge}/${vote.insufficientInformation})`,
      `Confidence: ${(confidence * 100).toFixed(0)}%`,
    ];
  }

  /** Map CouncilVote key to GovernanceVerdict. */
  #councilKeyToVerdict(key: keyof CouncilVote): GovernanceVerdict {
    switch (key) {
      case "agree":                     return "agree";
      case "agreeWithConcerns":         return "agree_with_concerns";
      case "challenge":                 return "challenge";
      case "insufficientInformation":   return "insufficient_information";
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/adaptation/governance-review-council.vitest.ts 2>&1 | tail -10
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adaptation/governance-review-council.ts tests/adaptation/governance-review-council.vitest.ts
git commit -m "feat(p6.5): GovernanceReviewCouncil deterministic aggregation"
```

---

### Task 4: Council Unit Tests

**Files:**
- Create/Modify: `tests/adaptation/governance-review-council.vitest.ts` (replace shell with full tests)
- Create: `tests/adaptation/governance-review-types.vitest.ts` (replace shell with type shape tests)

- [ ] **Step 1: Write the full type shape tests in governance-review-types.vitest.ts**

```typescript
/**
 * P6.5 — GovernanceReview type shape tests.
 */
import { describe, it, expect } from "vitest";
import type {
  GovernanceReview,
  GovernanceVerdict,
  LensScore,
  CouncilVote,
  GovernanceReviewInput,
} from "../../src/adaptation/governance-review-types.js";
import { GOVERNANCE_VERDICT_SEVERITY } from "../../src/adaptation/governance-review-types.js";

describe("GovernanceReview type shape", () => {
  it("extends DecisionArtifact — has id, subject, outcome, confidence, reasons, generatedAt", () => {
    const r: GovernanceReview = {
      id: "rev-1", subject: "Test review", outcome: "reviewed",
      confidence: 0.8, reasons: ["test"], generatedAt: "2026-01-01",
      recommendationId: "rec-1", proposalId: "prop-1", verdict: "agree",
      concerns: [], blindSpots: [], historicalAnalogies: [],
      lensScores: [], councilVote: { agree: 0, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    expect(r.id).toBe("rev-1");
    expect(r.subject).toBe("Test review");
    expect(r.outcome).toBe("reviewed");
    expect(typeof r.confidence).toBe("number");
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(typeof r.generatedAt).toBe("string");
  });

  it("has recommendationId, proposalId, verdict", () => {
    const r: GovernanceReview = { id: "rev-2", subject: "t", outcome: "reviewed",
      confidence: 0, reasons: [], generatedAt: "t",
      recommendationId: "rec-1", proposalId: "prop-1", verdict: "challenge",
      concerns: [], blindSpots: [], historicalAnalogies: [],
      lensScores: [], councilVote: { agree: 0, agreeWithConcerns: 0, challenge: 1, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    expect(r.recommendationId).toBe("rec-1");
    expect(r.proposalId).toBe("prop-1");
    expect(r.verdict).toBe("challenge");
  });

  it("has concerns, blindSpots, historicalAnalogies as arrays", () => {
    const r: GovernanceReview = { id: "rev-3", subject: "t", outcome: "reviewed",
      confidence: 0, reasons: [], generatedAt: "t",
      recommendationId: "r", proposalId: "p", verdict: "agree_with_concerns",
      concerns: ["risk of X"], blindSpots: ["missing Y"], historicalAnalogies: ["Z failed"],
      lensScores: [], councilVote: { agree: 0, agreeWithConcerns: 1, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    expect(r.concerns).toContain("risk of X");
    expect(r.blindSpots).toContain("missing Y");
    expect(r.historicalAnalogies).toContain("Z failed");
  });

  it("has lensScores and councilVote", () => {
    const r: GovernanceReview = { id: "rev-4", subject: "t", outcome: "reviewed",
      confidence: 0, reasons: [], generatedAt: "t",
      recommendationId: "r", proposalId: "p", verdict: "agree",
      concerns: [], blindSpots: [], historicalAnalogies: [],
      lensScores: [{ lens: "red_team", recommendedVerdict: "agree", confidence: 0.9, rationale: "ok" }],
      councilVote: { agree: 1, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    expect(r.lensScores.length).toBe(1);
    expect(r.councilVote.agree).toBe(1);
  });

  it("LensScore has lens, recommendedVerdict, confidence, rationale", () => {
    const s: LensScore = { lens: "historian", recommendedVerdict: "challenge", confidence: 0.6, rationale: "Past pattern" };
    expect(s.lens).toBe("historian");
    expect(s.recommendedVerdict).toBe("challenge");
    expect(s.confidence).toBe(0.6);
    expect(s.rationale).toBe("Past pattern");
  });

  it("CouncilVote has counts for all 4 categories", () => {
    const v: CouncilVote = { agree: 1, agreeWithConcerns: 2, challenge: 0, insufficientInformation: 0 };
    expect(v.agree).toBe(1);
    expect(v.agreeWithConcerns).toBe(2);
    expect(v.challenge).toBe(0);
    expect(v.insufficientInformation).toBe(0);
  });

  it("GOVERNANCE_VERDICT_SEVERITY maps to correct values", () => {
    expect(GOVERNANCE_VERDICT_SEVERITY.agree).toBe(0);
    expect(GOVERNANCE_VERDICT_SEVERITY.agree_with_concerns).toBe(1);
    expect(GOVERNANCE_VERDICT_SEVERITY.challenge).toBe(2);
    expect(GOVERNANCE_VERDICT_SEVERITY.insufficient_information).toBe(3);
  });
});
```

- [ ] **Step 2: Write council aggregation tests**

Replace `tests/adaptation/governance-review-council.vitest.ts`:

```typescript
/**
 * P6.5 — GovernanceReviewCouncil unit tests.
 *
 * Covers: verdict aggregation, tiebreaker, confidence computation,
 * determinism, edge cases.
 */
import { describe, it, expect } from "vitest";
import { GovernanceReviewCouncil } from "../../src/adaptation/governance-review-council.js";
import type { LensScore, GovernanceReviewInput } from "../../src/adaptation/governance-review-types.js";
import type { ApprovalRecommendation } from "../../src/adaptation/recommendation-types.js";
import type { DecisionContext } from "../../src/adaptation/decision-types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLens(overrides: Partial<LensScore> = {}): LensScore {
  return {
    lens: overrides.lens ?? "red_team",
    recommendedVerdict: overrides.recommendedVerdict ?? "agree",
    confidence: overrides.confidence ?? 0.8,
    rationale: overrides.rationale ?? "No concerns identified.",
  };
}

function makeRecommendation(overrides: Partial<ApprovalRecommendation> = {}): ApprovalRecommendation {
  return {
    id: "rec-test",
    subject: "Test recommendation",
    outcome: "recommended",
    confidence: 0.8,
    reasons: ["Test reason"],
    generatedAt: new Date().toISOString(),
    recommendation: "approve",
    proposalId: "prop-test-001",
    sourceArtifacts: [{ type: "context", id: "ctx-test" }],
    ...overrides,
  } as ApprovalRecommendation;
}

function makeContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
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

function makeInput(overrides: Partial<GovernanceReviewInput> = {}): GovernanceReviewInput {
  return {
    recommendation: overrides.recommendation ?? makeRecommendation(),
    decisionContext: overrides.decisionContext ?? makeContext(),
    riskScore: "riskScore" in overrides ? overrides.riskScore : undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Verdict aggregation
// ---------------------------------------------------------------------------

describe("Council aggregation — verdict", () => {
  it("4 lenses all agree → verdict agree", () => {
    const scores = [
      makeLens({ lens: "red_team", recommendedVerdict: "agree" }),
      makeLens({ lens: "historian", recommendedVerdict: "agree" }),
      makeLens({ lens: "policy_auditor", recommendedVerdict: "agree" }),
      makeLens({ lens: "confidence_critic", recommendedVerdict: "agree" }),
    ];
    const council = new GovernanceReviewCouncil();
    const review = council.aggregate("rev-1", "prop-test-001", "rec-test", scores, makeInput());
    expect(review.verdict).toBe("agree");
    expect(review.councilVote.agree).toBe(4);
  });

  it("2 agree, 2 challenge → tie resolves to challenge (most severe)", () => {
    const scores = [
      makeLens({ lens: "red_team", recommendedVerdict: "challenge" }),
      makeLens({ lens: "historian", recommendedVerdict: "challenge" }),
      makeLens({ lens: "policy_auditor", recommendedVerdict: "agree" }),
      makeLens({ lens: "confidence_critic", recommendedVerdict: "agree" }),
    ];
    const council = new GovernanceReviewCouncil();
    const review = council.aggregate("rev-2", "prop-test-001", "rec-test", scores, makeInput());
    expect(review.verdict).toBe("challenge");
    expect(review.councilVote.challenge).toBe(2);
    expect(review.councilVote.agree).toBe(2);
  });

  it("plurality: 2 agree_with_concerns, 1 agree, 1 challenge → agree_with_concerns", () => {
    const scores = [
      makeLens({ lens: "red_team", recommendedVerdict: "challenge" }),
      makeLens({ lens: "historian", recommendedVerdict: "agree_with_concerns" }),
      makeLens({ lens: "policy_auditor", recommendedVerdict: "agree_with_concerns" }),
      makeLens({ lens: "confidence_critic", recommendedVerdict: "agree" }),
    ];
    const council = new GovernanceReviewCouncil();
    const review = council.aggregate("rev-3", "prop-test-001", "rec-test", scores, makeInput());
    expect(review.verdict).toBe("agree_with_concerns");
    expect(review.councilVote.agreeWithConcerns).toBe(2);
  });

  it("all insufficient_information → insufficient_information", () => {
    const scores = [
      makeLens({ recommendedVerdict: "insufficient_information", confidence: 0 }),
      makeLens({ recommendedVerdict: "insufficient_information", confidence: 0 }),
      makeLens({ recommendedVerdict: "insufficient_information", confidence: 0 }),
      makeLens({ recommendedVerdict: "insufficient_information", confidence: 0 }),
    ];
    const council = new GovernanceReviewCouncil();
    const review = council.aggregate("rev-4", "prop-test-001", "rec-test", scores, makeInput());
    expect(review.verdict).toBe("insufficient_information");
    expect(review.councilVote.insufficientInformation).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe("Council aggregation — confidence", () => {
  it("confidence is 1.0 when all 4 lenses agree with high confidence", () => {
    const scores = [1, 2, 3, 4].map((i) => makeLens({ lens: "red_team" as any, recommendedVerdict: "agree", confidence: 1 }));
    const council = new GovernanceReviewCouncil();
    const review = council.aggregate("rev-5", "prop-test-001", "rec-test", scores, makeInput());
    expect(review.confidence).toBe(1);
  });

  it("insufficient_information verdict uses count/total formula", () => {
    const scores = [
      makeLens({ recommendedVerdict: "insufficient_information", confidence: 0 }),
      makeLens({ recommendedVerdict: "insufficient_information", confidence: 0 }),
      makeLens({ recommendedVerdict: "agree", confidence: 0.8 }),
      makeLens({ recommendedVerdict: "agree", confidence: 0.8 }),
    ];
    const council = new GovernanceReviewCouncil();
    const review = council.aggregate("rev-6", "prop-test-001", "rec-test", scores, makeInput());
    // Verdict is agree (2 vs 2 insufficient, tie → most severe among tied = agree? Actually wait: agree=2, insufficient=2 → tie → most severe = insufficient_information)
    // Actually severity: agree=0, insufficient=3, so tie between agree and insufficient goes to insufficient
    expect(review.verdict).toBe("insufficient_information");
    // When verdict is insufficient_information, confidence = count(insufficient) / total = 2/4 = 0.5
    expect(review.confidence).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("Council aggregation — determinism", () => {
  it("same inputs + same generatedAt → same output", () => {
    const frozen = "2026-06-21T12:00:00.000Z";
    const scores = [1, 2, 3, 4].map((i) => makeLens({ recommendedVerdict: "agree", confidence: 0.8 }));
    const council = new GovernanceReviewCouncil();
    const r1 = council.aggregate("rev-7", "prop-test-001", "rec-test", scores, makeInput(), { generatedAt: frozen });
    const r2 = council.aggregate("rev-7", "prop-test-001", "rec-test", scores, makeInput(), { generatedAt: frozen });
    expect(r1.verdict).toBe(r2.verdict);
    expect(r1.confidence).toBe(r2.confidence);
    expect(r1.concerns).toEqual(r2.concerns);
    expect(r1.councilVote).toEqual(r2.councilVote);
  });
});
```

- [ ] **Step 3: Run the full council test file**

```bash
npx vitest run tests/adaptation/governance-review-council.vitest.ts 2>&1 | tail -20
```
Expected: 8+ tests passing

- [ ] **Step 4: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 890+ tests passing

- [ ] **Step 5: Commit**

```bash
git add tests/adaptation/governance-review-council.vitest.ts tests/adaptation/governance-review-types.vitest.ts
git commit -m "feat(p6.5): GovernanceReview council unit tests"
```

---

### Task 5: Queue Integration — Review Severity Sort

**Files:**
- Modify: `src/adaptation/operator-queue-types.ts` — add `governanceReview?` to QueueInput, `reviewSeverity` to QueueItemOrdering, `governanceReviewId?` and `governanceVerdict?` to QueueItem
- Modify: `src/adaptation/operator-queue.ts` — add review severity to sort order (4th tier), update build method to handle governanceReview

- [ ] **Step 1: Write the failing test**

```typescript
// Add to tests/adaptation/operator-queue.vitest.ts
import { describe, it, expect } from "vitest";
import { GOVERNANCE_VERDICT_SEVERITY } from "../../src/adaptation/governance-review-types.js";

describe("Queue sort — governance review severity", () => {
  it("review severity breaks tie when risk, recommendation, and age are equal", () => {
    const challenge = makeInput({
      ctx: makeCtx({ proposalId: "prop-challenge" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
      governanceReview: { verdict: "challenge" } as any,
    });
    const agree = makeInput({
      ctx: makeCtx({ proposalId: "prop-agree" }),
      riskScore: makeRisk({ overallRisk: 0.5 }),
      recommendation: makeRecommendation({ recommendation: "defer" }),
      governanceReview: { verdict: "agree" } as any,
    });
    const q = new OperatorQueue();
    const items = q.build([agree, challenge], { generatedAt: "2026-06-21T12:00:00.000Z" });
    expect(items[0].proposalId).toBe("prop-challenge");
    expect(items[1].proposalId).toBe("prop-agree");
  });

  it("no review → severity 0 (no sort impact)", () => {
    const withReview = makeInput({
      ctx: makeCtx({ proposalId: "prop-with-review" }),
      governanceReview: { verdict: "challenge" } as any,
    });
    const withoutReview = makeInput({
      ctx: makeCtx({ proposalId: "prop-no-review" }),
      governanceReview: undefined,
    });
    const q = new OperatorQueue();
    const items = q.build([withoutReview, withReview], { generatedAt: "2026-06-21T12:00:00.000Z" });
    // challenge (severity 2) > no review (severity 0)
    expect(items[0].proposalId).toBe("prop-with-review");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/adaptation/operator-queue.vitest.ts 2>&1 | tail -20
```
Expected: FAIL — missing governanceReview field

- [ ] **Step 3: Modify operator-queue-types.ts**

Add governanceReview to QueueInput, reviewSeverity to QueueItemOrdering, governanceReviewId and governanceVerdict to QueueItem:

```typescript
// Add import at top
import type { GovernanceReview, GovernanceVerdict } from "./governance-review-types.js";

// In QueueInput, add:
  governanceReview?: GovernanceReview;

// In QueueItemOrdering, add:
  reviewSeverity: number;

// In QueueItem, add:
  governanceReviewId?: string;
  governanceVerdict?: GovernanceVerdict;
```

- [ ] **Step 4: Modify operator-queue.ts**

Update import to include GovernanceVerdict:
```typescript
import type { GovernanceVerdict } from "./governance-review-types.js";
```

Update the `inputs.map(...)` to extract governanceReview and compute reviewSeverity:
```typescript
const items: QueueItem[] = inputs.map(({ ctx, riskScore, recommendation, governanceReview }) => {
  const recommendationRank = this.recommendationRank(riskScore, recommendation);
  const reviewSeverity = governanceReview
    ? (GOVERNANCE_VERDICT_SEVERITY[governanceReview.verdict] ?? 0)
    : 0;
  const ordering: QueueItemOrdering = {
    risk: riskScore?.overallRisk ?? MISSING_RISK,
    recommendationRank,
    ageDays: ctx.ageDays,
    reviewSeverity,
  };

  return {
    id: `queue:${ctx.proposalId}:${generatedAt}`,
    subject: `Queue position for ${ctx.proposalId}`,
    outcome: OUTCOME_QUEUED,
    confidence: recommendation?.confidence ?? 0,
    recommendation: recommendation?.recommendation ?? undefined,
    reasons: this.buildReasons(ordering, riskScore, recommendation),
    evidenceRefs: [ctx.id, riskScore?.id ?? "", recommendation?.id ?? ""].filter(Boolean),
    generatedAt,
    proposalId: ctx.proposalId,
    position: 0,
    recommendationId: recommendation?.id,
    riskScoreId: riskScore?.id,
    governanceReviewId: governanceReview?.id,
    governanceVerdict: governanceReview?.verdict,
    ordering,
    sourceArtifacts: [
      { type: "context", id: ctx.id, timestamp: ctx.generatedAt },
      ...(riskScore ? [{ type: "risk" as const, id: riskScore.id, timestamp: riskScore.generatedAt }] : []),
      ...(recommendation ? [{ type: "recommendation" as const, id: recommendation.id, timestamp: recommendation.generatedAt }] : []),
      ...(governanceReview ? [{ type: "review" as const, id: governanceReview.id, timestamp: governanceReview.generatedAt }] : []),
    ],
  };
});
```

Update sort to add review severity as 4th tier (moving proposalId to 5th):
```typescript
items.sort((a, b) => {
  // 1. Risk descending
  if (b.ordering.risk !== a.ordering.risk) return b.ordering.risk - a.ordering.risk;
  // 2. Recommendation rank descending
  if (b.ordering.recommendationRank !== a.ordering.recommendationRank)
    return b.ordering.recommendationRank - a.ordering.recommendationRank;
  // 3. Age descending
  if (b.ordering.ageDays !== a.ordering.ageDays) return b.ordering.ageDays - a.ordering.ageDays;
  // 4. Review severity descending (quaternary modifier, P6.5)
  if (b.ordering.reviewSeverity !== a.ordering.reviewSeverity)
    return b.ordering.reviewSeverity - a.ordering.reviewSeverity;
  // 5. ProposalId ascending (final tiebreaker)
  return a.proposalId.localeCompare(b.proposalId);
});
```

Also add import for `GOVERNANCE_VERDICT_SEVERITY`:
```typescript
import { GOVERNANCE_VERDICT_SEVERITY } from "./governance-review-types.js";
```

Update the `buildReasons` method to include review severity:
```typescript
if (ordering.reviewSeverity > 0) {
  reasons.push(`Governance review severity: ${ordering.reviewSeverity}`);
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/adaptation/operator-queue.vitest.ts 2>&1 | tail -20
```
Expected: PASS (existing tests + new tests)

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/operator-queue-types.ts src/adaptation/operator-queue.ts
git commit -m "feat(p6.5): Queue integration — governance review severity sort"
```

---

### Task 6: CLI — review Subcommand Stub (P6.5a Foundation)

**Files:**
- Modify: `src/cli/commands/decision.ts`

- [ ] **Step 1: Verify the test baseline**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 890+ tests passing

- [ ] **Step 2: Add imports to decision.ts**

After the existing imports:

```typescript
import { GovernanceReviewCouncil } from "../../adaptation/governance-review-council.js";
import type { GovernanceReview, GovernanceVerdict, GovernanceReviewInput, LensScore, LensName } from "../../adaptation/governance-review-types.js";
import { GOVERNANCE_VERDICT_SEVERITY } from "../../adaptation/governance-review-types.js";
```

Wait — that strategicBriefBuilder import could be wrong. Let me be precise: the imports we need are:
- `GovernanceReviewCouncil` from `../../adaptation/governance-review-council.js`
- `GovernanceReview`, `GovernanceVerdict`, `GovernanceReviewInput` types from `../../adaptation/governance-review-types.js`
- `GOVERNANCE_VERDICT_SEVERITY` from `../../adaptation/governance-review-types.js`

> **P6.5a note:** The `alix decision review` subcommand is a foundation stub. It always prints "unavailable" — real lens execution is deferred to P6.5b. No `--with-reviews` flag on queue in this layer.

- [ ] **Step 3: Add case "review" — P6.5a stub that prints unavailable**

```typescript
    case "review":
      console.log("review: unavailable (P6.5a foundation — real lens agents deferred to P6.5b)");
      return;
```

Updated usage string (no `--with-reviews`, no `--lens` in P6.5a):
```typescript
console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N] | brief [--window N] [--json] | review <proposal-id>");
```

- [ ] **Step 4: runReview function — Not wired in P6.5a**

The case statement at Step 3 prints "unavailable" and returns directly, so no `runReview` function is connected in this layer. The `GovernanceReviewCouncil` and `LensAgent` infrastructure is implemented and testable via unit tests (Task 4), but the CLI subcommand is a stub. P6.5b will wire the full function.

**Decision not to stub the full function:** Shipping a `runReview` that builds real context, creates fake lens scores, and runs the council would produce a `GovernanceReview` with `verdict: "insufficient_information"` from all four lenses — which looks like a real review. P6.5b will add `runReview` when lenses produce real output.

  // Terminal renderer
  const verdictIcon = (v: GovernanceVerdict): string => {
    switch (v) {
      case "agree":                    return "✅";
      case "agree_with_concerns":      return "⚠️";
      case "challenge":                return "🔴";
      case "insufficient_information": return "❓";
    }
  };

  const recLabel = recommendation.recommendation.charAt(0).toUpperCase() + recommendation.recommendation.slice(1);

  console.log(`Governance Review: ${id}`);
  console.log(`═══════════════════════════════════════════`);
  console.log(``);
  console.log(`Recommendation: ${recLabel} (confidence: ${(recommendation.confidence * 100).toFixed(0)}%)`);
  console.log(``);
  console.log(`${verdictIcon(review.verdict)} Council verdict: ${review.verdict} (${review.councilVote.agree}/${review.councilVote.agreeWithConcerns}/${review.councilVote.challenge}/${review.councilVote.insufficientInformation})`);
  console.log(``);

  if (review.concerns.length > 0) {
    console.log(`Concerns (${review.concerns.length}):`);
    for (const c of review.concerns) {
      console.log(`  ⚠ ${c}`);
    }
    console.log(``);
  }

  if (review.blindSpots.length > 0) {
    console.log(`Blind spots (${review.blindSpots.length}):`);
    for (const b of review.blindSpots) {
      console.log(`  · ${b}`);
    }
    console.log(``);
  }

  console.log(`Confidence in review: ${(review.confidence * 100).toFixed(0)}%`);

  if (review.reasons.length > 0) {
    console.log(``);
    for (const r of review.reasons) {
      console.log(` · ${r}`);
    }
  }
}
```

- [ ] **Step 5: Verify no --with-reviews in P6.5a**

The `--with-reviews` queue flag is deferred to P6.5b. The queue's `runQueue` function should NOT reference `--with-reviews`. No code changes needed — verify `runQueue` has no `withReviews` var or `--with-reviews` check.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run 2>&1 | tail -10
```
Expected: 890+ tests passing

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/decision.ts
git commit -m "feat(p6.5a): CLI review subcommand stub"
```

---

### Task 7: Governance Sentinels

**Files:**
- Create: `tests/adaptation/governance-review-sentinels.vitest.ts`

- [ ] **Step 1: Write sentinel tests**

```typescript
/**
 * P6.5 — Governance Review Council sentinels.
 *
 * Enforces:
 * 1. No decision authority — GovernanceReview must not contain .approve/.reject/.apply
 * 2. No store mutation — must not import ProposalStore, approval-gate, applier modules
 * 3. No authority language in prompt templates — ban "I approve", "I reject", "apply this", etc.
 * 4. Purity — aggregation must be deterministic (no randomness, no LLM calls in council)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const COUNCIL_SRC = resolve(__dirname, "../../src/adaptation/governance-review-council.ts");
const councilSource = readFileSync(COUNCIL_SRC, "utf-8");

const LENS_SRC = resolve(__dirname, "../../src/adaptation/lens-agent.ts");
const lensSource = readFileSync(LENS_SRC, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const councilCodeOnly = stripComments(councilSource);
const lensCodeOnly = stripComments(lensSource);

describe("P6.5 — No decision authority sentinel", () => {
  it("council source must not contain mutation calls", () => {
    expect(councilCodeOnly).not.toMatch(/\.(approve|reject|apply|execute)\(/);
  });
});

describe("P6.5 — No store mutation sentinel", () => {
  it("council source must not import ProposalStore or stores", () => {
    const forbidden = ["ProposalStore", "EvidenceStore", "EffectivenessStore", "IntelligenceStore"];
    for (const name of forbidden) {
      expect(councilCodeOnly).not.toContain(name);
    }
  });

  it("council source must not import approval-gate or applier modules", () => {
    const forbidden = ["approval-gate", "applier"];
    for (const pattern of forbidden) {
      const lines = councilCodeOnly.split("\n").filter((l) => l.includes(pattern));
      expect(lines.length).toBe(0);
    }
  });
});

describe("P6.5 — Prompt authority-language sentinel", () => {
  const FORBIDDEN_PATTERNS = [
    "I approve",
    "I reject",
    "apply this",
    "execute this",
    "final decision",
    "must approve",
    "must reject",
  ];

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`prompt templates must not contain "${pattern}"`, () => {
      expect(lensCodeOnly).not.toContain(pattern);
    });
  }

  it("prompt DOES contain approve/reject/recommend (allowed — discussing existing recommendation)", () => {
    // These words are allowed in prompts because the prompts may reference
    // the existing recommendation. This test verifies they're still present
    // (i.e., the sentinel didn't ban them).
    expect(lensSource).toContain("recommendation");
  });
});

describe("P6.5 — Purity sentinel", () => {
  it("council aggregation must not call Math.random", () => {
    expect(councilCodeOnly).not.toContain("Math.random");
  });

  it("council source must not import LensAgent (LLM calls belong in CLI)", () => {
    expect(councilCodeOnly).not.toContain("LensAgent");
  });
});
```

- [ ] **Step 2: Run sentinel tests**

```bash
npx vitest run tests/adaptation/governance-review-sentinels.vitest.ts 2>&1 | tail -15
```
Expected: 9+ tests passing

- [ ] **Step 3: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 900+ tests passing

- [ ] **Step 4: Commit**

```bash
git add tests/adaptation/governance-review-sentinels.vitest.ts
git commit -m "feat(p6.5): Governance review sentinels"
```
