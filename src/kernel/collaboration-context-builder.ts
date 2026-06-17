/**
 * collaboration-context-builder.ts — Builds deterministic context for a worker from
 * dependency results and shared findings.
 *
 * Selection order:
 *   1. Direct dependency results (via existing loadByRef contract)
 *   2. Active findings from direct dependency workers
 *   3. Artifacts referenced by selected findings
 *
 * Hard budgets are enforced. Omitted counts are recorded.
 * Warnings preserve structured load statuses from CoordinationResultStore.
 */

import { createHash } from "node:crypto";
import { CoordinationResultStore } from "./coordination-result-store.js";
import { CoordinationStore } from "./coordination-store.js";
import { CollaborationStore } from "./collaboration-store.js";
import type { CoordinationRun, WorkerAssignment, PlanTriggerKind } from "./coordination-types.js";
import type { CoordinationWorkerResultRecord } from "./coordination-result-store.js";
import type { FindingConflict } from "./collaboration-conflict-types.js";
import type {
  WorkerContextManifest, WorkerContextSnapshot, CollaborationContextWarning,
  SharedFinding, SharedArtifact,
} from "./collaboration-types.js";
import type { TriggerEvidence, ModelReplanContext, ModelWorkerInfo, ModelFindingInfo, ModelConflictInfo, AggregateResultInfo } from "./replan-types.js";

export type CollaborationContextConflictsBudget = {
  maxTokens: number;
  maxItems: number;
  maxFindingsPerConflict: number;
};

export type CollaborationContextBudget = {
  maxTokens: number;
  maxFindings: number;
  maxArtifacts: number;
  maxDependencyResults: number;
  maxFindingContentChars: number;
  maxResultSummaryChars: number;
  conflicts?: CollaborationContextConflictsBudget;
};

const DEFAULT_CONFLICTS_BUDGET: CollaborationContextConflictsBudget = {
  maxTokens: 1_000,
  maxItems: 10,
  maxFindingsPerConflict: 5,
};

const DEFAULT_BUDGET: CollaborationContextBudget = {
  maxTokens: 8_000,
  maxFindings: 20,
  maxArtifacts: 20,
  maxDependencyResults: 8,
  maxFindingContentChars: 4_000,
  maxResultSummaryChars: 8_000,
  conflicts: DEFAULT_CONFLICTS_BUDGET,
};

function resolveConflictsBudget(budget: CollaborationContextBudget): CollaborationContextConflictsBudget {
  return budget.conflicts ?? DEFAULT_CONFLICTS_BUDGET;
}

function capConflict(c: FindingConflict, maxFindingsPerConflict: number): FindingConflict {
  if (c.findingIds.length <= maxFindingsPerConflict && c.claimComparisons.length <= maxFindingsPerConflict) {
    return c;
  }
  return {
    ...c,
    findingIds: c.findingIds.slice(0, maxFindingsPerConflict),
    claimComparisons: c.claimComparisons.slice(0, maxFindingsPerConflict),
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Convert a WorkerAssignment to a model-safe ModelWorkerInfo. */
function toModelWorker(w: WorkerAssignment): ModelWorkerInfo {
  return {
    id: w.id,
    taskLabel: w.taskLabel,
    status: w.status,
    attempt: w.attempt,
    dependencies: w.dependencies,
    planOrder: w.planOrder,
  };
}

/** Convert a SharedFinding to a model-safe ModelFindingInfo. */
function toModelFinding(f: SharedFinding): ModelFindingInfo {
  return {
    id: f.id,
    workerId: f.workerId,
    workerAttempt: f.workerAttempt,
    kind: f.kind,
    title: f.title,
    content: f.content,
    confidence: f.confidence,
    createdAt: f.createdAt,
  };
}

/** Convert a FindingConflict to a model-safe ModelConflictInfo. */
function toModelConflict(c: FindingConflict): ModelConflictInfo {
  return {
    id: c.id,
    topicKey: c.topicKey,
    type: c.type,
    status: c.status,
    criticality: c.criticality,
    findingIds: c.findingIds,
    summary: `Conflict ${c.id} (${c.type}, ${c.status}) involving findings: ${c.findingIds.join(", ")}`,
  };
}

/**
 * Compute topological batches (levels) from a list of workers.
 * Returns an array of arrays, where each inner array is a batch of workers
 * that can run in parallel (all their dependencies are in earlier batches).
 */
function computeTopologicalBatches(workers: WorkerAssignment[]): string[][] {
  const workerMap = new Map(workers.map(w => [w.id, w]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const w of workers) { inDegree.set(w.id, 0); adjacency.set(w.id, []); }
  for (const w of workers) {
    for (const depId of w.dependencies) {
      if (!workerMap.has(depId)) continue; // skip unknown deps
      adjacency.get(depId)!.push(w.id);
      inDegree.set(w.id, (inDegree.get(w.id) ?? 0) + 1);
    }
  }

  const remaining = new Set(workers.map(w => w.id));
  const batches: string[][] = [];

  while (remaining.size > 0) {
    const batch: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        batch.push(id);
      }
    }
    if (batch.length === 0) break; // cycle or unknown deps
    for (const id of batch) {
      remaining.delete(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) ?? 1) - 1);
      }
    }
    batches.push(batch);
  }

  return batches;
}

