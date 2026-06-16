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
import type {
  SharedFinding, SharedArtifact, CollaborationActor,
  FindingFilter, PublishFindingInput, PublishArtifactInput,
} from "./collaboration-types.js";
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
}
