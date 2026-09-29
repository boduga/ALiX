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

      try {
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

      // Compute ref deterministically before persisting
      const aggregateRef = `.alix/coordination/results/runs/${summary.runId}.json`;
      summary.aggregateRef = aggregateRef;
      await this.deps.aggregateStore.persist(summary);

      // Attach metadata only if this call wins the finalization race. The
      // store does check-and-attach under the per-run lock, so a second
      // terminal observation (another scheduler tick, another process) cannot
      // duplicate the attach — and therefore cannot duplicate the event below.
      const attach = await this.deps.coordinationStore.attachAggregateIfUnfinalized(runId, {
        aggregateResultRef: aggregateRef,
        aggregateGeneratedAt: summary.generatedAt,
        aggregateSourceFingerprint: fingerprint,
        outcome: summary.outcome,
      });

      if (!attach.attached) {
        // Someone else finalized this fingerprint first. Return their aggregate
        // without emitting a second event; if the store holds a different
        // fingerprint (a replan beat us), our summary is stale for the run
        // record but still the honest answer for the source we aggregated.
        const existing = await this.deps.aggregateStore.load(runId);
        return existing ?? summary;
      }

      // Emit event — exactly once, by the attach winner
      this.deps.eventLog?.append({
        sessionId: run.sessionId,
        actor: "coordination",
        type: "coordination.aggregate.completed",
        // The ref and fingerprint are what make this event usable as durable
        // verification evidence: a consumer can check the event describes the
        // aggregate currently attached to the run (see
        // `matchesAttachedAggregateEvent`). Without them an older event could
        // verify a newer, post-replan aggregate.
        payload: {
          runId,
          outcome: summary.outcome,
          workerCount: summary.counts.workers,
          aggregateResultRef: aggregateRef,
          sourceFingerprint: fingerprint,
        },
      }).catch(() => {});

      return summary;
      } catch (error) {
        // Aggregation failure is its own evidence. It must never be reported as
        // an execution failure: the workers' terminal statuses are untouched,
        // and `run.status` is only ever recomputed from worker statuses.
        const reason = error instanceof Error ? error.message : String(error);
        // Durable first: a consumer without the event log still sees the failure
        // through `deriveCoordinationCompletion` (`aggregation: "failed"`).
        await this.deps.coordinationStore.recordAggregationFailure(runId, {
          sourceFingerprint: fingerprint,
          failedAt: new Date().toISOString(),
          reason,
        }).catch(() => {});
        this.deps.eventLog?.append({
          sessionId: run.sessionId,
          actor: "coordination",
          type: "coordination.aggregate.failed",
          payload: {
            runId,
            error: reason,
            workerCount: run.workers.length,
          },
        }).catch(() => {});
        throw error;
      }
    } finally {
      lock.release();
    }
  }
}