/**
 * Redact sensitive content: strip absolute paths, truncate long strings.
 * - Replaces patterns like /home/user/path or /var/log/path with "[redacted-path]"
 * - Truncates excessively long words (>200 chars)
 */
function redactContent(text: string): string {
  // Strip absolute paths (Unix-style)
  let result = text.replace(/\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+/g, "[redacted-path]");
  // Strip absolute paths (Windows-style)
  result = result.replace(/[A-Za-z]:\\(?:[a-zA-Z0-9_.-]+\\)+[a-zA-Z0-9_.-]+/g, "[redacted-path]");
  // Truncate long contiguous strings (>200 chars) — these are likely encoded/binary data
  result = result.replace(/[^\s]{201,}/g, (match) => match.slice(0, 100) + "...[truncated]");
  return result;
}

type MetricsLike = {
  increment: (name: string, labels?: Record<string, string>, by?: number) => void;
  duration: (name: string, valueMs: number, labels?: Record<string, string>) => void;
};

export class CollaborationContextBuilder {
  constructor(
    private resultStore: CoordinationResultStore,
    private collabStore: CollaborationStore,
    private coordinationStore: CoordinationStore,
    private budget: CollaborationContextBudget = DEFAULT_BUDGET,
    private metrics?: MetricsLike,
  ) {}

