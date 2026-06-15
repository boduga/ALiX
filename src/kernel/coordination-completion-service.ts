/**
 * coordination-completion-service.ts — Race-safe terminal run finalization.
 *
 * Loads a terminal run, checks aggregate freshness, aggregates if needed,
 * persists, optionally synthesizes, and attaches metadata to the run.
 * Uses the finalization lock to prevent duplicate work across processes.
 */

import { CoordinationStore } from "./coordination-store.js";
import { CoordinationAggregateStore } from "./coordination-aggregate-store.js";
import { CoordinationFinalizationLock } from "./coordination-finalization-lock.js";
import { ResultAggregator } from "./coordination-result-aggregator.js";
import { computeAggregationSourceFingerprint } from "./coordination-aggregation-fingerprint.js";
import type { RunResultSummary } from "./coordination-result-types.js";
import type { RunSynthesizer } from "./coordination-run-synthesizer.js";
import type { EventLog } from "../events/event-log.js";

export type CoordinationCompletionServiceDeps = {
  coordinationStore: CoordinationStore;
  resultAggregator: ResultAggregator;
  aggregateStore: CoordinationAggregateStore;
  synthesizer?: RunSynthesizer;
  eventLog?: EventLog;
};

export class CoordinationCompletionService {
  constructor(private deps: CoordinationCompletionServiceDeps) {}

  async finalize(runId: string): Promise<RunResultSummary> {
    const lock = new CoordinationFinalizationLock((this.deps.coordinationStore as any).cwd, runId);
    const acquired = await lock.acquire();
    if (!acquired) throw new Error("Could not acquire finalization lock");

    try {
      const run = await this.deps.coordinationStore.load(runId);
      if (!run) throw new Error("Run not found");

      const fingerprint = computeAggregationSourceFingerprint(run);

      // Check for fresh aggregate — if source fingerprint matches, reuse
      if (run.aggregateSourceFingerprint === fingerprint && run.aggregateResultRef) {
        const existing = await this.deps.aggregateStore.load(runId);
        if (existing) return existing;
      }

      // Deterministic aggregation
      const summary = await this.deps.resultAggregator.aggregate(run);
      summary.sourceFingerprint = fingerprint;

      // Optional synthesis
      if (this.deps.synthesizer) {
        try {
          summary.finalSummary = await this.deps.synthesizer.synthesize({
            runId: summary.runId,
            rootGoal: summary.rootGoal,
            workerResults: summary.workerResults,
          });
          summary.synthesis = { status: "completed", generatedAt: new Date().toISOString() };
        } catch (err) {
          summary.synthesis = {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
            generatedAt: new Date().toISOString(),
          };
        }
      }

      // Persist aggregate atomically
      const aggregateRef = await this.deps.aggregateStore.persist(summary);
      summary.aggregateRef = aggregateRef;

      // Attach metadata to run (lock-safe via updateRun)
      await this.deps.coordinationStore.attachAggregate(runId, {
        aggregateResultRef: aggregateRef,
        aggregateGeneratedAt: summary.generatedAt,
        aggregateSourceFingerprint: fingerprint,
        outcome: summary.outcome,
      });

      // Emit event
      this.deps.eventLog?.append({
        sessionId: run.sessionId,
        actor: "coordination",
        type: "coordination.aggregate.completed",
        payload: { runId, outcome: summary.outcome, workerCount: summary.counts.workers },
      }).catch(() => {});

      return summary;
    } finally {
      lock.release();
    }
  }
}
