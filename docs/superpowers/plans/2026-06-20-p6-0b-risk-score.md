# P6.0b — RiskScore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deterministic, read-only risk scoring as a pure computation over DecisionContext — no stores, no recommendations, no ML.

**Architecture:** RiskScoreBuilder is a pure computation that accepts a `DecisionContext` and returns a `RiskScore`. It never reads from stores or constructs context. The CLI builds the DecisionContext via DecisionContextBuilder, then passes it to RiskScoreBuilder.

**Tech Stack:** TypeScript, vitest

## Global Constraints

- No new `ProposalAction` values or `EvidenceType` values
- No breaking changes to existing store schemas
- All changes backward-compatible with v0.5.0
- RiskScoreBuilder accepts DecisionContext directly — never constructs stores or rebuilds context
- Scoring functions are pure, deterministic, side-effect free
- Recommend ≠ Decide: RiskScoreBuilder is read-only

---

## File Structure Map

```
Create:
  src/adaptation/risk-score-types.ts         — RiskDimension, RiskItem, RiskScore, riskOutcomeFromScore()
  src/adaptation/risk-score-builder.ts       — scoreGovernance, scoreOperational, scoreCapability,
                                               scoreRevertability, scoreEvidenceQuality, RiskScoreBuilder
  tests/adaptation/risk-score-builder.vitest.ts
  tests/adaptation/risk-score-sentinels.vitest.ts

Modify:
  src/cli/commands/decision.ts               — add `alix decision risk` subcommand
```

---

### Task 1: RiskScore types

**Files:**
- Create: `src/adaptation/risk-score-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * P6.0b — RiskScore types.
 *
 * RiskScore is a deterministic, read-only risk assessment computed from
 * a DecisionContext. It answers "what could go wrong?" without making
 * recommendations.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// RiskDimension
// ---------------------------------------------------------------------------

export type RiskDimension =
  | "governance"
  | "operational"
  | "capability"
  | "revertability"
  | "evidence_quality";

export const RISK_DIMENSIONS: RiskDimension[] = [
  "governance",
  "operational",
  "capability",
  "revertability",
  "evidence_quality",
];

// ---------------------------------------------------------------------------
// RiskItem
// ---------------------------------------------------------------------------

export interface RiskItem {
  dimension: RiskDimension;
  /** 0-1 where 0 = no risk, 1 = critical risk. */
  score: number;
  /** Confidence in this score (0-1). */
  confidence: number;
  /** Human-readable justifications. Matches DecisionArtifact.reasons pattern. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// RiskScore
// ---------------------------------------------------------------------------

export type RiskOutcome = "low" | "medium" | "high" | "critical";

/**
 * Convert a numeric overallRisk (0-1) to a RiskOutcome label.
 * Pure function, no side effects.
 */
export function riskOutcomeFromScore(overallRisk: number): RiskOutcome {
  if (overallRisk < 0.3) return "low";
  if (overallRisk < 0.6) return "medium";
  if (overallRisk < 0.85) return "high";
  return "critical";
}

export interface RiskScore extends DecisionArtifact {
  /** Overall risk level (0-1). */
  overallRisk: number;

  /** Per-dimension breakdown. */
  risks: RiskItem[];

  /** Convenience accessor — per-dimension scores. */
  dimensions: Record<RiskDimension, number>;

  /** Provenance — preserves chain from DecisionContext. */
  sourceArtifacts: SourceArtifact[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adaptation/risk-score-types.ts
git commit -m "P6.0b: RiskScore type definitions"
```

---

### Task 2: Pure scoring functions + RiskScoreBuilder

**Files:**
- Create: `src/adaptation/risk-score-builder.ts`

- [ ] **Step 1: Create risk-score-builder.ts**

