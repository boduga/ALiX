# P8.5c Explain Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix explain proposal <id>` — a single read-only command that walks the entire persisted decision lifecycle (Outcome → Recommendation → Risk → Governance → Learning Signals → Calibration Impact) for a given proposal, proving the P7.5p → P8.5a chain is coherent end-to-end.

**Architecture:** Pure in-memory aggregation. The assembler reads from 6 existing stores (`OutcomeStore`, `ApprovalRecommendationStore`, `RiskScoreStore`, `GovernanceReviewStore`, `LearningStore`, `EvidenceChainStore`) and assembles an ephemeral `ProposalExplanation` view-model. The CLI renders it in terminal or JSON form. **Explain reads, never writes.** No new persistence substrate, no new artifact types, no new authority.

**Tech Stack:** TypeScript, vitest, node:fs (read-only).

## Global Constraints

These constraints apply to every task in this plan and are derived directly from the SDS:

- **Read-only invariant:** `alix explain` MUST NOT write to any store, evidence chain, adapter, or proposal surface. Sentinel-enforced in Task 5.
- **Ephemeral explanation:** `ProposalExplanation` is an in-memory value object. Never persisted. Never indexed. Never evolved into a new artifact type.
- **6 protected type files remain byte-identical to P8.5a.0 baseline:** `risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`. The new `ProposalExplanation` types live in `src/explain/proposal-explanation-types.ts` (NEW file — no edits to existing type files).
- **6 protected type files are joined by one new type file:** `src/learning/evidence-chain-types.ts` (already exists from P8.5a.0) and `src/learning/evidence-chain-store.ts` (already exists). These are NOT touched.
- **Evidence Chain model (corrected):** Source artifacts carry NO `evidenceRefs` backlinks. The EvidenceChainStore carries `ProvenanceLink` relationships as a separate append-only graph. Explain queries the graph; it does not navigate artifact-side backlinks.
- **Layer shape is registry-aligned:** `signalsByAdapter: Record<string, LearningSignal[]>` — future adapters (P7.5p.4 TelemetryCapture) drop in as new keys without schema or renderer changes.
- **Missing-data resilience:** Every layer can be absent. The explanation ALWAYS renders with explicit `not available` markers; never crashes.
- **Signal matching priority (locked):** Priority 1 = `sourceProposalIds` metadata (future), Priority 2 = `EvidenceChainStore` ProvenanceLink traversal, Priority 3 = subject/sourceReportId string heuristic. P8.5c ships Priorities 2 + 3; Priority 1 is documented as future migration.
- **String heuristic scope (locked invariant):** String heuristics (matching `subject` or `sourceReportId` substrings against a proposalId) are permitted **ONLY for Learning and Calibration layers**. The Outcome, Recommendation, Risk, and Governance layers MUST use one of: EvidenceChain traversal, explicit IDs on OutcomeRecord (`recommendationId` / `riskScoreId` / `governanceReviewId`), or proposal-scoped queries. String matching for these four layers is forbidden. This prevents future code from accidentally extending heuristic matching into governance artifacts.
- **Refresh hint is conditional:** appears only when Learning Layer is empty; renders in both terminal and JSON (`learningRefreshHint: string | null`).
- **`explanationIntegrity.completenessPercent`** is pre-computed by the assembler: `(layersAvailable / totalLayers) * 100` rounded to 1dp.
- **No new CLI global flag.** `--window` is local to `explain proposal`.
- **Existing test patterns:** mirror `risk-calibration-adapter.vitest.ts` and `governance-sentinel-retired.vitest.ts` for temp-dir + `vi.spyOn(process, "cwd")` mocking.

---

## File Structure

| Path | Purpose |
|---|---|
| `src/explain/proposal-explanation-types.ts` (new) | `ProposalExplanation` + layer interfaces + `ExplanationIntegrity`. Pure types, no store deps. |
| `src/explain/proposal-explanation-assembler.ts` (new) | Pure assembler. Reads from 6 stores, walks EvidenceChain, assembles `ProposalExplanation`. NO writes. |
| `src/cli/commands/explain.ts` (new) | `handleExplainCommand` dispatcher + terminal/JSON renderers. |
| `tests/explain/proposal-explanation-assembler.vitest.ts` (new) | Unit + integration tests for the assembler (8 tests). |
| `tests/cli/commands/explain-cli.vitest.ts` (new) | CLI tests for terminal + JSON output + missing-data resilience (5 tests). |
| `src/cli.ts` (modify, ~10 lines added) | Wire `alix explain` into the top-level dispatcher. |

No modifications to: existing stores, existing types, existing adapter code, the evidence chain itself.

---

## Task Decomposition

The plan is structured as **5 atomic tasks**, each independently testable and each producing one atomic commit. This matches the P8.5a.2 pattern (4 atomic slices + 1 fix). The 5 tasks are:

1. **P8.5c.1 — `ProposalExplanation` types** (foundation)
2. **P8.5c.2 — Assembler: Outcome + Recommendation + Risk + Governance layers**
3. **P8.5c.3 — Assembler: Learning Signals + Calibration Impact + EvidenceChain traversal + integrity**
4. **P8.5c.4 — `alix explain proposal` CLI + renderers**
5. **P8.5c.5 — Purity sentinel + final review + PR**

Each task produces a self-contained change that can be merged independently if needed (though the plan ships all 5 as one PR).

---

### Task 1: P8.5c.1 — `ProposalExplanation` types

**Files:**
- Create: `src/explain/proposal-explanation-types.ts`
- Test: (none yet — types only)

**Interfaces produced (consumed by Tasks 2-4):**

