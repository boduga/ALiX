/**
 * collaboration-conflict-detector.ts — Deterministic conflict detection pipeline.
 *
 * Wires the M0.78f pipeline components into a single class per plan §10:
 *
 *   CollaborationStore.queryFindings → ConflictCandidateGenerator →
 *   ClaimComparator → (optional) ModelConflictComparator →
 *   ConflictEvidenceComparator → ConflictRepository.upsertConflict
 *
 * The detector is best-effort: any thrown error from a comparator or
 * repository write is captured as a warning and reported in the result
 * so that one bad pair never aborts the whole pass. A `useModelAssistance`
 * flag gates the optional model comparator; it defaults to false.
 *
 * No call site is added here — the detector is a pure class that any
 * run lifecycle hook (scheduler, agent loop, conflict watcher) can
 * invoke. Wiring is a separate task.
 */

import { createHash } from "node:crypto";
import type { CollaborationStore } from "./collaboration-store.js";
import type { CoordinationStore } from "./coordination-store.js";
import type { CoordinationResultStore } from "./coordination-result-store.js";
import { ConflictCandidateGenerator } from "./collaboration-conflict-candidates.js";
import { ClaimComparator } from "./collaboration-claim-comparator.js";
import { ConflictEvidenceComparator } from "./collaboration-evidence-comparator.js";
import { ConflictRepository } from "./collaboration-conflict-repository.js";
import type { ModelConflictComparator } from "./collaboration-model-conflict-comparator.js";
import { computeFindingStatus } from "./collaboration-freshness.js";
import { computeTopicKey } from "./collaboration-claim-normalizer.js";
import type { SharedFinding } from "./collaboration-types.js";
import type {
  ClaimComparison,
  DetectionMethod,
  EvidenceComparison,
} from "./collaboration-conflict-types.js";

export type ConflictDetectionLimits = {
  maxFindingsPerTopic: number;
  maxPairsPerDetectionPass: number;
};

export const DEFAULT_DETECTION_LIMITS: ConflictDetectionLimits = {
  maxFindingsPerTopic: 20,
  maxPairsPerDetectionPass: 200,
};

export type ConflictDetectionReport = {
  runId: string;
  candidatesExamined: number;
  deterministicConflicts: number;
  modelAssistedConflicts: number;
  compatiblePairs: number;
  uncertainPairs: number;
  omittedPairs: number;
  createdConflictIds: string[];
  updatedConflictIds: string[];
  warnings: string[];
  durationMs: number;
};

export type ConflictDetectorDeps = {
  collabStore: CollaborationStore;
  coordinationStore: CoordinationStore;
  resultStore: CoordinationResultStore;
  candidateGenerator: ConflictCandidateGenerator;
  claimComparator: ClaimComparator;
  evidenceComparator: ConflictEvidenceComparator;
  conflictRepo: ConflictRepository;
  modelComparator?: ModelConflictComparator;
  limits?: ConflictDetectionLimits;
};

export type DetectConflictsOptions = {
  useModelAssistance?: boolean;
  signal?: AbortSignal;
};

const MODEL_TIMEOUT_MS = 5_000;

