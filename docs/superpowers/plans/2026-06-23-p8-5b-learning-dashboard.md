# P8.5b — Learning Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix learning dashboard` — a read-only terminal dashboard that surfaces learning health, calibration quality, and provenance observability by reusing the same `assembleProposalExplanation` assembler that powers `alix explain proposal <id>`. No second explanation engine.

**Architecture:** Pure read-only aggregation. The `DashboardAggregator` calls `assembleProposalExplanation` for a bounded set of recent proposals (default 20), aggregates `explanationIntegrity` + `joinPath` across them, reads `LearningStore` for signal/profile data, and produces an ephemeral `DashboardReport`. A terminal renderer draws 5 panels using ANSI colors. The dashboard is a renderer — no business logic, no persistence, no mutation.

**Tech Stack:** TypeScript, vitest, ANSI escape sequences for terminal rendering.

## Global Constraints

- **Read-only invariant:** DashboardAggregator and renderer MUST NOT write to any store. No append/appendSignal/appendProfile/appendReport/appendChain calls. No runLearningRefresh invocation. No proposal/mutation surface. Sentinel-enforced in Task 4.
- **Bounded scan invariant:** `assembleProposalExplanation` MUST be called for at most `--limit` proposals (default 20, max configurable). NOT unbounded. This protects recurring `--poll` mode from becoming expensive.
- **No second explanation engine:** DashboardAggregator reuses `assembleProposalExplanation` from the Explain module. Does NOT build its own joins. Provenance logic stays in one place.
- **Ephemeral output:** `DashboardReport` is computed on render, never persisted. On termination, it's gone.
- **6 protected type files remain byte-identical to main:** `risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`. The new `DashboardReport` types live in `src/learning/learning-dashboard.ts` (NEW file — no edits to existing type files).
- **No new stores.** No new adapters. No new authority surface. No changes to the Explain module or any existing adapter.
- **`dashboardIntegrityScore` is a pure function** computed by `src/learning/dashboard-integrity-score.ts` — independently testable, reusable by P9, separate from the renderer.
- **`CoverageThresholds`** define health bands: healthy >= 90, degraded >= 75, critical < 75. Renderer maps score to color.
- **Existing test patterns:** mirror `learning-refresh.vitest.ts` for temp-dir + store seeding + vi.spyOn(process, "cwd").

---

## File Structure

| Path | Purpose |
|---|---|
| `src/learning/dashboard-integrity-score.ts` (new) | Pure helper: `computeDashboardIntegrityScore(...)` — independently testable, reusable by P9 |
| `src/learning/learning-dashboard.ts` (new) | `DashboardReport` types + `DashboardAggregator` (pure read-only aggregation) |
| `src/cli/commands/dashboard-renderer.ts` (new) | Terminal renderer (ANSI-colored panels, horizontal rules, coverage thresholds) |
| `tests/learning/learning-dashboard.vitest.ts` (new) | Aggregator + integrity score tests (7 tests) |
| `tests/cli/commands/dashboard-renderer.vitest.ts` (new) | Renderer tests (4 tests — healthy, degraded, alerts, join-path) |
| `tests/cli/commands/learning-dashboard-cli.vitest.ts` (new) | CLI integration tests (3 tests) |
| `tests/learning/learning-dashboard-sentinels.vitest.ts` (new) | Purity sentinel (9 cases: 3 files × 3 assertions) |
| `src/cli/commands/learning.ts` (modify) | Add `case "dashboard"` + `runDashboard(args)` |

No modifications to: `proposal-explanation-assembler.ts`, `explain.ts`, any store file, any adapter, the refresh orchestrator, or the Evidence Chain.

---

## Task Decomposition

4 atomic tasks:

1. **P8.5b.1 — DashboardIntegrityScore pure helper + DashboardReport types + Aggregator**
2. **P8.5b.2 — Terminal renderer**
3. **P8.5b.3 — CLI integration (`alix learning dashboard`)**
4. **P8.5b.4 — Read-only sentinel + final review + PR**

Each task produces a self-contained change that can be verified independently.

---

### Task 1: P8.5b.1 — DashboardIntegrityScore helper + types + aggregator

**Files:**
- Create: `src/learning/dashboard-integrity-score.ts`
- Create: `src/learning/learning-dashboard.ts`
- Create: `tests/learning/learning-dashboard.vitest.ts`

**Step-by-step:**

- [ ] **Step 0: P8.5b.0 — Verify interfaces against P8.5c on main**

Before writing code, confirm the actual types from `main` (commit `11c2488a`):

1. Read `src/explain/proposal-explanation-types.ts` — verify `ProposalExplanation.outcome.status` is `"available" | "not_available"`, `learning.totalSignals`, `calibration.adjustments`, `JoinPath` type exist with correct shapes.
2. Read `src/learning/learning-store.ts` — verify `querySignals({ windowDays })` and `queryProfiles({ windowDays })` signatures accept the same options used by the dashboard.
3. Read `src/adaptation/outcome-store.ts` — verify `list()` returns all records (no ordering guarantee — must sort by `generatedAt` desc).
4. Run `npx tsc --noEmit` — ensure imports resolve correctly.

This step is structural: the plan references exact field names from actual P8.5c types rather than assumed shapes.

- [ ] **Step 1: Create `src/learning/dashboard-integrity-score.ts`**

The pure helper. Exported function `computeDashboardIntegrityScore(...)`. Separated from the renderer so P9 can consume it independently.

