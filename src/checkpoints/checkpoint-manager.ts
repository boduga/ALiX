import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type Checkpoint = {
  id: string;
  root: string;
  files: string[];
  missingFiles: string[];
};

export async function createFileCheckpoint(root: string, files: string[]): Promise<Checkpoint> {
  const id = randomUUID();
  const missingFiles: string[] = [];
  for (const file of files) {
    const source = resolveCheckpointPath(root, file);
    const target = join(root, ".alix", "checkpoints", id, file);
    if (!existsSync(source)) {
      missingFiles.push(file);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  return { id, root, files, missingFiles };
}

export async function restoreFileCheckpoint(checkpoint: Checkpoint): Promise<void> {
  for (const file of checkpoint.files) {
    const destination = resolveCheckpointPath(checkpoint.root, file);
    if (checkpoint.missingFiles.includes(file)) {
      await rm(destination, { force: true });
      continue;
    }
    const source = join(checkpoint.root, ".alix", "checkpoints", checkpoint.id, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

function resolveCheckpointPath(root: string, file: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, file);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`Checkpoint path is outside workspace: ${file}`);
  }
  return resolvedPath;
}
