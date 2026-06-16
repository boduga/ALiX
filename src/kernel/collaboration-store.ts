/**
 * collaboration-store.ts — Lock-safe, run-scoped store for shared findings and artifacts.
 *
 * State file: .alix/coordination/shared/<runId>/state.json
 * Manifests:  .alix/coordination/shared/<runId>/manifests/<workerId>-attempt-<n>.json
 * Lock:       .alix/coordination/shared/locks/<runId>.lock
 *
 * All writes go through mutate<T>() for atomicity.
 * Workers may only mutate records they created.
 */

import { writeFile, rename as renameFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CollaborationRunLock } from "./collaboration-run-lock.js";
import { validatePublishFindingInput, validatePublishArtifactInput, canonicalizeFindingInput, normalizeStateV1_0 } from "./collaboration-validation.js";
import type { FindingConflict, ConflictStatus } from "./collaboration-conflict-types.js";
import type {
  SharedFinding, SharedArtifact, WorkerContextManifest, CollaborationState,
  CollaborationActor, FindingFilter, PublishFindingInput, PublishArtifactInput,
} from "./collaboration-types.js";

const DEFAULT_STATE: CollaborationState = {
  schemaVersion: "1.0",
  runId: "",
  revision: 0,
  findings: [],
  artifacts: [],
  conflicts: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Build a fresh default state with its own mutable arrays. Module-level
 * DEFAULT_STATE is a shape reference; do not seed instances from it
 * directly — that would share array references between stores, which
 * causes cross-instance contamination when one instance mutates an
 * array and another instance "sees" the mutation through the constant.
 */
function createDefaultState(): CollaborationState {
  return {
    schemaVersion: DEFAULT_STATE.schemaVersion,
    runId: "",
    revision: 0,
    findings: [],
    artifacts: [],
    conflicts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export class CollaborationStore {
  private readonly cwd: string;
  private readonly runId: string;
  private readonly statePath: string;
  private readonly manifestsDir: string;
  private state: CollaborationState = createDefaultState();

  constructor(cwd: string, runId: string) {
    this.cwd = cwd;
    this.runId = runId;
    this.statePath = join(cwd, ".alix", "coordination", "shared", runId, "state.json");
    this.manifestsDir = join(cwd, ".alix", "coordination", "shared", runId, "manifests");
  }

  private async ensureDirs(): Promise<void> {
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    if (!existsSync(this.manifestsDir)) {
      await mkdir(this.manifestsDir, { recursive: true });
    }
  }

  private async loadState(): Promise<void> {
    if (!existsSync(this.statePath)) {
      this.state = { ...createDefaultState(), runId: this.runId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      return;
    }
    try {
      const raw = await readFile(this.statePath, "utf-8");
      const parsed = JSON.parse(raw);
      this.state = normalizeStateV1_0(parsed);
    } catch {
      this.state = { ...createDefaultState(), runId: this.runId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
  }

  private async saveState(): Promise<void> {
    this.state.updatedAt = new Date().toISOString();
    const token = randomUUID().slice(0, 8);
    const tmpPath = `${this.statePath}.tmp.${token}`;
    await writeFile(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
    await renameFile(tmpPath, this.statePath);
  }

  async mutate<T>(fn: (state: CollaborationState) => T | Promise<T>): Promise<T> {
    const lock = new CollaborationRunLock(this.cwd, this.runId);
    const acquired = await lock.acquire();
    if (!acquired) throw new Error("Could not acquire collaboration lock");
    try {
      await this.loadState();
      const result = await fn(this.state);
      this.state.revision++;
      await this.saveState();
      return result;
    } finally {
      lock.release();
    }
  }

  /**
   * Read-only access to the current state. Like `mutate` it loads fresh
   * state from disk, but it does NOT acquire the lock, bump the revision,
   * or rewrite the state file. Inspector and view-layer consumers must
   * use this for GETs; mutating selectors here will not be persisted.
   */
  async read<T>(selector: (state: CollaborationState) => T | Promise<T>): Promise<T> {
    await this.loadState();
    return selector(this.state);
  }

  async publishFinding(input: PublishFindingInput, actor: CollaborationActor): Promise<SharedFinding> {
    const errors = validatePublishFindingInput(input);
    if (errors.length > 0) throw new Error(`Finding validation failed: ${errors.join("; ")}`);

    return this.mutate((state) => {
      const now = new Date().toISOString();
      const canonical = canonicalizeFindingInput(input);
      const finding: SharedFinding = {
        id: `finding_${randomUUID()}`,
        schemaVersion: "1.0",
        runId: this.runId,
        workerId: actor.workerId,
        workerAttempt: actor.workerAttempt,
        kind: canonical.kind,
        title: canonical.title,
        content: canonical.content,
        confidence: canonical.confidence,
        tags: canonical.tags ?? [],
        evidenceRefs: canonical.evidenceRefs ?? [],
        artifactRefs: canonical.artifactRefs ?? [],
        createdAt: now,
        updatedAt: now,
      };
      state.findings.push(finding);
      return finding;
    });
  }

  async publishArtifact(input: PublishArtifactInput, actor: CollaborationActor): Promise<SharedArtifact> {
    return this.mutate((state) => {
      const now = new Date().toISOString();
      const artifact: SharedArtifact = {
        id: `artifact_${randomUUID()}`,
        schemaVersion: "1.0",
        runId: this.runId,
        workerId: actor.workerId,
        workerAttempt: actor.workerAttempt,
        kind: input.kind,
        uri: input.uri,
        mediaType: input.mediaType,
        digest: input.digest,
        sizeBytes: input.sizeBytes,
        ownershipClaims: input.ownershipClaims ?? [],
        createdAt: now,
        updatedAt: now,
      };
      state.artifacts.push(artifact);
      return artifact;
    });
  }

  async queryFindings(filter: FindingFilter): Promise<SharedFinding[]> {
    await this.loadState();
    let results = this.state.findings;

    if (filter.kinds && filter.kinds.length > 0) {
      results = results.filter(f => filter.kinds!.includes(f.kind));
    }
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(f => filter.tags!.some(t => f.tags.includes(t)));
    }
    if (filter.workerIds && filter.workerIds.length > 0) {
      results = results.filter(f => filter.workerIds!.includes(f.workerId));
    }
    if (filter.since) {
      results = results.filter(f => f.createdAt >= filter.since!);
    }

    // Exclude invalidated and superseded by default
    results = results.filter(f => !f.invalidatedAt && !f.supersededBy);

    // Sort by createdAt descending (newest first)
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const limit = filter.limit ?? 50;
    return results.slice(0, limit);
  }

  async getFindings(ids: string[]): Promise<SharedFinding[]> {
    await this.loadState();
    const idSet = new Set(ids);
    return this.state.findings.filter(f => idSet.has(f.id));
  }

  async getArtifacts(ids?: string[]): Promise<SharedArtifact[]> {
    await this.loadState();
    if (!ids) return [...this.state.artifacts];
    const idSet = new Set(ids);
    return this.state.artifacts.filter(a => idSet.has(a.id));
  }

  async getWorkerFindings(workerId: string): Promise<SharedFinding[]> {
    await this.loadState();
    return this.state.findings.filter(f => f.workerId === workerId && !f.invalidatedAt && !f.supersededBy);
  }

  async supersedeFinding(id: string, replacementId: string, actor: CollaborationActor): Promise<boolean> {
    return this.mutate((state) => {
      const finding = state.findings.find(f => f.id === id);
      if (!finding || finding.workerId !== actor.workerId) return false;
      finding.supersededBy = replacementId;
      finding.updatedAt = new Date().toISOString();
      return true;
    });
  }

  async markFindingInvalid(id: string, reason: string, actor: CollaborationActor): Promise<boolean> {
    return this.mutate((state) => {
      const finding = state.findings.find(f => f.id === id);
      if (!finding || finding.workerId !== actor.workerId) return false;
      finding.invalidatedAt = new Date().toISOString();
      finding.invalidationReason = reason;
      finding.updatedAt = new Date().toISOString();
      return true;
    });
  }

  async persistManifest(manifest: WorkerContextManifest): Promise<string> {
    await this.ensureDirs();
    const fileName = `${manifest.workerId}-attempt-${manifest.workerAttempt}.json`;
    const filePath = join(this.manifestsDir, fileName);
    const token = randomUUID().slice(0, 8);
    const tmpPath = `${filePath}.tmp.${token}`;
    await writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
    await renameFile(tmpPath, filePath);
    return `.alix/coordination/shared/${this.runId}/manifests/${fileName}`;
  }

  async loadManifestByRef(ref: string): Promise<WorkerContextManifest | null> {
    const resolved = join(this.cwd, ref);
    if (!existsSync(resolved)) return null;
    try {
      const raw = await readFile(resolved, "utf-8");
      return JSON.parse(raw) as WorkerContextManifest;
    } catch { return null; }
  }

  async addConflict(conflict: FindingConflict): Promise<FindingConflict> {
    return this.mutate((state) => {
      state.conflicts.push(conflict);
      return conflict;
    });
  }

  async queryConflicts(filter: { findingIds?: string[]; statuses?: ConflictStatus[] }): Promise<FindingConflict[]> {
    await this.loadState();
    let results = this.state.conflicts;

    if (filter.findingIds && filter.findingIds.length > 0) {
      const idSet = new Set(filter.findingIds);
      results = results.filter(c => c.findingIds.some(fid => idSet.has(fid)));
    }

    if (filter.statuses && filter.statuses.length > 0) {
      results = results.filter(c => filter.statuses!.includes(c.status));
    }

    return results;
  }

  getRevision(): number {
    return this.state.revision;
  }
}
