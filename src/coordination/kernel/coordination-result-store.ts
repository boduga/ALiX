/**
 * coordination-result-store.ts — Atomic result persistence for completed workers.
 *
 * Results stored at .alix/coordination/results/<workerId>.json
 * Written atomically via tmp + rename. Relative refs are workspace-relative.
 */

import { writeFile, rename as renameFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, isAbsolute, resolve } from "node:path";
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

export type ResultLoadResult =
  | { status: "ok"; record: CoordinationWorkerResultRecord }
  | { status: "missing"; message: string }
  | { status: "corrupt"; message: string }
  | { status: "invalid_ref"; message: string }
  | { status: "invalid_record"; message: string };

export function validateWorkerResultRecord(value: unknown): value is CoordinationWorkerResultRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return r.schemaVersion === "1.0"
    && typeof r.runId === "string"
    && typeof r.workerId === "string"
    && typeof r.agentId === "string"
    && typeof r.attempt === "number"
    && (r.outcome === "success" || r.outcome === "failure")
    && typeof r.completedAt === "string";
}

export function requiresResultRecord(worker: WorkerAssignment): boolean {
  // Workers that actually executed need a result file
  if (worker.status === "completed") return true;
  if (worker.status === "failed") {
    // Dependency-blocked, orphaned, or pre-start denials don't produce results
    if (worker.blockReason === "dependency_failed") return false;
    if (worker.blockReason === "orphaned" && !worker.startedAt) return false;
    if (worker.blockReason === "authorization_denied" && !worker.startedAt) return false;
    // Everything else (execution failures, timeouts, etc.) should have a result
    return true;
  }
  return false;
}

export class CoordinationResultStore {
  private readonly cwd: string;
  private readonly baseDir: string;

  constructor(cwd: string) {
    this.cwd = cwd;
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

  /**
   * Load and validate a worker result by its workspace-relative ref.
   * Returns a structured ResultLoadResult — never throws for missing/corrupt data.
   */
  async loadByRef(resultRef: string): Promise<ResultLoadResult> {
    // Reject absolute paths
    if (isAbsolute(resultRef)) {
      return { status: "invalid_ref", message: "Absolute paths not allowed" };
    }
    // Resolve against workspace root, not baseDir
    const resolved = resolve(this.cwd, resultRef);
    const rel = relative(this.baseDir, resolved);
    // The resolved path must be within the results directory and be a .json file
    if (rel.startsWith("..") || isAbsolute(rel) || !rel.endsWith(".json")) {
      return { status: "invalid_ref", message: "Reference outside result directory or invalid format" };
    }
    // Reject aggregate runs/ paths (those are not worker results)
    if (rel.startsWith("runs/")) {
      return { status: "invalid_ref", message: "Cannot load aggregate as worker result" };
    }
    // Check existence
    if (!existsSync(resolved)) {
      return { status: "missing", message: `Result not found: ${resultRef}` };
    }
    // Parse and validate
    try {
      const raw = await readFile(resolved, "utf-8");
      const parsed = JSON.parse(raw);
      if (!validateWorkerResultRecord(parsed)) {
        return { status: "invalid_record", message: "Result record failed validation" };
      }
      return { status: "ok", record: parsed };
    } catch (e) {
      return { status: "corrupt", message: `Failed to parse result: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Load all worker results for a run by scanning the result directory.
   * This is an administrative helper — the aggregator uses loadByRef per worker.
   */
  async loadByRun(runId: string): Promise<CoordinationWorkerResultRecord[]> {
    const results: CoordinationWorkerResultRecord[] = [];
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(this.baseDir);
      for (const file of files) {
        if (!file.endsWith(".json") || file.startsWith("runs/")) continue;
        const ref = `.alix/coordination/results/${file}`;
        const loaded = await this.loadByRef(ref);
        if (loaded.status === "ok" && loaded.record.runId === runId) {
          results.push(loaded.record);
        }
      }
    } catch { /* return partial results */ }
    return results;
  }
}
