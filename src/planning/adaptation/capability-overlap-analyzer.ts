/**
 * P5.5.4 — CapabilityOverlapAnalyzer.
 *
 * Detects pairwise overlap between registered capabilities — which capabilities
 * are so similar they should be consolidation candidates.
 *
 * For every unordered pair of distinct capabilities (A, B), computes a
 * symmetric overlap score from three signals: shared agents, shared proposals,
 * and shared resolution patterns.  Also computes directional coverage to show
 * whether one capability subsumes the other.
 *
 * Pure compute — no I/O, no mutations, no stores.
 *
 * @module
 */

import type { CapabilityOverlap } from "./capability-evolution-types.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

interface AgentCardInput {
  id: string;
  capabilities: string[];
}

interface ProposalInput {
  target: { kind: string; capability?: string };
  payload?: Record<string, unknown>;
}

interface CapabilityEventInput {
  payload: { capability?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the set of capabilities referenced by a single proposal.
 * Matches via target.capability (when target.kind === "capability") and
 * via payload.capability.
 */
function proposalCapabilitySet(p: ProposalInput): Set<string> {
  const caps = new Set<string>();
  if (p.target.kind === "capability" && p.target.capability) {
    caps.add(p.target.capability);
  }
  if (p.payload?.capability && typeof p.payload.capability === "string") {
    caps.add(p.payload.capability);
  }
  return caps;
}

/**
 * Conservative estimate of shared resolution events.
 *
 * Because capability_routed events carry only one capability each, we cannot
 * directly observe when two capabilities are resolved together.  We estimate
 * overlapping resolution as `min(countA, countB) * 0.2` divided by the total
 * event count.  This is intentionally conservative for v1.
 */
function computeSharedResolutionPattern(
  countA: number,
  countB: number,
): number {
  const total = countA + countB;
  if (total === 0) return 0;
  return (Math.min(countA, countB) * 0.2) / total;
}

// ---------------------------------------------------------------------------
// CapabilityOverlapAnalyzer
// ---------------------------------------------------------------------------

export class CapabilityOverlapAnalyzer {
  /**
   * Analyze pairwise overlap across all registered capabilities.
   *
   * @returns One {@link CapabilityOverlap} per pair whose overlapScore
   *          meets or exceeds `minOverlapScore` (default 0.3).
   */
  analyze(params: {
    /** All registered capability names. */
    registeredCapabilities: string[];
    /** Agent cards with their capabilities arrays. */
    agentCards: AgentCardInput[];
    /** All proposals (to check which reference both capabilities). */
    proposals: ProposalInput[];
    /** capability_routed events. */
    capabilityEvents?: CapabilityEventInput[];
    /** Minimum overlap score to include (default 0.3). */
    minOverlapScore?: number;
  }): CapabilityOverlap[] {
    const minScore = params.minOverlapScore ?? 0.3;
    const caps = params.registeredCapabilities;

    // Need at least 2 capabilities to form a pair
    if (caps.length < 2) return [];

    // No agent cards → no overlap possible
    if (params.agentCards.length === 0) return [];

    // ------------------------------------------------------------------
    // Build per-agent capability sets
    // ------------------------------------------------------------------
    const agentCapSets = params.agentCards.map(
      (card) => new Set(card.capabilities),
    );

    // ------------------------------------------------------------------
    // Build per-proposal capability sets
    // ------------------------------------------------------------------
    const proposalCapSets = params.proposals.map(proposalCapabilitySet);

    // ------------------------------------------------------------------
    // Count capability events per capability name
    // ------------------------------------------------------------------
    const eventCounts = new Map<string, number>();
    if (params.capabilityEvents) {
      for (const event of params.capabilityEvents) {
        const cap = event.payload.capability;
        if (cap) {
          eventCounts.set(cap, (eventCounts.get(cap) ?? 0) + 1);
        }
      }
    }

    // ------------------------------------------------------------------
    // Analyze each unordered pair
    // ------------------------------------------------------------------
    const results: CapabilityOverlap[] = [];

    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        const A = caps[i];
        const B = caps[j];

        // ----------------------------------------------------------------
        // 1. sharedAgentProportion
        // ----------------------------------------------------------------
        let agentsWithBoth = 0;
        let agentsWithAtLeastOne = 0;
        let agentsWithA = 0;
        let agentsWithB = 0;

        for (const capSet of agentCapSets) {
          const hasA = capSet.has(A);
          const hasB = capSet.has(B);
          if (hasA && hasB) agentsWithBoth++;
          if (hasA || hasB) agentsWithAtLeastOne++;
          if (hasA) agentsWithA++;
          if (hasB) agentsWithB++;
        }

        const sharedAgentProportion =
          agentsWithAtLeastOne > 0
            ? agentsWithBoth / agentsWithAtLeastOne
            : 0;

        // ----------------------------------------------------------------
        // 2. sharedProposalProportion
        // ----------------------------------------------------------------
        let proposalsWithAtLeastOne = 0;
        let proposalsWithBoth = 0;

        for (const capSet of proposalCapSets) {
          if (capSet.size === 0) continue;
          const hasA = capSet.has(A);
          const hasB = capSet.has(B);
          if (hasA || hasB) proposalsWithAtLeastOne++;
          if (hasA && hasB) proposalsWithBoth++;
        }

        const sharedProposalProportion =
          proposalsWithAtLeastOne > 0
            ? proposalsWithBoth / proposalsWithAtLeastOne
            : 0;

        // ----------------------------------------------------------------
        // 3. sharedResolutionPattern
        // ----------------------------------------------------------------
        const sharedResolutionPattern = params.capabilityEvents
          ? computeSharedResolutionPattern(
              eventCounts.get(A) ?? 0,
              eventCounts.get(B) ?? 0,
            )
          : 0;

        // ----------------------------------------------------------------
        // 4. overlapScore (weighted)
        // ----------------------------------------------------------------
        const overlapScore =
          0.4 * sharedAgentProportion +
          0.3 * sharedProposalProportion +
          0.3 * sharedResolutionPattern;

        if (overlapScore < minScore) continue;

        // ----------------------------------------------------------------
        // 5. Directional coverage
        // ----------------------------------------------------------------
        const coverageAtoB =
          agentsWithA > 0 ? agentsWithBoth / agentsWithA : 0;
        const coverageBtoA =
          agentsWithB > 0 ? agentsWithBoth / agentsWithB : 0;
        const asymmetry = coverageAtoB - coverageBtoA;

        // ----------------------------------------------------------------
        // 6. consolidationCandidate
        // ----------------------------------------------------------------
        const consolidationCandidate = overlapScore > 0.7;

        // ----------------------------------------------------------------
        // 7. sharedSignalCount (0-3)
        // ----------------------------------------------------------------
        let sharedSignalCount = 0;
        if (sharedAgentProportion > 0) sharedSignalCount++;
        if (sharedProposalProportion > 0) sharedSignalCount++;
        if (sharedResolutionPattern > 0) sharedSignalCount++;

        results.push({
          capabilityA: A,
          capabilityB: B,
          overlapScore,
          coverageAtoB,
          coverageBtoA,
          asymmetry,
          sharedSignalCount,
          consolidationCandidate,
        });
      }
    }

    return results;
  }
}
