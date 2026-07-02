// src/correlation/build-correlation-graph.ts

import type {
  CorrelationGraph,
  CorrelationEdge,
  CorrelationNode,
  CorrelationNodeStatus,
  CorrelationGraphStatus,
  CorrelationEngineConfig,
  CorrelationDirection,
  CorrelationSubsystemId,
} from "./correlation-types.js";
import type { BaselineComparison } from "../baseline/baseline-types.js";
import type { ExecutiveTrendSnapshot } from "../executive/trend-store.js";
import { executiveToCorrelationSubsystem } from "./normalize-subsystem.js";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Extract subsystem scores from a trend snapshot, handling the stored shape. */
function extractSubsystemScores(
  snapshot: ExecutiveTrendSnapshot,
): Record<string, number> {
  return snapshot.subsystemScores as Record<string, number>;
}

function computeNodeStatus(score: number): CorrelationNodeStatus {
  if (score >= 90) return "excellent";
  if (score >= 70) return "healthy";
  if (score >= 40) return "warning";
  if (score >= 0) return "critical";
  return "unknown";
}

interface DeltaSeries {
  subsystem: CorrelationSubsystemId;
  deltas: number[];
  degradedMask: boolean[];
}

function buildDeltaSeries(
  subsystem: CorrelationSubsystemId,
  scores: number[],
  threshold: number,
): DeltaSeries {
  const deltas: number[] = [];
  const degradedMask: boolean[] = [];
  for (let i = 1; i < scores.length; i++) {
    const d = scores[i] - scores[i - 1];
    deltas.push(d);
    degradedMask.push(d <= threshold);
  }
  return { subsystem, deltas, degradedMask };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

function computeEdge(
  source: DeltaSeries,
  target: DeltaSeries,
  maxLag: number,
  threshold: number,
  maxSamples: number,
  minEdgeConfidence: number,
  snapshotIds: string[],
): CorrelationEdge | null {
  const effectiveSamples = Math.min(source.deltas.length, target.deltas.length);

  // Find best lag 0..maxLag
  let bestLag = 0;
  let bestSimilarity = 0;
  let lag0Similarity = 0;
  let first = true;
  let bestLagLen = 0; // aligned overlap length that produced bestSimilarity
  for (let lag = 0; lag <= maxLag; lag++) {
    if (effectiveSamples <= lag) break;
    const srcEnd = source.deltas.length - lag;
    const tgtStart = lag;
    const len = Math.min(srcEnd, target.deltas.length - tgtStart);
    if (len < 1) continue;
    const aSlice = source.deltas.slice(0, len);
    const bSlice = target.deltas.slice(tgtStart, tgtStart + len);
    const sim = Math.abs(cosineSimilarity(aSlice, bSlice));
    if (first) {
      lag0Similarity = sim;
      first = false;
    }
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestLag = lag;
      bestLagLen = len;
    }
  }

  // Co-occurrence rate
  const alignedLen = Math.min(
    source.degradedMask.length,
    target.degradedMask.length - bestLag,
  );
  let sourceDegraded = 0;
  let bothDegraded = 0;
  for (let t = 0; t < alignedLen; t++) {
    if (source.degradedMask[t]) {
      sourceDegraded++;
      if (target.degradedMask[t + bestLag]) bothDegraded++;
    }
  }
  const coOccurrenceRate = sourceDegraded > 0
    ? bothDegraded / sourceDegraded
    : 0;

  // Direction
  const len = Math.min(source.deltas.length, target.deltas.length - bestLag);
  let meanProduct = 0;
  for (let t = 0; t < len; t++) {
    meanProduct += source.deltas[t] * target.deltas[t + bestLag];
  }
  meanProduct = len > 0 ? meanProduct / len : 0;
  const epsilon = 0.001;
  const correlationDirection: CorrelationDirection =
    meanProduct > epsilon ? "positive"
    : meanProduct < -epsilon ? "negative"
    : "none";

  // Confidence blend
  const similarityStrength = bestSimilarity;
  const sampleRatio = effectiveSamples / Math.max(maxSamples, 1);
  const lagStrength = Math.max(0, bestSimilarity - lag0Similarity);
  const correlationConfidence = clamp01(
    0.4 * coOccurrenceRate +
    0.3 * similarityStrength +
    0.2 * sampleRatio +
    0.1 * lagStrength,
  );

  if (correlationConfidence < minEdgeConfidence) return null;

  // Scope provenance to the snapshots whose deltas actually participated in
  // this edge: source deltas cover indices [0, len), target deltas are shifted
  // by bestLag, so the union covers snapshot indices [0 .. bestLag + len].
  const evidenceIds = snapshotIds.length === 0
    ? []
    : snapshotIds.slice(0, Math.min(snapshotIds.length, bestLag + bestLagLen + 1));

  return {
    source: source.subsystem,
    target: target.subsystem,
    coOccurrenceRate,
    temporalLag: bestLag,
    correlationDirection,
    correlationConfidence,
    evidenceIds,
  };
}

