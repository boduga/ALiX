import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProjectionStateSnapshot } from './projection-state.js';
// Re-export the state types (defined in projection-state.ts) so existing
// importers of this module — the runtime-collector and future ProjectionRuntime —
// keep resolving them without a layering inversion into the builder module.
export type { ProjectionState, ProjectionStateSnapshot } from './projection-state.js';

const CHECKPOINT_FILE = 'projection-checkpoint.json';
const TMP_SUFFIX = '.tmp';
export const CHECKPOINT_CONTAINER_VERSION = 1;

// PersistedProjectionCheckpoint (defined above) IS the envelope written to
// disk; CHECKPOINT_CONTAINER_VERSION is its literal version field.

/** The persisted form of a projection checkpoint. `committedAt` is the instant
 *  this projection became durable (D5 — the checkpoint is the durable commit
 *  marker). The cursor string is opaque to the store. `projections` (Phase 7)
 *  is the registry-keyed durable projection state (ProjectionRuntime
 *  exportState), saved in the SAME atomic transaction as the cursor so
 *  save-before-publish holds for state too. `state` (Phase 6.5) remains the
 *  legacy shape — a collector restores `projections ?? state` (dual-shape
 *  load), and the store never migrates state → projections on save. */
export interface PersistedProjectionCheckpoint {
  readonly version: 1;
  readonly cursor: string;
  readonly committedAt: number;
  readonly state?: ProjectionStateSnapshot;
  readonly projections?: ProjectionStateSnapshot;
}

/** Persistence boundary for projection checkpoints. Owns atomic disk writes and
 *  the container envelope. Does NOT interpret cursors, touch the EventLog, or
 *  run projection logic (D3). The cursor STRING is opaque — the collector
 *  serializes/deserializes it via the EventLog around this store (D7: the
 *  runtime layer never touches a cursorString, but the store's boundary is the
 *  serialized form). Dependency graph: EventLog ↑ Collector ↓ CheckpointStore. */
export interface ProjectionCheckpointStore {
  load(): Promise<PersistedProjectionCheckpoint | null>;
  save(checkpoint: PersistedProjectionCheckpoint): Promise<void>;
}

/** Filesystem store. Writes to `<sessionDir>/projection-checkpoint.json` via
 *  atomic tmp+rename (POSIX rename is atomic, so a crash mid-write never
 *  leaves a half-written file). */
export class FileProjectionCheckpointStore implements ProjectionCheckpointStore {
  private readonly path: string;
  private readonly tmpPath: string;

  constructor(sessionDir: string) {
    this.path = join(sessionDir, CHECKPOINT_FILE);
    this.tmpPath = this.path + TMP_SUFFIX;
  }

  async load(): Promise<PersistedProjectionCheckpoint | null> {
    if (!existsSync(this.path)) return null;
    const raw = await readFile(this.path, 'utf-8');
    let parsed: Partial<PersistedProjectionCheckpoint>;
    try {
      parsed = JSON.parse(raw) as Partial<PersistedProjectionCheckpoint>;
    } catch {
      return null; // corrupt — treat as not-found
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (parsed.version !== CHECKPOINT_CONTAINER_VERSION) return null; // unknown envelope
    if (typeof parsed.cursor !== 'string' || typeof parsed.committedAt !== 'number') return null;
    if (parsed.state !== undefined) {
      if (typeof parsed.state !== 'object' || parsed.state === null || Array.isArray(parsed.state)) return null;
    }
    if (parsed.projections !== undefined) {
      if (typeof parsed.projections !== 'object' || parsed.projections === null || Array.isArray(parsed.projections)) return null;
    }
    return {
      version: CHECKPOINT_CONTAINER_VERSION,
      cursor: parsed.cursor,
      committedAt: parsed.committedAt,
      ...(parsed.state !== undefined ? { state: parsed.state } : {}),
      ...(parsed.projections !== undefined ? { projections: parsed.projections } : {}),
    };
  }

  async save(checkpoint: PersistedProjectionCheckpoint): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.tmpPath, JSON.stringify(checkpoint, null, 2) + '\n', 'utf-8');
    await rename(this.tmpPath, this.path);
  }
}
