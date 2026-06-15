/**
 * coordination-result-store.ts — Atomic result persistence for completed workers.
 *
 * Results stored at .alix/coordination/results/<workerId>.json
 * Written atomically via tmp + rename. Relative refs are workspace-relative.
 */

import { writeFile, rename as renameFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkerFailureKind, WorkerAssignment } from "./coordination-types.js";

export type CoordinationWorkerResultRecord = {
  schemaVersion: "1.0";
  runId: string;
  workerId: string;
  agentId: string;
  attempt: number;
  outcome: "success" | "failure";
  summary?: string;
  outputPath?: string;
  error?: string;
  failureKind?: WorkerFailureKind;
  startedAt?: string;
  completedAt: string;
};

export class CoordinationResultStore {
  private baseDir: string;

  constructor(cwd: string) {
    this.baseDir = join(cwd, ".alix", "coordination", "results");
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  async persist(
    worker: WorkerAssignment,
    runId: string,
    result: { outcome: "success" | "failure"; summary?: string; outputPath?: string; error?: string; failureKind?: WorkerFailureKind },
  ): Promise<string> {
    await this.ensureDir();
    const record: CoordinationWorkerResultRecord = {
      schemaVersion: "1.0",
      runId,
      workerId: worker.id,
      agentId: worker.agentId,
      attempt: worker.attempt,
      outcome: result.outcome,
      summary: result.summary,
      outputPath: result.outputPath,
      error: result.error,
      failureKind: result.failureKind,
      startedAt: worker.startedAt,
      completedAt: new Date().toISOString(),
    };
    const fileName = `${worker.id}.json`;
    const token = randomUUID().slice(0, 8);
    const tmpPath = join(this.baseDir, `${fileName}.tmp.${token}`);
    const finalPath = join(this.baseDir, fileName);
    await writeFile(tmpPath, JSON.stringify(record, null, 2), "utf-8");
    await renameFile(tmpPath, finalPath);
    return `.alix/coordination/results/${fileName}`;
  }

  /** Load a result record by worker ID. Returns null if not found. */
  async load(workerId: string): Promise<CoordinationWorkerResultRecord | null> {
    const path = join(this.baseDir, `${workerId}.json`);
    if (!existsSync(path)) return null;
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