```typescript
/**
 * P6.0b — RiskScoreBuilder.
 *
 * Pure, deterministic, read-only risk scoring over a DecisionContext.
 * Never reads from stores or constructs context — receives DecisionContext directly.
 * Scoring functions are independently testable and side-effect free.
 *
 * @module
 */

import type { DecisionContext } from "./decision-types.js";
import type {
  RiskScore,
  RiskItem,
  RiskDimension,
  RiskOutcome,
} from "./risk-score-types.js";
import { RISK_DIMENSIONS, riskOutcomeFromScore } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// Pure scoring functions
// Each receives a DecisionContext and returns a number in [0, 1].
// ---------------------------------------------------------------------------

export function scoreGovernance(ctx: DecisionContext): number {
  let score = 0;
  if (ctx.lineageCompleteness === "broken") score += 0.4;
  else if (ctx.lineageCompleteness === "partial") score += 0.2;
  score += Math.min((ctx.warnings?.length ?? 0) * 0.15, 0.3);
  if (ctx.contextStatus === "insufficient_data") score += 0.5;
  return Math.min(score, 1);
}

export function scoreOperational(ctx: DecisionContext): number {
  let score = 0;
  if (ctx.proposalStatus === "failed") score += 0.4;
  const badOutcomes = ctx.similarProposals.filter(
    (s) => s.outcome === "revert" || s.outcome === "investigate",
  ).length;
  score += Math.min(badOutcomes * 0.1, 0.3);
  if (ctx.effectivenessTrend.revertRate > 0.5) score += 0.3;
  return Math.min(score, 1);
}

export function scoreCapability(ctx: DecisionContext): number {
  let score = 0;
  if (ctx.effectivenessTrend.sampleSize === 0) score += 0.3;
  if (ctx.effectivenessTrend.sampleSize > 0) {
    score += (1 - ctx.effectivenessTrend.keepRate) * 0.5;
  }
  const revertCount = ctx.similarProposals.filter(
    (s) => s.outcome === "revert",
  ).length;
  score += Math.min(revertCount * 0.1, 0.2);
  return Math.min(score, 1);
}

export function scoreRevertability(ctx: DecisionContext): number {
  if (ctx.proposalAction === "create_improvement_issue") return 0.1;
  if (ctx.proposalAction === "suggest_routing_weight") return 0.1;
  if (ctx.lineageCompleteness === "broken") return 0.7;
  if (ctx.proposalStatus === "applied") return 0.3;
  return 0.5;
}

export function scoreEvidenceQuality(ctx: DecisionContext): number {
  let score = 0;
  if (ctx.evidenceRefs.length === 0) score += 0.4;
  if (ctx.dataFreshness.oldestArtifactAgeDays > 30) score += 0.2;
  if (ctx.lineageCompleteness === "broken") score += 0.3;
  else if (ctx.lineageCompleteness === "partial") score += 0.15;
  if (ctx.contextStatus === "stale_context") score += 0.3;
  return Math.min(score, 1);
}

// ---------------------------------------------------------------------------
// RiskScoreBuilder
// ---------------------------------------------------------------------------

export class RiskScoreBuilder {
  /**
   * Build a RiskScore from a DecisionContext.
   *
   * Pure computation — receives DecisionContext directly, never reads
   * from stores or constructs context. Deterministic: same input always
   * produces the same output.
   */
  build(ctx: DecisionContext): RiskScore {
    const generatedAt = new Date().toISOString();
    const reasons: string[] = [];
    const warnings: string[] = [];
    const evidenceRefs: string[] = [...ctx.evidenceRefs];
    const dimensions: Record<RiskDimension, number> = {
      governance: scoreGovernance(ctx),
      operational: scoreOperational(ctx),
      capability: scoreCapability(ctx),
      revertability: scoreRevertability(ctx),
      evidence_quality: scoreEvidenceQuality(ctx),
    };

    const risks: RiskItem[] = [];
    for (const dim of RISK_DIMENSIONS) {
      const score = dimensions[dim];
      const dimReasons: string[] = [];
      if (dim === "governance" && ctx.lineageCompleteness !== "complete") {
        dimReasons.push(`Lineage is ${ctx.lineageCompleteness}`);
      }
      if (dim === "capability" && ctx.effectivenessTrend.sampleSize === 0) {
        dimReasons.push("No effectiveness history available");
      }
      if (dimReasons.length === 0) {
        dimReasons.push(`Score ${score.toFixed(2)} based on available evidence`);
      }
      risks.push({
        dimension: dim,
        score,
        confidence: ctx.confidence,
        reasons: dimReasons,
      });
      reasons.push(`${dim}: ${score.toFixed(2)}`);
    }

    const overallRisk = Math.round(
      RISK_DIMENSIONS.reduce((sum, d) => sum + dimensions[d], 0) /
        RISK_DIMENSIONS.length *
        100,
    ) / 100;

    const outcome: RiskOutcome = riskOutcomeFromScore(overallRisk);

    if (ctx.warnings) {
      warnings.push(...ctx.warnings);
    }

    return {
      id: `risk-${ctx.proposalId}`,
      subject: `Risk assessment for ${ctx.proposalAction}: ${ctx.subject}`,
      outcome,
      confidence: ctx.confidence,
      reasons,
      warnings: warnings.length > 0 ? warnings : undefined,
      evidenceRefs,
      generatedAt,
      overallRisk,
      risks,
      dimensions,
      // Preserve provenance chain from DecisionContext
      sourceArtifacts: ctx.sourceArtifacts,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adaptation/risk-score-builder.ts
git commit -m "P6.0b: RiskScoreBuilder — pure scoring functions + builder"
```

