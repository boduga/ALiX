// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.1 — Historical Similarity Assessment.
 *
 * Computes multi-dimensional similarity between a replay dataset and
 * current production conditions. Each dimension is scored independently
 * (0–1), then assembled into a HistoricalSimilarityAssessment.
 *
 * Similarity is used by the confidence model to cap overall confidence
 * when historical replay conditions differ from current production.
 *
 * @module historical-similarity
 */

import type { HistoricalSimilarityAssessment } from "../contracts/confidence-contract.js";
import type { ReplayDataset } from "../contracts/replay-contract.js";
import { computeOverallSimilarity } from "../confidence/confidence-calculator.js";

// ---------------------------------------------------------------------------
// computeHistoricalSimilarity
// ---------------------------------------------------------------------------

/**
 * Input for historical similarity computation.
 */
export interface HistoricalSimilarityInput {
  /** Replay dataset representing the historical snapshot. */
  readonly historicalSnapshot: ReplayDataset;
  /** Current production snapshot for comparison. */
  readonly currentSnapshot: ReplayDataset;
}

/**
 * Compute a multi-dimensional historical similarity assessment between
 * a replay dataset and current production conditions.
 *
 * Each dimension is scored 0–1 based on comparing corresponding fields
 * across the two snapshots. Dimensions that cannot be compared (missing
 * data, incompatible formats) are recorded in `coverageGaps`.
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * @param input - Historical and current snapshot data.
 * @returns Fully populated HistoricalSimilarityAssessment.
 */
export function computeHistoricalSimilarity(
  input: HistoricalSimilarityInput,
): HistoricalSimilarityAssessment {
  const { historicalSnapshot: h, currentSnapshot: c } = input;
  const gaps: string[] = [];

  // --- Workload similarity ---
  // Compare evidence counts + construction strategy as a proxy for workload mix
  const workloadSimilarity = compareEvidenceProfiles(h, c, gaps);

  // --- Topology similarity ---
  const topologySimilarity = compareTopologies(h, c, gaps);

  // --- Policy similarity ---
  const policySimilarity = comparePolicies(h, c, gaps);

  // --- Resource similarity ---
  const resourceSimilarity = compareTelemetry(h, c, gaps);

  // --- Agent composition similarity ---
  const agentSimilarity = compareAgentConfigs(h, c, gaps);

  // --- Traffic/distribution similarity ---
  const trafficSimilarity = compareConstructionStrategies(h, c, gaps);

  // --- Failure pattern similarity ---
  const failurePatternSimilarity = compareFailurePatterns(h, c, gaps);

  // Build the assessment
  const assessment: HistoricalSimilarityAssessment = {
    workloadSimilarity,
    topologySimilarity,
    policySimilarity,
    resourceSimilarity,
    agentCompositionSimilarity: agentSimilarity,
    trafficSimilarity,
    failurePatternSimilarity,
    overallSimilarity: 0, // placeholder — computed below
    coverageGaps: gaps,
  };

  assessment.overallSimilarity = computeOverallSimilarity(assessment);

  return assessment;
}

// ---------------------------------------------------------------------------
// Dimension comparators
// ---------------------------------------------------------------------------

function compareEvidenceProfiles(
  h: ReplayDataset,
  c: ReplayDataset,
  gaps: string[],
): number {
  if (h.evidenceCount === 0 && c.evidenceCount === 0) return 1.0;
  if (h.evidenceCount === 0 || c.evidenceCount === 0) {
    gaps.push("evidence_count_zero");
    return 0;
  }

  const ratio = Math.min(h.evidenceCount, c.evidenceCount) /
                Math.max(h.evidenceCount, c.evidenceCount);

  // Compare construction strategy
  const strategyScore =
    h.constructionMetadata.constructionStrategy === c.constructionMetadata.constructionStrategy
      ? 1.0
      : 0.5;

  return Math.max(0, Math.min(1, ratio * 0.6 + strategyScore * 0.4));
}