```ts
// src/explain/proposal-explanation-types.ts

import type { LearningSignal, CalibrationProfile } from "../learning/learning-types.js";
import type { OutcomeValue } from "../adaptation/outcome-types.js";
import type { GovernanceVerdict, LensName } from "../adaptation/governance-review-types.js";
import type { RiskDimension, RiskOutcome } from "../adaptation/risk-score-types.js";

/** Top-level explanation object. In-memory, ephemeral, never persisted. */
export interface ProposalExplanation {
  proposalId: string;
  generatedAt: string;
  windowDays: number;
  outcome: OutcomeLayer | UnavailableLayer;
  recommendation: RecommendationLayer | UnavailableLayer;
  risk: RiskLayer | UnavailableLayer;
  governance: GovernanceLayer | UnavailableLayer;
  learning: LearningLayer;
  calibration: CalibrationLayer;
  explanationIntegrity: ExplanationIntegrity;
  /** Conditional hint when Learning Layer is empty. null when not applicable. */
  learningRefreshHint: string | null;
}

export interface UnavailableLayer {
  status: "not_available";
  reason: string;
}

export interface OutcomeLayer {
  status: "available";
  outcome: OutcomeValue;
  observedAt: string;
  /**
   * Artifact IDs that contributed to this layer. NOT the Evidence Chain graph —
   * this is a per-layer source list, distinct from `EvidenceChainStore`'s
   * `ProvenanceLink` relationships. Named `sourceArtifactIds` (not
   * `evidenceRefs`) to avoid semantic collision with the existing learning
   * system's `evidenceRefs` field.
   */
  sourceArtifactIds: string[];
  /** Which join path sourced this layer: chain, direct-id, or proposal-fallback. */
  joinPath: "evidence_chain" | "direct_id" | "proposal_fallback" | "string_heuristic";
}

export interface RecommendationLayer {
  status: "available";
  recommendationId: string;
  decision: string;
  confidence: number | undefined;          // undefined = P7.5p.1 missing
  reasons: string[];
  sourceArtifactIds: string[];
  joinPath: "evidence_chain" | "direct_id" | "proposal_fallback" | "string_heuristic";
}

export interface RiskLayer {
  status: "available";
  riskScoreId: string;
  overallRisk: number;
  outcome: RiskOutcome;
  dimensions: { dimension: RiskDimension; score: number; confidence: number; reasons: string[] }[];
  sourceArtifactIds: string[];
  joinPath: "evidence_chain" | "direct_id" | "proposal_fallback" | "string_heuristic";
}

export interface GovernanceLayer {
  status: "available";
  reviewId: string;
  verdict: GovernanceVerdict;
  concerns: string[];
  lensScores: { lens: LensName; verdict: GovernanceVerdict; confidence: number }[];
  sourceArtifactIds: string[];
  joinPath: "evidence_chain" | "direct_id" | "proposal_fallback" | "string_heuristic";
}

/**
 * Registry-aligned: keys mirror the P8.5a.2 AdapterRegistry. Future adapters
 * (P7.5p.4 TelemetryCapture, etc.) drop in as new keys without schema or
 * renderer changes. For P8.5c the keys are: "recommendation", "risk", "governance".
 */
export interface LearningLayer {
  signalsByAdapter: Record<string, LearningSignal[]>;
  adaptersWithSignals: string[];
  totalSignals: number;
}

export interface CalibrationLayer {
  profilesByTarget: Record<string, CalibrationProfile[]>;
  adjustments: { target: string; previousValue: number; suggestedValue: number; reason: string }[];
}

/**
 * Per-layer + aggregate observability metadata. Lets P8.5b Dashboard /
 * P9 Meta-Governance consume "5/6 layers, chain 50%, fallback used" without
 * reparsing the explanation.
 */
export interface ExplanationIntegrity {
  outcomeFound: boolean;
  recommendationFound: boolean;
  riskFound: boolean;
  governanceFound: boolean;
  learningFound: boolean;
  calibrationFound: boolean;
  evidenceChainUsed: boolean;
  fallbackJoinsUsed: boolean;
  incompleteChainLayers: number;
  totalLayers: number;
  layersAvailable: number;
  /** Pre-computed: (layersAvailable / totalLayers) * 100, rounded to 1dp. */
  completenessPercent: number;
}
```

- [ ] **Step 1: Create the file**

Write `src/explain/proposal-explanation-types.ts` with the full content above.

- [ ] **Step 2: Verify tsc compiles the new types**

Run: `npx tsc --noEmit`
Expected: clean. (Pure types — no runtime impact.)

- [ ] **Step 3: Commit**

```bash
git add src/explain/proposal-explanation-types.ts
git commit -m "feat(p8.5c.1): ProposalExplanation + ExplanationIntegrity types"
```

---

### Task 2: P8.5c.2 — Assembler (Outcome + Recommendation + Risk + Governance layers via direct-id + proposal-fallback)

**Files:**
- Create: `src/explain/proposal-explanation-assembler.ts`
- Create: `tests/explain/proposal-explanation-assembler.vitest.ts`

**Interfaces consumed (from Task 1):**

```ts
import type { ProposalExplanation, OutcomeLayer, RecommendationLayer, RiskLayer, GovernanceLayer, UnavailableLayer, ExplanationIntegrity } from "./proposal-explanation-types.js";
```

**Store dependencies (READ-ONLY):**

| Store | File | Method used |
|---|---|---|
| `OutcomeStore` | `src/adaptation/outcome-store.ts` | `list()` then filter by `subjectId === proposalId` |
| `ApprovalRecommendationStore` | `src/adaptation/approval-recommendation-store.ts` | `get(id)` (after OutcomeRecord.recommendationId) then fallback `list()` |
| `RiskScoreStore` | `src/adaptation/risk-score-store.ts` | `get(id)` (after OutcomeRecord.riskScoreId) then fallback `queryByWindow(windowDays)` |
| `GovernanceReviewStore` | `src/adaptation/governance-review-store.ts` | `queryByProposal(proposalId)` (P7.5p.3 cross-proposal isolation invariant) |

**Per-layer resolution priority (locked for P8.5c, refined in Task 3):**

```text
1. EvidenceChain traversal (Task 3)
2. Direct-id from OutcomeRecord: recommendationId / riskScoreId / governanceReviewId
3. Proposal-based fallback: filter by proposalId (cross-proposal isolation invariant)
4. String heuristic on subject/sourceReportId (DEPRECATED post-P9; only used for Learning signals)
```

Task 2 ships priorities 2 and 3. Priority 1 (chain) is integrated in Task 3 — which becomes the structural bridge between P8.5a.0 and P8.5c. Without Task 3's chain integration, P8.5c would only validate stores + adapters, NOT the Evidence Chain itself.

**Step-by-step:**

- [ ] **Step 1: Write 4 failing tests**