```ts
/**
 * P8.5b — Dashboard integrity score.
 *
 * Pure function. No I/O, no store access, no side effects.
 * Independently testable. Reusable by P9 Meta-Governance.
 *
 * Core invariant: the score is a derived metric, not a persisted artifact.
 * Different weightings produce different scores for the same input data.
 */

import type { AggregatedIntegrity, ChainAlertPanel } from "./learning-dashboard.js";

export interface IntegrityScoreInput {
  aggregatedIntegrity: AggregatedIntegrity;
  chainAlerts: ChainAlertPanel;
}

/**
 * Compute a single synthetic health score (0-100).
 *
 * Weighting:
 *   - Average completeness               40%
 *   - Evidence chain usage               30%
 *   - Missing layer penalty (inverse)    20%
 *   - Alert count penalty (inverse)      10%
 *
 * All sub-scores are 0-100; the result is a weighted sum clamped to [0, 100].
 * Round to 1 decimal place.
 */
export function computeDashboardIntegrityScore(input: IntegrityScoreInput): number {
  const { aggregatedIntegrity, chainAlerts } = input;

  // No-data guard: when no proposals exist, score deterministically returns 0.
  if (aggregatedIntegrity.totalExplanations === 0) return 0;

  // 1. Average completeness (40%)
  const completenessScore = aggregatedIntegrity.averageCompleteness;

  // 2. Evidence chain usage (30%)
  const chainScore = aggregatedIntegrity.evidenceChainUsage;

  // 3. Missing layer penalty (20%) — inverse of (1 - missing/total)
  const totalLayers = 6;
  let missingTotal = 0;
  for (const counts of Object.values(aggregatedIntegrity.layerAvailabilityCounts)) {
    missingTotal += counts.missing;
  }
  const totalLayerSlots = aggregatedIntegrity.totalExplanations * totalLayers;
  const missingRatio = totalLayerSlots > 0 ? missingTotal / totalLayerSlots : 0;
  const layerPenalty = (1 - missingRatio) * 100;

  // 4. Alert count penalty (10%)
  const alertRatio = Math.min(chainAlerts.totalAlerts / aggregatedIntegrity.totalExplanations, 1);
  const alertPenalty = (1 - alertRatio) * 100;

  const score = completenessScore * 0.40 + chainScore * 0.30 + layerPenalty * 0.20 + alertPenalty * 0.10;
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}
```

- [ ] **Step 2: Write the failing test for `computeDashboardIntegrityScore`**

```ts
// tests/learning/learning-dashboard.vitest.ts
import { describe, it, expect } from "vitest";
import { computeDashboardIntegrityScore } from "../../src/learning/dashboard-integrity-score.js";
import type { AggregatedIntegrity, ChainAlertPanel } from "../../src/learning/learning-dashboard.js";

function mockAggregatedIntegrity(overrides: Partial<AggregatedIntegrity> = {}): AggregatedIntegrity {
  return {
    totalExplanations: 20,
    averageCompleteness: 90,
    bestLayer: "Outcome",
    worstLayer: "Governance",
    layerAvailability: { outcome: 100, recommendation: 90, risk: 85, governance: 70, learning: 80, calibration: 75 },
    layerAvailabilityCounts: {
      outcome: { present: 20, missing: 0 },
      recommendation: { present: 18, missing: 2 },
      risk: { present: 17, missing: 3 },
      governance: { present: 14, missing: 6 },
      learning: { present: 16, missing: 4 },
      calibration: { present: 15, missing: 5 },
    },
    evidenceChainUsage: 81,
    fallbackJoinRate: 3,
    incompleteChainCount: 2,
    ...overrides,
  };
}

function emptyAlerts(): ChainAlertPanel {
  return { critical: [], warnings: [], infos: [], totalAlerts: 0 };
}

describe("computeDashboardIntegrityScore", () => {
  it("returns 100 for perfect health", () => {
    const score = computeDashboardIntegrityScore({
      aggregatedIntegrity: mockAggregatedIntegrity({
        averageCompleteness: 100,
        evidenceChainUsage: 100,
      }),
      chainAlerts: emptyAlerts(),
    });
    expect(score).toBeCloseTo(100, 1);
  });

  it("penalizes missing layers", () => {
    const score = computeDashboardIntegrityScore({
      aggregatedIntegrity: mockAggregatedIntegrity({ averageCompleteness: 100, evidenceChainUsage: 100 }),
      chainAlerts: emptyAlerts(),
    });
    // 100*0.4 + 100*0.3 + (1 - 20/120)*100*0.2 + 100*0.1 = 40 + 30 + 16.7 + 10 = 96.7
    // (20 missing out of 120 slots)
    expect(score).toBeGreaterThan(90);
    expect(score).toBeLessThan(100);
  });

  it("penalizes alerts", () => {
    const score = computeDashboardIntegrityScore({
      aggregatedIntegrity: mockAggregatedIntegrity({ averageCompleteness: 100, evidenceChainUsage: 100, totalExplanations: 20 }),
      chainAlerts: { critical: [{ proposalId: "p-1", severity: "critical", message: "x" }], warnings: [], infos: [], totalAlerts: 1 },
    });
    // With 1 alert out of 20 proposals, alertPenalty = (1 - 1/20) * 100 = 95
    // 40 + 30 + 16.7 + 9.5 = 96.2
    expect(score).toBeGreaterThan(90);
  });
});
```

- [ ] **Step 3: Create `src/learning/learning-dashboard.ts`** with all DashboardReport types + the DashboardAggregator class. The aggregator:

