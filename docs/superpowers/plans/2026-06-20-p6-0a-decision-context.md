# P6.0a — Decision Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the DecisionContext layer — the read-only context snapshot for any proposal, establishing the DecisionArtifact pattern and Recommend≠Decide invariant.

**Architecture:** Types in `decision-types.ts`, builder in `decision-context-builder.ts` (reads ProposalStore, EvidenceStore, LineageBuilder, EffectivenessStore, IntelligenceStore), CLI in `src/cli/commands/decision.ts` + registration in `src/cli.ts`. All read-only — no writes, no mutation paths.

**Tech Stack:** TypeScript, vitest, existing stores (ProposalStore, EvidenceStore, LineageBuilder, EffectivenessStore, IntelligenceStore)

## Global Constraints

- No new `ProposalAction` values or `EvidenceType` values
- No breaking changes to existing store schemas
- All changes backward-compatible with v0.5.0
- Recommend ≠ Decide: DecisionContextBuilder is read-only — never writes to any store
- Governance sentinel must pass: no imports of ApprovalGate, appliers, or generators

---

## File Structure Map

```
Create:
  src/adaptation/decision-types.ts                — DecisionArtifact, ContextStatus, DecisionContext, SourceArtifact
  src/adaptation/decision-confidence.ts           — computeDecisionConfidence() shared module
  src/adaptation/decision-context-builder.ts       — DecisionContextBuilder class
  src/cli/commands/decision.ts                    — `alix decision context` CLI
  tests/adaptation/decision-confidence.vitest.ts
  tests/adaptation/decision-context-builder.vitest.ts
  tests/adaptation/decision-governance-sentinels.vitest.ts

Modify:
  src/adaptation/intelligence-store.ts             — add findSimilarProposals()
  src/cli.ts                                       — register `alix decision` command
```

**Path convention note:** The CLI uses the same `join(".alix", ...)` constant pattern as `src/cli/commands/adaptation.ts` (see PROPOSALS_DIR, EVIDENCE_DIR, EFFECTIVENESS_DIR, INTELLIGENCE_DIR). No separate path resolver is needed — this is the established convention.

---

### Task 1: DecisionContext types

**Files:**
- Create: `src/adaptation/decision-types.ts`

**Interfaces:**
- Produces: `DecisionArtifact`, `ContextStatus`, `SourceArtifact`, `DecisionContext`, `DataFreshness`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * P6.0a — DecisionContext types for the Decision Influence Layer.
 *
 * DecisionContext is a read-only snapshot of everything ALiX knows about
 * a single proposal at a point in time. It is context, not judgment —
 * no risk scores, no recommendations.
 *
 * All P6 layers build on the base DecisionArtifact pattern:
 *   outcome + confidence + reasons + evidence + warnings
 *
 * @module
 */

import type { LineageGraph } from "./lineage-types.js";

// ---------------------------------------------------------------------------
// Base artifact pattern
// ---------------------------------------------------------------------------

/**
 * Base shape for all P6 decision artifacts.
 * Specialized forms: DecisionContext, RiskScore, Recommendation, QueueItem, StrategicBrief.
 */
export interface DecisionArtifact {
  id: string;
  subject: string;
  outcome: string;
  confidence: number;
  reasons: string[];
  warnings?: string[];
  evidenceRefs?: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// ContextStatus
// ---------------------------------------------------------------------------

export type ContextStatus =
  | "complete_context"    // proposal found, lineage traced, evidence available
  | "partial_context"     // some data missing (e.g., no effectiveness history)
  | "stale_context"       // proposal has had no activity for >30 days
  | "insufficient_data";  // proposal not found or critical data missing

// ---------------------------------------------------------------------------
// SourceArtifact
// ---------------------------------------------------------------------------

export type SourceArtifactType =
  | "proposal"
  | "lineage"
  | "effectiveness"
  | "intelligence"
  | "priority";

export interface SourceArtifact {
  type: SourceArtifactType;
  id: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// DataFreshness
// ---------------------------------------------------------------------------

export interface DataFreshness {
  newestArtifactAgeDays: number;
  oldestArtifactAgeDays: number;
}

// ---------------------------------------------------------------------------
// DecisionContext
// ---------------------------------------------------------------------------

export interface SimilarProposal {
  proposalId: string;
  action: string;
  outcome: string;
  confidence: number;
}

export interface EffectivenessTrend {
  actionType: string;
  keepRate: number;
  revertRate: number;
  sampleSize: number;
}

export interface DecisionContext extends DecisionArtifact {
  contextStatus: ContextStatus;
  /** Evidence completeness — NOT recommendation confidence.
   *  Computed from: proposal found, lineage completeness, evidence refs,
   *  effectiveness history, similar proposals, warnings count. */
  // (confidence, reasons, warnings, evidenceRefs, generatedAt inherited from DecisionArtifact)