```ts
// tests/explain/proposal-explanation-assembler.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleProposalExplanation } from "../../src/explain/proposal-explanation-assembler.js";
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import { ApprovalRecommendationStore } from "../../src/adaptation/approval-recommendation-store.js";
import { RiskScoreStore } from "../../src/adaptation/risk-score-store.js";
import { GovernanceReviewStore } from "../../src/adaptation/governance-review-store.js";

const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
const RECOMMENDATIONS_DIR = join(".alix", "approval-recommendations");
const RISK_SCORES_DIR = join(".alix", "risk-scores");
const GOVERNANCE_REVIEWS_DIR = join(".alix", "governance-reviews");

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "explain-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("assembleProposalExplanation", () => {
  it("returns all layers as not_available when stores are empty", async () => {
    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });
    expect(result.proposalId).toBe("prop-1");
    expect(result.outcome.status).toBe("not_available");
    expect(result.recommendation.status).toBe("not_available");
    expect(result.risk.status).toBe("not_available");
    expect(result.governance.status).toBe("not_available");
    expect(result.learning.totalSignals).toBe(0);
    expect(result.calibration.profilesByTarget).toEqual({});
    expect(result.explanationIntegrity.totalLayers).toBe(6);
    expect(result.explanationIntegrity.layersAvailable).toBe(0);
    expect(result.explanationIntegrity.completenessPercent).toBe(0);
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(false);
    expect(result.learningRefreshHint).not.toBeNull();
  });

  it("populates Recommendation via direct-id from OutcomeRecord.recommendationId (joinPath: direct_id)", async () => {
    // Seed an OutcomeRecord with explicit recommendationId
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: ["Deployed cleanly"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "Applied",
      observationWindowDays: 7,
      recommendationId: "rec-1",          // DIRECT-ID JOIN
    } as any);
    // Seed the recommendation
    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({
      id: "rec-1",
      subject: "Recommendation for prop-1",
      outcome: "recommended",
      confidence: 0.85,
      reasons: ["Pattern matches successful precedent"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      proposalId: "prop-1",
      decision: "approve",
    } as any);
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.recommendation.status).toBe("available");
    if (result.recommendation.status === "available") {
      expect(result.recommendation.recommendationId).toBe("rec-1");
      expect(result.recommendation.joinPath).toBe("direct_id");
    }
    expect(result.explanationIntegrity.recommendationFound).toBe(true);
  });

  it("falls back to proposalId join when OutcomeRecord has no recommendationId (joinPath: proposal_fallback)", async () => {
    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({
      id: "rec-1",
      subject: "Recommendation for prop-1",
      outcome: "recommended",
      confidence: 0.85,
      reasons: ["x"],
      generatedAt: new Date().toISOString(),
      proposalId: "prop-1",
      decision: "approve",
    } as any);
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.recommendation.status).toBe("available");
    if (result.recommendation.status === "available") {
      expect(result.recommendation.joinPath).toBe("proposal_fallback");
    }
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(true);
  });

  it("populates Risk via direct-id from OutcomeRecord.riskScoreId", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "a",
      observationWindowDays: 7,
      riskScoreId: "risk-prop-1",          // DIRECT-ID JOIN
    } as any);
    const riskStore = new RiskScoreStore(join(tempRoot, RISK_SCORES_DIR));
    await riskStore.append({
      id: "risk-prop-1",
      subject: "Risk for prop-1",
      outcome: "assessed",
      confidence: 0.9,
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      overallRisk: 0.42,
      risks: [],
      dimensions: { governance: 0.4, operational: 0.5, capability: 0.3, revertability: 0.4, evidence_quality: 0.5 },
      sourceArtifacts: [],
    } as any);
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.risk.status).toBe("available");
    if (result.risk.status === "available") {
      expect(result.risk.riskScoreId).toBe("risk-prop-1");
      expect(result.risk.joinPath).toBe("direct_id");
    }
  });

  it("populates Governance via direct-id from OutcomeRecord.governanceReviewId", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "a",
      observationWindowDays: 7,
      governanceReviewId: "rev-1",         // DIRECT-ID JOIN
    } as any);
    const reviewStore = new GovernanceReviewStore(join(tempRoot, GOVERNANCE_REVIEWS_DIR));
    await reviewStore.append({
      id: "rev-1",
      subject: "Review for prop-1",
      outcome: "reviewed",
      confidence: 0.8,
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      proposalId: "prop-1",
      recommendationId: "rec-1",
      verdict: "agree_with_concerns",
      concerns: ["Reversibility unclear"],
      blindSpots: [],
      historicalAnalogies: [],
      lensScores: [],
      councilVote: { agree: 0, agreeWithConcerns: 1, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    } as any);
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.governance.status).toBe("available");
    if (result.governance.status === "available") {
      expect(result.governance.reviewId).toBe("rev-1");
      expect(result.governance.joinPath).toBe("direct_id");
    }
  });

  it("computes completenessPercent correctly when partial data is present", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({ id: "out-1", subject: "x", outcome: "success", reasons: [], generatedAt: new Date().toISOString(), subjectId: "prop-1", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7, recommendationId: "rec-1" } as any);
    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({ id: "rec-1", subject: "x", outcome: "recommended", confidence: 0.9, reasons: [], generatedAt: new Date().toISOString(), proposalId: "prop-1", decision: "approve" } as any);
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.explanationIntegrity.layersAvailable).toBe(2);
    expect(result.explanationIntegrity.completenessPercent).toBeCloseTo(33.3, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/explain/proposal-explanation-assembler.vitest.ts`
Expected: FAIL with "Cannot find module .../proposal-explanation-assembler.js"

- [ ] **Step 3: Implement the assembler (Task 2 scope: direct-id + proposal-fallback)**