function compareTopologies(
  h: ReplayDataset,
  c: ReplayDataset,
  gaps: string[],
): number {
  const hTopo = h.topologySnapshot;
  const cTopo = c.topologySnapshot;

  if (hTopo.agentCount === 0 && cTopo.agentCount === 0) return 1.0;

  const agentRatio = cTopo.agentCount > 0
    ? Math.min(hTopo.agentCount, cTopo.agentCount) / Math.max(hTopo.agentCount, cTopo.agentCount)
    : 0;

  const versionMatch = hTopo.runtimeVersion === cTopo.runtimeVersion ? 1.0 : 0.3;

  const sharedPolicies = hTopo.activePolicies.filter((p) =>
    cTopo.activePolicies.includes(p),
  ).length;
  const totalPolicies = Math.max(hTopo.activePolicies.length, cTopo.activePolicies.length);
  const policyOverlap = totalPolicies > 0 ? sharedPolicies / totalPolicies : 1.0;

  if (hTopo.runtimeVersion !== cTopo.runtimeVersion) {
    gaps.push(`runtime_version_mismatch:${hTopo.runtimeVersion}→${cTopo.runtimeVersion}`);
  }

  return Math.max(0, Math.min(1, agentRatio * 0.3 + versionMatch * 0.4 + policyOverlap * 0.3));
}

function comparePolicies(
  h: ReplayDataset,
  c: ReplayDataset,
  gaps: string[],
): number {
  const hPol = h.policySnapshot;
  const cPol = c.policySnapshot;

  if (hPol.policyId === cPol.policyId && hPol.policyVersion === cPol.policyVersion) {
    return 1.0;
  }

  gaps.push(`policy_version_mismatch:${hPol.policyId}@${hPol.policyVersion}→${cPol.policyVersion}`);
  return 0.5;
}

function compareTelemetry(
  h: ReplayDataset,
  c: ReplayDataset,
  gaps: string[],
): number {
  const hTel = h.telemetrySnapshot;
  const cTel = c.telemetrySnapshot;

  const sharedMetrics = hTel.metricNames.filter((m) => cTel.metricNames.includes(m)).length;
  const totalMetrics = Math.max(hTel.metricNames.length, cTel.metricNames.length);
  const metricOverlap = totalMetrics > 0 ? sharedMetrics / totalMetrics : 1.0;

  if (hTel.metricNames.length > 0 && cTel.metricNames.length > 0 && sharedMetrics < totalMetrics) {
    gaps.push(`metric_gap:${totalMetrics - sharedMetrics}_metrics_missing`);
  }

  return Math.max(0, Math.min(1, metricOverlap));
}

function compareAgentConfigs(
  h: ReplayDataset,
  c: ReplayDataset,
  gaps: string[],
): number {
  const hAgents = h.agentConfigurationSnapshot;
  const cAgents = c.agentConfigurationSnapshot;

  const sharedAgents = hAgents.agentIds.filter((a) => cAgents.agentIds.includes(a)).length;
  const totalAgents = Math.max(hAgents.agentIds.length, cAgents.agentIds.length);

  // Check hash overlap for shared agents
  let hashMatches = 0;
  let hashComparable = 0;
  for (const agentId of hAgents.agentIds) {
    const hHash = hAgents.configurationHashes[agentId];
    const cHash = cAgents.configurationHashes[agentId];
    if (hHash && cHash) {
      hashComparable++;
      if (hHash === cHash) hashMatches++;
    }
  }

  const agentOverlap = totalAgents > 0 ? sharedAgents / totalAgents : 1.0;
  const configMatch = hashComparable > 0 ? hashMatches / hashComparable : 0.5;

  if (sharedAgents < totalAgents) {
    gaps.push(`agent_gap:${totalAgents - sharedAgents}_agents_missing`);
  }

  return Math.max(0, Math.min(1, agentOverlap * 0.5 + configMatch * 0.5));
}

function compareConstructionStrategies(
  h: ReplayDataset,
  c: ReplayDataset,
  gaps: string[],
): number {
  const hStrat = h.constructionMetadata.constructionStrategy;
  const cStrat = c.constructionMetadata.constructionStrategy;

  if (hStrat === cStrat) return 1.0;

  gaps.push(`strategy_mismatch:${hStrat}→${cStrat}`);
  return 0.5;
}

function compareFailurePatterns(
  h: ReplayDataset,
  c: ReplayDataset,
  gaps: string[],
): number {
  // Failure pattern similarity is inferred from evidence profile overlap
  // without direct failure data, we use a neutral score
  gaps.push("failure_patterns_not_directly_comparable");
  return 0.5;
}