export function buildCorrelationGraph(
  comparisons: BaselineComparison[],
  snapshots: ExecutiveTrendSnapshot[],
  config: CorrelationEngineConfig,
): CorrelationGraph {
  const now = new Date().toISOString();
  // Sort snapshots oldest → newest so delta[t] - delta[t-1] is correct
  snapshots = [...snapshots].sort(
    (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime(),
  );
  const subsystemSet = new Set(config.canonicalSubsystems);
  const excludedSet = new Set(config.excludedSubsystems);
  const nodes: CorrelationNode[] = [];
  const scoreMap = new Map<CorrelationSubsystemId, number>();

  for (const c of comparisons) {
    if (subsystemSet.has(c.subsystem as CorrelationSubsystemId) && !excludedSet.has(c.subsystem as CorrelationSubsystemId)) {
      nodes.push({
        subsystem: c.subsystem as CorrelationSubsystemId,
        score: c.score,
        status: computeNodeStatus(c.score),
        drift: c.drift,
        evidenceIds: [],
      });
      scoreMap.set(c.subsystem as CorrelationSubsystemId, c.score);
    }
  }

  // Fill missing canonical subsystems
  for (const sub of config.canonicalSubsystems) {
    if (!scoreMap.has(sub)) {
      nodes.push({
        subsystem: sub,
        score: 0,
        status: "unknown",
        drift: [],
        evidenceIds: [],
      });
    }
  }

  // Insufficient history
  if (snapshots.length < config.minSamples) {
    return {
      schemaVersion: "p11.1.0",
      generatedAt: now,
      windowSize: config.windowSize,
      status: "insufficient_history",
      nodes,
      edges: [],
      meta: {
        totalSnapshotsExamined: snapshots.length,
        minConfidenceThreshold: config.minEdgeConfidence,
        maxLagExamined: config.maxTemporalLag,
        degradationThreshold: config.degradationDeltaThreshold,
        canonicalSubsystems: [...config.canonicalSubsystems],
        excludedSubsystems: [...config.excludedSubsystems],
      },
    };
  }

  // Build score series
  const subsystemSeries = new Map<CorrelationSubsystemId, number[]>();
  for (const snap of snapshots) {
    const scores = extractSubsystemScores(snap);
    for (const [execName, score] of Object.entries(scores)) {
      const corrName = executiveToCorrelationSubsystem(execName);
      if (corrName && subsystemSet.has(corrName) && !excludedSet.has(corrName)) {
        if (!subsystemSeries.has(corrName)) subsystemSeries.set(corrName, []);
        subsystemSeries.get(corrName)!.push(score);
      }
    }
  }

  // Compute delta series
  const deltaSeriesMap = new Map<CorrelationSubsystemId, DeltaSeries>();
  for (const [sub, scores] of subsystemSeries) {
    deltaSeriesMap.set(sub, buildDeltaSeries(sub, scores, config.degradationDeltaThreshold));
  }

  // Collect snapshot IDs for evidence traceability
  const snapshotIds = snapshots.map(s => s.id).filter(Boolean);

  // Compute pairwise edges
  const allSubs = [...deltaSeriesMap.keys()];
  const edges: CorrelationEdge[] = [];
  for (const a of allSubs) {
    const aSeries = deltaSeriesMap.get(a)!;
    for (const b of allSubs) {
      if (a === b) continue;
      const bSeries = deltaSeriesMap.get(b)!;
      const edge = computeEdge(aSeries, bSeries, config.maxTemporalLag, config.degradationDeltaThreshold, config.windowSize, config.minEdgeConfidence, snapshotIds);
      if (edge) edges.push(edge);
    }
  }

  // Determine status
  let status: CorrelationGraphStatus = "ok";
  if (snapshots.length < config.minSamples) {
    status = "insufficient_history";
  } else {
    const latest = snapshots[snapshots.length - 1];
    const latestGeneratedAt = new Date(latest.generatedAt).getTime();
    const windowDays = latest.windowDays || 7;
    const staleAfterMs = config.staleAfterWindows * windowDays * 24 * 60 * 60 * 1000;
    if (Date.now() - latestGeneratedAt > staleAfterMs) {
      status = "stale";
    }
  }

  return {
    schemaVersion: "p11.1.0",
    generatedAt: now,
    windowSize: config.windowSize,
    status,
    nodes,
    edges,
    meta: {
      totalSnapshotsExamined: snapshots.length,
      minConfidenceThreshold: config.minEdgeConfidence,
      maxLagExamined: config.maxTemporalLag,
      degradationThreshold: config.degradationDeltaThreshold,
      canonicalSubsystems: [...config.canonicalSubsystems],
      excludedSubsystems: [...config.excludedSubsystems],
    },
  };
}
