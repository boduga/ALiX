import { mkdir, readFile, writeFile, rm, cp, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

export type Checkpoint = {
  id: string;
  path: string;
  originalPath: string;
  createdAt: string;
  sessionId: string;
};

export class CheckpointManager {
  private sessionId: string;

  constructor(private baseDir: string, sessionId?: string) {
    this.sessionId = sessionId ?? randomUUID();
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async createCheckpoint(filePath: string): Promise<Checkpoint> {
    const id = randomUUID();
    const checkpoint: Checkpoint = {
      id,
      path: filePath,
      originalPath: filePath,
      createdAt: new Date().toISOString(),
      sessionId: this.sessionId,
    };

    const checkpointDir = join(this.baseDir, id);
    await mkdir(checkpointDir, { recursive: true });

    // Store the file with its basename
    const destPath = join(checkpointDir, basename(filePath));
    try {
      await cp(filePath, destPath, { recursive: true });
    } catch (err) {
      // File may not exist yet - that's ok for checkpoint creation
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    await writeFile(join(checkpointDir, "metadata.json"), JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }

  async restore(checkpointId: string): Promise<void> {
    const checkpointDir = join(this.baseDir, checkpointId);
    const metadataPath = join(checkpointDir, "metadata.json");

    try {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Checkpoint;
      const srcPath = join(checkpointDir, basename(metadata.originalPath));
      await cp(srcPath, metadata.path, { recursive: true });
    } catch (err) {
      throw new Error(`Checkpoint ${checkpointId} not found or corrupted`);
    }
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpointDir = join(this.baseDir, checkpointId);
    const metadataPath = join(checkpointDir, "metadata.json");
    // Check if checkpoint exists
    try {
      await readFile(metadataPath, "utf8");
    } catch {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }
    await rm(checkpointDir, { recursive: true, force: true });
  }

  async listCheckpoints(): Promise<Checkpoint[]> {
    const entries = await readdir(this.baseDir).catch(() => []);
    const checkpoints: Checkpoint[] = [];

    for (const id of entries) {
      const metadataPath = join(this.baseDir, id, "metadata.json");
      try {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Checkpoint;
        checkpoints.push(metadata);
      } catch {
        // Skip corrupted entries
      }
    }

    return checkpoints.filter((c) => c.sessionId === this.sessionId);
  }
}