```ts
/**
 * P8.5b — Learning Dashboard.
 *
 * Pure read-only aggregation layer. Consumes the Explain assembler and
 * LearningStore; never writes or mutates. Ephemeral output.
 */

import { join } from "node:path";
import { LearningStore } from "./learning-store.js";
import { assembleProposalExplanation } from "../explain/proposal-explanation-assembler.js";
import type { ProposalExplanation, JoinPath } from "../explain/proposal-explanation-types.js";
import { computeDashboardIntegrityScore } from "./dashboard-integrity-score.js";

// --- Types ---

export interface CoverageThresholds {
  healthy: number;   // >= 90
  degraded: number;  // >= 75
  critical: number;  // < 75
}

export interface DashboardReport {
  schemaVersion: "p8.5b.0";
  generatedAt: string;
  windowDays: number;
  proposalsScanned: number;
  dashboardIntegrityScore: number;
  explanationIntegrity: AggregatedIntegrity;
  calibrationHealth: CalibrationHealthPanel;
  signals: SignalExplorerPanel;
  joinPathAnalysis: JoinPathPanel;
  chainAlerts: ChainAlertPanel;
}

export interface AggregatedIntegrity {
  totalExplanations: number;
  averageCompleteness: number;
  bestLayer: string;
  worstLayer: string;
  layerAvailability: Record<string, number>;
  layerAvailabilityCounts: Record<string, { present: number; missing: number }>;
  evidenceChainUsage: number;
  fallbackJoinRate: number;
  incompleteChainCount: number;
}

export interface CalibrationHealthPanel {
  adapters: { name: string; signalCount: number; signalTypes: Record<string, number>; profileCount: number; lastRefresh: string | null; note?: string }[];
}

export interface SignalExplorerPanel {
  totalSignals: number;
  signals: { id: string; adapter: string; type: string; strength: number }[];
}

export interface JoinPathPanel {
  distribution: Record<string, number>;
  joinPathByLayer: Record<string, Record<string, number>>;
  bestLayer: { name: string; rate: number };
  worstLayer: { name: string; rate: number };
  heuristicLayers: { layer: string; count: number }[];
}

export interface ChainAlertPanel {
  critical: ChainAlert[];
  warnings: ChainAlert[];
  infos: ChainAlert[];
  totalAlerts: number;
}

export interface ChainAlert {
  proposalId: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface DashboardOptions {
  cwd: string;
  windowDays?: number;
  limit?: number;
  generatedAt?: string;
  thresholds?: CoverageThresholds;
}

// --- Aggregator ---

const LEARNING_DIR = join(".alix", "learning");

export async function buildDashboardReport(opts: DashboardOptions): Promise<DashboardReport> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const windowDays = opts.windowDays ?? 90;
  const limit = opts.limit ?? 20;
  const thresholds = opts.thresholds ?? { healthy: 90, degraded: 75, critical: 75 };

  // 1. Scan recent proposals (up to limit) via the Explain assembler.
  //    For P8.5b, we get proposals from the OutcomeStore (most recent)
  const { OutcomeStore } = await import("../adaptation/outcome-store.js");
  const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
  const outcomeStore = new OutcomeStore(join(opts.cwd, OUTCOMES_DIR));
  const allOutcomes = await outcomeStore.list().catch(() => []);
  // Explicit sort by generatedAt descending — OutcomeStore.list() order is NOT guaranteed.
  allOutcomes.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  const recentProposalIds = [...new Set(allOutcomes.map((o) => o.subjectId))]
    .slice(0, limit);

  const explanations: ProposalExplanation[] = [];
  for (const proposalId of recentProposalIds) {
    const expl = await assembleProposalExplanation({
      proposalId,
      cwd: opts.cwd,
      windowDays: 30,
      generatedAt,
    });
    explanations.push(expl);
  }

  // 2. Aggregate explanationIntegrity across scanned proposals
  const tot = explanations.length;
  let sumCompleteness = 0;
  let chainUsedCount = 0;
  let fallbackCount = 0;
  let incompleteSum = 0;
  const layerPresents: Record<string, number> = {};
  const layerTotals: Record<string, number> = {};
  const joinPathCounts: Record<string, number> = {};
  const joinPathByLayer: Record<string, Record<string, number>> = {};
  const alerts: { proposalId: string; severity: "critical" | "warning" | "info"; message: string }[] = [];
  const layers = ["outcome", "recommendation", "risk", "governance", "learning", "calibration"];

  for (const expl of explanations) {
    const i = expl.explanationIntegrity;
    sumCompleteness += i.completenessPercent;
    if (i.evidenceChainUsed) chainUsedCount++;
    if (i.fallbackJoinsUsed) fallbackCount++;
    incompleteSum += i.incompleteChainLayers;

    // Per-layer presence + join path
    const pairs: [string, { status: string; joinPath?: string }][] = [
      ["outcome", expl.outcome],
      ["recommendation", expl.recommendation],
      ["risk", expl.risk],
      ["governance", expl.governance],
    ];
    for (const [name, layer] of pairs as any) {
      if (!layerTotals[name]) { layerTotals[name] = 0; layerPresents[name] = 0; }
      layerTotals[name] += 1;
      if (layer.status === "available") {
        layerPresents[name] += 1;
        const jp = layer.joinPath ?? "proposal_fallback";
        joinPathCounts[jp] = (joinPathCounts[jp] ?? 0) + 1;
        if (!joinPathByLayer[name]) joinPathByLayer[name] = {};
        joinPathByLayer[name][jp] = (joinPathByLayer[name][jp] ?? 0) + 1;
      }
    }
    // Learning + Calibration are always "available" (may be empty)
    layerTotals["learning"] = (layerTotals["learning"] ?? 0) + 1;
    layerPresents["learning"] = (layerPresents["learning"] ?? 0) + (expl.learning.totalSignals > 0 ? 1 : 0);
    layerTotals["calibration"] = (layerTotals["calibration"] ?? 0) + 1;
    layerPresents["calibration"] = (layerPresents["calibration"] ?? 0) + (expl.calibration.adjustments.length > 0 ? 1 : 0);

    // Chain alerts
    if (i.incompleteChainLayers > 0) {
      alerts.push({ proposalId: expl.proposalId, severity: "info", message: `Chain references ${i.incompleteChainLayers} missing artifact(s)` });
    }
    if (expl.outcome.status === "available" && expl.recommendation.status === "not_available") {
      alerts.push({ proposalId: expl.proposalId, severity: "critical", message: "Outcome exists, Recommendation: MISSING (stale direct-id)" });
    }
    if (expl.risk.status === "not_available" && expl.governance.status === "available") {
      // Risk missing but governance present → alert
      alerts.push({ proposalId: expl.proposalId, severity: "warning", message: "Risk score missing while Governance review present" });
    }
    // (Symmetrical: governance missing while risk present)
    if (expl.risk.status === "available" && expl.governance.status === "not_available") {
      alerts.push({ proposalId: expl.proposalId, severity: "warning", message: "Governance review missing while Risk score present" });
    }
  }

  const avgCompleteness = tot > 0 ? Math.round((sumCompleteness / tot) * 10) / 10 : 0;
  const layerAvailability: Record<string, number> = {};
  const layerAvailabilityCounts: Record<string, { present: number; missing: number }> = {};
  let bestLayer = ""; let bestRate = 0; let worstLayer = ""; let worstRate = Infinity;
  for (const layer of layers) {
    const t = layerTotals[layer] ?? 0;
    const p = layerPresents[layer] ?? 0;
    const rate = t > 0 ? Math.round((p / t) * 1000) / 10 : 0;
    layerAvailability[layer] = rate;
    layerAvailabilityCounts[layer] = { present: p, missing: t - p };
    if (rate > bestRate) { bestRate = rate; bestLayer = layer; }
    if (rate < worstRate) { worstRate = rate; worstLayer = layer; }
  }

  const totalJoinPaths = Object.values(joinPathCounts).reduce((a, b) => a + b, 0);
  const distribution: Record<string, number> = {};
  for (const [jp, count] of Object.entries(joinPathCounts)) {
    distribution[jp] = Math.round((count / (totalJoinPaths || 1)) * 1000) / 10;
  }

  // JoinPath per-layer percentages
  const jpb: Record<string, Record<string, number>> = {};
  for (const [layer, paths] of Object.entries(joinPathByLayer)) {
    const layerTotal = Object.values(paths).reduce((a, b) => a + b, 0);
    jpb[layer] = {};
    for (const [jp, count] of Object.entries(paths)) {
      jpb[layer][jp] = Math.round((count / (layerTotal || 1)) * 1000) / 10;
    }
  }

  // Best/worst by layer
  const layerRates: { name: string; rate: number }[] = [];
  for (const [layer, rates] of Object.entries(jpb)) {
    const ecRate = rates["evidence_chain"] ?? 0;
    layerRates.push({ name: layer, rate: ecRate });
  }
  layerRates.sort((a, b) => b.rate - a.rate);
  const bestChainLayer = layerRates[0] ?? { name: "", rate: 0 };
  const worstChainLayer = layerRates[layerRates.length - 1] ?? { name: "", rate: 0 };

  // Heuristic layers
  const heuristicLayers: { layer: string; count: number }[] = [];
  for (const [layer, jpMap] of Object.entries(joinPathByLayer)) {
    const hc = jpMap["string_heuristic"];
    if (hc && hc > 0) {
      heuristicLayers.push({ layer, count: Math.round(hc) });
    }
  }

  const severitySort = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severitySort[a.severity] - severitySort[b.severity]);

  const aggregatedIntegrity: AggregatedIntegrity = {
    totalExplanations: tot,
    averageCompleteness: avgCompleteness,
    bestLayer, worstLayer,
    layerAvailability, layerAvailabilityCounts,
    evidenceChainUsage: tot > 0 ? Math.round((chainUsedCount / tot) * 1000) / 10 : 0,
    fallbackJoinRate: tot > 0 ? Math.round((fallbackCount / tot) * 1000) / 10 : 0,
    incompleteChainCount: incompleteSum,
  };

  const chainAlerts: ChainAlertPanel = {
    critical: alerts.filter((a) => a.severity === "critical"),
    warnings: alerts.filter((a) => a.severity === "warning"),
    infos: alerts.filter((a) => a.severity === "info"),
    totalAlerts: alerts.length,
  };

  // 3. Read LearningStore for signal + profile data
  const learningStore = new LearningStore(join(opts.cwd, LEARNING_DIR));
  const allSignals = await learningStore.querySignals({ windowDays }).catch(() => []);
  const allProfiles = await learningStore.queryProfiles({ windowDays }).catch(() => []);

  // Adapter classification by sourceReportId prefix
  function adapterForReport(sourceReportId: string): string {
    if (sourceReportId.startsWith("recommendation-")) return "recommendation";
    if (sourceReportId.startsWith("risk-calibration-")) return "risk";
    if (sourceReportId.startsWith("governance-calibration-")) return "governance";
    return "unknown";
  }

  const adapterNames = ["recommendation", "risk", "governance"];
  const calibrationHealth: CalibrationHealthPanel = {
    adapters: adapterNames.map((name) => {
      const sigs = allSignals.filter((s) => adapterForReport(s.sourceReportId) === name);
      const projs = allProfiles.filter((p) => p.target.startsWith(name === "risk" ? "" : name));
      const types: Record<string, number> = {};
      for (const s of sigs) { types[s.signalType] = (types[s.signalType] ?? 0) + 1; }
      const lastRefresh = sigs.length > 0 ? [...sigs].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0].generatedAt : null;
      return {
        name,
        signalCount: sigs.length,
        signalTypes: types,
        profileCount: projs.length,
        lastRefresh,
        note: name === "governance" ? "Low fidelity (concernsRaised inferred)" : undefined,
      };
    }),
  };

  const signalExplorer: SignalExplorerPanel = {
    totalSignals: allSignals.length,
    signals: allSignals.slice(0, 100).map((s) => ({
      id: s.id,
      adapter: adapterForReport(s.sourceReportId),
      type: s.signalType,
      strength: s.strength,
    })),
  };

  const score = computeDashboardIntegrityScore({ aggregatedIntegrity, chainAlerts });

  return {
    schemaVersion: "p8.5b.0",
    generatedAt,
    windowDays,
    proposalsScanned: tot,
    dashboardIntegrityScore: score,
    explanationIntegrity: aggregatedIntegrity,
    calibrationHealth,
    signals: signalExplorer,
    joinPathAnalysis: {
      distribution,
      joinPathByLayer: jpb,
      bestLayer: { name: bestChainLayer.name, rate: bestChainLayer.rate },
      worstLayer: { name: worstChainLayer.name, rate: worstChainLayer.rate },
      heuristicLayers,
    },
    chainAlerts,
  };
}
```