  // Proposal state
  proposalId: string;
  proposalStatus: string;
  proposalAction: string;
  createdAt: string;
  ageDays: number;

  // Lifecycle context (consumed from LineageBuilder)
  lineage?: LineageGraph;
  lineageCompleteness: "partial" | "complete" | "broken";

  // Intelligence context — similar proposals by action type
  similarProposals: SimilarProposal[];

  // Effectiveness history for this proposal's action type
  effectivenessTrend: EffectivenessTrend;

  // Provenance — what went into this context
  sourceArtifacts: SourceArtifact[];

  // Data freshness — age range of all consumed artifacts
  dataFreshness: DataFreshness;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adaptation/decision-types.ts
git commit -m "P6.0a: DecisionContext type definitions"
```

---

### Task 2a: IntelligenceStore.findSimilarProposals()

**Files:**
- Modify: `src/adaptation/intelligence-store.ts`

**Interfaces:**
- Consumes: `ProposalStore` (for looking up source proposals by ID)
- Produces: `IntelligenceStore.findSimilarProposals(actionType, excludeProposalId, proposalStore)`

- [ ] **Step 1: Add findSimilarProposals to IntelligenceStore**

Read the current `src/adaptation/intelligence-store.ts` — note its `ProposalEffectivenessReport` import (it already handles `EffectivenessStore` state).

Add the following method to the `IntelligenceStore` class:

```typescript
/**
 * Find proposals with the same action type by scanning effectiveness reports
 * and loading their source proposals to verify the action type matches.
 *
 * Improves layering by keeping decision-support queries in the intelligence
 * store rather than embedding store traversal logic in the DecisionContextBuilder.
 * Note: still performs one proposalStore.load() per candidate — suitable for
 * P6.0a scale (tens of effectiveness reports); optimize with indexing in later
 * P6 phases if needed.
 */
async findSimilarProposals(
  actionType: string,
  excludeProposalId: string,
  proposalStore: ProposalStore,
): Promise<Array<{ proposalId: string; outcome: string; confidence: number }>> {
  const files = await this.list();
  const similar: Array<{ proposalId: string; outcome: string; confidence: number }> = [];

  for (const filename of files.slice(0, 50)) {
    const report = await this.load(filename);
    if (!report) continue;
    if (report.proposalId === excludeProposalId) continue;

    // Load the source proposal to verify action type matches
    // (effectiveness reports don't store action type)
    const sourceProposal = await proposalStore.load(report.proposalId);
    if (sourceProposal && sourceProposal.action === actionType) {
      similar.push({
        proposalId: report.proposalId,
        outcome: report.recommendation,
        confidence: sourceProposal.sourceConfidence,
      });
    }
  }

  return similar;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adaptation/intelligence-store.ts
git commit -m "P6.0a: IntelligenceStore.findSimilarProposals() for decision support"
```

---

### Task 2b: Decision confidence module

**Files:**
- Create: `src/adaptation/decision-confidence.ts`

**Interfaces:**
- Consumes: nothing (pure constants + computation)
- Produces: `computeDecisionConfidence(contextStatus, lineageCompleteness, hasEvidenceFp, hasEffectiveness, similarCount, warningsCount, ageDays)` — reused by P6.1 RiskScore and P6.3 Recommendation later

- [ ] **Step 1: Create decision-confidence.ts**

```typescript
/**
 * P6.0a — Decision confidence computation.
 *
 * Confidence reflects evidence completeness, not recommendation certainty.
 * Extracted into its own module so P6.1 (RiskScore) and P6.3 (Recommendation)
 * can reuse the same computation without depending on DecisionContextBuilder.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

const CONFIDENCE_PROPOSAL_FOUND = 0.30;
const CONFIDENCE_LINEAGE_COMPLETE = 0.20;
const CONFIDENCE_LINEAGE_PARTIAL = 0.10;
const CONFIDENCE_LINEAGE_BROKEN = -0.10;
const CONFIDENCE_EVIDENCE_FP = 0.15;
const CONFIDENCE_EFFECTIVENESS = 0.15;
const CONFIDENCE_SIMILAR_PROPOSALS = 0.10;
const CONFIDENCE_PER_WARNING = -0.05;
const CONFIDENCE_STALE_PENALTY = -0.10;

/** Staleness threshold in days. */
export const STALE_THRESHOLD_DAYS = 30;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConfidenceInputs {
  lineageCompleteness: "partial" | "complete" | "broken";
  hasEvidenceFingerprints: boolean;
  hasEffectiveness: boolean;
  similarProposalsCount: number;
  warningsCount: number;
  ageDays: number;
}

export interface ConfidenceResult {
  confidence: number;
  reasons: string[];
}

/**
 * Compute evidence-completeness confidence from a DecisionContext snapshot.
 * Returns [0, 1] clamped and rounded to 2 decimal places.
 *
 * When contextStatus is "insufficient_data" the caller should force confidence
 * to 0 regardless of this computation — this function assumes a proposal exists.
 */
export function computeDecisionConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const reasons: string[] = [];
  let confidence = 0;

  confidence += CONFIDENCE_PROPOSAL_FOUND;

  if (inputs.lineageCompleteness === "complete") {
    confidence += CONFIDENCE_LINEAGE_COMPLETE;
    reasons.push("Full lineage trace available");
  } else if (inputs.lineageCompleteness === "partial") {
    confidence += CONFIDENCE_LINEAGE_PARTIAL;
    reasons.push("Partial lineage trace available");
  } else {
    confidence += CONFIDENCE_LINEAGE_BROKEN;
  }

  if (inputs.hasEvidenceFingerprints) {
    confidence += CONFIDENCE_EVIDENCE_FP;
  }

  if (inputs.hasEffectiveness) {
    confidence += CONFIDENCE_EFFECTIVENESS;
    reasons.push("Effectiveness report available");
  }

  if (inputs.similarProposalsCount > 0) {
    confidence += CONFIDENCE_SIMILAR_PROPOSALS;
    reasons.push(`${inputs.similarProposalsCount} similar proposals identified`);
  }

  confidence += inputs.warningsCount * CONFIDENCE_PER_WARNING;

  if (inputs.ageDays > STALE_THRESHOLD_DAYS) {
    confidence += CONFIDENCE_STALE_PENALTY;
  }

  confidence = Math.max(0, Math.min(1, confidence));
  confidence = Math.round(confidence * 100) / 100;

  if (reasons.length === 0) {
    reasons.push("Basic proposal context available");
  }

  return { confidence, reasons };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adaptation/decision-confidence.ts
git commit -m "P6.0a: extract decision confidence computation into shared module"
```

---

### Task 2c: DecisionContextBuilder

**Files:**
- Create: `src/adaptation/decision-context-builder.ts`

**Interfaces:**
- Consumes: `ProposalStore`, `EvidenceStore`, `LineageBuilder`, `EffectivenessStore`, `IntelligenceStore`, `computeDecisionConfidence()`
- Produces: `DecisionContextBuilder.build(proposalId) => Promise<DecisionContext>`

- [ ] **Step 1: Create DecisionContextBuilder**

```typescript
/**
 * P6.0a — DecisionContextBuilder.
 *
 * Builds a read-only DecisionContext for a given proposal by aggregating:
 * - ProposalStore (proposal state)
 * - LineageBuilder (lifecycle graph)
 * - EvidenceStore (evidence fingerprints)
 * - EffectivenessStore (effectiveness history)
 * - IntelligenceStore (intelligence trends and similar proposals)
 *
 * Read-only rule: this builder reads stores but never writes to them.
 * Enforced by governance sentinel test.
 *
 * @module
 */

import type { ProposalStore } from "./proposal-store.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import type { LineageBuilder } from "./lineage-builder.js";
import type { EffectivenessStore } from "./effectiveness-store.js";
import type { IntelligenceStore } from "./intelligence-store.js";
import type {
  DecisionContext,
  ContextStatus,
  SourceArtifact,
  EffectivenessTrend,
  DataFreshness,
} from "./decision-types.js";
import {
  computeDecisionConfidence,
  STALE_THRESHOLD_DAYS,
} from "./decision-confidence.js";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class DecisionContextBuilder {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly evidenceStore: EvidenceStore,
    private readonly lineageBuilder: LineageBuilder,
    private readonly effectivenessStore: EffectivenessStore,
    private readonly intelligenceStore: IntelligenceStore,
  ) {}

  async build(proposalId: string): Promise<DecisionContext> {
    const generatedAt = new Date().toISOString();
    const reasons: string[] = [];
    const warnings: string[] = [];
    const evidenceRefs: string[] = [];
    const sourceArtifacts: SourceArtifact[] = [];

    // 1. Load the proposal
    const proposal = await this.proposalStore.load(proposalId);
    if (!proposal) {
      return {
        id: `decision-ctx-${proposalId}`,
        subject: `Context for proposal ${proposalId}`,
        contextStatus: "insufficient_data",
        confidence: 0,
        reasons: ["Proposal not found"],
        warnings: [`Proposal ${proposalId} not found in ProposalStore`],
        evidenceRefs: [],
        generatedAt,
        proposalId,
        proposalStatus: "unknown",
        proposalAction: "unknown",
        createdAt: "",
        ageDays: 0,
        lineage: undefined,
        lineageCompleteness: "broken",
        similarProposals: [],
        effectivenessTrend: { actionType: "", keepRate: 0, revertRate: 0, sampleSize: 0 },
        sourceArtifacts: [],
        dataFreshness: { newestArtifactAgeDays: 0, oldestArtifactAgeDays: 0 },
      };
    }

    sourceArtifacts.push({
      type: "proposal",
      id: proposal.id,
      timestamp: proposal.createdAt,
    });
    evidenceRefs.push(...proposal.evidenceFingerprints);

    const createdAt = new Date(proposal.createdAt);
    const ageDays = Math.floor(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    // 2. Build lineage graph
    const lineage = await this.lineageBuilder.build(proposalId);
    sourceArtifacts.push({
      type: "lineage",
      id: proposalId,
      timestamp: lineage.generatedAt,
    });

    // Propagate lineage warnings
    if (lineage.warnings.length > 0) {
      for (const w of lineage.warnings) {
        warnings.push(`[lineage] ${w.message}`);
      }
    }

    // 3. Compute context status
    let contextStatus: ContextStatus;
    if (ageDays > STALE_THRESHOLD_DAYS) {
      contextStatus = "stale_context";
      warnings.push(`Proposal has had no activity for ${ageDays} days (threshold: ${STALE_THRESHOLD_DAYS})`);
    } else if (lineage.completeness === "complete") {
      contextStatus = "complete_context";
    } else {
      contextStatus = "partial_context";
    }

    // 4. Load effectiveness history
    const effReport = await this.effectivenessStore.load(proposalId);
    let effectivenessTrend: EffectivenessTrend = {
      actionType: proposal.action,
      keepRate: 0,
      revertRate: 0,
      sampleSize: 0,
    };
    if (effReport) {
      sourceArtifacts.push({
        type: "effectiveness",
        id: proposalId,
        timestamp: effReport.assessedAt,
      });
      effectivenessTrend = {
        actionType: proposal.action,
        keepRate: effReport.recommendation === "keep" ? 1 : 0,
        revertRate: effReport.recommendation === "revert" ? 1 : 0,
        sampleSize: 1,
      };
    }

    // 5. Load similar proposals via IntelligenceStore
    const similarResults = await this.intelligenceStore.findSimilarProposals(
      proposal.action,
      proposalId,
      this.proposalStore,
    );

    // 6. Scan intelligence reports for source artifacts
    const intelligenceFiles = await this.intelligenceStore.list();
    for (const filename of intelligenceFiles.slice(0, 5)) {
      const report = await this.intelligenceStore.load(filename);
      if (!report) continue;
      sourceArtifacts.push({
        type: "intelligence",
        id: filename,
        timestamp: report.generatedAt,
      });
    }

    // 7. Compute confidence via shared module
    const confidenceResult = computeDecisionConfidence({
      lineageCompleteness: lineage.completeness,
      hasEvidenceFingerprints: proposal.evidenceFingerprints.length > 0,
      hasEffectiveness: !!effReport,
      similarProposalsCount: similarResults.length,
      warningsCount: warnings.length,
      ageDays,
    });

    // 8. Combine reasons
    reasons.push(...confidenceResult.reasons);
    if (effReport) {
      reasons.push(`Effectiveness: ${effReport.recommendation}`);
    }

    // 7. Clamp and round confidence
    confidence = Math.max(0, Math.min(1, confidence));
    confidence = Math.round(confidence * 100) / 100;
    if (contextStatus === "insufficient_data") {
      confidence = 0;
    }

    // 8. Build data freshness
    const sourceTimestamps = sourceArtifacts
      .map((s) => s.timestamp)
      .filter((t): t is string => !!t)
      .map((t) => new Date(t).getTime())
      .filter((t) => !isNaN(t));

    const dataFreshness: DataFreshness = {
      newestArtifactAgeDays:
        sourceTimestamps.length > 0
          ? Math.floor((Date.now() - Math.max(...sourceTimestamps)) / (1000 * 60 * 60 * 24))
          : 0,
      oldestArtifactAgeDays:
        sourceTimestamps.length > 0
          ? Math.floor((Date.now() - Math.min(...sourceTimestamps)) / (1000 * 60 * 60 * 24))
          : 0,
    };

    // 9. Build return value
    return {
      // DecisionArtifact fields (outcome is set to contextStatus for artifact
      // compatibility — P6's base artifact shape requires an outcome field,
      // and contextStatus is the most semantically accurate value at this layer)
      id: `decision-ctx-${proposalId}`,
      subject: `Context for ${proposal.action}: ${proposal.reason}`,
      outcome: contextStatus,
      confidence: confidenceResult.confidence,
      reasons,
      warnings: warnings.length > 0 ? warnings : undefined,
      evidenceRefs,
      generatedAt,

      // DecisionContext-specific fields
      contextStatus,
      proposalId: proposal.id,
      proposalStatus: proposal.status,
      proposalAction: proposal.action,
      createdAt: proposal.createdAt,
      ageDays,
      lineage,
      lineageCompleteness: lineage.completeness,
      similarProposals: similarResults.map((r) => ({
        proposalId: r.proposalId,
        action: proposal.action,
        outcome: r.outcome,
        confidence: r.confidence,
      })),
      effectivenessTrend,
      sourceArtifacts,
      dataFreshness,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/adaptation/decision-context-builder.ts
git commit -m "P6.0a: DecisionContextBuilder implementation"
```

---

### Task 3a: Decision confidence tests

**Files:**
- Create: `tests/adaptation/decision-confidence.vitest.ts`

- [ ] **Step 1: Create confidence computation tests**

```typescript
import { describe, it, expect } from "vitest";
import { computeDecisionConfidence } from "../../src/adaptation/decision-confidence";

describe("computeDecisionConfidence", () => {
  it("returns high confidence for complete data", () => {
    const result = computeDecisionConfidence({
      lineageCompleteness: "complete",
      hasEvidenceFingerprints: true,
      hasEffectiveness: true,
      similarProposalsCount: 5,
      warningsCount: 0,
      ageDays: 2,
    });
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("returns lower confidence for partial data", () => {
    const result = computeDecisionConfidence({
      lineageCompleteness: "partial",
      hasEvidenceFingerprints: false,
      hasEffectiveness: false,
      similarProposalsCount: 0,
      warningsCount: 0,
      ageDays: 2,
    });
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("applies stale penalty for old proposals", () => {
    const fresh = computeDecisionConfidence({
      lineageCompleteness: "complete",
      hasEvidenceFingerprints: true,
      hasEffectiveness: true,
      similarProposalsCount: 3,
      warningsCount: 0,
      ageDays: 5,
    });
    const stale = computeDecisionConfidence({
      lineageCompleteness: "complete",
      hasEvidenceFingerprints: true,
      hasEffectiveness: true,
      similarProposalsCount: 3,
      warningsCount: 0,
      ageDays: 31,
    });
    expect(fresh.confidence).toBeGreaterThan(stale.confidence);
  });

  it("clamps confidence to [0, 1]", () => {
    const result = computeDecisionConfidence({
      lineageCompleteness: "broken",
      hasEvidenceFingerprints: false,
      hasEffectiveness: false,
      similarProposalsCount: 0,
      warningsCount: 10,
      ageDays: 5,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/adaptation/decision-confidence.vitest.ts --config vitest.config.mts`
Expected: 4 tests passing

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/decision-confidence.vitest.ts
git commit -m "P6.0a: decision confidence computation tests"
```

---

### Task 3b: DecisionContextBuilder tests

**Files:**
- Create: `tests/adaptation/decision-context-builder.vitest.ts`

**Interfaces:**
- Consumes: `DecisionContextBuilder` from Task 2c, mock stores
- Produces: 9+ tests covering all DecisionContext scenarios

- [ ] **Step 1: Create tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { DecisionContextBuilder } from "../../src/adaptation/decision-context-builder";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types";

// ---------------------------------------------------------------------------
// Mock helpers (same pattern as lineage-builder tests)
// ---------------------------------------------------------------------------

function mockProposalStore(proposals: Record<string, AdaptationProposal>) {
  return {
    load: vi.fn(async (id: string) => proposals[id] ?? null),
    list: vi.fn(async () => Object.values(proposals)),
  } as any;
}

function mockEvidenceStore() {
  return {
    getByFingerprint: vi.fn(async () => null),
    query: vi.fn(async () => ({ records: [], total: 0, truncated: false })),
  } as any;
}

function mockLineageBuilder(graph: any) {
  return {
    build: vi.fn(async () => graph),
  } as any;
}

function mockEffectivenessStore(report: any | null) {
  return {
    load: vi.fn(async () => report),
  } as any;
}

function mockIntelligenceStore(reports: any[]) {
  return {
    list: vi.fn(async () => reports.map((r) => `${r.generatedAt}.json`)),
    load: vi.fn(async (filename: string) =>
      reports.find((r) => filename.startsWith(r.generatedAt)) ?? null,
    ),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DecisionContextBuilder", () => {
  const now = new Date().toISOString();

  it("builds a minimal context for a pending proposal", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-test-001",
      createdAt: now,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Test proposal",
    };

    const lineageGraph = {
      rootId: "prop-test-001",
      generatedAt: now,
      completeness: "partial" as const,
      nodes: [{ id: "prop-test-001", type: "proposal" as const, label: "test", timestamp: now }],
      edges: [],
      warnings: [],
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-test-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-test-001");
    expect(ctx.proposalId).toBe("prop-test-001");
    expect(ctx.contextStatus).toBe("partial_context");
    expect(ctx.confidence).toBeGreaterThan(0);
    expect(ctx.lineageCompleteness).toBe("partial");
    expect(ctx.sourceArtifacts.length).toBeGreaterThanOrEqual(1);
    expect(ctx.dataFreshness).toBeDefined();
    expect(typeof ctx.dataFreshness.newestArtifactAgeDays).toBe("number");
  });

  it("returns insufficient_data for missing proposals", async () => {
    const builder = new DecisionContextBuilder(
      mockProposalStore({}),
      mockEvidenceStore(),
      mockLineageBuilder({ rootId: "", generatedAt: now, completeness: "broken", nodes: [], edges: [], warnings: [] }),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-nonexistent");
    expect(ctx.contextStatus).toBe("insufficient_data");
    expect(ctx.confidence).toBe(0);
    expect(ctx.warnings).toBeDefined();
  });

  it("returns complete_context for applied proposals with full lineage", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-applied-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: ["fp-1"],
      reason: "Test applied",
    };

    const lineageGraph = {
      rootId: "prop-applied-001",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [
        { id: "prop-applied-001", type: "proposal" as const, label: "test", timestamp: now },
        { id: "approval:evt-1", type: "approval" as const, label: "approved", timestamp: now },
      ],
      edges: [{ sourceId: "prop-applied-001", targetId: "approval:evt-1", relation: "approved_as" as const }],
      warnings: [],
    };

    const effReport = {
      proposalId: "prop-applied-001",
      recommendation: "keep",
      assessedAt: now,
      dataSufficient: true,
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-applied-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(effReport),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-applied-001");
    expect(ctx.contextStatus).toBe("complete_context");
    expect(ctx.lineageCompleteness).toBe("complete");
    expect(ctx.effectivenessTrend.sampleSize).toBe(1);
    expect(ctx.sourceArtifacts.some((s) => s.type === "effectiveness")).toBe(true);
  });

  it("detects stale proposals", async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
    const proposal: AdaptationProposal = {
      id: "prop-stale-001",
      createdAt: oldDate,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "stale" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.5,
      evidenceFingerprints: [],
      reason: "Stale proposal",
    };

    const lineageGraph = {
      rootId: "prop-stale-001",
      generatedAt: oldDate,
      completeness: "partial" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-stale-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-stale-001");
    expect(ctx.contextStatus).toBe("stale_context");
    expect(ctx.ageDays).toBeGreaterThan(30);
    expect(ctx.warnings).toBeDefined();
    expect(ctx.warnings!.some((w) => w.includes("stale") || w.includes("activity"))).toBe(true);
  });

  it("includes similar proposals from intelligence store", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-sim-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Test with similar",
    };

    const lineageGraph = {
      rootId: "prop-sim-001",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    // Mock IntelligenceStore with findSimilarProposals
    const intelStore = mockIntelligenceStore([]);
    intelStore.findSimilarProposals = vi.fn(async () => [
      { proposalId: "prop-old-001", outcome: "keep", confidence: 0.85 },
      { proposalId: "prop-old-002", outcome: "revert", confidence: 0.6 },
    ]);

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-sim-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      intelStore,
    );

    const ctx = await builder.build("prop-sim-001");
    expect(ctx.similarProposals.length).toBeGreaterThan(0);
    expect(ctx.similarProposals[0].action).toBe("update_agent_card");
  });

  it("includes source artifacts for all consumed data", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-src-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: ["fp-1"],
      reason: "Source artifact test",
    };

    const lineageGraph = {
      rootId: "prop-src-001",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    const intelStore = mockIntelligenceStore([]);
    intelStore.findSimilarProposals = vi.fn(async () => []);

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-src-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore({ proposalId: "prop-src-001", recommendation: "keep", assessedAt: now, dataSufficient: true }),
      intelStore,
    );

    const ctx = await builder.build("prop-src-001");
    // Should have: proposal + lineage + effectiveness artifacts
    const types = ctx.sourceArtifacts.map((s) => s.type);
    expect(types).toContain("proposal");
    expect(types).toContain("lineage");
    expect(types).toContain("effectiveness");
    expect(types.length).toBeGreaterThanOrEqual(3);
  });

  it("confidence reflects evidence completeness", async () => {
    // Proposal with full data should have higher confidence than one without
    const lineageComplete = {
      rootId: "prop-a",
      generatedAt: now,
      completeness: "complete" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };
    const lineagePartial = {
      rootId: "prop-b",
      generatedAt: now,
      completeness: "partial" as const,
      nodes: [],
      edges: [],
      warnings: [],
    };

    const proposalA: AdaptationProposal = {
      id: "prop-a",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.9,
      evidenceFingerprints: ["fp-1", "fp-2"],
      reason: "Full data",
    };
    const proposalB: AdaptationProposal = {
      id: "prop-b",
      createdAt: now,
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "minimal" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.5,
      evidenceFingerprints: [],
      reason: "Minimal data",
    };

    const builderA = new DecisionContextBuilder(
      mockProposalStore({ "prop-a": proposalA }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageComplete),
      mockEffectivenessStore({ proposalId: "prop-a", recommendation: "keep", assessedAt: now, dataSufficient: true }),
      mockIntelligenceStore([{ generatedAt: now, trends: [] }]),
    );
    const builderB = new DecisionContextBuilder(
      mockProposalStore({ "prop-b": proposalB }),
      mockEvidenceStore(),
      mockLineageBuilder(lineagePartial),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctxA = await builderA.build("prop-a");
    const ctxB = await builderB.build("prop-b");
    expect(ctxA.confidence).toBeGreaterThan(ctxB.confidence);
  });

  it("populates lineage warnings into context warnings", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-warn-001",
      createdAt: now,
      status: "applied",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "test" },
      payload: {},
      sourceRecommendationType: "reflection",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "Warning test",
    };

    const lineageGraph = {
      rootId: "prop-warn-001",
      generatedAt: now,
      completeness: "broken" as const,
      nodes: [],
      edges: [],
      warnings: [
        { type: "missing_evidence_fingerprint" as const, message: "Evidence fingerprint fp-abc not found", sourceId: "prop-warn-001" },
      ],
    };

    const builder = new DecisionContextBuilder(
      mockProposalStore({ "prop-warn-001": proposal }),
      mockEvidenceStore(),
      mockLineageBuilder(lineageGraph),
      mockEffectivenessStore(null),
      mockIntelligenceStore([]),
    );

    const ctx = await builder.build("prop-warn-001");
    expect(ctx.warnings).toBeDefined();
    expect(ctx.warnings!.length).toBeGreaterThan(0);
    expect(ctx.warnings!.some((w) => w.includes("fingerprint"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/adaptation/decision-context-builder.vitest.ts --config vitest.config.mts`
Expected: 8 tests passing

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/decision-context-builder.vitest.ts
git commit -m "P6.0a: DecisionContextBuilder tests"
```

---

### Task 4: Governance sentinels

**Files:**
- Create: `tests/adaptation/decision-governance-sentinels.vitest.ts`

- [ ] **Step 1: Create governance sentinel tests**

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Read a file's source text for structural/grep-based checks. */
function sourceOf(modulePath: string): string {
  const resolved = require.resolve(modulePath);
  return fs.readFileSync(resolved, "utf-8");
}

describe("P6 Governance Invariants — Recommend ≠ Decide", () => {
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

  it("DecisionContextBuilder must not import governance/mutation modules", () => {
    const source = sourceOf(
      "../../src/adaptation/decision-context-builder",
    );
    for (const mod of FORBIDDEN_IMPORTS) {
      expect(source).not.toContain(mod);
    }
  });

  it("DecisionContextBuilder must not reference governance types", () => {
    const source = sourceOf(
      "../../src/adaptation/decision-context-builder",
    );
    for (const type of FORBIDDEN_TYPES) {
      expect(source).not.toContain(type);
    }
  });

  it("DecisionContextBuilder must not contain save/update/approve/apply or proposal-generation calls", () => {
    const source = sourceOf(
      "../../src/adaptation/decision-context-builder",
    );
    const forbiddenMethods = [
      ".save(",
      ".update(",
      ".approve(",
      ".apply(",
      ".reject(",
      ".generateProposal(",
      "createProposal(",
      "generateFromReflection(",
      "generateFromEffectiveness(",
      "generateFromCapabilityEvolution(",
    ];
    for (const method of forbiddenMethods) {
      expect(source).not.toContain(method);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/adaptation/decision-governance-sentinels.vitest.ts --config vitest.config.mts`
Expected: 3 tests passing

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/decision-governance-sentinels.vitest.ts
git commit -m "P6.0a: governance sentinels — Recommend≠Decide invariant"
```

---

### Task 5: CLI decision command

**Files:**
- Create: `src/cli/commands/decision.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `DecisionContextBuilder` from Task 2
- Produces: `alix decision context <id> [--json]` CLI command

- [ ] **Step 1: Create the CLI command handler**

```typescript
/**
 * P6.0a — decision CLI command.
 *
 * Provides:
 * - `alix decision context <proposal-id>` — render DecisionContext as formatted terminal output
 * - `alix decision context <proposal-id> --json` — output DecisionContext as JSON
 *
 * Subcommands beyond `context` (risk, recommend, queue, brief) are added
 * in later P6 slices.
 *
 * @module
 */

import { join } from "node:path";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { EvidenceStore } from "../../security/evidence/evidence-store.js";
import { LineageBuilder } from "../../adaptation/lineage-builder.js";
import { EffectivenessStore } from "../../adaptation/effectiveness-store.js";
import { IntelligenceStore } from "../../adaptation/intelligence-store.js";
import { DecisionContextBuilder } from "../../adaptation/decision-context-builder.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions
// ---------------------------------------------------------------------------

const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");
const EVIDENCE_DIR = join(".alix", "security");
const EFFECTIVENESS_DIR = join(".alix", "adaptation", "effectiveness");
const INTELLIGENCE_DIR = join(".alix", "adaptation", "intelligence");

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function handleDecisionCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const rest = args.slice(1);

  switch (subcommand) {
    case "context":
      await runContext(rest);
      return;
    default:
      console.error(`Unknown decision subcommand: "${subcommand}"`);
      console.error("Usage: alix decision context <proposal-id> [--json]");
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runContext
// ---------------------------------------------------------------------------

async function runContext(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision context <proposal-id> [--json]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const cwd = process.cwd();

  const proposalStore = new ProposalStore(join(cwd, PROPOSALS_DIR));
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) });
  const lineageBuilder = new LineageBuilder(
    proposalStore,
    evidenceStore,
    new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR)),
    new IntelligenceStore(join(cwd, INTELLIGENCE_DIR)),
  );
  const builder = new DecisionContextBuilder(
    proposalStore,
    evidenceStore,
    lineageBuilder,
    new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR)),
    new IntelligenceStore(join(cwd, INTELLIGENCE_DIR)),
  );

  const ctx = await builder.build(id);

  if (jsonMode) {
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  // Terminal renderer
  const statusIcon =
    ctx.contextStatus === "complete_context" ? "✅" :
    ctx.contextStatus === "partial_context" ? "⚠️" :
    ctx.contextStatus === "stale_context" ? "🕰️" :
    "❌";

  console.log(`Decision Context: ${ctx.proposalId}`);
  console.log(`──────────────────────────────────────`);
  console.log(`${statusIcon} Status: ${ctx.contextStatus}`);
  console.log(`   Confidence: ${(ctx.confidence * 100).toFixed(0)}% (evidence completeness)`);
  console.log(``);
  console.log(`Proposal: ${ctx.proposalAction} (${ctx.proposalStatus})`);
  console.log(`Created: ${new Date(ctx.createdAt).toLocaleDateString()} (${ctx.ageDays} day(s) ago)`);
  console.log(``);
  console.log(`Lineage: ${ctx.lineageCompleteness}${ctx.lineage ? ` — ${ctx.lineage.nodes.length} lifecycle stages traced` : ""}`);
  console.log(``);
  console.log(`Effectiveness trend (${ctx.effectivenessTrend.actionType || "n/a"}):`);
  console.log(`   Keep rate: ${(ctx.effectivenessTrend.keepRate * 100).toFixed(0)}%  (n=${ctx.effectivenessTrend.sampleSize})`);
  console.log(`   Revert rate: ${(ctx.effectivenessTrend.revertRate * 100).toFixed(0)}%`);
  if (ctx.similarProposals.length > 0) {
    console.log(``);
    console.log(`Similar proposals: ${ctx.similarProposals.length}`);
    for (const sp of ctx.similarProposals) {
      console.log(`   · ${sp.proposalId} — ${sp.outcome} (${(sp.confidence * 100).toFixed(0)}%)`);
    }
  }
  console.log(``);
  console.log(`Sources:`);
  for (const src of ctx.sourceArtifacts) {
    const icon =
      src.type === "proposal" ? "📄" :
      src.type === "lineage" ? "🔗" :
      src.type === "effectiveness" ? "📊" :
      src.type === "intelligence" ? "🧠" :
      "📌";
    console.log(`   ${icon} ${src.type}: ${src.id}`);
  }
  console.log(``);
  console.log(`Data freshness: ${ctx.dataFreshness.newestArtifactAgeDays} day(s) (newest) / ${ctx.dataFreshness.oldestArtifactAgeDays} day(s) (oldest)`);

  if (ctx.warnings && ctx.warnings.length > 0) {
    console.log(``);
    console.log(`⚠️ Warnings (${ctx.warnings.length}):`);
    for (const w of ctx.warnings) {
      console.log(`   · ${w}`);
    }
  }

  if (ctx.reasons.length > 0) {
    console.log(``);
    console.log(`Why this confidence:`);
    for (const r of ctx.reasons) {
      console.log(`   · ${r}`);
    }
  }
}
```

- [ ] **Step 2: Register the command in `src/cli.ts`**

Find the adaptation command registration block (around line 2497-2502) and add a similar block after it:

```typescript
// ── Decision command (P6.0a) ──────────────────────────────────────
if (command === "decision") {
  const { handleDecisionCommand } = await import("./cli/commands/decision.js");
  await handleDecisionCommand(args);
  process.exit(0);
}
```

Also add a help text entry in the usage section (around line 182):
```typescript
  alix decision context <id>   Show DecisionContext for a proposal (P6.0a)
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/adaptation/ --config vitest.config.mts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/decision.ts src/cli.ts
git commit -m "P6.0a: CLI decision context command"
```

---

## Milestone Tag

After all tasks are complete:

```bash
git tag alix-p6.0a-complete
git push origin alix-p6.0a-complete
```
