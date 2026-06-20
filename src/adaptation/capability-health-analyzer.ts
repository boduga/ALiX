/**
 * P5.5.2 — CapabilityHealthAnalyzer.
 *
 * Evaluates whether each capability in the system is healthy, emerging,
 * stagnant, declining, or deprecated.  Uses agent registration counts,
 * resolution events, proposal history, goal decomposition demand signals,
 * and historical keep/revert rates from the IntelligenceReport (P5.3).
 *
 * Pure compute — no I/O, no mutations, no stores.
 *
 * @module
 */

import type { CapabilityHealth, LifecycleState } from "./capability-evolution-types.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type TrendDirection = "rising" | "falling" | "stable";

/** Flattened shape that the analyzer accepts — mirrors the deep IntelligenceReport buckets. */
interface IntelligenceReportInput {
  buckets: {
    byCapability: {
      buckets: Array<{
        value: string;
        keepRate?: number;
        advisoryRevertRate?: number;
        actualRevertRate?: number;
      }>;
    };
  };
}

interface AgentCardInput {
  capabilities: string[];
  id: string;
}

interface ProposalInput {
  target: { kind: string; capability?: string };
  payload?: { capability?: string };
  createdAt: string;
}

interface CapabilityEventInput {
  payload: { capability: string; resolvedAgent?: string };
  timestamp: string;
}

