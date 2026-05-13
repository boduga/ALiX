import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type Checkpoint = {
  id: string;
  root: string;
  files: string[];
};

export async function createFileCheckpoint(root: string, files: string[]): Promise<Checkpoint> {
  const id = randomUUID();
  for (const file of files) {
    const target = join(root, ".alix", "checkpoints", id, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
  }
  return { id, root, files };
}
