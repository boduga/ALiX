/**
 * P5.5.6 — CapabilityEvolutionReporter: orchestrates the P5.5 analysis pipeline.
 *
 * Loads agent cards, proposals, and intelligence data; delegates to the four
 * capability analyzers; assembles and persists the CapabilityEvolutionReport.
 *
 * Pure orchestration — no mutations, no evidence writes, no proposal creation.
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CapabilityHealthAnalyzer } from "./capability-health-analyzer.js";
import { CapabilityGapAnalyzer } from "./capability-gap-analyzer.js";
import { CapabilityOverlapAnalyzer } from "./capability-overlap-analyzer.js";
import { CapabilityDriftAnalyzer } from "./capability-drift-analyzer.js";
import { CapabilityEvolutionStore } from "./capability-evolution-store.js";
import type { CapabilityEvolutionReport, LifecycleState } from "./capability-evolution-types.js";
import type { AdaptationProposal } from "./adaptation-types.js";
import type { IntelligenceReport } from "./intelligence-types.js";
import type { EvidenceRecord } from "../security/evidence/evidence-types.js";
import type { ReflectionReport } from "../reflection/reflection-types.js";

// ---------------------------------------------------------------------------
// Minimal agent card shape
// ---------------------------------------------------------------------------

export interface AgentCardEntry {
  id: string;
  capabilities: string[];
  description?: string;
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

export class CapabilityEvolutionReporter {
  constructor(
    private readonly cardsDir: string,
    private readonly intelligenceStore: { loadLatest(): Promise<IntelligenceReport | null> },
    private readonly proposalStore: { list(status?: string): Promise<AdaptationProposal[]> },
    private readonly evidenceStore: { query(q: { type?: string; limit?: number }): Promise<{ records: EvidenceRecord[] }> },
    private readonly store: CapabilityEvolutionStore,
    private readonly reflectionDir?: string,
  ) {}

  async generateReport(): Promise<CapabilityEvolutionReport> {
    const generatedAt = new Date().toISOString();

    // 1. Load agent cards
    const agentCards = this.#loadAgentCards();

    // 2. Load IntelligenceReport (may be null)
    const intelligenceReport = await this.intelligenceStore.loadLatest();

    // 3. Load applied proposals only — pending/rejected/failed proposals
    //    would contaminate health metrics and pattern detection.
    const allProposals = await this.proposalStore.list("applied");

    // 4. Load evidence events (with explicit large limit to avoid silent truncation)
    const [capabilityEvents, rawReflectionEvents] = await Promise.all([
      this.evidenceStore.query({ type: "capability_routed", limit: 10000 }),
      this.evidenceStore.query({ type: "reflection_report", limit: 10000 }) as Promise<{ records: EvidenceRecord[] }>,
    ]);

    // 5a. Also load reflection report files from disk for richer gap detection
    const reflectionFileEvents = this.#loadReflectionEvents();
    const reflectionEvents: { payload: { recommendationType?: string; details?: string; capability?: string }; timestamp: string }[] = [
      ...(rawReflectionEvents?.records ?? []).map((r) => ({
        payload: r.payload as { recommendationType?: string; details?: string; capability?: string },
        timestamp: r.timestamp,
      })),
      ...reflectionFileEvents,
    ];

    // 5. Extract all unique registered capabilities from all agent cards
    const registeredCapabilities = [
      ...new Set(agentCards.flatMap((c) => c.capabilities)),
    ].sort();

    // 6. Run health analyzer
    const healthAnalyzer = new CapabilityHealthAnalyzer();
    const healthAnalysis = healthAnalyzer.analyze({
      agentCards,
      intelligenceReport,
      proposals: allProposals,
      capabilityEvents: capabilityEvents.records as never,
    });

    // 7. Run gap analyzer
    const gapAnalyzer = new CapabilityGapAnalyzer();
    const gapAnalysis = gapAnalyzer.analyze({
      registeredCapabilities,
      capabilityEvents: (capabilityEvents.records ?? []) as never,
      proposals: allProposals,
      reflectionEvents,
    });

    // 8. Run overlap analyzer
    const overlapAnalyzer = new CapabilityOverlapAnalyzer();
    const overlapAnalysis = overlapAnalyzer.analyze({
      registeredCapabilities,
      agentCards,
      proposals: allProposals,
      capabilityEvents: (capabilityEvents.records ?? []) as never,
    });

    // 9. Run drift analyzer
    const driftAnalyzer = new CapabilityDriftAnalyzer();
    const driftAnalysis = driftAnalyzer.analyze({
      registeredCapabilities,
      agentCards,
      proposals: allProposals,
    });

    // 10. Compute lifecycle distribution
    const lifecycleDistribution = this.#computeDistribution(healthAnalysis.map((h) => h.lifecycleState));

    // 11. Generate executive summary
    const executiveSummary = this.#buildExecutiveSummary(
      healthAnalysis,
      gapAnalysis,
      overlapAnalysis,
      driftAnalysis,
    );

    // 12. Assemble report
    const report: CapabilityEvolutionReport = {
      generatedAt,
      totalCapabilities: registeredCapabilities.length,
      healthAnalysis,
      gapAnalysis,
      overlapAnalysis,
      driftAnalysis,
      lifecycleDistribution,
      executiveSummary,
    };

    // 13. Persist
    await this.store.save(report);

    return report;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Load reflection report files from the reflection directory and extract
   * capability gap recommendations as reflection events.
   *
   * This enables the gap analyzer's Signal 3 (reflection gap mentions)
   * from reflection report files on disk, complementing any reflection
   * records that may exist in the evidence store.
   *
   * Recommendation titles from CapabilityAnalyzer follow known patterns:
   *   `"${cap}" requested ${count} times with zero candidates`
   *   `Address capability gap for "${cap}"`
   * We extract the capability name from these patterns.
   */
  #loadReflectionEvents(): { payload: { recommendationType?: string; details?: string; capability?: string }; timestamp: string }[] {
    if (!this.reflectionDir) return [];
    try {
      if (!existsSync(this.reflectionDir)) return [];
      const files = readdirSync(this.reflectionDir).filter((f) => f.endsWith(".json"));
      const events: { payload: { recommendationType?: string; details?: string; capability?: string }; timestamp: string }[] = [];

      // Regex to extract a quoted capability name from recommendation titles
      const capRegex = /"([^"]+)"/;

      for (const file of files) {
        try {
          const raw = JSON.parse(readFileSync(join(this.reflectionDir, file), "utf-8"));
          const report = raw as Partial<ReflectionReport>;
          const timestamp = (raw as { generatedAt?: string }).generatedAt ?? new Date().toISOString();

          // Extract capability_gap recommendations as reflection events
          if (report.recommendations) {
            for (const rec of report.recommendations) {
              if (rec.type !== "capability_gap") continue;

              // Extract capability name from title pattern:
              // "Address capability gap for "cap"" or ""cap" requested..."
              const match = rec.title.match(capRegex);
              const capability = match ? match[1] : undefined;
              if (!capability) continue;

              events.push({
                payload: {
                  recommendationType: "capability_gap",
                  capability,
                  details: rec.evidence?.join("; ") ?? rec.recommendedAction,
                },
                timestamp,
              });
            }
          }
        } catch {
          // Skip unparseable files — best-effort loading
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  /** Load all agent card JSON files from the cards directory. */
  #loadAgentCards(): AgentCardEntry[] {
    try {
      if (!existsSync(this.cardsDir)) return [];
      return readdirSync(this.cardsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(this.cardsDir, f), "utf-8")) as AgentCardEntry;
          } catch {
            return null;
          }
        })
        .filter((c): c is AgentCardEntry => c !== null);
    } catch {
      return [];
    }
  }

  /** Compute count of capabilities per lifecycle state. */
  #computeDistribution(states: LifecycleState[]): Record<LifecycleState, number> {
    const all: LifecycleState[] = ["emerging", "active", "mature", "stagnant", "declining", "deprecated"];
    const dist = Object.fromEntries(all.map((s) => [s, 0])) as Record<LifecycleState, number>;
    for (const s of states) {
      dist[s] = (dist[s] ?? 0) + 1;
    }
    return dist;
  }

  /** Build the executive summary. */
  #buildExecutiveSummary(
    health: { capability: string; lifecycleState: LifecycleState }[],
    gaps: { suggestedCapability: string; signalStrength: number }[],
    overlaps: { consolidationCandidate: boolean }[],
    drifts: { splitCandidate: boolean }[],
  ): string {
    const total = health.length;
    if (total === 0) {
      return "No capabilities registered. The system has no capability model to evaluate.";
    }

    const lines: string[] = [];
    const declining = health.filter((h) => h.lifecycleState === "declining").length;
    const emerging = health.filter((h) => h.lifecycleState === "emerging").length;
    const stagnant = health.filter((h) => h.lifecycleState === "stagnant").length;
    const deprecated = health.filter((h) => h.lifecycleState === "deprecated").length;
    const strongGaps = gaps.filter((g) => g.signalStrength >= 2).length;
    const consolidationCandidates = overlaps.filter((o) => o.consolidationCandidate).length;
    const splitCandidates = drifts.filter((d) => d.splitCandidate).length;

    lines.push(`${total} capabilities registered across ${new Set(health.map((h) => h.capability)).size} capability names.`);

    if (declining > 0) lines.push(`${declining} in declining state — review recommended.`);
    if (stagnant > 0) lines.push(`${stagnant} in stagnant state — idle, not trending down.`);
    if (deprecated > 0) lines.push(`${deprecated} in deprecated state — no registered agents or usage.`);
    if (emerging > 0) lines.push(`${emerging} emerging capabilities with limited data.`);

    if (strongGaps > 0) lines.push(`${strongGaps} strong gap signal(s) detected — unresolved capability needs exist.`);
    if (consolidationCandidates > 0) lines.push(`${consolidationCandidates} overlap pair(s) flagged as consolidation candidates.`);
    if (splitCandidates > 0) lines.push(`${splitCandidates} drift candidate(s) flagged as split candidates.`);

    return lines.join("\n");
  }
}