interface GoalEventInput {
  payload: { capabilities?: string[] };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const RECENT_DAYS = 30;
const PRIOR_END_DAYS = 60;
const TREND_THRESHOLD = 0.2; // 20 % of total

// ---------------------------------------------------------------------------
// Trend helper
// ---------------------------------------------------------------------------

/**
 * Compute trend direction by comparing recent-vs-prior delta against a
 * 20 % threshold of the all-time total.  When total is 0 the diff is
 * necessarily 0 → always "stable".
 */
function computeTrend(recent: number, prior: number, total: number): TrendDirection {
  const diff = recent - prior;
  const threshold = total * TREND_THRESHOLD;
  if (diff > threshold) return "rising";
  if (diff < -threshold) return "falling";
  return "stable";
}

// ---------------------------------------------------------------------------
// Lifecycle classifier
// ---------------------------------------------------------------------------

interface LifecycleParams {
  resolutionCount: number;
  agentCount: number;
  resolutionTrend: TrendDirection;
  proposalTrend: TrendDirection;
  keepRate: number | null;
  revertRate: number | null;
  proposalCount: number;
}

/**
 * Determine lifecycle state using a first-match cascade.  The order matches
 * the specification exactly; note that rule 5 (stagnant with falling proposal
 * trend) can never fire because rule 2 already catches falling proposal
 * trend as `declining`.
 */
function determineLifecycle(p: LifecycleParams): LifecycleState {
  // 1. No resolutions or no agents → deprecated
  if (p.resolutionCount === 0 || p.agentCount === 0) return "deprecated";

  // 2. Any negative signal → declining
  if (
    p.resolutionTrend === "falling" ||
    (p.keepRate !== null && p.keepRate < 0.5) ||
    (p.revertRate !== null && p.revertRate > 0.2) ||
    p.proposalTrend === "falling"
  ) {
    return "declining";
  }

  // 3. Established, stable, high volume → mature
  if (
    p.resolutionCount >= 50 &&
    (p.keepRate === null || p.keepRate >= 0.75) &&
    (p.revertRate === null || p.revertRate < 0.1) &&
    p.proposalCount >= 20 &&
    p.resolutionTrend === "stable" &&
    p.proposalTrend === "stable"
  ) {
    return "mature";
  }

  // 4. Regular usage with acceptable metrics → active
  //    Widen trend to string for the "falling" checks since rule 2 already
  //    excludes falling at compile time, but the check is kept for spec
  //    clarity and resilience against future rule reordering.
  const resTrendAny: string = p.resolutionTrend;
  const propTrendAny: string = p.proposalTrend;
  if (
    p.resolutionCount >= 10 &&
    (p.keepRate === null || p.keepRate >= 0.6) &&
    (p.revertRate === null || p.revertRate < 0.15) &&
    p.proposalCount >= 5 &&
    resTrendAny !== "falling" &&
    propTrendAny !== "falling"
  ) {
    return "active";
  }

  // 5. Stable resolution but falling proposals → stagnant
  //    (Note: proposalTrend === "falling" already caught by rule 2,
  //     so this rule only activates if rule 2 was bypassed — practically
  //     unreachable, but preserved for spec compliance.)
  if (p.resolutionTrend === "stable" && propTrendAny === "falling") {
    return "stagnant";
  }

  // 6. Has resolutions but very few proposals → emerging
  if (p.resolutionCount > 0 && p.proposalCount < 5) return "emerging";

  // 7. Default
  return "stagnant";
}

// ---------------------------------------------------------------------------
// Rationale builder
// ---------------------------------------------------------------------------

function buildRationale(params: {
  resolutionCount: number;
  agentCount: number;
  keepRate: number | null;
  revertRate: number | null;
  resolutionTrend: TrendDirection;
  proposalTrend: TrendDirection;
  lifecycleState: LifecycleState;
  proposalCount: number;
}): string {
  const parts: string[] = [];
  parts.push(`${params.resolutionCount} resolutions`);
  parts.push(`${params.agentCount} agents`);
  if (params.proposalCount > 0) parts.push(`${params.proposalCount} proposals`);
  else parts.push("no proposals");

  if (params.keepRate !== null) {
    parts.push(`keep rate ${formatRate(params.keepRate)}`);
  }
  if (params.revertRate !== null) {
    parts.push(`revert rate ${formatRate(params.revertRate)}`);
  }

  parts.push(`resolution trend ${params.resolutionTrend}`);

  if (params.proposalCount > 0) {
    parts.push(`proposal trend ${params.proposalTrend}`);
  }

  return parts.join(", ") + ` → ${params.lifecycleState}`;
}

function formatRate(rate: number): string {
  return rate.toFixed(2);
}

// ---------------------------------------------------------------------------
// CapabilityHealthAnalyzer
// ---------------------------------------------------------------------------

export class CapabilityHealthAnalyzer {
  /**
   * Analyze capability health across all registered agents, resolution
   * events, proposals, and optional intelligence/goal data.
   *
   * @returns One {@link CapabilityHealth} entry per unique capability found
   *          in agent cards.
   */
  analyze(params: {
    /** All registered agent cards with their capabilities arrays. */
    agentCards: AgentCardInput[];
    /** IntelligenceReport from P5.3 (may be null). */
    intelligenceReport: IntelligenceReportInput | null;
    /** All proposals (to count per-capability). */
    proposals: ProposalInput[];
    /** capability_routed evidence events. */
    capabilityEvents: CapabilityEventInput[];
    /** goal decomposition events (optional demand signal). */
    goalEvents?: GoalEventInput[];
  }): CapabilityHealth[] {
    const now = Date.now();
    const recentCutoff = now - RECENT_DAYS * MS_PER_DAY;
    const priorStartCutoff = now - PRIOR_END_DAYS * MS_PER_DAY;

    // ------------------------------------------------------------------
    // 1. Extract unique capability names from agent cards
    // ------------------------------------------------------------------
    const capabilitySet = new Set<string>();
    for (const card of params.agentCards) {
      for (const cap of card.capabilities) {
        capabilitySet.add(cap);
      }
    }

    const capabilities = [...capabilitySet];
    if (capabilities.length === 0) return [];

    // ------------------------------------------------------------------
    // Build lookup indices
    // ------------------------------------------------------------------

    // ---- IntelligenceReport by-capability buckets ----
    const bucketMap = new Map<
      string,
      { keepRate?: number; advisoryRevertRate?: number; actualRevertRate?: number }
    >();
    if (params.intelligenceReport?.buckets?.byCapability?.buckets) {
      for (const bucket of params.intelligenceReport.buckets.byCapability.buckets) {
        bucketMap.set(bucket.value, bucket);
      }
    }

    // ---- Resolution events indexed by capability ----
    const eventsByCap = new Map<string, CapabilityEventInput[]>();
    for (const event of params.capabilityEvents) {
      const cap = event.payload.capability;
      if (!eventsByCap.has(cap)) eventsByCap.set(cap, []);
      eventsByCap.get(cap)!.push(event);
    }

    // ---- Proposals indexed by capability ----
    const proposalsByCap = new Map<string, ProposalInput[]>();
    for (const prop of params.proposals) {
      const cap =
        prop.target.kind === "capability" && prop.target.capability
          ? prop.target.capability
          : prop.payload?.capability;
      if (cap) {
        if (!proposalsByCap.has(cap)) proposalsByCap.set(cap, []);
        proposalsByCap.get(cap)!.push(prop);
      }
    }

    // ---- Goal event demand (per-capability counts) ----
    const goalDemandByCap = new Map<string, number>();
    if (params.goalEvents) {
      for (const event of params.goalEvents) {
        const caps = event.payload.capabilities ?? [];
        for (const cap of caps) {
          goalDemandByCap.set(cap, (goalDemandByCap.get(cap) ?? 0) + 1);
        }
      }
    }

    // ---- Agent counts per capability ----
    const agentCountByCap = new Map<string, number>();
    for (const card of params.agentCards) {
      for (const cap of card.capabilities) {
        agentCountByCap.set(cap, (agentCountByCap.get(cap) ?? 0) + 1);
      }
    }

    // ------------------------------------------------------------------
    // Compute raw demand (unresolved events + goal events)
    // ------------------------------------------------------------------
    const rawDemandByCap = new Map<string, number>();
    for (const cap of capabilities) {
      const goalCount = goalDemandByCap.get(cap) ?? 0;
      const unresolvedCount = (eventsByCap.get(cap) ?? []).filter(
        (e) => !e.payload.resolvedAgent,
      ).length;
      rawDemandByCap.set(cap, goalCount + unresolvedCount);
    }

    // Min-max normalization range
    const demands = [...rawDemandByCap.values()];
    const minDemand = demands.length > 0 ? Math.min(...demands) : 0;
    const maxDemand = demands.length > 0 ? Math.max(...demands) : 0;
    const demandRange = maxDemand - minDemand;

    // ------------------------------------------------------------------
    // 2. Analyze each capability
    // ------------------------------------------------------------------
    const results: CapabilityHealth[] = [];

    for (const cap of capabilities) {
      const agentCount = agentCountByCap.get(cap) ?? 0;

      // -- Resolution counts --
      const events = eventsByCap.get(cap) ?? [];
      const resolutionCount = events.length;
      let resolutionCountRecent = 0;
      let resolutionCountPrior = 0;
      for (const event of events) {
        const ts = new Date(event.timestamp).getTime();
        if (ts >= recentCutoff) {
          resolutionCountRecent++;
        } else if (ts >= priorStartCutoff && ts < recentCutoff) {
          resolutionCountPrior++;
        }
      }

      // -- Proposal counts --
      const props = proposalsByCap.get(cap) ?? [];
      const proposalCount = props.length;
      let proposalCountRecent = 0;
      let proposalCountPrior = 0;
      for (const prop of props) {
        const ts = new Date(prop.createdAt).getTime();
        if (ts >= recentCutoff) {
          proposalCountRecent++;
        } else if (ts >= priorStartCutoff && ts < recentCutoff) {
          proposalCountPrior++;
        }
      }

      // -- Demand score (0-1 min-max normalized) --
      const rawDemand = rawDemandByCap.get(cap) ?? 0;
      const demandScore =
        demandRange > 0 ? (rawDemand - minDemand) / demandRange : 0;

      // -- keepRate / revertRate from IntelligenceReport --
      const bucket = bucketMap.get(cap);
      const keepRate: number | null = bucket?.keepRate ?? null;
      const hasRevertData =
        bucket?.advisoryRevertRate !== undefined ||
        bucket?.actualRevertRate !== undefined;
      const revertRate: number | null =
        bucket && hasRevertData
          ? Math.max(bucket.advisoryRevertRate ?? 0, bucket.actualRevertRate ?? 0)
          : null;

      // -- Trends --
      const resolutionTrend = computeTrend(
        resolutionCountRecent,
        resolutionCountPrior,
        resolutionCount,
      );
      const proposalTrend = computeTrend(
        proposalCountRecent,
        proposalCountPrior,
        proposalCount,
      );

      // -- Lifecycle state --
      const lifecycleState = determineLifecycle({
        resolutionCount,
        agentCount,
        resolutionTrend,
        proposalTrend,
        keepRate,
        revertRate,
        proposalCount,
      });

      // -- Rationale --
      const rationale = buildRationale({
        resolutionCount,
        agentCount,
        keepRate,
        revertRate,
        resolutionTrend,
        proposalTrend,
        lifecycleState,
        proposalCount,
      });

      results.push({
        capability: cap,
        agentCount,
        resolutionCount,
        resolutionCountRecent,
        resolutionCountPrior,
        proposalCountRecent,
        proposalCountPrior,
        demandScore,
        keepRate,
        revertRate,
        proposalCount,
        lifecycleState,
        rationale,
      });
    }

    return results;
  }
}
