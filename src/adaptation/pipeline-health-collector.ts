/**
 * P6.6a — PipelineHealthCollector: I/O for health reports.
 *
 * Reads all P6 stores and builds the PipelineHealthInput consumed
 * by PipelineHealthBuilder. All I/O happens here — the builder stays pure.
 *
 * No writes. No new evidence events. Read-only.
 *
 * @module
 */

import type { PipelineHealthInput, ScopedProposalData } from "./pipeline-health-types.js";
import type { ProposalStore } from "./proposal-store.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import type { EffectivenessStore } from "./effectiveness-store.js";
import type { IntelligenceStore } from "./intelligence-store.js";
import type { DecisionContextBuilder } from "./decision-context-builder.js";
import { RiskScoreBuilder } from "./risk-score-builder.js";
import { RecommendationEngine } from "./recommendation-engine.js";
import { StrategicBriefBuilder } from "./strategic-brief.js";
import type { StrategicBriefOptions } from "./strategic-brief-types.js";

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export interface HealthCollectorInfrastructure {
  proposalStore: ProposalStore;
  evidenceStore: EvidenceStore;
  effectivenessStore: EffectivenessStore;
  intelligenceStore: IntelligenceStore;
  contextBuilder: DecisionContextBuilder;
  riskScoreBuilder: RiskScoreBuilder;
  recommendationEngine: RecommendationEngine;
}

export class PipelineHealthCollector {
  #infra: HealthCollectorInfrastructure;

  constructor(infra: HealthCollectorInfrastructure) {
    this.#infra = infra;
  }

