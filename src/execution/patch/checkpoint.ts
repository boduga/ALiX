import { mkdir, readFile, writeFile, rm, cp, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

export type Checkpoint = {
  id: string;
  patchId: string;
  files: string[];
  createdAt: string;
};

export class CheckpointManager {
  constructor(private checkpointsDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.checkpointsDir, { recursive: true });
  }

  async create(patchId: string, filePaths: string[]): Promise<Checkpoint> {
    const id = randomUUID();
    const checkpoint: Checkpoint = {
      id,
      patchId,
      files: filePaths,
      createdAt: new Date().toISOString(),
    };
    const checkpointDir = join(this.checkpointsDir, id);
    await mkdir(checkpointDir, { recursive: true });
    for (const filePath of filePaths) {
      const destDir = join(checkpointDir, basename(filePath));
      await cp(filePath, destDir, { recursive: true }).catch(() => {});
    }
    await writeFile(join(checkpointDir, "metadata.json"), JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }

  async restore(checkpointId: string): Promise<void> {
    const checkpointDir = join(this.checkpointsDir, checkpointId);
    const metadataPath = join(checkpointDir, "metadata.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Checkpoint;
    for (const filePath of metadata.files) {
      const src = join(checkpointDir, basename(filePath));
      await cp(src, filePath, { recursive: true });
    }
  }

  async list(): Promise<Checkpoint[]> {
    const entries = await readdir(this.checkpointsDir);
    const checkpoints: Checkpoint[] = [];
    for (const id of entries) {
      const metadataPath = join(this.checkpointsDir, id, "metadata.json");
      try {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Checkpoint;
        checkpoints.push(metadata);
      } catch {}
    }
    return checkpoints;
  }

  async delete(checkpointId: string): Promise<void> {
    const checkpointDir = join(this.checkpointsDir, checkpointId);
    await rm(checkpointDir, { recursive: true, force: true });
  }

  async close(): Promise<void> {
    // No-op: CheckpointManager doesn't hold open resources
    // Kept for interface consistency with other managers
  }
}