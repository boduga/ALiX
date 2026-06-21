# P6.1 — ApprovalRecommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the third P6 DecisionArtifact layer — a deterministic, read-only recommendation engine that answers "What appears reasonable?" using DecisionContext + RiskScore.

**Architecture:** RecommendationEngine is a pure computation class (no stores, no async) that receives DecisionContext + optional RiskScore and returns a single ApprovalRecommendation with one of four outcomes. Signal coherence is computed deterministically. The engine never constructs context or reads stores — it receives its data already assembled.

**Tech Stack:** TypeScript, vitest

## Global Constraints

- No new ProposalAction values or EvidenceType values
- No breaking changes to existing store schemas (type expansions are OK as long as they're backward-compatible)
- All changes backward-compatible with v0.5.0 (and v0.6.0)
- RecommendationEngine is read-only — no write, approve, apply, or queue operations
- Recommend ≠ Decide invariant enforced from first commit
- High risk must produce investigate, NOT reject
- Confidence is signal coherence, NOT evidence completeness or risk magnitude
- Recommendation confidence bounded by evidence ceiling (`min(signalCoherence, max(0.5, ctx.confidence))`)

---
## File Structure Map

```
Create:
  src/adaptation/recommendation-types.ts      — Recommendation, WarningSeverity, EnrichedWarning, ApprovalRecommendation
  src/adaptation/recommendation-engine.ts     — RecommendationEngine, rule functions, computeSignalCoherence
  tests/adaptation/recommendation-engine.vitest.ts
  tests/adaptation/recommendation-sentinels.vitest.ts

Modify:
  src/adaptation/decision-types.ts            — add EnrichedWarning type, update DecisionArtifact.warnings to EnrichedWarning[]
  src/adaptation/decision-context-builder.ts  — update build() to produce EnrichedWarning[] instead of string[] for warnings
  src/cli/commands/decision.ts                — add `alix decision recommend` subcommand
```

### Interfaces Between Tasks

- **Task 1** produces: `Recommendation`, `WarningSeverity`, `EnrichedWarning`, `ApprovalRecommendation extends DecisionArtifact`, updates `DecisionContext.warnings` to `EnrichedWarning[]`
- **Task 2** consumes: `ApprovalRecommendation`, `Recommendation`, `EnrichedWarning`, `DecisionContext`, `RiskScore`, `RiskItem`
- **Task 3** consumes: same as Task 2
- **Task 4** consumes: `DecisionContextBuilder`, `RiskScoreBuilder`, `RecommendationEngine`
- **Task 5** consumes: `RecommendationEngine` source file (for sentinel checks)

---

### Task 1: Types — Recommendation, WarningSeverity, EnrichedWarning, ApprovalRecommendation

**Files:**
- Create: `src/adaptation/recommendation-types.ts`
- Modify: `src/adaptation/decision-types.ts` — add `EnrichedWarning` type, update `DecisionArtifact.warnings` from `string[]` to `EnrichedWarning[]`

- [ ] **Step 1: Create recommendation-types.ts**

```typescript
/**
 * P6.1 — ApprovalRecommendation types.
 *
 * ApprovalRecommendation is a deterministic, read-only recommendation computed
 * from DecisionContext + RiskScore. It answers "What appears reasonable?"
 * without making decisions.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { RiskItem } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// WarningSeverity
// ---------------------------------------------------------------------------

export type WarningSeverity = "info" | "warning" | "critical";

// ---------------------------------------------------------------------------
// EnrichedWarning
// ---------------------------------------------------------------------------

export interface EnrichedWarning {
  message: string;
  severity: WarningSeverity;
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export type Recommendation = "approve" | "reject" | "defer" | "investigate";

// ---------------------------------------------------------------------------
// ApprovalRecommendation
// ---------------------------------------------------------------------------

export interface ApprovalRecommendation extends DecisionArtifact {
  /** One outcome — "What appears reasonable?" */
  recommendation: Recommendation;

  /** The proposal this recommendation addresses. */
  proposalId: string;

  /** Reference to the RiskScore used (if any). */
  riskScoreId?: string;

  /** Human-readable rationale — per-rule justifications. */
  reasons: string[];

  /** RiskScore dimensions forwarded for operator convenience. */
  risks?: RiskItem[];

  /** Preserves evidence chain from DecisionContext. */
  sourceArtifacts: SourceArtifact[];
}
```

- [ ] **Step 2: Update decision-types.ts with EnrichedWarning**

Add the `EnrichedWarning` and `WarningSeverity` types to `src/adaptation/decision-types.ts`, then update `DecisionArtifact.warnings` from `warnings?: string[]` to `warnings?: EnrichedWarning[]`.

```typescript
// Add to decision-types.ts alongside the existing types:

export type WarningSeverity = "info" | "warning" | "critical";

export interface EnrichedWarning {
  message: string;
  severity: WarningSeverity;
}
```

Then update `DecisionArtifact`:
```typescript
export interface DecisionArtifact {
  id: string;
  subject: string;
  outcome: string;
  confidence: number;
  reasons: string[];
  warnings?: EnrichedWarning[];  // was string[]
  evidenceRefs?: string[];
  generatedAt: string;
}
```

- [ ] **Step 3: Update decision-context-builder.ts to produce EnrichedWarning[]**

In `src/adaptation/decision-context-builder.ts`, find where warnings are constructed as `string[]` and update to produce `EnrichedWarning[]`. The pattern is:
```typescript
// Old: warnings.push("Lineage is incomplete");
// New:
warnings.push({ message: "Lineage is incomplete", severity: "info" });
```

Apply severity annotations:
- `"info"` for informational warnings (e.g., low sample size, partial lineage)
- `"warning"` for moderate concerns (e.g., stale context, moderate risk indicators)
- `"critical"` for trust/integrity issues (e.g., broken lineage, missing evidence chain)

The existing warning generation logic stays the same — only the type changes.

After updating, run `npx tsc --noEmit` to verify type compatibility.

- [ ] **Step 4: Commit**

```bash
git add src/adaptation/recommendation-types.ts src/adaptation/decision-types.ts src/adaptation/decision-context-builder.ts
git commit -m "P6.1: ApprovalRecommendation type definitions + EnrichedWarning"
```

---

### Task 2: RecommendationEngine — pure rule evaluation + signal coherence

**Files:**
- Create: `src/adaptation/recommendation-engine.ts`

**Interfaces:**
- Consumes: `ApprovalRecommendation`, `Recommendation`, `EnrichedWarning` from `./recommendation-types`, `DecisionContext` from `./decision-types`, `RiskScore` / `RiskItem` from `./risk-score-types`
- Produces: `RecommendationEngine` class with `recommend(ctx, riskScore?, options?)`

- [ ] **Step 1: Create recommendation-engine.ts**

```typescript
/**
 * P6.1 — RecommendationEngine.
 *
 * Pure, deterministic, read-only recommendation engine.
 * Receives DecisionContext + optional RiskScore and returns a single
 * ApprovalRecommendation with one of four outcomes.
 *
 * Rules (priority order, first match wins):
 *   1. reject    — lineage broken + insufficient data + critical warning
 *   2. defer     — stale or insufficient context
 *   3. investigate — high risk, or strong evidence + material risk
 *   4. approve   — otherwise (default)
 *
 * Never reads stores or constructs context.
 *
 * @module
 */

import type { DecisionContext } from "./decision-types.js";
import type { RiskScore, RiskItem } from "./risk-score-types.js";
import type { ApprovalRecommendation, Recommendation } from "./recommendation-types.js";
import { riskOutcomeFromScore } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/**
 * Determine if the proposal should be rejected.
 * Reject is a trust/integrity circuit breaker, NOT a quality judgment.
 * Requires ALL THREE conditions: broken lineage + insufficient data + critical warning.
 */
function shouldReject(ctx: DecisionContext): boolean {
  if (ctx.lineageCompleteness !== "broken") return false;
  if (ctx.contextStatus !== "insufficient_data") return false;
  return (ctx.warnings ?? []).some((w) => w.severity === "critical");
}

/**
 * Determine if the proposal should be deferred due to insufficient evidence.
 */
function shouldDefer(ctx: DecisionContext): boolean {
  return ctx.contextStatus === "stale_context" || ctx.contextStatus === "insufficient_data";
}

/**
 * Determine if the proposal should be investigated.
 * High risk or conflicting signals need human attention.
 */
function shouldInvestigate(ctx: DecisionContext, riskScore?: RiskScore): boolean {
  // High risk alone is enough to flag for investigation
  if (riskScore && riskScore.overallRisk >= 0.6) return true;
  // Strong evidence + material risk = signals conflict
  if (ctx.confidence >= 0.8 && riskScore && riskScore.overallRisk >= 0.4) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Signal coherence
// ---------------------------------------------------------------------------

/**
 * Compute recommendation confidence from signal coherence.
 *
 * Measures how clearly the available evidence supports the selected recommendation.
 * Bounded by evidence ceiling — recommendation cannot be more certain
 * than the available evidence.
 *
 * Returns a value in [0, 1] with 2 decimal places.
 */
export function computeSignalCoherence(
  recommendation: Recommendation,
  ctx: DecisionContext,
  riskScore?: RiskScore,
): number {
  let support = 0;
  let contradict = 0;

  // Evidence completeness supports when high
  if (ctx.confidence >= 0.7) support++;
  else if (ctx.confidence < 0.4) contradict++;

  // Risk assessment support depends on recommendation
  if (riskScore) {
    if (recommendation === "investigate" && riskScore.overallRisk >= 0.6) support++;
    else if (recommendation !== "investigate" && riskScore.overallRisk < 0.4) support++;
    else contradict++;
  }

  // Lineage completeness supports confident recommendations
  if (ctx.lineageCompleteness === "complete") support++;
  else if (ctx.lineageCompleteness === "broken") contradict++;

  // Effectiveness trend alignment
  if (ctx.effectivenessTrend.sampleSize > 0) {
    const trendSupports =
      (recommendation === "approve" && ctx.effectivenessTrend.keepRate > 0.7) ||
      (recommendation === "investigate" && ctx.effectivenessTrend.revertRate > 0.3);
    if (trendSupports) support++;
    else contradict++;
  }

  const total = support + contradict;
  if (total === 0) return 0.5; // neutral — no signals to judge

  // Raw coherence: what proportion of signals support the recommendation
  const rawCoherence = support / total;

  // Evidence ceiling: recommendation cannot be more certain than the available evidence
  // Floor of 0.5 so low evidence doesn't collapse confidence to zero
  const evidenceCeiling = Math.max(0.5, ctx.confidence);
  const clamped = Math.min(rawCoherence, evidenceCeiling);

  return Math.round(clamped * 100) / 100;
}

// ---------------------------------------------------------------------------
// RecommendationEngine
// ---------------------------------------------------------------------------

export class RecommendationEngine {
  /**
   * Produce a single ApprovalRecommendation from DecisionContext + optional RiskScore.
   *
   * @param ctx - Assembled DecisionContext
   * @param riskScore - Optional RiskScore from RiskScoreBuilder
   * @param generatedAt - ISO 8601 timestamp (injected for deterministic testing)
   */
  recommend(
    ctx: DecisionContext,
    riskScore?: RiskScore,
    generatedAt?: string,
  ): ApprovalRecommendation {
    const genAt = generatedAt ?? new Date().toISOString();
    const reasons: string[] = [];
    let recommendation: Recommendation;

    // Rule 1: reject (trust circuit breaker)
    if (shouldReject(ctx)) {
      recommendation = "reject";
      reasons.push("Lineage is broken, data insufficient, and critical warnings present");
      reasons.push("Proposal cannot be trusted — requires manual governance review");
    }
    // Rule 2: defer (insufficient evidence)
    else if (shouldDefer(ctx)) {
      recommendation = "defer";
      if (ctx.contextStatus === "stale_context") reasons.push("Context is stale — refresh evidence before evaluating");
      if (ctx.contextStatus === "insufficient_data") reasons.push("Insufficient data to form a recommendation");
    }
    // Rule 3: investigate (high risk or conflicting signals)
    else if (shouldInvestigate(ctx, riskScore)) {
      recommendation = "investigate";
      if (riskScore && riskScore.overallRisk >= 0.6) {
        reasons.push(`Risk score is ${riskScore.outcome} (${riskScore.overallRisk.toFixed(2)})`);
      }
      if (ctx.confidence >= 0.8 && riskScore && riskScore.overallRisk >= 0.4) {
        reasons.push("Strong evidence with material risk — signals conflict");
      }
    }
    // Rule 4: approve (default)
    else {
      recommendation = "approve";
      reasons.push("Context is sufficient and risk is moderate or low");
    }

    const coherence = computeSignalCoherence(recommendation, ctx, riskScore);

    return {
      id: `rec-${ctx.proposalId}`,
      subject: `Recommendation for ${ctx.proposalId}`,
      outcome: recommendation,
      recommendation,
      confidence: coherence,
      reasons,
      proposalId: ctx.proposalId,
      evidenceRefs: [...(ctx.evidenceRefs ?? [])],
      warnings: ctx.warnings?.length ? [...ctx.warnings] : undefined,
      sourceArtifacts: [...ctx.sourceArtifacts],
      generatedAt: genAt,
    };
  }
}
```

- [ ] **Step 2: Compile-check**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add src/adaptation/recommendation-engine.ts
git commit -m "P6.1: RecommendationEngine — pure rule evaluation + signal coherence"
```

---

### Task 3: RecommendationEngine tests

**Files:**
- Create: `tests/adaptation/recommendation-engine.vitest.ts`

- [ ] **Step 1: Create tests**

```typescript
import { describe, it, expect } from "vitest";
import { RecommendationEngine, computeSignalCoherence } from "../../src/adaptation/recommendation-engine.js";
import type { DecisionContext } from "../../src/adaptation/decision-types.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";
import type { EnrichedWarning } from "../../src/adaptation/recommendation-types.js";

function createContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    id: "decision-ctx-test",
    subject: "Test context",
    outcome: "complete_context",
    confidence: 0.85,
    reasons: [],
    warnings: [],
    evidenceRefs: ["fp-1"],
    generatedAt: new Date().toISOString(),
    contextStatus: "complete_context",
    proposalId: "prop-test-001",
    proposalStatus: "applied",
    proposalAction: "update_agent_card",
    createdAt: new Date().toISOString(),
    ageDays: 2,
    lineage: undefined,
    lineageCompleteness: "complete",
    similarProposals: [],
    effectivenessTrend: { actionType: "update_agent_card", keepRate: 0.8, revertRate: 0.1, sampleSize: 10 },
    sourceArtifacts: [{ type: "proposal", id: "ctx-1" }],
    dataFreshness: { newestArtifactAgeDays: 1, oldestArtifactAgeDays: 2 },
    ...overrides,
  };
}

function createRiskScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    id: "risk-test",
    subject: "Test risk",
    outcome: "low",
    confidence: 0.85,
    reasons: [],
    evidenceRefs: ["fp-1"],
    generatedAt: new Date().toISOString(),
    overallRisk: 0.2,
    risks: [],
    dimensions: { governance: 0.1, operational: 0.1, capability: 0.2, revertability: 0.1, evidence_quality: 0.1 },
    sourceArtifacts: [],
    ...overrides,
  };
}

describe("RecommendationEngine — rule evaluation", () => {
  it("rejects only when lineage broken + insufficient_data + critical warning", () => {
    const ctx = createContext({
      lineageCompleteness: "broken",
      contextStatus: "insufficient_data",
      warnings: [{ message: "Lineage chain severed", severity: "critical" }] as EnrichedWarning[],
    });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).toBe("reject");
  });

  it("does NOT reject when only lineage is broken (no critical warning)", () => {
    const ctx = createContext({
      lineageCompleteness: "broken",
      contextStatus: "insufficient_data",
      warnings: [{ message: "Lineage is partial", severity: "warning" }] as EnrichedWarning[],
    });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).not.toBe("reject");
  });

  it("defers for stale context", () => {
    const ctx = createContext({ contextStatus: "stale_context" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).toBe("defer");
  });

  it("defers for insufficient data", () => {
    const ctx = createContext({ contextStatus: "insufficient_data" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).toBe("defer");
  });

  it("investigates when risk is high (overallRisk >= 0.6)", () => {
    const ctx = createContext();
    const risk = createRiskScore({ overallRisk: 0.7, outcome: "high" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("investigate");
  });

  it("investigates when strong evidence + material risk", () => {
    const ctx = createContext({ confidence: 0.9 });
    const risk = createRiskScore({ overallRisk: 0.5, outcome: "medium" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("investigate");
  });

  it("approves when context sufficient and risk low", () => {
    const ctx = createContext();
    const risk = createRiskScore({ overallRisk: 0.2, outcome: "low" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("approve");
  });
});

describe("RecommendationEngine — high risk never produces reject", () => {
  it("high risk without broken lineage/inssufficient data → investigate, not reject", () => {
    const ctx = createContext({ lineageCompleteness: "complete", confidence: 0.9 });
    const risk = createRiskScore({ overallRisk: 0.9, outcome: "critical" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("investigate");
    expect(result.recommendation).not.toBe("reject");
  });
});

describe("computeSignalCoherence", () => {
  it("returns high coherence when all signals support approve", () => {
    const ctx = createContext({ confidence: 0.9, lineageCompleteness: "complete" });
    const risk = createRiskScore({ overallRisk: 0.15 });
    const coherence = computeSignalCoherence("approve", ctx, risk);
    expect(coherence).toBeGreaterThan(0.7);
  });

  it("returns low coherence when signals conflict", () => {
    const ctx = createContext({ confidence: 0.9, lineageCompleteness: "complete" });
    const risk = createRiskScore({ overallRisk: 0.6 });
    // High confidence + high risk should NOT support "approve"
    const coherence = computeSignalCoherence("approve", ctx, risk);
    expect(coherence).toBeLessThan(0.5);
  });

  it("coherence is bounded by evidence ceiling", () => {
    const ctx = createContext({ confidence: 0.3 });
    const risk = createRiskScore({ overallRisk: 0.15 });
    // With confidence 0.3, max coherence should be max(0.5, 0.3) = 0.5
    const coherence = computeSignalCoherence("approve", ctx, risk);
    expect(coherence).toBeLessThanOrEqual(0.5);
  });

  it("returns 0.5 neutral when no signals available", () => {
    const ctx = createContext({
      confidence: 0.5,
      lineageCompleteness: "complete",
      effectivenessTrend: { actionType: "update_agent_card", keepRate: 0, revertRate: 0, sampleSize: 0 },
      warnings: [] as EnrichedWarning[],
    });
    const coherence = computeSignalCoherence("approve", ctx);
    expect(coherence).toBe(0.5);
  });
});

describe("ApprovalRecommendation — DecisionArtifact compatibility", () => {
  it("has outcome, confidence, reasons, warnings, evidenceRefs, generatedAt", () => {
    const ctx = createContext();
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.outcome).toBeDefined();
    expect(result.recommendation).toBeDefined();
    expect(typeof result.confidence).toBe("number");
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(Array.isArray(result.evidenceRefs)).toBe(true);
    expect(result.generatedAt).toBeDefined();
    expect(result.sourceArtifacts).toBeDefined();
    expect(result.proposalId).toBe("prop-test-001");
  });
});

describe("RecommendationEngine — determinism", () => {
  it("produces identical results for the same inputs", () => {
    const ctx = createContext();
    const risk = createRiskScore();
    const engine = new RecommendationEngine();
    const frozenTime = "2026-06-20T12:00:00.000Z";
    const r1 = engine.recommend(ctx, risk, frozenTime);
    const r2 = engine.recommend(ctx, risk, frozenTime);
    expect(r1).toEqual(r2);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/adaptation/recommendation-engine.vitest.ts --config vitest.config.mts`
Expected: 15+ tests passing

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/recommendation-engine.vitest.ts
git commit -m "P6.1: RecommendationEngine tests"
```

---

### Task 4: CLI — `alix decision recommend`

**Files:**
- Modify: `src/cli/commands/decision.ts`

- [ ] **Step 1: Add import and subcommand handler**

Add the import after the existing RiskScoreBuilder import:
```typescript
import { RecommendationEngine } from "../../adaptation/recommendation-engine.js";
```

Add the `"recommend"` case to the switch statement after the `"risk"` case:
```typescript
    case "recommend":
      await runRecommend(rest);
      return;
```

Update the default error message:
```typescript
console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json]");
```

- [ ] **Step 2: Add runRecommend function**

```typescript
// ---------------------------------------------------------------------------
// runRecommend
// ---------------------------------------------------------------------------

async function runRecommend(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision recommend <proposal-id> [--json]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const cwd = process.cwd();

  const proposalStore = new ProposalStore(join(cwd, PROPOSALS_DIR));
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) });
  const effStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const intelStore = new IntelligenceStore(join(cwd, INTELLIGENCE_DIR));
  const lineageBuilder = new LineageBuilder(proposalStore, evidenceStore, effStore, intelStore);
  const ctxBuilder = new DecisionContextBuilder(proposalStore, evidenceStore, lineageBuilder, effStore, intelStore);
  const riskBuilder = new RiskScoreBuilder();
  const recEngine = new RecommendationEngine();

  const ctx = await ctxBuilder.build(id);
  const risk = riskBuilder.build(ctx);
  const recommendation = recEngine.recommend(ctx, risk);

  if (jsonMode) {
    console.log(JSON.stringify(recommendation, null, 2));
    return;
  }

  const recIcon =
    recommendation.recommendation === "approve" ? "✅" :
    recommendation.recommendation === "reject" ? "❌" :
    recommendation.recommendation === "defer" ? "⏸️" :
    "🔍";

  console.log(`Recommendation: ${recommendation.proposalId}`);
  console.log(`────────────────────────────────────`);
  console.log(`${recIcon} ${recommendation.recommendation.charAt(0).toUpperCase() + recommendation.recommendation.slice(1)} (confidence: ${(recommendation.confidence * 100).toFixed(0)}%)`);
  console.log(``);
  console.log(`Context confidence: ${(ctx.confidence * 100).toFixed(0)}% (evidence completeness)`);
  console.log(`Risk score:        ${risk.overallRisk.toFixed(2)}  (${risk.outcome})`);
  console.log(``);
  console.log(`Reasons:`);
  for (const reason of recommendation.reasons) {
    console.log(` · ${reason}`);
  }
  if (recommendation.warnings && recommendation.warnings.length > 0) {
    console.log(``);
    console.log(`Warnings:`);
    for (const w of recommendation.warnings) {
      const icon = w.severity === "critical" ? "🔴" : w.severity === "warning" ? "🟡" : "🔵";
      console.log(` ${icon} ${w.message}`);
    }
  }
  console.log(``);
  console.log(`Sources: ${recommendation.sourceArtifacts.length} artifact(s)`);
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run --config vitest.config.mts`
Expected: All tests pass (including new recommendation tests)

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/decision.ts
git commit -m "P6.1: CLI alix decision recommend subcommand"
```

---

### Task 5: Governance sentinels

**Files:**
- Create: `tests/adaptation/recommendation-sentinels.vitest.ts`

- [ ] **Step 1: Create sentinel tests**

```typescript
/**
 * P6.1 — Governance sentinels for RecommendationEngine.
 *
 * Enforces the Recommend ≠ Decide invariant at the source-code level.
 * RecommendationEngine must not import governance/mutation modules,
 * reference governance types, contain recommendation-as-action language,
 * or call write/approve/apply methods.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function sourceOf(relativePath: string): string {
  const resolved = path.resolve(__dirname, relativePath);
  return fs.readFileSync(resolved, "utf-8");
}

const FORBIDDEN_IMPORTS = [
  "approval-gate",
  "agent-card-applier",
  "skill-applier",
  "revert-applier",
  "auto-proposal-generator",
  "capability-evolution-proposal-generator",
];

const FORBIDDEN_TYPES = [
  "ApprovalGate",
  "Applier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "AutomaticProposalGenerator",
  "CapabilityEvolutionProposalGenerator",
];

const FORBIDDEN_STORES = [
  "ProposalStore",
  "EvidenceStore",
  "LineageBuilder",
  "IntelligenceStore",
  "EffectivenessStore",
];

it("must not import governance/mutation modules", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine");
  for (const mod of FORBIDDEN_IMPORTS) {
    expect(source).not.toContain(mod);
  }
});

it("must not reference governance types", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine");
  for (const type of FORBIDDEN_TYPES) {
    expect(source).not.toContain(type);
  }
});

it("must not reference store types in source", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine");
  for (const store of FORBIDDEN_STORES) {
    expect(source).not.toContain(store);
  }
});

it("must not contain write/approve/apply/reject calls", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine");
  const forbidden = [".save(", ".update(", ".approve(", ".apply(", ".reject(", ".queue("];
  for (const method of forbidden) {
    expect(source).not.toContain(method);
  }
});

it("must not contain recommendation language as action terms", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine");
  // These are OK in type definitions but must not appear as imperative calls
  const patterns = [/\bapprove\b/, /\breject\b/, /\bdefer\b/, /\binvestigate\b/];
  // Only flag if they appear outside of type annotations and return statements
  // (This is a conservative grep — false positives on type references are acceptable)
  const lines = source.split("\n");
  for (const pattern of patterns) {
    const matches = lines.filter(
      (l) => pattern.test(l) && !l.includes("Recommendation") && !l.includes("recommendation") && !l.includes("recommend"),
    );
    // Only flag if found outside the 'recommendation' return object
    const cleanLines = matches.filter(
      (l) => !l.includes("recommendation:") && !l.includes("recommendation === "),
    );
    expect(cleanLines.length).toBe(0);
  }
});

it("constructor must not accept stores", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine");
  // The constructor should only accept no arguments
  const constructorMatch = source.match(/constructor\([^)]*\)/);
  if (constructorMatch) {
    const params = constructorMatch[0];
    expect(params).toBe("constructor()");
  }
});
```

- [ ] **Step 2: Run sentinel tests**

Run: `npx vitest run tests/adaptation/recommendation-sentinels.vitest.ts --config vitest.config.mts`
Expected: 6 tests passing

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/recommendation-sentinels.vitest.ts
git commit -m "P6.1: governance sentinels — Recommendation must not decide"
```

---

## Self-Review

**Spec coverage:**
- Types (Recommendation, WarningSeverity, EnrichedWarning, ApprovalRecommendation, DecisionContext.warnings update) → Task 1
- Engine (4 rules, priority order, deterministic) → Task 2
- Signal coherence with evidence ceiling → Task 2
- Tests (high risk → investigate, reject circuit breaker, defer, approve, coherence, determinism) → Task 3
- CLI (recommend subcommand) → Task 4
- Governance sentinels (no stores, no writes, no gate imports, no action terms) → Task 5
- Determinism assertion → Task 3
- Three-signal separation → enforced across Tasks 2–4

**Placeholder scan:** Clean — all code blocks have complete implementations.

**Type consistency:** All type names, imports, and method signatures are consistent across tasks.
