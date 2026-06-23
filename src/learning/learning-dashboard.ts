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
      const projs = allProfiles.filter((p) => p.target.startsWith(name));
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
