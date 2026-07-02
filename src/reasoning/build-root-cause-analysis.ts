// src/reasoning/build-root-cause-analysis.ts
//
// P11.2 — Pure deterministic function that consumes a CorrelationGraph and a
// ReasoningEngineConfig, and produces a RootCauseAnalysis with per-degraded-
// subsystem causal findings, chain-of-failure detection, deterministic
// recommendation text, and a content-addressed correlationGraphId hash.
//
// Pure — no I/O, no side effects, no imports from node:* beyond createHash.

import { createHash } from "node:crypto";
import type { CorrelationGraph, CorrelationSubsystemId } from "../correlation/correlation-types.js";
import type {
  RootCauseAnalysis,
  CausalFinding,
  LikelyCause,
  CausalMechanism,
  AnalysisStatus,
  ReasoningEngineConfig,
} from "./reasoning-types.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildRootCauseAnalysis(
  graph: CorrelationGraph,
  config: ReasoningEngineConfig,
  generatedAt?: string,
): RootCauseAnalysis {
  const now = generatedAt ?? new Date().toISOString();
  const analysisId = `reason-${now}`;

  const correlationGraphId = computeCorrelationGraphId(graph);

  // ---- Step 1: Status mapping (early exit) --------------------------------

  if (graph.status === "insufficient_history") {
    return makeEarlyExit("insufficient_history", analysisId, now, correlationGraphId, graph);
  }

  if (graph.status === "stale") {
    return makeEarlyExit("stale", analysisId, now, correlationGraphId, graph);
  }

  // ---- Step 2: Identify degraded subsystems -------------------------------

  const degradedNodes = graph.nodes.filter(
    (n) =>
      n.status === "warning" ||
      n.status === "critical" ||
      (n.status === "unknown" && n.score < config.degradationThreshold),
  );

  if (degradedNodes.length === 0) {
    return makeEarlyExit("no_degradation", analysisId, now, correlationGraphId, graph);
  }

  // Build a fast lookup from subsystem id → node
  const nodeMap = new Map<CorrelationSubsystemId, (typeof graph.nodes)[number]>();
  for (const n of graph.nodes) {
    nodeMap.set(n.subsystem, n);
  }

  // ---- Step 3: Target-indexed edge map ------------------------------------

  const edgesByTarget = new Map<CorrelationSubsystemId, (typeof graph.edges)[number][]>();
  for (const edge of graph.edges) {
    let bucket = edgesByTarget.get(edge.target);
    if (!bucket) {
      bucket = [];
      edgesByTarget.set(edge.target, bucket);
    }
    bucket.push(edge);
  }

  // ---- Step 4-7: Build findings per degraded subsystem --------------------

  const findings: CausalFinding[] = [];

  for (const node of degradedNodes) {
    const target = node.subsystem;
    const incomingEdges = edgesByTarget.get(target) ?? [];

    // Filter edges that meet the minimum confidence threshold
    const qualifyingEdges = incomingEdges.filter(
      (e) => e.correlationConfidence >= config.minCauseConfidence,
    );

    // Map causeSubsystem → LikelyCause (accumulator for dedup)
    const causeMap = new Map<CorrelationSubsystemId, LikelyCause>();

    // -- Step 4: Direct cause classification --
    for (const edge of qualifyingEdges) {
      const causeSubsystem = edge.source;
      const srcNode = nodeMap.get(causeSubsystem);
      const driftItemIds = srcNode ? srcNode.drift.map((d) => d.id) : [];

      let mechanism: CausalMechanism;
      let confidence: number;
      let coOccurrenceRate: number | undefined;

      if (edge.correlationDirection === "positive" && edge.temporalLag >= 1) {
        // temporal_cascade: A degrades → B degrades later
        mechanism = "temporal_cascade";
        confidence = Math.min(edge.correlationConfidence + 0.1, 0.95);
      } else if (
        edge.correlationDirection === "positive" &&
        edge.temporalLag === 0 &&
        edge.coOccurrenceRate >= 0.5
      ) {
        // concurrent_degradation: A and B degrade together
        mechanism = "concurrent_degradation";
        confidence = edge.correlationConfidence;
        coOccurrenceRate = edge.coOccurrenceRate;
      } else if (edge.correlationDirection === "negative") {
        // inverse_correlation: improvements to A adversely affect B
        mechanism = "inverse_correlation";
        confidence = edge.correlationConfidence * 0.8;
      } else {
        // "none" direction or non-qualifying combination — skip
        continue;
      }

      const existing = causeMap.get(causeSubsystem);
      if (existing) {
        // Dedup: keep higher confidence, merge evidence IDs
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
          existing.mechanism = mechanism;
          existing.coOccurrenceRate = coOccurrenceRate;
        }
        const mergedEvidence = new Set([...existing.evidenceIds, ...edge.evidenceIds]);
        existing.evidenceIds = [...mergedEvidence];
        const mergedDrift = new Set([...existing.driftItemIds, ...driftItemIds]);
        existing.driftItemIds = [...mergedDrift];
      } else {
        causeMap.set(causeSubsystem, {
          causeSubsystem,
          confidence,
          mechanism,
          coOccurrenceRate,
          evidenceIds: [...edge.evidenceIds],
          driftItemIds,
        });
      }
    }

    // -- Step 5: Chain detection (2-hop indirect) --
    // For each direct cause B → T, walk incoming edges into B to find A → B → T.
    for (const [directCauseSubsystem, directCause] of causeMap) {
      const edgesIntoB = edgesByTarget.get(directCauseSubsystem) ?? [];

      for (const edgeAtoB of edgesIntoB) {
        const aSubsystem = edgeAtoB.source;

        // Exclude cycles back to the original target
        if (aSubsystem === target) continue;

        // Skip if A is not a known subsystem node
        if (!nodeMap.has(aSubsystem)) continue;

        // Edge A→B must also qualify
        if (edgeAtoB.correlationConfidence < config.minCauseConfidence) continue;

        // Skip edges with "none" direction — no causal significance
        if (edgeAtoB.correlationDirection === "none") continue;

        // Combined confidence: edge(A→B) * edge(B→T), capped at 0.95
        // edge(B→T) is the directCause's already-adjusted confidence
        const chainConfidence = Math.min(
          edgeAtoB.correlationConfidence * directCause.confidence,
          0.95,
        );

        const chainEvidenceIds = [
          ...edgeAtoB.evidenceIds,
          ...directCause.evidenceIds,
        ];

        const chainPath: CorrelationSubsystemId[] = [
          aSubsystem,
          directCauseSubsystem,
          target,
        ];

        const srcNodeA = nodeMap.get(aSubsystem);
        const driftItemIdsA = srcNodeA ? srcNodeA.drift.map((d) => d.id) : [];

        // -- Step 6: Dedup with direct causes --
        const existingChain = causeMap.get(aSubsystem);
        if (existingChain) {
          // Same causeSubsystem from both direct and chain
          if (chainConfidence > existingChain.confidence) {
            existingChain.confidence = chainConfidence;
          }

          // Merge evidence IDs
          const mergedEvidence = new Set([
            ...existingChain.evidenceIds,
            ...chainEvidenceIds,
          ]);
          existingChain.evidenceIds = [...mergedEvidence];

          // Merge drift item IDs
          const mergedDrift = new Set([
            ...existingChain.driftItemIds,
            ...driftItemIdsA,
          ]);
          existingChain.driftItemIds = [...mergedDrift];

          // If mechanisms differ, prefer the direct mechanism
          if (existingChain.mechanism === "degradation_chain") {
            // Both are chains — update chainPath to the shorter/new one
            existingChain.chainPath = chainPath;
          }
          // If existing is a direct mechanism, keep it (prefer direct)
        } else {
          causeMap.set(aSubsystem, {
            causeSubsystem: aSubsystem,
            confidence: chainConfidence,
            mechanism: "degradation_chain",
            chainPath,
            evidenceIds: chainEvidenceIds,
            driftItemIds: driftItemIdsA,
          });
        }
      }
    }

    // -- Step 7: Sort (descending confidence) and cap --
    let causes = [...causeMap.values()].sort((a, b) => b.confidence - a.confidence);
    causes = causes.slice(0, config.maxCausesPerSubsystem);

    // -- Step 9: Driving metric (largest |delta|) --
    let drivingMetric: string | null = null;
    if (node.drift.length > 0) {
      let maxAbsDelta = -1;
      for (const item of node.drift) {
        const absDelta = Math.abs(item.delta);
        if (absDelta > maxAbsDelta) {
          maxAbsDelta = absDelta;
          drivingMetric = item.id;
        }
      }
    }

    // -- Step 10: Recommendation template --
    const recommendedAction = buildRecommendation(target, causes);

    findings.push({
      primarySubsystem: target,
      currentScore: node.score,
      likelyCauses: causes,
      drivingMetric,
      recommendedAction,
    });
  }

  // -- Step 8: insufficient_edges post-check --
  let status: AnalysisStatus = "ok";
  if (!findings.some((f) => f.likelyCauses.length > 0)) {
    status = "insufficient_edges";
  }

  return {
    schemaVersion: "p11.2.0",
    analysisId,
    generatedAt: now,
    correlationGraphId,
    status,
    findings,
    meta: {
      totalSubsystemsExamined: graph.nodes.length,
      degradedSubsystems: findings.length,
      totalEdgesAnalyzed: graph.edges.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers — pure, no side effects
// ---------------------------------------------------------------------------

/**
 * Content-addressed hash of a CorrelationGraph.
 * Returns the same hex string for identical graph snapshots.
 */
function computeCorrelationGraphId(graph: CorrelationGraph): string {
  return createHash("sha256")
    .update(
      graph.schemaVersion +
        graph.generatedAt +
        JSON.stringify(graph.nodes) +
        JSON.stringify(graph.edges),
    )
    .digest("hex");
}

/**
 * Build an early-exit RootCauseAnalysis (no degradation or graph-level
 * precursor status) with a uniform empty-findings shape.
 */
function makeEarlyExit(
  status: AnalysisStatus,
  analysisId: string,
  generatedAt: string,
  correlationGraphId: string,
  graph: CorrelationGraph,
): RootCauseAnalysis {
  return {
    schemaVersion: "p11.2.0",
    analysisId,
    generatedAt,
    correlationGraphId,
    status,
    findings: [],
    meta: {
      totalSubsystemsExamined: graph.nodes.length,
      degradedSubsystems: 0,
      totalEdgesAnalyzed: graph.edges.length,
    },
  };
}

function buildRecommendation(
  target: CorrelationSubsystemId,
  causes: LikelyCause[],
): string {
  const top = causes[0];
  if (!top) {
    // No causes found template
    return `${target} is degraded but no statistically significant causal relationship was found from other subsystems. Investigate independently.`;
  }

  const confidencePct = `${(top.confidence * 100).toFixed(0)}`;

  switch (top.mechanism) {
    case "temporal_cascade": {
      return `Consider inspecting ${top.causeSubsystem} changes — they may have triggered the ${target} degradation (${confidencePct}% confidence).`;
    }

    case "concurrent_degradation": {
      const coPct = top.coOccurrenceRate != null
        ? `${(top.coOccurrenceRate * 100).toFixed(0)}`
        : "?";
      return `Investigate common root cause affecting ${top.causeSubsystem} and ${target} — they degrade together (${coPct}% co-occurrence).`;
    }

    case "inverse_correlation": {
      return `Review whether improvements to ${top.causeSubsystem} are adversely affecting ${target}.`;
    }

    case "degradation_chain": {
      const chainPath = top.chainPath ?? [top.causeSubsystem, target];
      return `Trace the degradation chain: ${chainPath.join(" → ")}. Consider inspecting the chain for cascading failures.`;
    }

    default: {
      // Exhaustiveness check — unreachable for known CausalMechanism values
      const _exhaustive: never = top.mechanism;
      void (_exhaustive);
      return `${target} is degraded. Investigate ${top.causeSubsystem} as a potential cause.`;
    }
  }
}
