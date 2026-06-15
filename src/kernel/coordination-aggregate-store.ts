/**
 * coordination-aggregate-store.ts — Atomic aggregate result persistence.
 *
 * Stores RunResultSummary at .alix/coordination/results/runs/<runId>.json.
 * Written atomically via tmp + rename. Returns workspace-relative ref.
 */

import { writeFile, rename as renameFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunResultSummary } from "./coordination-result-types.js";

export class CoordinationAggregateStore {
  private baseDir: string;

  constructor(cwd: string) {
    this.baseDir = join(cwd, ".alix", "coordination", "results", "runs");
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  async persist(summary: RunResultSummary): Promise<string> {
    await this.ensureDir();
    const fileName = `${summary.runId}.json`;
    const token = randomUUID().slice(0, 8);
    const tmpPath = join(this.baseDir, `${fileName}.tmp.${token}`);
    const finalPath = join(this.baseDir, fileName);
    await writeFile(tmpPath, JSON.stringify(summary, null, 2), "utf-8");
    await renameFile(tmpPath, finalPath);
    return `.alix/coordination/results/runs/${fileName}`;
  }

  async load(runId: string): Promise<RunResultSummary | null> {
    const path = join(this.baseDir, `${runId}.json`);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.schemaVersion !== "1.0") return null;
      if (parsed.runId !== runId) return null;
      return parsed as RunResultSummary;
    } catch {
      return null;
    }
  }
}
