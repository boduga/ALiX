/**
 * coordination-result-aggregator.ts — Deterministic run-level result aggregation.
 *
 * For each worker: loads and validates the result via resultRef, computes
 * duration, records integrity issues. Produces typed RunResultSummary with
 * counts, timing, outcome, completeness, and failure chains.
 */

import type { CoordinationRun, CoordinationRunOutcome } from "./coordination-types.js";
import type { RunResultSummary, WorkerResultSummary, AggregationIssue, FailureChain } from "./coordination-result-types.js";
import { CoordinationResultStore, requiresResultRecord } from "./coordination-result-store.js";
import { buildFailureChains } from "./coordination-failure-chain.js";

export class ResultAggregator {
  constructor(private resultStore: CoordinationResultStore) {}

  async aggregate(run: CoordinationRun): Promise<RunResultSummary> {
    const issues: AggregationIssue[] = [];
    const workerResults: WorkerResultSummary[] = [];
    let earliestStart: string | undefined;
    let latestCompletion: string | undefined;

    for (const worker of run.workers) {
      // Copy durable worker state
      const summary: WorkerResultSummary = {
        workerId: worker.id,
        taskLabel: worker.taskLabel,
        goalPrompt: worker.goalPrompt,
        agentId: worker.agentId,
        planOrder: worker.planOrder,
        status: worker.status,
        attempt: worker.attempt,
        maxAttempts: worker.maxAttempts,
        outcome: undefined,
        error: worker.error,
        failureKind: worker.failureKind,
        blockReason: worker.blockReason,
        failureProvenance: worker.failureProvenance,
        startedAt: worker.startedAt,
        completedAt: worker.completedAt,
      };

      // Compute duration if we have both timestamps
      if (worker.startedAt && worker.completedAt) {
        const start = new Date(worker.startedAt).getTime();
        const end = new Date(worker.completedAt).getTime();
        if (!isNaN(start) && !isNaN(end) && end >= start) {
          summary.durationMs = end - start;
        } else {
          issues.push({ code: "invalid_timestamp", workerId: worker.id, message: `Invalid timestamps: start=${worker.startedAt}, end=${worker.completedAt}` });
        }
      }

      // Track earliest start and latest completion
      if (worker.startedAt && (!earliestStart || worker.startedAt < earliestStart)) {
        earliestStart = worker.startedAt;
      }
      if (worker.completedAt && (!latestCompletion || worker.completedAt > latestCompletion)) {
        latestCompletion = worker.completedAt;
      }

      // Load result record if available
      if (worker.resultRef) {
        const loadResult = await this.resultStore.loadByRef(worker.resultRef);
        switch (loadResult.status) {
          case "ok":
            summary.outcome = loadResult.record.outcome;
            summary.summary = loadResult.record.summary;
            // Validate run/worker/attempt match
            if (loadResult.record.runId !== run.id) {
              issues.push({ code: "run_mismatch", workerId: worker.id, message: `Result runId ${loadResult.record.runId} doesn't match run ${run.id}` });
            }
            if (loadResult.record.workerId !== worker.id) {
              issues.push({ code: "worker_mismatch", workerId: worker.id, message: `Result workerId ${loadResult.record.workerId} doesn't match worker ${worker.id}` });
            }
            if (loadResult.record.attempt !== worker.attempt) {
              issues.push({ code: "attempt_mismatch", workerId: worker.id, message: `Result attempt ${loadResult.record.attempt} doesn't match worker attempt ${worker.attempt}` });
            }
            break;
          case "missing":
            summary.error = loadResult.message;
            issues.push({ code: "missing_result", workerId: worker.id, message: loadResult.message });
            break;
          case "corrupt":
            issues.push({ code: "corrupt_result", workerId: worker.id, message: loadResult.message });
            break;
          case "invalid_ref":
            issues.push({ code: "corrupt_result", workerId: worker.id, message: loadResult.message });
            break;
          case "invalid_record":
            issues.push({ code: "corrupt_result", workerId: worker.id, message: loadResult.message });
            break;
        }
      } else if (requiresResultRecord(worker)) {
        issues.push({ code: "missing_result", workerId: worker.id, message: `Worker requires result but resultRef is missing` });
      }

      workerResults.push(summary);
    }

    // Compute counts
    let successfulResults = 0;
    let failedResults = 0;
    let missingResults = 0;
    for (const r of workerResults) {
      if (r.outcome === "success") successfulResults++;
      else if (r.outcome === "failure") failedResults++;
      else if (r.status === "completed" && !r.outcome) missingResults++;
    }

    const counts = {
      workers: run.workers.length,
      completed: run.workers.filter(w => w.status === "completed").length,
      failed: run.workers.filter(w => w.status === "failed").length,
      blocked: run.workers.filter(w => w.status === "blocked").length,
      cancelled: run.workers.filter(w => w.status === "cancelled").length,
      pending: run.workers.filter(w => w.status === "pending").length,
      running: run.workers.filter(w => w.status === "running").length,
      successfulResults,
      failedResults,
      missingResults,
    };

    // Compute completeness — any integrity issue makes the aggregate incomplete
    const hasIntegrityIssue = issues.length > 0;
    const complete = !hasIntegrityIssue;

    // Compute outcome
    const outcome = this.computeOutcome(run, complete, counts);

    // Build failure chains
    const failureChains = buildFailureChains(run);

    // Timing
    const wallClockDurationMs = earliestStart && latestCompletion
      ? new Date(latestCompletion).getTime() - new Date(earliestStart).getTime() : undefined;
    const totalWorkerDurationMs = workerResults.reduce((sum, w) => sum + (w.durationMs ?? 0), 0);

    return {
      schemaVersion: "1.0",
      runId: run.id,
      rootGoal: run.rootGoal,
      status: run.status,
      outcome,
      generatedAt: new Date().toISOString(),
      sourceFingerprint: "",
      sourceRunUpdatedAt: run.updatedAt,
      complete,
      issues,
      counts,
      workerResults,
      failureChains,
      timing: { startedAt: earliestStart, completedAt: latestCompletion, wallClockDurationMs, totalWorkerDurationMs },
      synthesis: { status: "not_requested" },
    };
  }

  private computeOutcome(run: CoordinationRun, complete: boolean, counts: RunResultSummary["counts"]): CoordinationRunOutcome {
    if (!complete) return "incomplete";
    if (counts.workers === 0) return "incomplete";
    if (run.workers.every(w => w.status === "cancelled")) return "cancelled";

    // Non-terminal runs cannot be success
    if (counts.pending > 0 || counts.running > 0) return "incomplete";

    // Partial success: some succeeded but there are terminal problems
    const hasTerminalProblem = counts.failed > 0 || counts.blocked > 0 || counts.cancelled > 0;
    if (counts.successfulResults > 0 && hasTerminalProblem) return "partial_success";

    if (counts.completed === counts.workers && counts.failedResults === 0 && counts.missingResults === 0) return "success";
    if (counts.completed > 0 && counts.failed === 0) return "success";
    if (counts.failed > 0) return "failure";
    if (counts.blocked > 0 && counts.completed === 0) return "blocked";
    return "incomplete";
  }
}
