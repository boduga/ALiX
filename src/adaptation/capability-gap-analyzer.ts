/**
 * P5.5.3 — CapabilityGapAnalyzer.
 *
 * Detects missing capabilities — recurring needs that no registered
 * capability satisfies.  Combines three independent signal types:
 *
 *   1. Unresolved capability_routed events (no resolvedAgent, or candidates===0).
 *   2. Proposals targeting non-existent capabilities.
 *   3. Reflection events reporting capability gaps.
 *
 * Pure compute — no I/O, no mutations, no stores.
 *
 * @module
 */

import type { CapabilityGap } from "./capability-evolution-types.js";

// ---------------------------------------------------------------------------
// Input type aliases (matching the spec)
// ---------------------------------------------------------------------------

interface CapabilityEventInput {
  payload: {
    capability?: string;
    resolvedAgent?: string;
    candidates?: number;
  };
  timestamp: string;
}

interface ProposalInput {
  target: { kind: string; capability?: string };
  payload?: Record<string, unknown>;
  reason?: string;
}

interface ReflectionEventInput {
  payload: {
    recommendationType?: string;
    details?: string;
    capability?: string;
  };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export class CapabilityGapAnalyzer {
  /**
   * Analyze capability events, proposals, and reflection events to
   * discover capability gaps.
   *
   * @returns One {@link CapabilityGap} per unique missing capability,
   *          filtered by `minSignalStrength`.
   */
  analyze(params: {
    /** All registered capability names. */
    registeredCapabilities: string[];
    /** capability_routed evidence events. */
    capabilityEvents: CapabilityEventInput[];
    /** All proposals. */
    proposals: ProposalInput[];
    /** Reflection evidence events mentioning missing capabilities. */
    reflectionEvents?: ReflectionEventInput[];
    /** Minimum signal strength to include (default 1). */
    minSignalStrength?: number;
  }): CapabilityGap[] {
    const minStrength = params.minSignalStrength ?? 1;
    const registered = new Set(params.registeredCapabilities);

    // Per-capability gap accumulator:
    //   s1 = unresolved event count
    //   s2 = proposal count targeting non-existent cap
    //   s3 = reflection gap mention count
    const gapMap = new Map<
      string,
      { s1: number; s2: number; s3: number }
    >();

    function ensure(cap: string) {
      if (!gapMap.has(cap)) {
        gapMap.set(cap, { s1: 0, s2: 0, s3: 0 });
      }
      return gapMap.get(cap)!;
    }

    // ------------------------------------------------------------------
    // Signal 1 — Unresolved capability_routed events
    // ------------------------------------------------------------------

    for (const event of params.capabilityEvents) {
      const cap = event.payload.capability;
      if (!cap) continue;

      const isUnresolved =
        !event.payload.resolvedAgent || event.payload.candidates === 0;
      if (!isUnresolved) continue;

      ensure(cap).s1++;
    }

    // ------------------------------------------------------------------
    // Signal 2 — Proposals targeting non-existent capabilities
    // ------------------------------------------------------------------

    for (const proposal of params.proposals) {
      if (proposal.target.kind !== "capability") continue;
      const cap = proposal.target.capability;
      if (!cap) continue;
      if (registered.has(cap)) continue;

      ensure(cap).s2++;
    }

    // ------------------------------------------------------------------
    // Signal 3 — Reflection gap mentions
    // ------------------------------------------------------------------

    if (params.reflectionEvents) {
      for (const event of params.reflectionEvents) {
        // Case A: explicit capability_gap recommendation
        if (event.payload.recommendationType === "capability_gap") {
          const cap = event.payload.capability;
          if (cap) {
            ensure(cap).s3++;
            continue;
          }
          // If no explicit capability, skip — can't attribute to a specific gap
        }

        // Case B: payload mentions a missing capability
        const cap = event.payload.capability;
        if (cap && !registered.has(cap)) {
          ensure(cap).s3++;
        }
      }
    }

    // ------------------------------------------------------------------
    // Assemble gaps
    // ------------------------------------------------------------------

    const gaps: CapabilityGap[] = [];

    for (const [cap, counts] of gapMap) {
      const evidence: string[] = [];
      let signalStrength = 0;

      if (counts.s1 > 0) {
        evidence.push(
          `${counts.s1} unresolved capability_routed event${counts.s1 === 1 ? "" : "s"}`,
        );
        signalStrength++;
      }

      if (counts.s2 > 0) {
        evidence.push(
          `${counts.s2} proposal${counts.s2 === 1 ? "" : "s"} targeting non-existent capability`,
        );
        signalStrength++;
      }

      if (counts.s3 > 0) {
        evidence.push(
          `${counts.s3} reflection gap mention${counts.s3 === 1 ? "" : "s"}`,
        );
        signalStrength++;
      }

      if (signalStrength < minStrength) continue;

      gaps.push({
        suggestedCapability: cap,
        evidence,
        signalStrength,
        confidence:
          signalStrength === 3
            ? "high"
            : signalStrength === 2
              ? "medium"
              : "low",
      });
    }

    return gaps;
  }
}