(Note: the aggregator code above is the **reference implementation** — the subagent will write the exact code in the file.)

- [ ] **Step 3: Write 4 tests for the aggregator**

```ts
// Append to tests/learning/learning-dashboard.vitest.ts

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vi, beforeEach, afterEach } from "vitest";
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import { ApprovalRecommendationStore } from "../../src/adaptation/approval-recommendation-store.js";
import { LearningStore } from "../../src/learning/learning-store.js";
import { buildDashboardReport } from "../../src/learning/learning-dashboard.js";

const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
const RECOMMENDATIONS_DIR = join(".alix", "recommendations");
const LEARNING_DIR = join(".alix", "learning");
let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "db-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("buildDashboardReport", () => {
  it("returns empty report when no stores have data", async () => {
    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90 });
    // Even with empty stores, the integrity panel shows 0/6 layers → completenessPercent=0
    expect(report.schemaVersion).toBe("p8.5b.0");
    expect(report.proposalsScanned).toBe(0);
    expect(report.explanationIntegrity.totalExplanations).toBe(0);
    expect(report.dashboardIntegrityScore).toBe(0);
    expect(report.signals.totalSignals).toBe(0);
  });

  it("aggregates a single seeded proposal", async () => {
    // Seed one OutcomeRecord + one Recommendation
    const os = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await os.append({ id: "out-1", subject: "x", outcome: "success", reasons: [], generatedAt: new Date().toISOString(), subjectId: "prop-1", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7, recommendationId: "rec-1" } as any);
    const rs = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await rs.append({ id: "rec-1", subject: "x", outcome: "recommended", confidence: 0.85, reasons: [], generatedAt: new Date().toISOString(), proposalId: "prop-1", recommendation: "approve" } as any);
    // Seed some LearningSignals
    const ls = new LearningStore(join(tempRoot, LEARNING_DIR));
    await ls.appendSignal({ id: "sig-1", subject: "Overconfidence signal", outcome: "signal_detected", confidence: 0.7, reasons: ["delta"], generatedAt: new Date().toISOString(), sourceReportId: "recommendation-accuracy-window-30", signalType: "overconfidence", strength: 0.7, summary: "x", evidenceRefs: [] });

    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90, generatedAt: "2026-06-23T00:00:00.000Z" });
    expect(report.proposalsScanned).toBeGreaterThanOrEqual(1);
    expect(report.explanationIntegrity.layersAvailable).toBeDefined();
    expect(report.calibrationHealth.adapters.length).toBe(3);
    expect(report.signals.totalSignals).toBeGreaterThanOrEqual(1);
    expect(report.chainAlerts).toBeDefined();
  });

  it("detects missing recommendation (chain integrity alert)", async () => {
    // Seed an OutcomeRecord with a stale recommendationId that has no matching rec
    const os = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await os.append({ id: "out-2", subject: "x", outcome: "failure", reasons: [], generatedAt: new Date().toISOString(), subjectId: "prop-2", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7, recommendationId: "rec-MISSING" } as any);
    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90 });
    const criticalAlerts = report.chainAlerts.critical;
    expect(criticalAlerts.some((a) => a.message.includes("Recommendation: MISSING"))).toBe(true);
  });

  it("respects the limit parameter (bounded scan)", async () => {
    // Seed 3 proposals
    for (let i = 0; i < 3; i++) {
      const os = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
      await os.append({ id: `out-${i}`, subject: "x", outcome: "success", reasons: [], generatedAt: new Date().toISOString(), subjectId: `prop-${i}`, subjectType: "proposal", actionTaken: "a", observationWindowDays: 7 } as any);
    }
    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90, limit: 2 });
    expect(report.proposalsScanned).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/learning/learning-dashboard.vitest.ts && npx tsc --noEmit`
