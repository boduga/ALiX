/**
 * P5.0d — CapabilityAnalyzer: detects capability gaps from routing evidence.
 *
 * Queries `capability_routed` events from the EvidenceStore (targeted query by
 * type, not full scan), groups records by the `capability` payload field,
 * identifies capabilities with candidates === 0 (unresolved), and generates
 * gap observations for those requested >= 2 times.
 *
 * Severity:
 *   - high   when the capability was requested >= 5 times with zero candidates
 *   - medium when the capability was requested >= 2 times with zero candidates
 *
 * Recommendations have confidence = min(0.5 + count * 0.1, 0.95).
 *
 * @module
 */

import type { Analyzer, AnalysisResult, Observation, Recommendation } from "./reflection-types.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum request count before a gap observation is emitted. */
const MIN_GAP_THRESHOLD = 2;

/** Request count at which severity escalates from medium to high. */
const HIGH_SEVERITY_THRESHOLD = 5;

/** Maximum number of records to scan for capability_routed events. */
const QUERY_LIMIT = 5000;

/** Base confidence before per-count scaling. */
const BASE_CONFIDENCE = 0.5;

/** Confidence increment per request count. */
const CONFIDENCE_INCREMENT = 0.1;

/** Maximum confidence value. */
const MAX_CONFIDENCE = 0.95;

// ---------------------------------------------------------------------------
// CapabilityAnalyzer
// ---------------------------------------------------------------------------

export class CapabilityAnalyzer implements Analyzer {
  readonly name = "CapabilityAnalyzer";

  private readonly store: EvidenceStore;

  constructor(store: EvidenceStore) {
    this.store = store;
  }

  /**
   * Analyze capability_routed evidence for unresolved capabilities.
   *
   * A capability is considered unresolved when at least one routing event
   * for it had zero candidates.  The total request count (across all
   * events for that capability, resolved or not) determines severity and
   * recommendation confidence.
   */
  async analyze(): Promise<AnalysisResult> {
    const routed = await this.store.query({
      type: "capability_routed",
      limit: QUERY_LIMIT,
    });

    const observations: Observation[] = [];
    const recommendations: Recommendation[] = [];

    if (routed.records.length === 0) {
      return { observations, recommendations };
    }

    // Group by capability, track total requests and zero-candidate sets
    const requestCounts = new Map<string, number>();
    const zeroCandidateCaps = new Set<string>();

    for (const record of routed.records) {
      const cap = this.coerceCapability(record.payload);
      if (cap === undefined) continue;

      requestCounts.set(cap, (requestCounts.get(cap) ?? 0) + 1);

      const candidates = this.coerceCandidates(record.payload);
      if (candidates === 0) {
        zeroCandidateCaps.add(cap);
      }
    }

    // Generate observations and recommendations for unresolved gaps
    for (const cap of zeroCandidateCaps) {
      const count = requestCounts.get(cap) ?? 0;
      if (count < MIN_GAP_THRESHOLD) continue;

      const severity: Observation["severity"] =
        count >= HIGH_SEVERITY_THRESHOLD ? "high" : "medium";

      observations.push({
        type: "capability_gap",
        severity,
        title: `"${cap}" requested ${count} times with zero candidates`,
        detail: `No agent could handle capability "${cap}". Consider adding a registry entry or training data.`,
        source: this.name,
        count,
      });

      recommendations.push({
        type: "capability_gap",
        confidence: this.computeConfidence(count),
        title: `Address capability gap for "${cap}"`,
        evidence: [`"${cap}" requested ${count} times with zero candidates`],
        recommendedAction: `Register an agent for "${cap}" or add the capability to the routing table.`,
      });
    }

    return { observations, recommendations };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Safely extract the capability name from a payload record.
   * Returns undefined if the field is missing or not a non-empty string.
   */
  private coerceCapability(payload: Record<string, unknown>): string | undefined {
    const value = payload["capability"];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    return undefined;
  }

  /**
   * Safely extract the candidates count from a payload record.
   * Returns -1 if missing/malformed so callers can distinguish from a
   * genuine zero.
   */
  private coerceCandidates(payload: Record<string, unknown>): number {
    const value = payload["candidates"];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return -1;
  }

  /**
   * Compute recommendation confidence from request count.
   * Follows the formula: min(0.5 + count * 0.1, 0.95).
   */
  private computeConfidence(count: number): number {
    return Math.min(BASE_CONFIDENCE + count * CONFIDENCE_INCREMENT, MAX_CONFIDENCE);
  }
}