---

### Task 3: RiskScoreBuilder tests

**Files:**
- Create: `tests/adaptation/risk-score-builder.vitest.ts`

- [ ] **Step 1: Create tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  scoreGovernance,
  scoreOperational,
  scoreCapability,
  scoreRevertability,
  scoreEvidenceQuality,
  RiskScoreBuilder,
} from "../../src/adaptation/risk-score-builder";
import type { DecisionContext } from "../../src/adaptation/decision-types";

function createContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    // DecisionArtifact fields
    id: "decision-ctx-test",
    subject: "Test context",
    outcome: "complete_context",
    confidence: 0.85,
    reasons: [],
    evidenceRefs: ["fp-1"],
    generatedAt: new Date().toISOString(),
    // Context-specific
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
    sourceArtifacts: [],
    dataFreshness: { newestArtifactAgeDays: 1, oldestArtifactAgeDays: 2 },
    ...overrides,
  };
}

describe("RiskScoreBuilder — pure scoring functions", () => {
  it("scoreGovernance: broken lineage increases risk", () => {
    const ctx = createContext({ lineageCompleteness: "broken" });
    expect(scoreGovernance(ctx)).toBeGreaterThan(0);
  });

  it("scoreGovernance: insufficient_data increases risk", () => {
    const ctx = createContext({ contextStatus: "insufficient_data", lineageCompleteness: "broken" });
    expect(scoreGovernance(ctx)).toBeGreaterThanOrEqual(0.5);
  });

  it("scoreOperational: failed status increases risk", () => {
    const ctx = createContext({ proposalStatus: "failed" });
    expect(scoreOperational(ctx)).toBeGreaterThan(0);
  });

  it("scoreCapability: no effectiveness data increases risk", () => {
    const ctx = createContext({
      effectivenessTrend: { actionType: "unknown", keepRate: 0, revertRate: 0, sampleSize: 0 },
    });
    expect(scoreCapability(ctx)).toBeGreaterThan(0.3);
  });

  it("scoreRevertability: non-mutating actions are low risk", () => {
    const ctx = createContext({ proposalAction: "create_improvement_issue" });
    expect(scoreRevertability(ctx)).toBeLessThanOrEqual(0.2);
  });

  it("scoreEvidenceQuality: no evidence refs increases risk", () => {
    const ctx = createContext({ evidenceRefs: [] });
    expect(scoreEvidenceQuality(ctx)).toBeGreaterThan(0);
  });

  it("overall risk is average of dimensions", () => {
    const builder = new RiskScoreBuilder();
    const ctx = createContext();
    const score = builder.build(ctx);
    const avg =
      (score.dimensions.governance +
        score.dimensions.operational +
        score.dimensions.capability +
        score.dimensions.revertability +
        score.dimensions.evidence_quality) / 5;
    expect(score.overallRisk).toBeCloseTo(Math.round(avg * 100) / 100, 2);
  });
});

describe("RiskScoreBuilder — determinism", () => {
  it("produces identical risk scores for the same DecisionContext", () => {
    const builder = new RiskScoreBuilder();
    const ctx = createContext();
    const score1 = builder.build(ctx);
    const score2 = builder.build(ctx);
    expect(score1).toEqual(score2);
  });
});