function sha256Hex(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function emptyReport(runId: string, start: number, warnings: string[] = []): ConflictDetectionReport {
  return {
    runId,
    candidatesExamined: 0,
    deterministicConflicts: 0,
    modelAssistedConflicts: 0,
    compatiblePairs: 0,
    uncertainPairs: 0,
    omittedPairs: 0,
    createdConflictIds: [],
    updatedConflictIds: [],
    warnings,
    durationMs: Date.now() - start,
  };
}

export class ConflictDetector {
  constructor(private deps: ConflictDetectorDeps) {}

  async detectConflicts(
    runId: string,
    options?: DetectConflictsOptions,
  ): Promise<ConflictDetectionReport> {
    const start = Date.now();
    const limits = this.deps.limits ?? DEFAULT_DETECTION_LIMITS;
    // If the caller supplied custom limits, build a generator bound to them;
    // otherwise reuse the one injected in deps.
    const candidateGenerator = this.deps.limits
      ? new ConflictCandidateGenerator(limits)
      : this.deps.candidateGenerator;
    const useModel = options?.useModelAssistance === true;
    const signal = options?.signal;

    const report: ConflictDetectionReport = {
      runId,
      candidatesExamined: 0,
      deterministicConflicts: 0,
      modelAssistedConflicts: 0,
      compatiblePairs: 0,
      uncertainPairs: 0,
      omittedPairs: 0,
      createdConflictIds: [],
      updatedConflictIds: [],
      warnings: [],
      durationMs: 0,
    };

    // 1. Load the run
    let run;
    try {
      run = await this.deps.coordinationStore.load(runId);
    } catch (err) {
      report.warnings.push(`coordinationStore.load failed: ${err instanceof Error ? err.message : String(err)}`);
      report.durationMs = Date.now() - start;
      return report;
    }
    if (!run) {
      report.warnings.push(`run not found: ${runId}`);
      report.durationMs = Date.now() - start;
      return report;
    }

    // 2. Load findings, filter to active (not invalidated/superseded and from current source-worker attempt)
    let rawFindings: SharedFinding[];
    try {
      rawFindings = await this.deps.collabStore.queryFindings({});
    } catch (err) {
      report.warnings.push(`collabStore.queryFindings failed: ${err instanceof Error ? err.message : String(err)}`);
      report.durationMs = Date.now() - start;
      return report;
    }
    // Defensively filter again: queryFindings already excludes invalidated/superseded.
    // The collabStore is per-run, so findings are already scoped; here we just
    // enforce the current source-worker attempt.
    const activeFindings = rawFindings.filter(f => {
      if (f.invalidatedAt || f.supersededBy) return false;
      const sourceWorker = run.workers.find(w => w.id === f.workerId);
      if (!sourceWorker) return false;
      const currentAttempt = sourceWorker.attempt ?? 0;
      const recorded = f.workerAttempt ?? 0;
      if (recorded < currentAttempt) return false; // source worker has a higher attempt
      return computeFindingStatus(f, currentAttempt) === "active";
    });

    // 3. Generate candidate pairs (the generator does its own topic-grouping and limits).
    const { pairs, report: genReport } = candidateGenerator.generateCandidates(activeFindings, run);
    report.candidatesExamined = pairs.length;
    report.omittedPairs = genReport.omittedPairs;
    report.warnings.push(...genReport.warnings);

    // 4. Build evidence context (artifacts + dependency results).
    // Loaded for the D3 observability wiring; not consumed by detection itself.
    let artifacts: Awaited<ReturnType<CollaborationStore["getArtifacts"]>>;
    try {
      artifacts = await this.deps.collabStore.getArtifacts();
      artifacts = artifacts.filter(a => a.runId === runId);
    } catch (err) {
      artifacts = [];
      report.warnings.push(`collabStore.getArtifacts failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Loaded for the D3 observability wiring; not consumed by detection itself.
    let dependencyResults: Awaited<ReturnType<CoordinationResultStore["loadByRun"]>>;
    try {
      dependencyResults = (await this.deps.resultStore.loadByRun(runId)) ?? [];
    } catch (err) {
      dependencyResults = [];
      report.warnings.push(`resultStore.loadByRun failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 5. Walk each pair.
    for (const pair of pairs) {
      if (signal?.aborted) {
        report.warnings.push("detection aborted");
        break;
      }

      const left = pair.left;
      const right = pair.right;

      // Both findings must have a claim to be comparable.
      if (!left.claim || !right.claim) {
        report.uncertainPairs++;
        continue;
      }

      // Compute claim comparison.
      let cmp: ClaimComparison;
      try {
        cmp = this.deps.claimComparator.compare(left.claim, right.claim, left.id, right.id);
      } catch (err) {
        report.warnings.push(`claimComparator failed for ${left.id}/${right.id}: ${err instanceof Error ? err.message : String(err)}`);
        report.uncertainPairs++;
        continue;
      }

      // Classify.
      let pathKind: "compatible" | "deterministic" | "model_assisted" | "uncertain" = "uncertain";
      if (cmp.compatibility === "compatible") {
        report.compatiblePairs++;
        continue;
      }
      if (cmp.compatibility === "incompatible") {
        report.deterministicConflicts++;
        pathKind = "deterministic";
      } else if (cmp.compatibility === "uncertain" && useModel && this.deps.modelComparator) {
        const modelOutcome = await this.invokeModel(left, right, evidenceFor(activeFindings, left, right), signal);
        if (modelOutcome === "incompatible") {
          report.modelAssistedConflicts++;
          pathKind = "model_assisted";
        } else {
          report.uncertainPairs++;
          continue;
        }
      } else {
        // "uncertain" without model assistance, or "different_scope" / "insufficient_structure" → uncertain.
        report.uncertainPairs++;
        continue;
      }

      // Build evidence comparison (best-effort).
      let evidence: EvidenceComparison;
      try {
        evidence = this.deps.evidenceComparator.compare([left, right]);
      } catch (err) {
        report.warnings.push(`evidenceComparator failed for ${left.id}/${right.id}: ${err instanceof Error ? err.message : String(err)}`);
        // Fall back to a minimal evidence comparison so persistence still succeeds.
        evidence = {
          ranking: [
            { findingId: left.id, score: 0, components: { freshness: 0, evidenceQuality: 0, confidence: 0, sourceAttempt: 0, resultProvenance: 0, artifactIntegrity: 0 }, reasons: ["evidence comparator error"] },
            { findingId: right.id, score: 0, components: { freshness: 0, evidenceQuality: 0, confidence: 0, sourceAttempt: 0, resultProvenance: 0, artifactIntegrity: 0 }, reasons: ["evidence comparator error"] },
          ],
          confidence: "low",
          scoreMargin: 0,
          recommendation: "human_review",
          unresolvedReasons: ["evidence comparator error"],
        };
      }

      // Fingerprint dedup key: run + type + topic + sorted finding ids + comparator version.
      const topicKey = computeTopicKey(left.claim!);
      const fingerprint = sha256Hex({
        runId,
        type: cmp.type ?? "contradiction",
        topic: topicKey,
        findings: [left.id, right.id].sort(),
        version: cmp.comparatorVersion,
      });

      const detectedBy: DetectionMethod[] = [pathKind === "model_assisted" ? "model_assisted" : "deterministic"];

      try {
        const { conflict, created } = await this.deps.conflictRepo.upsertConflict(runId, {
          conflictFingerprint: fingerprint,
          topicKey,
          type: cmp.type ?? "contradiction",
          findingIds: [left.id, right.id],
          claimComparisons: [cmp],
          evidenceComparison: evidence,
          detectedBy,
          criticality: "warning",
          blocksDownstreamByPolicy: false,
        });
        if (created) report.createdConflictIds.push(conflict.id);
        else report.updatedConflictIds.push(conflict.id);
      } catch (err) {
        report.warnings.push(`upsertConflict failed for ${left.id}/${right.id}: ${err instanceof Error ? err.message : String(err)}`);
        // Roll back the counter we already incremented, since the conflict was not persisted.
        if (pathKind === "deterministic") report.deterministicConflicts--;
        else report.modelAssistedConflicts--;
      }
    }

    report.durationMs = Date.now() - start;
    return report;
  }

  /**
   * Best-effort model call. Returns the model's `compatibility` on success,
   * or `null` on any error/timeout (which the caller treats as "uncertain").
   */
  private async invokeModel(
    left: SharedFinding,
    right: SharedFinding,
    evidenceSummary: { leftScore: number; rightScore: number; margin: number },
    signal: AbortSignal | undefined,
  ): Promise<"compatible" | "incompatible" | "uncertain" | null> {
    if (!this.deps.modelComparator) return null;
    try {
      const result = await this.deps.modelComparator.compare(
        {
          pairId: `${left.id}:${right.id}`,
          leftFinding: {
            title: left.title,
            content: left.content,
            claim: left.claim,
            confidence: left.confidence,
          },
          rightFinding: {
            title: right.title,
            content: right.content,
            claim: right.claim,
            confidence: right.confidence,
          },
          evidenceSummary,
        },
        { timeoutMs: MODEL_TIMEOUT_MS, signal },
      );
      if (result.compatibility === "compatible" || result.compatibility === "incompatible" || result.compatibility === "uncertain") {
        return result.compatibility;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Build a minimal evidence summary for the model comparator. The model
 * is bounded — it never gets the full store, only a derived score.
 */
function evidenceFor(
  activeFindings: SharedFinding[],
  left: SharedFinding,
  right: SharedFinding,
): { leftScore: number; rightScore: number; margin: number } {
  // The detector has not yet ranked — give the model neutral scores and let
  // its bounded reasoning decide. Margin is 0 by definition.
  void activeFindings;
  return { leftScore: 0, rightScore: 0, margin: 0 };
}