  async build(run: CoordinationRun, worker: WorkerAssignment): Promise<{
    manifest: WorkerContextManifest;
    snapshot: WorkerContextSnapshot;
  }> {
    const warnings: CollaborationContextWarning[] = [];
    const findings: SharedFinding[] = [];
    const artifacts: SharedArtifact[] = [];
    const manifestResults: WorkerContextManifest["results"] = [];
    const resultRecords: CoordinationWorkerResultRecord[] = [];
    let tokenEstimate = 0;

    // 1. Load direct dependency results
    const depWorkers = run.workers.filter(w => worker.dependencies.includes(w.id));
    for (const dep of depWorkers.slice(0, this.budget.maxDependencyResults)) {
      if (dep.resultRef) {
        const loadResult = await this.resultStore.loadByRef(dep.resultRef);
        switch (loadResult.status) {
          case "ok":
            resultRecords.push(loadResult.record);
            const resultTokens = estimateTokens(loadResult.record.summary ?? "");
            manifestResults.push({
              resultRef: dep.resultRef,
              sourceWorkerId: dep.id,
              reason: "direct_dependency_result",
              estimatedTokens: resultTokens,
              outcome: loadResult.record.outcome,
            });
            tokenEstimate += resultTokens;
            break;
          case "missing":
            warnings.push({ code: "dependency_result_missing", sourceId: dep.id, message: `Dependency result not found: ${dep.resultRef}` });
            break;
          case "corrupt":
            warnings.push({ code: "dependency_result_corrupt", sourceId: dep.id, message: `Dependency result corrupt: ${dep.resultRef}` });
            break;
          case "invalid_ref":
            warnings.push({ code: "dependency_result_invalid_ref", sourceId: dep.id, message: `Invalid result ref: ${dep.resultRef}` });
            break;
          case "invalid_record":
            warnings.push({ code: "dependency_result_invalid_record", sourceId: dep.id, message: `Invalid result record: ${dep.resultRef}` });
            break;
        }
      }
    }

    // 2. Load findings from dependency workers
    const depIds = depWorkers.map(w => w.id);
    const depFindings = await this.collabStore.queryFindings({ workerIds: depIds, limit: this.budget.maxFindings });
    for (const f of depFindings.slice(0, this.budget.maxFindings)) {
      const findingTokens = estimateTokens(f.title + f.content);
      findings.push(f);
      tokenEstimate += findingTokens;

      // 3. Load artifacts referenced by these findings
      for (const artifactId of f.artifactRefs) {
        if (artifacts.length >= this.budget.maxArtifacts) {
          warnings.push({ code: "context_truncated", sourceId: undefined, message: `Max artifacts (${this.budget.maxArtifacts}) reached` });
          break;
        }
        const loaded = await this.collabStore.getArtifacts([artifactId]);
        if (loaded.length > 0) {
          artifacts.push(loaded[0]);
          tokenEstimate += estimateTokens(loaded[0].uri);
        } else {
          warnings.push({ code: "finding_missing_artifact", sourceId: artifactId, message: `Finding references missing artifact: ${artifactId}` });
        }
      }
    }

    // 4. Load unresolved conflicts involving these findings
    const findingIds = findings.map(f => f.id);
    const conflictsBudget = resolveConflictsBudget(this.budget);
    const rawConflicts = findingIds.length > 0
      ? await this.collabStore.queryConflicts({ findingIds, statuses: ["detected", "under_review"] })
      : [];
    const activeConflicts = rawConflicts
      .slice(0, conflictsBudget.maxItems)
      .map(c => capConflict(c, conflictsBudget.maxFindingsPerConflict));

    // D4: context conflict metrics — included vs omitted.
    if (this.metrics) {
      const omittedByBudget = Math.max(0, rawConflicts.length - activeConflicts.length);
      try {
        for (let i = 0; i < activeConflicts.length; i++) {
          this.metrics.increment("collaboration_conflict_context_included_total", { reason: "included" });
        }
      } catch { /* best-effort */ }
      if (omittedByBudget > 0) {
        try {
          this.metrics.increment("collaboration_conflict_context_omitted_total", { reason: "budget" });
        } catch { /* best-effort */ }
      }
    }

    // Compute fingerprint
    const fingerprintInput = {
      depResults: manifestResults.map(r => ({ ref: r.resultRef, outcome: r.outcome })),
      findings: findings.map(f => ({ id: f.id, updatedAt: f.updatedAt })),
      artifacts: artifacts.map(a => ({ id: a.id })),
      conflictIds: activeConflicts.map(c => c.id).sort(),
    };
    const sourceFingerprint = createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex");

    const storeRevision = this.collabStore.getRevision();

    const omitted = {
      findings: Math.max(0, depFindings.length - this.budget.maxFindings),
      artifacts: 0,
      results: Math.max(0, depWorkers.length - this.budget.maxDependencyResults),
    };

    const omittedByReason = {
      budget: omitted.results + omitted.findings + omitted.artifacts,
      lowRelevance: 0, invalidated: 0, superseded: 0,
      staleAttempt: 0, staleDependency: 0, staleArtifact: 0,
      unauthorized: 0, duplicate: 0, semanticRerankLimit: 0,
    };

    const manifest: WorkerContextManifest = {
      schemaVersion: "1.1",
      runId: run.id,
      workerId: worker.id,
      workerAttempt: worker.attempt,
      dependencyWorkerIds: depIds,
      findings: findings.map(f => ({
        findingId: f.id,
        sourceWorkerId: f.workerId,
        sourceWorkerAttempt: f.workerAttempt,
        reason: "dependency_finding",
        estimatedTokens: estimateTokens(f.title + f.content),
        includedTokens: estimateTokens(f.title + f.content),
        digest: createHash("sha256").update(JSON.stringify(f)).digest("hex"),
        score: 0,
        scoreComponents: {},
        selectionReasons: [],
      })),
      artifacts: artifacts.map(a => ({
        artifactId: a.id,
        sourceWorkerId: a.workerId,
        reason: "referenced_artifact",
        estimatedTokens: estimateTokens(a.uri),
      })),
      results: manifestResults,
      conflictIds: activeConflicts.map(c => c.id),
      generatedAt: new Date().toISOString(),
      tokenEstimate,
      tokenBudget: this.budget.maxTokens,
      omitted,
      omittedByReason,
      warnings,
      sourceRevision: storeRevision,
      sourceFingerprint,
    };

    const snapshot: WorkerContextSnapshot = {
      schemaVersion: "1.0",
      manifestRef: "",
      sourceFingerprint,
      dependencyResults: resultRecords,
      findings,
      artifacts,
      conflicts: activeConflicts,
      renderedText: "",
    };

    return { manifest, snapshot };
  }