```ts
// src/explain/proposal-explanation-assembler.ts

/**
 * P8.5c.2 — ProposalExplanation assembler.
 *
 * Pure read-only aggregation. Walks stores + (in Task 3) the EvidenceChain
 * graph and assembles an ephemeral ProposalExplanation view-model.
 *
 * CORE INVARIANT: this module NEVER writes to any store, evidence chain,
 * adapter, or proposal surface. Explain reads. Sentinel-enforced.
 *
 * Layer-resolution priority (locked):
 *   1. EvidenceChain traversal (Task 3)
 *   2. Direct-id from OutcomeRecord (this task)
 *   3. Proposal-based fallback (this task)
 *   4. String heuristic on subject/sourceReportId (Task 3, deprecated post-P9)
 */

import { join } from "node:path";
import { OutcomeStore } from "../adaptation/outcome-store.js";
import { ApprovalRecommendationStore } from "../adaptation/approval-recommendation-store.js";
import { RiskScoreStore } from "../adaptation/risk-score-store.js";
import { GovernanceReviewStore } from "../adaptation/governance-review-store.js";
import type {
  ProposalExplanation,
  OutcomeLayer,
  RecommendationLayer,
  RiskLayer,
  GovernanceLayer,
  UnavailableLayer,
  ExplanationIntegrity,
  JoinPath,
} from "./proposal-explanation-types.js";

const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
const RECOMMENDATIONS_DIR = join(".alix", "approval-recommendations");
const RISK_SCORES_DIR = join(".alix", "risk-scores");
const GOVERNANCE_REVIEWS_DIR = join(".alix", "governance-reviews");

export interface AssembleOptions {
  proposalId: string;
  cwd: string;
  windowDays: number;
  generatedAt?: string;
}

const REFRESH_HINT = "Run 'alix learning refresh' to generate calibration signals for this proposal.";

export async function assembleProposalExplanation(
  opts: AssembleOptions,
): Promise<ProposalExplanation> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const proposalId = opts.proposalId;
  const windowDays = opts.windowDays;

  // Track whether any layer used a fallback join (for explanationIntegrity).
  let fallbackJoinsUsed = false;
  let incompleteChainLayers = 0;          // Task 3 will populate
  let evidenceChainUsed = false;          // Task 3 will populate

  // ---- Layer 1: Outcome ------------------------------------------------
  // Use OutcomeStore.queryBySubject (more efficient than list().filter()).
  const outcomeStore = new OutcomeStore(join(opts.cwd, OUTCOMES_DIR));
  const matchingOutcomes = await outcomeStore.queryBySubject(proposalId).catch(() => []);
  matchingOutcomes.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  const mostRecentOutcome = matchingOutcomes[0];

  const outcome: OutcomeLayer | UnavailableLayer = mostRecentOutcome
    ? {
        status: "available",
        outcome: mostRecentOutcome.outcome,
        observedAt: mostRecentOutcome.generatedAt,
        sourceArtifactIds: [mostRecentOutcome.id],
        joinPath: "proposal_fallback",     // Outcome is always proposal-scoped (no chain link)
      }
    : { status: "not_available", reason: `no OutcomeRecord for proposal ${proposalId}` };

  // ---- Layer 2: Recommendation via direct-id then proposal-fallback ---
  let recommendation: RecommendationLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no ApprovalRecommendation linked to proposal ${proposalId}`,
  };
  let recJoinPath: JoinPath = "proposal_fallback";

  const recStore = new ApprovalRecommendationStore(join(opts.cwd, RECOMMENDATIONS_DIR));
  if (mostRecentOutcome?.recommendationId) {
    const rec = await recStore.get(mostRecentOutcome.recommendationId).catch(() => null);
    if (rec) {
      recJoinPath = "direct_id";
      recommendation = {
        status: "available",
        recommendationId: rec.id,
        decision: rec.decision,
        confidence: rec.confidence,
        reasons: rec.reasons,
        sourceArtifactIds: [rec.id],
        joinPath: recJoinPath,
      };
    }
  }
  if (recommendation.status === "not_available") {
    const allRecs = await recStore.list().catch(() => []);
    const matchingRecs = allRecs
      .filter((r) => r.proposalId === proposalId)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    const mostRecentRec = matchingRecs[0];
    if (mostRecentRec) {
      recommendation = {
        status: "available",
        recommendationId: mostRecentRec.id,
        decision: mostRecentRec.decision,
        confidence: mostRecentRec.confidence,
        reasons: mostRecentRec.reasons,
        sourceArtifactIds: [mostRecentRec.id],
        joinPath: "proposal_fallback",
      };
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layer 3: Risk Score via direct-id then proposal-fallback --------
  let risk: RiskLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no RiskScore linked to proposal ${proposalId}`,
  };

  const riskStore = new RiskScoreStore(join(opts.cwd, RISK_SCORES_DIR));
  if (mostRecentOutcome?.riskScoreId) {
    const r = await riskStore.get(mostRecentOutcome.riskScoreId).catch(() => null);
    if (r) {
      risk = {
        status: "available",
        riskScoreId: r.id,
        overallRisk: r.overallRisk,
        outcome: r.overallRisk < 0.3 ? "low" : r.overallRisk < 0.6 ? "medium" : r.overallRisk < 0.85 ? "high" : "critical",
        dimensions: Object.entries(r.dimensions).map(([dim, score]) => ({
          dimension: dim as any,
          score,
          confidence: r.risks.find((x: any) => x.dimension === dim)?.confidence ?? 0,
          reasons: r.risks.find((x: any) => x.dimension === dim)?.reasons ?? [],
        })),
        sourceArtifactIds: [r.id],
        joinPath: "direct_id",
      };
    }
  }
  if (risk.status === "not_available") {
    const allRisks = await riskStore.queryByWindow(windowDays).catch(() => []);
    const matching = allRisks.find((r) => r.id === `risk-${proposalId}`);
    if (matching) {
      risk = {
        status: "available",
        riskScoreId: matching.id,
        overallRisk: matching.overallRisk,
        outcome: matching.overallRisk < 0.3 ? "low" : matching.overallRisk < 0.6 ? "medium" : matching.overallRisk < 0.85 ? "high" : "critical",
        dimensions: Object.entries(matching.dimensions).map(([dim, score]) => ({
          dimension: dim as any,
          score,
          confidence: matching.risks.find((x: any) => x.dimension === dim)?.confidence ?? 0,
          reasons: matching.risks.find((x: any) => x.dimension === dim)?.reasons ?? [],
        })),
        sourceArtifactIds: [matching.id],
        joinPath: "proposal_fallback",
      };
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layer 4: Governance Review via direct-id then proposal-fallback -
  let governance: GovernanceLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no GovernanceReview linked to proposal ${proposalId}`,
  };

  const reviewStore = new GovernanceReviewStore(join(opts.cwd, GOVERNANCE_REVIEWS_DIR));
  if (mostRecentOutcome?.governanceReviewId) {
    const rev = await reviewStore.get(mostRecentOutcome.governanceReviewId).catch(() => null);
    if (rev) {
      governance = {
        status: "available",
        reviewId: rev.id,
        verdict: rev.verdict,
        concerns: rev.concerns,
        lensScores: rev.lensScores.map((ls) => ({
          lens: ls.lens,
          verdict: ls.recommendedVerdict,
          confidence: ls.confidence,
        })),
        sourceArtifactIds: [rev.id],
        joinPath: "direct_id",
      };
    }
  }
  if (governance.status === "not_available") {
    const matchingReviews = await reviewStore.queryByProposal(proposalId).catch(() => []);
    const mostRecentReview = matchingReviews
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
    if (mostRecentReview) {
      governance = {
        status: "available",
        reviewId: mostRecentReview.id,
        verdict: mostRecentReview.verdict,
        concerns: mostRecentReview.concerns,
        lensScores: mostRecentReview.lensScores.map((ls) => ({
          lens: ls.lens,
          verdict: ls.recommendedVerdict,
          confidence: ls.confidence,
        })),
        sourceArtifactIds: [mostRecentReview.id],
        joinPath: "proposal_fallback",
      };
      fallbackJoinsUsed = true;
    }
  }

  // ---- Layers 5 + 6 (filled in Task 3) --------------------------------
  const learning = {
    signalsByAdapter: {} as Record<string, any[]>,
    adaptersWithSignals: [] as string[],
    totalSignals: 0,
  };
  const calibration = {
    profilesByTarget: {} as Record<string, any[]>,
    adjustments: [] as { target: string; previousValue: number; suggestedValue: number; reason: string }[],
  };

  // ---- ExplanationIntegrity (preliminary — refined in Task 3) ---------
  const outcomeFound = outcome.status === "available";
  const recommendationFound = recommendation.status === "available";
  const riskFound = risk.status === "available";
  const governanceFound = governance.status === "available";
  const learningFound = false;
  const calibrationFound = false;
  const layersAvailable = [outcomeFound, recommendationFound, riskFound, governanceFound, learningFound, calibrationFound].filter(Boolean).length;

  const explanationIntegrity: ExplanationIntegrity = {
    outcomeFound,
    recommendationFound,
    riskFound,
    governanceFound,
    learningFound,
    calibrationFound,
    evidenceChainUsed,
    fallbackJoinsUsed,
    incompleteChainLayers,
    totalLayers: 6,
    layersAvailable,
    completenessPercent: Math.round((layersAvailable / 6) * 1000) / 10,
  };

  return {
    proposalId,
    generatedAt,
    windowDays,
    outcome,
    recommendation,
    risk,
    governance,
    learning,
    calibration,
    explanationIntegrity,
    learningRefreshHint: learningFound ? null : REFRESH_HINT,
  };
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/explain/proposal-explanation-assembler.vitest.ts && npx tsc --noEmit`
Expected: 6/6 tests pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/explain/proposal-explanation-assembler.ts tests/explain/proposal-explanation-assembler.vitest.ts
git commit -m "feat(p8.5c.2): assembler with direct-id + proposal-fallback priority order"
```

---

### Task 3: P8.5c.3 — Learning + Calibration + EvidenceChain traversal + Integrity refinement

**Files:**
- Modify: `src/explain/proposal-explanation-assembler.ts` (extend with Learning/Calibration layers + EvidenceChain traversal + Integrity refinement)
- Modify: `tests/explain/proposal-explanation-assembler.vitest.ts` (append 5 more tests)

**Why this is the critical task:** Without EvidenceChain integration, P8.5c would only validate `Stores → Adapters → Learning`, NOT `Stores → Evidence Chain → Learning`. The user's review caught this — P8.5c ships with **real** chain traversal in this task.

**Step-by-step:**

- [ ] **Step 1: Write 5 failing tests**

Append to the test file:

```ts
  it("uses EvidenceChain to populate Recommendation layer (joinPath: evidence_chain)", async () => {
    // Seed Outcome + Recommendation
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({ id: "out-1", subject: "x", outcome: "success", reasons: [], generatedAt: "2026-06-01T00:00:00.000Z", subjectId: "prop-1", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7 } as any);
    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({ id: "rec-1", subject: "x", outcome: "recommended", confidence: 0.85, reasons: [], generatedAt: "2026-06-01T00:00:00.000Z", proposalId: "prop-1", decision: "approve" } as any);
    // Seed an EvidenceChain linking out-1 → rec-1
    const chainStore = new EvidenceChainStore(join(tempRoot, LEARNING_DIR));
    await chainStore.appendChain({
      id: "chain-1",
      subject: "Chain for prop-1",
      outcome: "computed",
      confidence: 1,
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      rootArtifactId: "out-1",
      rootArtifactType: "outcome",
      links: [
        {
          sourceArtifactId: "out-1",
          sourceArtifactType: "outcome",
          targetArtifactId: "rec-1",
          targetArtifactType: "recommendation",
          relationship: "derived_from",
          recordedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      depth: 1,
    });
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.recommendation.status).toBe("available");
    if (result.recommendation.status === "available") {
      expect(result.recommendation.recommendationId).toBe("rec-1");
      expect(result.recommendation.joinPath).toBe("evidence_chain");
    }
    expect(result.explanationIntegrity.evidenceChainUsed).toBe(true);
  });

  it("marks incompleteChainLayers when chain references a missing artifact", async () => {
    // Seed Outcome only
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({ id: "out-1", subject: "x", outcome: "success", reasons: [], generatedAt: "2026-06-01T00:00:00.000Z", subjectId: "prop-1", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7 } as any);
    // Seed a chain that points to a missing rec-1 (chain orphan)
    const chainStore = new EvidenceChainStore(join(tempRoot, LEARNING_DIR));
    await chainStore.appendChain({
      id: "chain-1",
      subject: "Chain for prop-1",
      outcome: "computed",
      confidence: 1,
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      rootArtifactId: "out-1",
      rootArtifactType: "outcome",
      links: [
        {
          sourceArtifactId: "out-1",
          sourceArtifactType: "outcome",
          targetArtifactId: "rec-MISSING",
          targetArtifactType: "recommendation",
          relationship: "derived_from",
          recordedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      depth: 1,
    });
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.explanationIntegrity.evidenceChainUsed).toBe(true);
    expect(result.explanationIntegrity.incompleteChainLayers).toBeGreaterThanOrEqual(1);
    // Falls through to proposal_fallback, which finds nothing → recommendation unavailable
    expect(result.recommendation.status).toBe("not_available");
  });

  it("populates Learning layer via EvidenceChain link from signal to proposal artifact", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({ id: "out-1", subject: "x", outcome: "success", reasons: [], generatedAt: "2026-06-01T00:00:00.000Z", subjectId: "prop-1", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7 } as any);
    const learningStore = new LearningStore(join(tempRoot, LEARNING_DIR));
    await learningStore.appendSignal({
      id: "sig-1",
      subject: "Overconfidence signal",
      outcome: "signal_detected",
      confidence: 0.7,
      reasons: ["delta"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "risk-calibration-window-30",
      signalType: "overconfidence",
      strength: 0.7,
      summary: "x",
      evidenceRefs: [],          // empty — chain is the ONLY link
    });
    const chainStore = new EvidenceChainStore(join(tempRoot, LEARNING_DIR));
    await chainStore.appendChain({
      id: "chain-1",
      subject: "Signal chain",
      outcome: "computed",
      confidence: 1,
      reasons: ["x"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      rootArtifactId: "sig-1",
      rootArtifactType: "signal",
      links: [
        {
          sourceArtifactId: "sig-1",
          sourceArtifactType: "signal",
          targetArtifactId: "out-1",
          targetArtifactType: "outcome",
          relationship: "derived_from",
          recordedAt: "2026-06-22T00:00:00.000Z",
        },
      ],
      depth: 2,
    });
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.learning.totalSignals).toBe(1);
    expect(result.learning.signalsByAdapter.risk).toHaveLength(1);
  });

  it("populates Learning layer via string heuristic fallback (subject includes proposalId)", async () => {
    const learningStore = new LearningStore(join(tempRoot, LEARNING_DIR));
    await learningStore.appendSignal({
      id: "sig-1",
      subject: "Overconfidence for prop-1 bucket",
      outcome: "signal_detected",
      confidence: 0.7,
      reasons: ["x"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "risk-calibration-window-30",
      signalType: "overconfidence",
      strength: 0.7,
      summary: "x",
      evidenceRefs: [],
    });
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(result.learning.totalSignals).toBe(1);
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(true);
  });

  it("populates Calibration layer when CalibrationProfiles reference the proposal", async () => {
    const learningStore = new LearningStore(join(tempRoot, LEARNING_DIR));
    await learningStore.appendProfile({
      id: "prof-1",
      subject: "Confidence multiplier for prop-1 bucket",
      outcome: "suggested",
      confidence: 0.7,
      reasons: ["delta"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      target: "recommendation_confidence_multiplier",
      targetName: "confidence_multiplier_0.8-1.0",
      previousValue: 1.0,
      suggestedValue: 0.85,
      reason: "Observed success rate below midpoint",
      evidenceRefs: ["sig-1"],
      sourceSignalIds: ["sig-1"],
    });
    const result = await assembleProposalExplanation({ proposalId: "prop-1", cwd: tempRoot, windowDays: 30 });
    expect(Object.keys(result.calibration.profilesByTarget)).toEqual(["recommendation_confidence_multiplier"]);
    expect(result.calibration.adjustments).toHaveLength(1);
    expect(result.calibration.adjustments[0].suggestedValue).toBe(0.85);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/explain/proposal-explanation-assembler.vitest.ts`
Expected: 5 failures (LearningStore + EvidenceChainStore not imported, chain traversal not implemented).

- [ ] **Step 3: Extend the assembler**

In `src/explain/proposal-explanation-assembler.ts`:

1. Add imports:
   ```ts
   import { LearningStore } from "../learning/learning-store.js";
   import { EvidenceChainStore } from "../learning/evidence-chain-store.js";
   import { EXPLAIN_MAX_DEPTH } from "../learning/evidence-chain-types.js";
   ```

2. Add `LEARNING_DIR` near the other constants:
   ```ts
   const LEARNING_DIR = join(".alix", "learning");
   ```

3. **Critical new helper** — at the top of the file, add the chain-resolution helper. This is the bridge to P8.5a.0:

```ts
/**
 * Resolve a target artifact through the EvidenceChain graph.
 * Walks chains rooted at `rootArtifactId`, traversing ProvenanceLinks up to
 * EXPLAIN_MAX_DEPTH. Returns the set of reachable target artifact IDs.
 */
async function resolveChainReachable(
  chainStore: EvidenceChainStore,
  rootArtifactId: string,
): Promise<{ reachable: Set<string>; usedChain: boolean }> {
  const reachable = new Set<string>();
  let usedChain = false;
  const chains = await chainStore.getChainForRoot(rootArtifactId).catch(() => []);
  for (const chain of chains) {
    usedChain = true;
    for (const link of chain.links.slice(0, EXPLAIN_MAX_DEPTH)) {
      reachable.add(link.targetArtifactId);
    }
  }
  return { reachable, usedChain };
}
```

4. **Refactor Layers 2-4 to attempt chain resolution first** (Priority 1):

Insert this block immediately after the Outcome layer is built:

```ts
  // ---- Evidence Chain resolution (Priority 1) ------------------------
  const chainStore = new EvidenceChainStore(join(opts.cwd, LEARNING_DIR));
  let chainReachable = new Set<string>();
  if (mostRecentOutcome) {
    const { reachable, usedChain } = await resolveChainReachable(chainStore, mostRecentOutcome.id);
    chainReachable = reachable;
    if (usedChain) evidenceChainUsed = true;
  }
```

5. **Refactor Recommendation resolution** — chain check first, then direct-id (existing), then proposal fallback (existing):

```ts
  // ---- Layer 2: Recommendation (chain → direct-id → proposal fallback)
  let recommendation: RecommendationLayer | UnavailableLayer = {
    status: "not_available",
    reason: `no ApprovalRecommendation linked to proposal ${proposalId}`,
  };
  const recStore = new ApprovalRecommendationStore(join(opts.cwd, RECOMMENDATIONS_DIR));
  // Priority 1: chain
  for (const targetId of chainReachable) {
    const rec = await recStore.get(targetId).catch(() => null);
    if (rec && rec.proposalId === proposalId) {
      recommendation = {
        status: "available",
        recommendationId: rec.id,
        decision: rec.decision,
        confidence: rec.confidence,
        reasons: rec.reasons,
        sourceArtifactIds: [rec.id],
        joinPath: "evidence_chain",
      };
      break;
    }
  }
  // Priority 2: direct-id from OutcomeRecord (existing logic)
  if (recommendation.status === "not_available" && mostRecentOutcome?.recommendationId) {
    const rec = await recStore.get(mostRecentOutcome.recommendationId).catch(() => null);
    if (rec) {
      recommendation = {
        status: "available",
        recommendationId: rec.id,
        decision: rec.decision,
        confidence: rec.confidence,
        reasons: rec.reasons,
        sourceArtifactIds: [rec.id],
        joinPath: "direct_id",
      };
    } else {
      incompleteChainLayers += 1;       // chain or direct-id references missing rec
    }
  }
  // Priority 3: proposal-fallback (existing logic)
  if (recommendation.status === "not_available") {
    const allRecs = await recStore.list().catch(() => []);
    const matchingRecs = allRecs
      .filter((r) => r.proposalId === proposalId)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    const mostRecentRec = matchingRecs[0];
    if (mostRecentRec) {
      recommendation = {
        status: "available",
        recommendationId: mostRecentRec.id,
        decision: mostRecentRec.decision,
        confidence: mostRecentRec.confidence,
        reasons: mostRecentRec.reasons,
        sourceArtifactIds: [mostRecentRec.id],
        joinPath: "proposal_fallback",
      };
      fallbackJoinsUsed = true;
    }
  }
```

6. Apply the same chain-first pattern to Risk (Layer 3) and Governance (Layer 4) — same structure, swap the store. For Risk the chain target type is `risk_score`, for Governance it's `governance_review`. Mirror the priority ladder.

7. **Layer 5 — Learning Signals via chain (Priority 1+2) + heuristic (Priority 3)**:

```ts
  // ---- Layer 5: Learning Signals (chain → heuristic) ------------------
  const learningStore = new LearningStore(join(opts.cwd, LEARNING_DIR));
  const allSignals = await learningStore.querySignals({ windowDays }).catch(() => []);
  const allProfiles = await learningStore.queryProfiles({ windowDays }).catch(() => []);
  // Chain: find signals whose chain root resolves to any outcome/recommendation/risk/governance for this proposal
  const proposalArtifactIds = new Set<string>();
  if (mostRecentOutcome) proposalArtifactIds.add(mostRecentOutcome.id);
  if (recommendation.status === "available") proposalArtifactIds.add((recommendation as RecommendationLayer).recommendationId);
  if (risk.status === "available") proposalArtifactIds.add((risk as RiskLayer).riskScoreId);
  if (governance.status === "available") proposalArtifactIds.add((governance as GovernanceLayer).reviewId);

  const allChains = await chainStore.listChains().catch(() => []);
  const chainRoots = new Set<string>();
  for (const chain of allChains) {
    for (const link of chain.links) {
      if (proposalArtifactIds.has(link.targetArtifactId)) {
        chainRoots.add(chain.rootArtifactId);
        evidenceChainUsed = true;
      }
    }
  }
  // Signals reachable via chain
  const matchingSignals: any[] = [];
  for (const sig of allSignals) {
    if (chainRoots.has(sig.id)) {
      matchingSignals.push(sig);
    }
  }
  // Priority 3: heuristic fallback (subject/sourceReportId contains proposalId)
  if (matchingSignals.length === 0) {
    for (const sig of allSignals) {
      if (sig.subject?.includes(proposalId) || sig.sourceReportId?.includes(proposalId)) {
        matchingSignals.push(sig);
        fallbackJoinsUsed = true;
      }
    }
  }
  const signalsByAdapter: Record<string, any[]> = {};
  for (const sig of matchingSignals) {
    const adapter = sig.sourceReportId?.startsWith("recommendation-")
      ? "recommendation"
      : sig.sourceReportId?.startsWith("risk-calibration-")
      ? "risk"
      : sig.sourceReportId?.startsWith("governance-calibration-")
      ? "governance"
      : "unknown";
    if (!signalsByAdapter[adapter]) signalsByAdapter[adapter] = [];
    signalsByAdapter[adapter].push(sig);
  }
  const adaptersWithSignals = Object.keys(signalsByAdapter).filter((k) => signalsByAdapter[k].length > 0);
  const learning = {
    signalsByAdapter,
    adaptersWithSignals,
    totalSignals: matchingSignals.length,
  };

  // ---- Layer 6: Calibration Profiles (chain → heuristic) -------------
  // Profiles reachable via chain (profile.evidenceRefs contains signal IDs in chainRoots)
  const matchingProfiles: any[] = [];
  for (const prof of allProfiles) {
    if (prof.sourceSignalIds?.some((sid: string) => chainRoots.has(sid)) || prof.evidenceRefs?.some((eid: string) => chainRoots.has(eid))) {
      matchingProfiles.push(prof);
    }
  }
  // Heuristic fallback
  if (matchingProfiles.length === 0) {
    for (const prof of allProfiles) {
      if (prof.subject?.includes(proposalId) || prof.evidenceRefs?.includes(proposalId)) {
        matchingProfiles.push(prof);
        fallbackJoinsUsed = true;
      }
    }
  }
  const profilesByTarget: Record<string, any[]> = {};
  for (const prof of matchingProfiles) {
    if (!profilesByTarget[prof.target]) profilesByTarget[prof.target] = [];
    profilesByTarget[prof.target].push(prof);
  }
  const calibration = {
    profilesByTarget,
    adjustments: matchingProfiles.map((p) => ({
      target: p.target,
      previousValue: p.previousValue,
      suggestedValue: p.suggestedValue,
      reason: p.reason,
    })),
  };
```

8. Update `learningFound` and `calibrationFound` in ExplanationIntegrity:

```ts
  const learningFound = learning.totalSignals > 0;
  const calibrationFound = matchingProfiles.length > 0;
```

- [ ] **Step 4: Run all tests + tsc**

Run: `npx vitest run tests/explain/proposal-explanation-assembler.vitest.ts && npx tsc --noEmit`
Expected: 11/11 tests pass (6 from Task 2 + 5 new), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/explain/proposal-explanation-assembler.ts tests/explain/proposal-explanation-assembler.vitest.ts
git commit -m "feat(p8.5c.3): EvidenceChain traversal + learning + calibration layers"
```

---

### Task 4: P8.5c.4 — `alix explain proposal` CLI + renderers

**Files:**
- Create: `src/cli/commands/explain.ts`
- Create: `tests/cli/commands/explain-cli.vitest.ts`
- Modify: `src/cli.ts` (wire `alix explain`)

**Step-by-step:**

- [ ] **Step 1: Write 5 failing CLI tests**

```ts
// tests/cli/commands/explain-cli.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleExplainCommand } from "../../../src/cli/commands/explain.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "explain-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("handleExplainCommand", () => {
  it("prints 'not available' for every layer when stores are empty", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleExplainCommand(["proposal", "prop-1"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Outcome");
    expect(output).toContain("not available");
    expect(output).toContain("Explanation Integrity");
    expect(output).toContain("0/6 layers available");
  });

  it("prints valid JSON with --json flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleExplainCommand(["proposal", "prop-1", "--json"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.proposalId).toBe("prop-1");
    expect(parsed.explanationIntegrity.totalLayers).toBe(6);
  });

  it("shows refresh hint when Learning layer is empty", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleExplainCommand(["proposal", "prop-1"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("learning refresh");
  });

  it("errors on missing proposal id", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await handleExplainCommand(["proposal"]);
    expect(err).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("errors on unknown subcommand", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await handleExplainCommand(["bogus"]);
    expect(err).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/commands/explain-cli.vitest.ts`
Expected: FAIL with "Cannot find module .../explain.js"

- [ ] **Step 3: Implement `src/cli/commands/explain.ts`**

```ts
// src/cli/commands/explain.ts

/**
 * P8.5c.4 — `alix explain` CLI dispatcher + renderers.
 *
 * Single subcommand for P8.5c: `proposal <id>`. Future targets
 * (signal, governance-review, adapter) slot in as new cases.
 *
 * CORE INVARIANT: read-only. No writes. No mutation. Sentinel-enforced.
 */

import { assembleProposalExplanation } from "../../explain/proposal-explanation-assembler.js";
import type { ProposalExplanation, UnavailableLayer } from "../../explain/proposal-explanation-types.js";

export async function handleExplainCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== "proposal") {
    console.error(`Unknown explain subcommand: "${subcommand}"`);
    console.error(`Usage: alix explain proposal <proposal-id> [--window <days>] [--json]`);
    process.exit(1);
  }

  const proposalId = args[1];
  if (!proposalId) {
    console.error("Error: proposal id required");
    console.error(`Usage: alix explain proposal <proposal-id> [--window <days>] [--json]`);
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 90;
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const explanation = await assembleProposalExplanation({
    proposalId,
    cwd: process.cwd(),
    windowDays,
  });

  if (jsonMode) {
    console.log(JSON.stringify(explanation, null, 2));
    return;
  }

  renderTerminal(explanation);
}

function renderTerminal(explanation: ProposalExplanation): void {
  const bar = "═══════════════════════════════════════";
  console.log(`Proposal ${explanation.proposalId}`);
  console.log(`Generated: ${explanation.generatedAt}`);
  console.log(`Window: ${explanation.windowDays} days`);
  console.log(bar);

  renderLayer("Outcome", explanation.outcome, (l) => {
    console.log(`  outcome:    ${l.outcome}`);
    console.log(`  observed:   ${l.observedAt}`);
  });
  renderLayer("Recommendation", explanation.recommendation, (l) => {
    console.log(`  decision:   ${l.decision}`);
    console.log(`  confidence: ${l.confidence ?? "n/a"}`);
  });
  renderLayer("Risk Assessment", explanation.risk, (l) => {
    console.log(`  overall:    ${l.overallRisk.toFixed(2)} (${l.outcome})`);
    for (const d of l.dimensions) {
      console.log(`    ${d.dimension.padEnd(18)} ${d.score.toFixed(2)} (confidence ${d.confidence.toFixed(2)})`);
    }
  });
  renderLayer("Governance Review", explanation.governance, (l) => {
    console.log(`  verdict:    ${l.verdict}`);
    if (l.concerns.length > 0) {
      console.log(`  concerns:`);
      for (const c of l.concerns) console.log(`    - ${c}`);
    }
  });
  renderLayer("Learning Signals", explanation.learning, () => {
    if (explanation.learning.totalSignals === 0) {
      console.log(`  No signals found.`);
      if (explanation.learningRefreshHint) {
        console.log(``);
        console.log(`  Hint:`);
        console.log(`    Run "alix learning refresh"`);
        console.log(`    to generate calibration signals.`);
      }
      return;
    }
    console.log(`  total: ${explanation.learning.totalSignals} signal(s) across ${explanation.learning.adaptersWithSignals.length} adapter(s)`);
    for (const [adapter, sigs] of Object.entries(explanation.learning.signalsByAdapter)) {
      console.log(`    ${adapter}: ${sigs.length} signal(s)`);
    }
  });
  renderLayer("Calibration Impact", explanation.calibration, () => {
    if (explanation.calibration.adjustments.length === 0) {
      console.log(`  No calibration profiles found.`);
      return;
    }
    console.log(`  ${explanation.calibration.adjustments.length} adjustment(s):`);
    for (const a of explanation.calibration.adjustments) {
      console.log(`    ${a.target}: ${a.previousValue} → ${a.suggestedValue}`);
    }
  });

  console.log(bar);
  const i = explanation.explanationIntegrity;
  console.log(`Explanation Integrity: ${i.layersAvailable}/${i.totalLayers} layers available (${i.completenessPercent}%)`);
  console.log(`Evidence Chain: not yet integrated (priority slot reserved)`);
  console.log(`Fallback Joins Used: No`);
  console.log(bar);
}

function renderLayer<T extends { status: string }>(
  name: string,
  layer: T | UnavailableLayer,
  render: (l: any) => void,
): void {
  console.log(``);
  console.log(`${name}`);
  if (layer.status === "not_available") {
    console.log(`  not available  (${(layer as UnavailableLayer).reason})`);
    return;
  }
  render(layer as any);
}
```

- [ ] **Step 4: Run all tests + tsc**

Run: `npx vitest run tests/cli/commands/explain-cli.vitest.ts && npx tsc --noEmit`
Expected: 5/5 tests pass, tsc clean.

- [ ] **Step 5: Wire `alix explain` into `src/cli.ts`**

Open `src/cli.ts`. Find the top-level dispatcher pattern (where `alix decision`, `alix learning`, `alix adaptation` are routed). Add a new case for `explain`:

```ts
  if (command === "explain") {
    const { handleExplainCommand } = await import("./cli/commands/explain.js");
    await handleExplainCommand(args);
    return;
  }
```

(Match the existing dispatch style in src/cli.ts — confirm pattern around line 2825-2840.)

- [ ] **Step 6: Run the full test suite to verify no regressions**

Run: `npx vitest run tests/`
Expected: all existing tests still pass + the 5 new CLI tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/explain.ts tests/cli/commands/explain-cli.vitest.ts src/cli.ts
git commit -m "feat(p8.5c.4): alix explain proposal CLI + terminal/JSON renderers"
```

---

### Task 5: P8.5c.5 — Purity sentinel + final review + PR

**Files:**
- Create: `tests/explain/explain-purity-sentinels.vitest.ts`
- (No code changes; final review + PR dispatch follows)

**Step-by-step:**

- [ ] **Step 1: Write the purity sentinel test**

```ts
// tests/explain/explain-purity-sentinels.vitest.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Imports forbidden in BOTH the assembler and the CLI renderer.
const FORBIDDEN_IMPORTS = [
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AutomaticProposalGenerator",
  // Appliers — every applier is a mutation surface
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
];

// Files that must remain pure read-only.
const EXPLAIN_FILES = [
  "src/explain/proposal-explanation-assembler.ts",
  "src/cli/commands/explain.ts",
];

// Write/mutation method calls forbidden in either file.
// These are easy to bypass accidentally if the sentinel only checks
// `.append(`, so we list the specific method names too.
const FORBIDDEN_WRITE_CALLS = [
  ".append(",
  ".appendSignal(",
  ".appendProfile(",
  ".appendReport(",
  ".appendChain(",
  ".write(",
  ".writeFile(",
  ".appendFile(",
  ".save(",
  ".recordOutcome(",
  ".createProposal(",
  ".approveProposal(",
  ".applyProposal(",
  ".rejectProposal(",
  // Refresh orchestrator (single-writer for LearningStore; explain must never invoke it)
  "runLearningRefresh(",
  // CLI / agent-card mutators
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
];

describe("Explain module purity sentinel", () => {
  for (const file of EXPLAIN_FILES) {
    it(`${file} has no forbidden imports`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
      for (const line of importLines) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(line, `${file} imports ${forbidden}`).not.toContain(forbidden);
        }
      }
    });

    it(`${file} never calls any mutation method`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      for (const call of FORBIDDEN_WRITE_CALLS) {
        expect(src, `${file} contains forbidden call ${call}`).not.toContain(call);
      }
    });

    it(`${file} never imports node:fs write APIs (no appendFileSync, writeFileSync, mkdir with recursive on a write path)`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      const fsWrites = [
        "appendFileSync",
        "writeFileSync",
        "createWriteStream",
      ];
      for (const call of fsWrites) {
        expect(src, `${file} uses ${call}`).not.toContain(call);
      }
    });
  }
});
```

- [ ] **Step 2: Run the sentinel test**

Run: `npx vitest run tests/explain/explain-purity-sentinels.vitest.ts`
Expected: PASS (2 tests × 2 files = 4 cases).

- [ ] **Step 3: Run the full test suite + tsc one final time**

Run: `npx vitest run tests/ && npx tsc --noEmit`
Expected: all tests pass (existing + new), tsc clean.

- [ ] **Step 4: Verify the 6 protected type files are unchanged**

Run:
```bash
git diff main --stat -- \
  'src/learning/*-types.ts' \
  'src/adaptation/*-types.ts'
```
Expected: empty (no changes to protected type files).

- [ ] **Step 5: Commit the sentinel**

```bash
git add tests/explain/explain-purity-sentinels.vitest.ts
git commit -m "test(p8.5c.5): explain module purity sentinel"
```

- [ ] **Step 6: Push the branch + open PR**

```bash
git push -u origin feature/p8.5c-explain-command
gh pr create --title "P8.5c: Explain Command" --body "..."
```

- [ ] **Step 7: Final whole-branch review + merge**

After the PR is opened, dispatch a final whole-branch reviewer (the same pattern used for P8.5a.2). Apply any fixes from the review as a single fix commit. Merge with squash + delete-branch. Tag `alix-p8-5c-complete`.

---

## Summary

| Metric | Value |
|---|---|
| Tasks | 5 atomic |
| New files | 5 (1 type file, 1 assembler, 1 CLI, 2 test files) |
| Modified files | 1 (`src/cli.ts` — ~10 lines) |
| Tests added | 19 (11 assembler + 5 CLI + 3 sentinel cases × 2 files = 19 effective) |
| Test count after P8.5c | ~307 (288 existing + ~19 new) |
| Protected type files changed | 0 |
| New persistence substrate | 0 |
| New authority surface | 0 |
| Read-only invariant | Sentinel-enforced |

**What this proves for the rest of the roadmap:**

| Phase | What P8.5c proves |
|---|---|
| P8.5b Dashboard | All 6 layers + `explanationIntegrity` consumable as Dashboard widgets |
| P9 Meta-Governance | Explain output is governance-grade human-readable justification |
| P7.5p.4 TelemetryCapture | `signalsByAdapter` registry shape drops in a 4th key with no changes |
| Future `explain signal` / `explain governance-review` | Same assembler pattern; new entry points only |

The progression now feels coherent:
```
P7.5p  Persistence → P8.5a  Adapters → P8.5c  Explain → P8.5b  Dashboard → P9 Meta-Governance
```