describe("RiskScore — DecisionArtifact compatibility", () => {
  it("has outcome, reasons, warnings, evidenceRefs, generatedAt", () => {
    const builder = new RiskScoreBuilder();
    const ctx = createContext();
    const score = builder.build(ctx);
    expect(score.outcome).toBeDefined();
    expect(Array.isArray(score.reasons)).toBe(true);
    expect(Array.isArray(score.evidenceRefs)).toBe(true);
    expect(score.generatedAt).toBeDefined();
    expect(score.sourceArtifacts).toBeDefined();
    expect(score.sourceArtifacts.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/adaptation/risk-score-builder.vitest.ts --config vitest.config.mts`
Expected: 10 tests passing

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/risk-score-builder.vitest.ts
git commit -m "P6.0b: RiskScoreBuilder tests"
```

---

### Task 4: CLI risk command

**Files:**
- Modify: `src/cli/commands/decision.ts`

- [ ] **Step 1: Add `alix decision risk` subcommand**

Read the current `src/cli/commands/decision.ts` first. Add a `"risk"` case to the switch statement and a `runRisk` function.

The risk command:
1. Loads the proposal ID from args
2. Builds a DecisionContext via DecisionContextBuilder (same as `context` subcommand)
3. Passes the DecisionContext to RiskScoreBuilder
4. Renders terminal output or JSON

```typescript
import { RiskScoreBuilder } from "../../adaptation/risk-score-builder.js";

// In handleDecisionCommand's switch statement, add:
case "risk":
  await runRisk(rest);
  return;

// Add the runRisk function:
async function runRisk(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision risk <proposal-id> [--json]");
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

  const ctx = await ctxBuilder.build(id);
  const risk = riskBuilder.build(ctx);

  if (jsonMode) {
    console.log(JSON.stringify(risk, null, 2));
    return;
  }

  const riskIcon =
    risk.outcome === "critical" ? "🔴" :
    risk.outcome === "high" ? "🟠" :
    risk.outcome === "medium" ? "🟡" :
    "🟢";

  console.log(`Risk Score: ${risk.proposalId}`);
  console.log(`──────────────────────────────`);
  console.log(`${riskIcon} Overall: ${risk.outcome.toUpperCase()} (${risk.overallRisk.toFixed(2)})`);
  console.log(``);
  console.log(`Dimensions (confidence: ${(risk.confidence * 100).toFixed(0)}%):`);
  for (const r of risk.risks) {
    const dimIcon =
      r.dimension === "governance" ? "⚖️" :
      r.dimension === "operational" ? "⚙️" :
      r.dimension === "capability" ? "🎯" :
      r.dimension === "revertability" ? "↩️" :
      r.dimension === "evidence_quality" ? "📋" :
      "•";
    console.log(`  ${dimIcon} ${r.dimension.padEnd(18)} ${r.score.toFixed(2)}`);
    for (const reason of r.reasons) {
      console.log(`     ${reason}`);
    }
  }
  console.log(``);
  console.log(`Sources: ${risk.sourceArtifacts.length} artifact(s) used`);
}
```

- [ ] **Step 2: Run vitest tests**

Run: `npx vitest run tests/adaptation/ --config vitest.config.mts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/decision.ts
git commit -m "P6.0b: CLI alix decision risk subcommand"
```

---

### Task 5: Governance sentinels

**Files:**
- Create: `tests/adaptation/risk-score-sentinels.vitest.ts`

- [ ] **Step 1: Create sentinel tests**

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function sourceOf(modulePath: string): string {
  const resolved = require.resolve(modulePath);
  return fs.readFileSync(resolved, "utf-8");
}

describe("P6 Governance Invariants — RiskScore must not recommend", () => {
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

  const RECOMMENDATION_WORDS = [
    "approve",
    "reject",
    "defer",
    "investigate",
  ];

  it("must not import governance/mutation modules", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder");
    for (const mod of FORBIDDEN_IMPORTS) {
      expect(source).not.toContain(mod);
    }
  });

  it("must not reference governance types", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder");
    for (const type of FORBIDDEN_TYPES) {
      expect(source).not.toContain(type);
    }
  });

  it("must not contain recommendation language", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder");
    for (const word of RECOMMENDATION_WORDS) {
      expect(source).not.toContain(word);
    }
  });

  it("must not contain write/approve/apply calls", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder");
    const forbidden = [".save(", ".update(", ".approve(", ".apply(", ".reject("];
    for (const method of forbidden) {
      expect(source).not.toContain(method);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/adaptation/risk-score-sentinels.vitest.ts --config vitest.config.mts`
Expected: 4 tests passing

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/risk-score-sentinels.vitest.ts
git commit -m "P6.0b: governance sentinels — RiskScore must not recommend"
```

---

## Milestone Tag

```bash
git tag alix-p6.0b-complete
git push origin alix-p6.0b-complete
```