  async collect(windowDays: number): Promise<PipelineHealthInput> {
    const storeAvailability = {
      proposalStore: true,
      evidenceStore: true,
      effectivenessStore: true,
      intelligenceStore: true,
    };
    const storeErrors: NonNullable<PipelineHealthInput["storeErrors"]> = {};

    // 1. Load proposals
    let proposals: Array<{ id: string; status: string; createdAt: string }> = [];
    try {
      proposals = await this.#infra.proposalStore.list();
    } catch (err) {
      storeAvailability.proposalStore = false;
      storeErrors.proposalStore = err instanceof Error ? err.message : String(err);
    }

    // Compute status counts
    const proposalCounts: PipelineHealthInput["proposalCounts"] = {
      total: proposals.length,
      pending: proposals.filter((p) => p.status === "pending").length,
      approved: proposals.filter((p) => p.status === "approved").length,
      applied: proposals.filter((p) => p.status === "applied").length,
      rejected: proposals.filter((p) => p.status === "rejected").length,
      failed: proposals.filter((p) => p.status === "failed").length,
    };

    // 2. Build DecisionContexts for scoped proposals (pending + created/applied within window)
    const windowStartMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const scopedIds = proposals
      .filter((p) => {
        if (p.status === "pending") return true;
        // Proposals don't have appliedAt — use createdAt only
        const createdAt = Date.parse(p.createdAt ?? "");
        return Number.isFinite(createdAt) && createdAt >= windowStartMs;
      })
      .map((p) => p.id);

    const scopedProposalInputs: ScopedProposalData[] = [];
    for (const id of scopedIds) {
      try {
        const ctx = await this.#infra.contextBuilder.build(id);
        const risk = this.#infra.riskScoreBuilder.build(ctx);
        const recommendation = this.#infra.recommendationEngine.recommend(ctx, risk);
        scopedProposalInputs.push({
          contextConfidence: ctx.confidence,
          riskConfidence: risk.confidence,
          recommendationConfidence: recommendation.confidence,
          ageDays: ctx.ageDays,
          lineageCompleteness: ctx.lineageCompleteness,
          dataFreshness: {
            newestDays: ctx.dataFreshness.newestArtifactAgeDays,
            oldestDays: ctx.dataFreshness.oldestArtifactAgeDays,
          },
        });
      } catch {
        // Per-proposal error isolation: skip, continue
      }
    }

    // 3. Load effectiveness reports — save both count and records for brief
    let effectivenessReports = 0;
    let effRecords: any[] = [];
    try {
      effRecords = await this.#infra.effectivenessStore.list();
      effectivenessReports = effRecords.length;
    } catch (err) {
      storeAvailability.effectivenessStore = false;
      storeErrors.effectivenessStore = err instanceof Error ? err.message : String(err);
    }

    // 4. Load intelligence reports
    //    intelligenceStore.list() returns filenames (strings) — load actual
    //    report objects for the strategic brief input.
    let intelligenceReports = 0;
    let intelRecords: any[] = [];
    try {
      const filenames = await this.#infra.intelligenceStore.list();
      intelligenceReports = filenames.length;
      // Load all reports for the strategic brief (capped at 50 for I/O safety)
      const loaded = await Promise.all(
        filenames.slice(0, 50).map((f) => this.#infra.intelligenceStore.load(f)),
      );
      intelRecords = loaded.filter(Boolean);
    } catch (err) {
      storeAvailability.intelligenceStore = false;
      storeErrors.intelligenceStore = err instanceof Error ? err.message : String(err);
    }

    // 5. Count evidence events — evidenceStore.query({}) returns EvidenceQueryResult
    let lifecycleEventsTotal = 0;
    let lifecycleEventsInWindow = 0;
    let evRecords: any[] = [];
    try {
      const evResult = await this.#infra.evidenceStore.query({});
      lifecycleEventsTotal = evResult.total;
      evRecords = evResult.records;
      const evidenceWindowMs = windowDays * 24 * 60 * 60 * 1000;
      const windowCutoff = new Date(Date.now() - evidenceWindowMs);
      lifecycleEventsInWindow = evResult.records.filter(
        (e) => new Date(e.timestamp).getTime() >= windowCutoff.getTime(),
      ).length;
    } catch (err) {
      storeAvailability.evidenceStore = false;
      storeErrors.evidenceStore = err instanceof Error ? err.message : String(err);
    }

    // 6. Build strategic brief — available: false only on build failure.
    //    Load actual intelligence and effectiveness records for meaningful findings.
    //    If the first load failed but the store is available, try again.
    let effectivenessRecords: any[] = effRecords;
    if (effectivenessRecords.length === 0 && storeAvailability.effectivenessStore) {
      try {
        effectivenessRecords = await this.#infra.effectivenessStore.list();
      } catch {
        /* partial — brief will still run with what's available */
      }
    }
    let strategicBrief: PipelineHealthInput["strategicBrief"];
    try {
      const briefBuilder = new StrategicBriefBuilder();
      const briefOptions: StrategicBriefOptions = {
        window: windowDays as 30 | 90 | 180,
        generatedAt: new Date().toISOString(),
      };
      const briefInput = {
        intelligenceReports: intelRecords,
        effectivenessReports: effectivenessRecords,
        evidenceRecords: evRecords,
      };
      const brief = briefBuilder.build(briefInput, briefOptions);
      strategicBrief = {
        available: true,
        confidence: brief.confidence,
        findings: brief.findings.length,
      };
    } catch {
      strategicBrief = { available: false, confidence: null, findings: 0 };
    }

    // Exclude unused store error keys that are falsy
    const cleanStoreErrors: PipelineHealthInput["storeErrors"] = {};
    for (const [key, val] of Object.entries(storeErrors)) {
      if (val) (cleanStoreErrors as any)[key] = val;
    }

    return {
      proposalCounts,
      scopedProposalInputs,
      effectivenessReports,
      intelligenceReports,
      lifecycleEvents: { total: lifecycleEventsTotal, inWindow: lifecycleEventsInWindow },
      strategicBrief,
      storeAvailability,
      storeErrors: Object.keys(cleanStoreErrors).length > 0 ? cleanStoreErrors : undefined,
    };
  }
}