Expected: 7/7 tests pass (3 integrity score tests + 4 aggregator tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/learning/dashboard-integrity-score.ts src/learning/learning-dashboard.ts tests/learning/learning-dashboard.vitest.ts
git commit -m "feat(p8.5b.1): DashboardIntegrityScore + DashboardReport types + aggregator"
```

---

### Task 2: P8.5b.2 — Terminal renderer

**Files:**
- Create: `src/cli/commands/dashboard-renderer.ts`
- (No separate test file — tested via CLI integration in Task 3)

**Step-by-step:**

- [ ] **Step 1: Create `src/cli/commands/dashboard-renderer.ts`**

The renderer converts a `DashboardReport` into ANSI-colored terminal output. Each panel is drawn with Unicode box-drawing characters, horizontal rules, and color codes.

```ts
/**
 * P8.5b.2 — Learning Dashboard terminal renderer.
 *
 * Pure renderer: reads DashboardReport, emits ANSI-colored text.
 * No business logic, no aggregation, no store access.
 */

import type { DashboardReport, CoverageThresholds } from "../../learning/learning-dashboard.js";

const DEFAULT_THRESHOLDS: CoverageThresholds = { healthy: 90, degraded: 75, critical: 75 };

function colorize(score: number, thresholds: CoverageThresholds): string {
  if (score >= thresholds.healthy) return "\x1b[32m";   // green
  if (score >= thresholds.degraded) return "\x1b[33m";   // yellow
  return "\x1b[31m";                                     // red
}
function reset(): string { return "\x1b[0m"; }

function bar(value: number, width = 20): string {
  const filled = Math.round((value / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function renderHeader(report: DashboardReport): void {
  const scoreColor = colorize(report.dashboardIntegrityScore, DEFAULT_THRESHOLDS);
  console.log(`${scoreColor}╔══════════════════════════════════════════════════╗${reset()}`);
  console.log(`${scoreColor}║  LEARNING DASHBOARD             v${report.schemaVersion}${reset()}`);
  console.log(`${scoreColor}║  Generated: ${report.generatedAt}${reset()}`);
  console.log(`${scoreColor}║  Window: ${report.windowDays} days  |  Scanned: ${report.proposalsScanned} proposals${reset()}`);
  console.log(`${scoreColor}║  Dashboard Integrity: ${report.dashboardIntegrityScore}/100${reset()}`);
  console.log(`${scoreColor}╚══════════════════════════════════════════════════╝${reset()}`);
}

function renderIntegrityPanel(report: DashboardReport): void {
  const i = report.explanationIntegrity;
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  EXPLANATION INTEGRITY                          ║`);
  console.log(`║                                                  ║`);
  console.log(`║  Average Completeness: ${i.averageCompleteness}%${reset()}`);
  console.log(`║  Best Layer:  ${i.bestLayer} (${i.layerAvailability[i.bestLayer] ?? 0}%)`);
  console.log(`║  Worst Layer: ${i.worstLayer} (${i.layerAvailability[i.worstLayer] ?? 0}%)`);
  console.log(`║                                                  ║`);
  for (const layer of ["outcome", "recommendation", "risk", "governance", "learning", "calibration"]) {
    const pct = i.layerAvailability[layer] ?? 0;
    const c = pct >= 90 ? "\x1b[32m" : pct >= 75 ? "\x1b[33m" : "\x1b[31m";
    console.log(`║  ${c}${layer.padEnd(16)}${String(pct).padStart(3)}% ${bar(pct)}${reset()}`);
  }
  console.log(`║                                                  ║`);
  const ecColor = colorize(i.evidenceChainUsage, DEFAULT_THRESHOLDS);
  console.log(`║  Evidence Chain: ${ecColor}${i.evidenceChainUsage}%${reset()} of explanations     ║`);
  console.log(`║  Fallback Joins: ${i.fallbackJoinRate}%                           ║`);
  console.log(`║  Incomplete Chains: ${i.incompleteChainCount} proposals            ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

function renderCalibrationHealth(report: DashboardReport): void {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  CALIBRATION HEALTH                              ║`);
  console.log(`║                                                  ║`);
  for (const a of report.calibrationHealth.adapters) {
    const types = Object.entries(a.signalTypes).map(([t, c]) => `${c} ${t}`).join(", ");
    console.log(`║  ${a.name.padEnd(27)}${reset()}`);
    console.log(`║    Signals: ${a.signalCount}  (${types || "none"})`);
    console.log(`║    Profiles Active: ${a.profileCount}`);
    console.log(`║    Last Refresh: ${a.lastRefresh ?? "never"}${a.note ? "  ⓘ " + a.note : ""}`);
    console.log(`║                                                  ║`);
  }
  console.log(`╚══════════════════════════════════════════════════╝`);
}

function renderSignalExplorer(report: DashboardReport): void {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  LEARNING SIGNALS                                ║`);
  console.log(`║                                                  ║`);
  console.log(`║  Sig | Adapter        | Type            | Stren  ║`);
  console.log(`║  ${"─".repeat(52)}`);
  for (const sig of report.signals.signals.slice(0, 15)) {
    console.log(`║  ${sig.id.slice(0, 4).padEnd(4)}| ${sig.adapter.padEnd(14)}| ${sig.type.padEnd(15)}| ${sig.strength.toFixed(1).padEnd(5)}`);
  }
  if (report.signals.totalSignals > 15) {
    console.log(`║  ... (${report.signals.totalSignals - 15} more)`);
  }
  console.log(`║                                                  ║`);
  console.log(`║  Total: ${report.signals.totalSignals} signals                            ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

function renderJoinPathAnalysis(report: DashboardReport): void {
  const jp = report.joinPathAnalysis;
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  JOIN PATH ANALYSIS                              ║`);
  console.log(`║                                                  ║`);
  for (const [path, pct] of Object.entries(jp.distribution)) {
    const c = path === "evidence_chain" ? "\x1b[32m" : path === "string_heuristic" ? "\x1b[31m" : "\x1b[33m";
    console.log(`║  ${c}${path.padEnd(20)} ${bar(pct)} ${pct}%${reset()}`);
  }
  console.log(`║                                                  ║`);
  console.log(`║  Best Layer:  ${jp.bestLayer.name} (${jp.bestLayer.rate}% EvidenceChain)`);
  console.log(`║  Worst Layer: ${jp.worstLayer.name} (${jp.worstLayer.rate}% EvidenceChain)`);
  console.log(`║                                                  ║`);
  // Per-layer breakdown
  for (const [layer, paths] of Object.entries(jp.joinPathByLayer)) {
    const ecPct = paths["evidence_chain"] ?? 0;
    const c = ecPct >= 80 ? "\x1b[32m" : ecPct >= 50 ? "\x1b[33m" : "\x1b[31m";
    console.log(`║  ${c}${layer.padEnd(14)} EC: ${String(ecPct).padStart(3)}%${reset()}${Object.entries(paths).filter(([k]) => k !== "evidence_chain").map(([k, v]) => ` ${k}: ${v}%`).join("")}`);
  }
  if (jp.heuristicLayers.length > 0) {
    console.log(`║  ${"\x1b[31m"}⚠ ${jp.heuristicLayers.length} layer(s) used string heuristic${reset()}`);
    for (const hl of jp.heuristicLayers) {
      console.log(`║     ${hl.layer}: ${hl.count} join(s)`);
    }
  }
  console.log(`╚══════════════════════════════════════════════════╝`);
}

function renderChainAlerts(report: DashboardReport): void {
  if (report.chainAlerts.totalAlerts === 0) {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  CHAIN INTEGRITY: ✅ No alerts                    ║`);
    console.log(`╚══════════════════════════════════════════════════╝`);
    return;
  }
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  CHAIN INTEGRITY ALERTS                          ║`);
  console.log(`║                                                  ║`);
  for (const alert of report.chainAlerts.critical) {
    console.log(`║  ${"\x1b[31m"}🔴 CRITICAL${reset()}`);
    console.log(`║    ${alert.proposalId}: ${alert.message}`);
  }
  for (const alert of report.chainAlerts.warnings) {
    console.log(`║  ${"\x1b[33m"}🟡 WARNING${reset()}`);
    console.log(`║    ${alert.proposalId}: ${alert.message}`);
  }
  for (const alert of report.chainAlerts.infos) {
    console.log(`║  ${"\x1b[34m"}ℹ️ INFO${reset()}`);
    console.log(`║    ${alert.proposalId}: ${alert.message}`);
  }
  console.log(`║                                                  ║`);
  console.log(`║  ${report.chainAlerts.totalAlerts} alert(s) found                          ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

export function renderDashboard(report: DashboardReport): void {
  renderHeader(report);
  renderIntegrityPanel(report);
  renderCalibrationHealth(report);
  renderSignalExplorer(report);
  renderJoinPathAnalysis(report);
  renderChainAlerts(report);
}
```

- [ ] **Step 2: Create `tests/cli/commands/dashboard-renderer.vitest.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { renderDashboard } from "../../../src/cli/commands/dashboard-renderer.js";
import type { DashboardReport } from "../../../src/learning/learning-dashboard.js";

function healthyReport(): DashboardReport {
  return {
    schemaVersion: "p8.5b.0",
    generatedAt: "2026-06-23T00:00:00.000Z",
    windowDays: 90,
    proposalsScanned: 20,
    dashboardIntegrityScore: 95,
    explanationIntegrity: {
      totalExplanations: 20,
      averageCompleteness: 92,
      bestLayer: "outcome",
      worstLayer: "governance",
      layerAvailability: { outcome: 100, recommendation: 95, risk: 90, governance: 80, learning: 85, calibration: 82 },
      layerAvailabilityCounts: { outcome: { present: 20, missing: 0 }, recommendation: { present: 19, missing: 1 }, risk: { present: 18, missing: 2 }, governance: { present: 16, missing: 4 }, learning: { present: 17, missing: 3 }, calibration: { present: 16, missing: 4 } },
      evidenceChainUsage: 85,
      fallbackJoinRate: 5,
      incompleteChainCount: 1,
    },
    calibrationHealth: {
      adapters: [
        { name: "recommendation", signalCount: 24, signalTypes: { overconfidence: 14, underconfidence: 10 }, profileCount: 3, lastRefresh: "2026-06-23T08:15:00Z" },
        { name: "risk", signalCount: 18, signalTypes: { overfire: 9, miss: 7, risk_dimension_ignored: 2 }, profileCount: 0, lastRefresh: "2026-06-23T08:15:00Z" },
        { name: "governance", signalCount: 12, signalTypes: { lens_high_predictive_value: 5, lens_high_false_positive: 4, lens_high_miss_rate: 3 }, profileCount: 0, lastRefresh: "2026-06-23T08:15:00Z", note: "Low fidelity" },
      ],
    },
    signals: { totalSignals: 54, signals: [] },
    joinPathAnalysis: {
      distribution: { evidence_chain: 78, direct_id: 16, proposal_fallback: 3, string_heuristic: 3 },
      joinPathByLayer: { outcome: { evidence_chain: 0, proposal_fallback: 100 }, recommendation: { evidence_chain: 94, direct_id: 6 }, risk: { evidence_chain: 87, direct_id: 13 }, governance: { evidence_chain: 22, proposal_fallback: 78 }, learning: { evidence_chain: 50, string_heuristic: 50 }, calibration: { string_heuristic: 100 } },
      bestLayer: { name: "recommendation", rate: 94 },
      worstLayer: { name: "governance", rate: 22 },
      heuristicLayers: [{ layer: "learning", count: 1 }],
    },
    chainAlerts: { critical: [{ proposalId: "prop-42", severity: "critical", message: "Outcome exists, Recommendation MISSING" }], warnings: [{ proposalId: "prop-18", severity: "warning", message: "Risk missing while Governance present" }], infos: [], totalAlerts: 2 },
  };
}

function degradedReport(): DashboardReport {
  const r = healthyReport();
  r.dashboardIntegrityScore = 70;
  r.explanationIntegrity.averageCompleteness = 72;
  r.explanationIntegrity.evidenceChainUsage = 50;
  r.explanationIntegrity.layerAvailability.governance = 40;
  r.joinPathAnalysis.worstLayer = { name: "governance", rate: 5 };
  return r;
}

describe("renderDashboard", () => {
  it("renders healthy score in green", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(healthyReport());
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Dash"); // header rendered
    expect(output).toContain("95");     // score rendered
    const reset = "\x1b[0m";
    expect(output).toContain(reset);
    log.mockRestore();
  });

  it("renders alerts section", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(healthyReport());
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("CRITICAL");
    expect(output).toContain("RECOMMENDATION MISSING");
    expect(output).toContain("WARNING");
    log.mockRestore();
  });

  it("renders join path by layer", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(healthyReport());
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("EvidenceChain");
    expect(output).toContain("recommendation");
    expect(output).toContain("governance");
    expect(output).toContain("string_heuristic");
    log.mockRestore();
  });

  it("color-codes based on score thresholds", () => {
    // Healthy = green, Degraded = yellow
    const logGreen = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(healthyReport());
    const greenOutput = logGreen.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(greenOutput).toContain("\x1b[32m"); // green
    logGreen.mockRestore();

    const logYellow = vi.spyOn(console, "log").mockImplementation(() => {});
    renderDashboard(degradedReport());
    const yellowOutput = logYellow.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(yellowOutput).toContain("\x1b[33m"); // yellow
    logYellow.mockRestore();
  });
});
```

- [ ] **Step 3: Run renderer tests + verify tsc**

Run: `npx vitest run tests/cli/commands/dashboard-renderer.vitest.ts && npx tsc --noEmit`
Expected: 4/4 renderer tests pass, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/dashboard-renderer.ts
git commit -m "feat(p8.5b.2): terminal dashboard renderer (5 ANSI panels)"
```

---

### Task 3: P8.5b.3 — CLI integration (`alix learning dashboard`)

**Files:**
- Modify: `src/cli/commands/learning.ts` (add `case "dashboard"` + `runDashboard`)
- Test via `tests/cli/commands/learning-refresh-cli.vitest.ts` (extend or create new test)

**Step-by-step:**

- [ ] **Step 1: Add "dashboard" case to `learning.ts`**

Find the `handleLearningCommand` switch (around line 56). After `case "report"` and `case "propose"`, add:

```ts
    case "dashboard":
      await runDashboard(rest);
      return;
```

Add the `runDashboard` function (pattern-match the existing `runReport` and `runPropose` conventions):

```ts
async function runDashboard(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 90;
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) { console.error("Error: --window requires a positive integer"); process.exit(1); }
    windowDays = parsed;
  }
  const limitIdx = args.indexOf("--limit");
  let limit = 20;
  if (limitIdx !== -1 && limitIdx + 1 < args.length) {
    const parsed = parseInt(args[limitIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) { console.error("Error: --limit requires a positive integer"); process.exit(1); }
    limit = parsed;
  }

  const { buildDashboardReport } = await import("../../learning/learning-dashboard.js");
  const report = await buildDashboardReport({
    cwd: process.cwd(),
    windowDays,
    limit,
  });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { renderDashboard } = await import("./dashboard-renderer.js");
  renderDashboard(report);
}
```

- [ ] **Step 2: Write 3 CLI tests**

```ts
// tests/cli/commands/learning-dashboard-cli.vitest.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleLearningCommand } from "../../../src/cli/commands/learning.js";
import { OutcomeStore } from "../../../src/adaptation/outcome-store.js";
import { LearningStore } from "../../../src/learning/learning-store.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "db-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("alix learning dashboard CLI", () => {
  it("renders dashboard with empty stores", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLearningCommand(["dashboard"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("LEARNING DASHBOARD");
    expect(output).toContain("Dashboard Integrity");
    expect(output).toContain("Chain Integrity");
  });

  it("outputs valid JSON with --json", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const os = new OutcomeStore(join(tempRoot, ".alix", "adaptation", "outcomes"));
    await os.append({ id: "out-1", subject: "x", outcome: "success", reasons: [], generatedAt: new Date().toISOString(), subjectId: "prop-1", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7 } as any);
    await handleLearningCommand(["dashboard", "--json"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe("p8.5b.0");
    expect(parsed.explanationIntegrity).toBeDefined();
    expect(parsed.calibrationHealth).toBeDefined();
    expect(parsed.chainAlerts).toBeDefined();
  });

  it("errors on invalid --window", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await handleLearningCommand(["dashboard", "--window", "abc"]);
    expect(err).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 3: Run tests + full suite + tsc**

Run: `npx vitest run tests/cli/commands/learning-dashboard-cli.vitest.ts && npx tsc --noEmit`
Expected: 3/3 tests pass, tsc clean.

Run: `npx vitest run tests/` — full suite green (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/learning.ts tests/cli/commands/learning-dashboard-cli.vitest.ts
git commit -m "feat(p8.5b.3): alix learning dashboard CLI"
```

---

### Task 4: P8.5b.4 — Read-only sentinel + final review + PR

**Files:**
- Create: `tests/learning/learning-dashboard-sentinels.vitest.ts`

**Step-by-step:**

- [ ] **Step 1: Write the purity sentinel test**

Mirror the P8.5c sentinel pattern. Forbidden imports + forbidden write calls + forbidden fs writes. The dashboard files are:

- `src/learning/dashboard-integrity-score.ts`
- `src/learning/learning-dashboard.ts`
- `src/cli/commands/dashboard-renderer.ts`

The aggregator (`learning-dashboard.ts`) DOES import `LearningStore` and `assembleProposalExplanation` (read-only consumption). The sentinel should check that it only READS (no `appendSignal`/`appendProfile`/`appendChain` calls).

```ts
// tests/learning/learning-dashboard-sentinels.vitest.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_IMPORTS = [
  "ProposalStore",
  "ApprovalGate",
  "AdaptationProposalStore",
  "AutomaticProposalGenerator",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "runLearningRefresh",
];

const DASHBOARD_FILES = [
  "src/learning/dashboard-integrity-score.ts",
  "src/learning/learning-dashboard.ts",
  "src/cli/commands/dashboard-renderer.ts",
];

const FORBIDDEN_WRITE_CALLS = [
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
  "runLearningRefresh(",
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
];

const FORBIDDEN_FS_WRITES = ["appendFileSync", "writeFileSync", "createWriteStream"];

describe("Dashboard module purity sentinel", () => {
  for (const file of DASHBOARD_FILES) {
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

    it(`${file} never imports node:fs write APIs`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      for (const call of FORBIDDEN_FS_WRITES) {
        expect(src, `${file} uses ${call}`).not.toContain(call);
      }
    });
  }
});
```

- [ ] **Step 2: Run the sentinel test**

Run: `npx vitest run tests/learning/learning-dashboard-sentinels.vitest.ts`
Expected: 9 cases (3 files × 3 assertions) all pass.

- [ ] **Step 3: Final full suite + tsc + protected type check**

Run:
```bash
npx vitest run tests/ && npx tsc --noEmit && git diff main --stat -- 'src/learning/*-types.ts' 'src/adaptation/*-types.ts'
```
Expected: all tests pass, tsc clean, 0 changes to protected type files.

- [ ] **Step 4: Commit — sentinel**

```bash
git add tests/learning/learning-dashboard-sentinels.vitest.ts
git commit -m "test(p8.5b.4): dashboard module purity sentinel"
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feature/p8.5b-learning-dashboard
gh pr create --title "P8.5b: Learning Dashboard" --body "..."
```

- [ ] **Step 6: Whole-branch review + merge + tag**

After the PR is opened, dispatch a final whole-branch reviewer. Apply any fixes as a single fix commit. Merge with squash + delete-branch. Tag `alix-p8-5b-complete`.

---

## Summary

| Metric | Value |
|---|---|
| Tasks | 4 atomic |
| New files | 6 (integrity-score, aggregator+types, renderer, 3 test files) |
| Modified files | 1 (`learning.ts` — ~15 lines for `case "dashboard"`) |
| Tests added | 17 (3 integrity score + 4 aggregator + 4 renderer + 3 CLI + 9 sentinel cases ÷ 3 files) |
| Protected type files changed | 0 |
| New persistence substrate | 0 |
| New authority surface | 0 |
| Read-only invariant | Sentinel-enforced |
| Bounded scan | Locked at default 20, configurable via --limit |
