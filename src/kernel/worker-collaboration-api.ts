/**
 * worker-collaboration-api.ts -- Constrained collaboration API for workers.
 *
 * Workers publish findings/artifacts and query shared data through this
 * bound interface. The actor identity is immutable -- workers cannot
 * forge their runId, workerId, or attempt.
 *
 * Workers may only mutate records they created.
 */

import { CollaborationStore } from "./collaboration-store.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type {
  SharedFinding, SharedArtifact, CollaborationActor,
  FindingFilter, PublishFindingInput, PublishArtifactInput,
} from "./collaboration-types.js";
import type { FindingConflict, ConflictStatus } from "./collaboration-conflict-types.js";
import type { CoordinationWorkerResultRecord } from "./coordination-result-store.js";

export interface WorkerCollaborationAPI {
  /** Publish a finding from the current worker. Returns the finding ID. */
  publishFinding(input: PublishFindingInput): Promise<string>;

  /** Publish an artifact from the current worker. Returns the artifact ID. */
  publishArtifact(input: PublishArtifactInput): Promise<string>;

  /** Query shared findings with optional filters. Returns max 50 results. */
  queryFindings(filter: FindingFilter): Promise<SharedFinding[]>;

  /** Get pre-loaded dependency results for the current worker. */
  getDependencyResults(): Promise<CoordinationWorkerResultRecord[]>;

  /**
   * Report a conflict between the given finding IDs.
   * Validates that all findings exist, are in the same run, are active,
   * and the reporting worker belongs to the run.
   * Returns the conflict ID.
   */
  reportConflict(input: { findingIds: string[]; topic?: string; reason: string }): Promise<string>;

  /**
   * List conflicts relevant to this worker's run.
   * Returns unresolved conflicts with bounded output.
   */
  listConflicts(filter?: { statuses?: ConflictStatus[]; relatedFindingIds?: string[]; limit?: number }): Promise<FindingConflict[]>;
}

/**
 * Bound implementation that enforces actor identity.
 * The actor is set at construction time and cannot be changed.
 */
export class BoundWorkerCollaborationAPI implements WorkerCollaborationAPI {
  constructor(
    private readonly actor: CollaborationActor,
    private readonly store: CollaborationStore,
    private readonly dependencyResults: CoordinationWorkerResultRecord[],
  ) {}

  async publishFinding(input: PublishFindingInput): Promise<string> {
    const finding = await this.store.publishFinding(input, this.actor);
    return finding.id;
  }

  async publishArtifact(input: PublishArtifactInput): Promise<string> {
    const artifact = await this.store.publishArtifact(input, this.actor);
    return artifact.id;
  }

  async queryFindings(filter: FindingFilter): Promise<SharedFinding[]> {
    const results = await this.store.queryFindings({
      ...filter,
      limit: filter.limit ?? 50,
    });
    // Strip content for findings not from this worker (privacy)
    return results.map(f => {
      if (f.workerId !== this.actor.workerId) {
        return { ...f, content: "[redacted -- findings from other workers]" };
      }
      return f;
    });
  }

  async getDependencyResults(): Promise<CoordinationWorkerResultRecord[]> {
    return [...this.dependencyResults];
  }

  async reportConflict(input: { findingIds: string[]; topic?: string; reason: string }): Promise<string> {
    if (input.findingIds.length < 2) {
      throw new Error("At least two finding IDs are required to report a conflict");
    }
    if (input.reason.length > 1000) {
      throw new Error("Reason must be at most 1000 characters");
    }

    // Duplicate IDs must be rejected. A conflict that references the same
    // finding twice has no semantic meaning and would corrupt the
    // fingerprint (which is hashed over findingIds) and any downstream
    // intersection logic. The fingerprint dedup would silently treat two
    // semantically different conflicts as identical.
    assertUniqueFindingIds(input.findingIds);

    const findings = await this.store.getFindings(input.findingIds);
    const foundIds = new Set(findings.map(f => f.id));

    // Validate all findings exist
    const missing = input.findingIds.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Findings not found: ${missing.join(", ")}`);
    }

    // Validate all findings belong to the same run as the reporting worker
    for (const f of findings) {
      if (f.runId !== this.actor.runId) {
        throw new Error(`Finding ${f.id} belongs to a different run (${f.runId})`);
      }
    }

    // Validate findings are active (not invalidated or superseded)
    const inactive = findings.filter(f => f.invalidatedAt || f.supersededBy);
    if (inactive.length > 0) {
      const inactiveIds = inactive.map(f => f.id).join(", ");
      throw new Error(`Findings are not active (invalidated or superseded): ${inactiveIds}`);
    }

    const now = new Date().toISOString();
    const topicKey = input.topic ?? `conflict_${input.findingIds.sort().join("_").slice(0, 64)}`;
    const conflictFingerprint = createHash("sha256")
      .update(JSON.stringify({ findingIds: [...input.findingIds].sort(), runId: this.actor.runId }))
      .digest("hex");

    const conflict: FindingConflict = {
      id: `conflict_${randomUUID()}`,
      schemaVersion: "1.0",
      runId: this.actor.runId,
      conflictFingerprint,
      topicKey,
      type: "worker_reported",
      status: "under_review",
      findingIds: [...input.findingIds],
      claimComparisons: [],
      evidenceComparison: {
        ranking: [],
        confidence: "low",
        scoreMargin: 0,
        recommendation: "human_review",
        unresolvedReasons: [input.reason],
      },
      detectedBy: ["worker_report"],
      criticality: "warning",
      blocksDownstreamByPolicy: false,
      history: [{
        action: "created",
        actor: { kind: "worker", id: this.actor.workerId },
        at: now,
        reason: input.reason,
      }],
      createdAt: now,
      updatedAt: now,
    };

    await this.store.addConflict(conflict);
    return conflict.id;
  }

  async listConflicts(filter?: { statuses?: ConflictStatus[]; relatedFindingIds?: string[]; limit?: number }): Promise<FindingConflict[]> {
    const conflicts = await this.store.queryConflicts({
      findingIds: filter?.relatedFindingIds,
      statuses: filter?.statuses,
    });

    const limit = filter?.limit ?? 50;
    return conflicts.slice(0, limit);
  }
}

/**
 * Throw on duplicate IDs in the input array. Order does not matter; the
 * first repeat encountered is the offender.
 */
function assertUniqueFindingIds(findingIds: string[]): void {
  const seen = new Set<string>();
  for (const id of findingIds) {
    if (seen.has(id)) {
      throw new Error(`Duplicate finding ID: ${id}`);
    }
    seen.add(id);
  }
}