  // ─── Helper methods ─────────────────────────────────────────────

  /**
   * Build a bounded ModelReplanContext for model-assisted replanning.
   *
   * Returns a fully populated context with run-scoped workers, findings,
   * conflicts, aggregate results, dependency graph (topological order),
   * budget enforcement, content redaction, and a deterministic fingerprint.
   *
   * The returned context is bounded by the configured token budget.
   * Content is redacted for sensitive data (absolute paths, long strings).
   * The `untrustedContent: true` marker signals that this data was sourced
   * from model input and should be treated as untrusted.
   *
   * Throws if the coordination run is not found.
   */
  async buildModelReplanContext(
    runId: string,
    trigger: PlanTriggerKind,
    triggerEvidence: TriggerEvidence,
  ): Promise<ModelReplanContext> {
    const run = await this.coordinationStore.load(runId);
    if (!run) {
      throw new Error(`Coordination run not found: ${runId}`);
    }

    const workers = run.workers;
    const workerIds = workers.map(w => w.id);

    // Worker info: completed/failed workers
    const completedWorkers = workers
      .filter(w => w.status === "completed" || w.status === "failed")
      .map(w => toModelWorker(w));

    // Full worker graph (all workers, for dependency context)
    const workerGraph = workers.map(w => toModelWorker(w));

    // Dependency graph as topological order (batches by level)
    const dependencyGraph = computeTopologicalBatches(workers);

    // Run-scoped findings: only this run's workers, current attempt only
    const workerToAttempt = new Map(workers.map(w => [w.id, w.attempt]));
    const rawFindings = workerIds.length > 0
      ? await this.collabStore.queryFindings({ workerIds, limit: this.budget.maxFindings })
      : [];

    // Filter to current-attempt findings per worker
    const currentFindings = rawFindings.filter(
      f => workerToAttempt.get(f.workerId) === f.workerAttempt,
    );

    // Conflicts involving these findings (detected or under review)
    const findingIds = currentFindings.map(f => f.id);
    const rawConflicts = findingIds.length > 0
      ? await this.collabStore.queryConflicts({ findingIds, statuses: ["detected", "under_review"] })
      : [];

    // Aggregate result from CoordinationResultStore
    let aggregateResult: AggregateResultInfo | undefined;
    if (run.aggregateResultRef) {
      const loadResult = await this.resultStore.loadByRef(run.aggregateResultRef);
      if (loadResult.status === "ok") {
        aggregateResult = {
          outcome: loadResult.record.outcome,
          summary: loadResult.record.summary ?? "",
          issues: loadResult.record.error ? [loadResult.record.error] : [],
        };
      } else {
        aggregateResult = {
          outcome: "unknown",
          summary: `Aggregate result not available: ${loadResult.message}`,
          issues: [],
        };
      }
    }

    // Build model-friendly structures
    let findings: ModelFindingInfo[] = currentFindings.map(f => toModelFinding(f));
    let conflicts: ModelConflictInfo[] = rawConflicts.map(c => toModelConflict(c));

    // Pre-redact content (strip absolute paths, truncate long strings)
    const warnings: string[] = [];
    const redactedFindings = findings.map(f => ({
      ...f,
      content: redactContent(f.content),
    }));
    const redactedConflicts = conflicts.map(c => ({
      ...c,
      summary: redactContent(c.summary),
    }));

    // Token budget enforcement
    // Pre-compute token estimates per item for precise trimming
    const findingWithTokens = redactedFindings.map(f => ({
      info: f,
      tokens: estimateTokens(JSON.stringify(f)),
    }));
    const conflictWithTokens = redactedConflicts.map(c => ({
      info: c,
      tokens: estimateTokens(JSON.stringify(c)),
    }));

    // Base tokens (workers, graph, aggregate result — always included)
    const baseTokens = estimateTokens(JSON.stringify({
      completedWorkers, workerGraph, dependencyGraph, aggregateResult,
    }));
    let findingsTokens = findingWithTokens.reduce((s, f) => s + f.tokens, 0);
    let conflictsTokens = conflictWithTokens.reduce((s, c) => s + c.tokens, 0);
    let totalTokens = baseTokens + findingsTokens + conflictsTokens;
    let omittedFindingsByBudget = 0;
    let omittedConflictsByBudget = 0;

    // Trim findings from back (newest-first = least critical for replan)
    while (totalTokens > this.budget.maxTokens && findingWithTokens.length > 0) {
      const removed = findingWithTokens.pop()!;
      totalTokens -= removed.tokens;
      omittedFindingsByBudget++;
    }
    // Trim conflicts if findings alone did not bring us under budget
    while (totalTokens > this.budget.maxTokens && conflictWithTokens.length > 0) {
      const removed = conflictWithTokens.pop()!;
      totalTokens -= removed.tokens;
      omittedConflictsByBudget++;
    }

    if (omittedFindingsByBudget > 0 || omittedConflictsByBudget > 0) {
      warnings.push(
        `Context trimmed: ${omittedFindingsByBudget} findings and ${omittedConflictsByBudget} conflicts omitted to fit budget of ${this.budget.maxTokens} tokens`,
      );
    }

    // Compute deterministic context fingerprint
    const fingerprintInput = {
      runId,
      trigger,
      workerCount: workers.length,
      findingIds: findingWithTokens.map(f => f.info.id).sort(),
      conflictIds: conflictWithTokens.map(c => c.info.id).sort(),
      workerIds: workerGraph.map(w => w.id).sort(),
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(fingerprintInput))
      .digest("hex");

    return {
      runId,
      trigger,
      triggerEvidence,
      completedWorkers,
      activeConflicts: conflictWithTokens.map(c => c.info),
      recentFindings: findingWithTokens.map(f => f.info),
      workerGraph,
      aggregateResult,
      dependencyGraph,
      tokenBudget: {
        allocated: this.budget.maxTokens,
        consumed: totalTokens,
        omittedFindings: omittedFindingsByBudget + Math.max(0, rawFindings.length - currentFindings.length),
        omittedConflicts: omittedConflictsByBudget,
      },
      fingerprint,
      warnings,
      untrustedContent: true as const,
    };
  }

  /**
   * Build replan context for a coordination run.
   * Returns completed/failed workers, active conflicts, and recent findings
   * to inform replanning decisions.
   */
  async buildReplanContext(runId: string): Promise<{
    completedWorkers: Array<{ workerId: string; taskLabel: string; outcome: string; attempt: number }>;
    activeConflicts: FindingConflict[];
    recentFindings: SharedFinding[];
  }> {
    const run = await this.coordinationStore.load(runId);
    if (!run) return { completedWorkers: [], activeConflicts: [], recentFindings: [] };

    return {
      completedWorkers: run.workers
        .filter(w => w.status === "completed" || w.status === "failed")
        .map(w => ({ workerId: w.id, taskLabel: w.taskLabel, outcome: w.status, attempt: w.attempt })),
      activeConflicts: await this.collabStore.queryConflicts({ statuses: ["detected", "under_review"] }),
      recentFindings: await this.collabStore.queryFindings({ limit: 20 }),
    };
  }
}
