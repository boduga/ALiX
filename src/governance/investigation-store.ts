/**
 * P9.6 — InvestigationStore: append-only JSONL store for InvestigationRecommendation records.
 *
 * One JSONL file `.alix/governance/investigations.jsonl`. save() appends a new record.
 * updateStatus() appends a new version — never rewrites in place. get()/list() resolve
 * the latest version per id (last-wins within ascending line order).
 *
 * @module
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  InvestigationRecommendation,
  InvestigationFilter,
  InvestigationStatus,
} from "./investigation-types.js";

const FILE_NAME = "investigations.jsonl";

export class InvestigationStore {
  constructor(
    private readonly storeDir: string = join(process.cwd(), ".alix", "governance"),
  ) {}

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private filePath(): string {
    return join(this.storeDir, FILE_NAME);
  }

  /** Read all lines, parse JSON, return array. Skips corrupt lines silently. */
  private readAll(): InvestigationRecommendation[] {
    const path = this.filePath();
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    const results: InvestigationRecommendation[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // skip corrupt lines
      }
    }
    return results;
  }

  /**
   * Resolve the latest version per id (last-wins in array order).
   */
  private resolveLatest(records: InvestigationRecommendation[]): Map<string, InvestigationRecommendation> {
    const map = new Map<string, InvestigationRecommendation>();
    for (const r of records) {
      map.set(r.id, r);
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Append a new investigation record to the JSONL file.
   */
  async save(investigation: InvestigationRecommendation): Promise<void> {
    this.ensureDir();
    const line = JSON.stringify(investigation) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
  }

  /**
   * Get the latest version of an investigation by id.
   * Returns null if no record with that id exists.
   */
  async get(id: string): Promise<InvestigationRecommendation | null> {
    const all = this.readAll();
    const latest = this.resolveLatest(all);
    return latest.get(id) ?? null;
  }

  /**
   * List investigations, optionally filtered by kind/status/severity.
   * Returns the latest version per id, sorted by createdAt descending.
   */
  async list(filter?: InvestigationFilter): Promise<InvestigationRecommendation[]> {
    const all = this.readAll();
    const latest = this.resolveLatest(all);
    let results = Array.from(latest.values());

    if (filter?.kind) {
      results = results.filter((r) => r.kind === filter.kind);
    }
    if (filter?.status) {
      results = results.filter((r) => r.status === filter.status);
    }
    if (filter?.severity) {
      results = results.filter((r) => r.severity === filter.severity);
    }

    results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return results;
  }

  /**
   * Update the status of an investigation by appending a new version.
   * Does not rewrite the file. If no record with that id exists, the
   * call is a silent no-op.
   *
   * @param id - Investigation ID
   * @param status - New status
   * @param opts - Optional: resolution text, assignedTo
   */
  async updateStatus(
    id: string,
    status: InvestigationStatus,
    opts?: { resolution?: string; assignedTo?: string },
  ): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return; // silent no-op

    const now = new Date().toISOString();
    const updated: InvestigationRecommendation = {
      ...existing,
      status,
      updatedAt: now,
      ...(opts?.assignedTo ? { assignedTo: opts.assignedTo } : {}),
      ...(status === "resolved"
        ? { resolvedAt: now, resolution: opts?.resolution ?? "Operator resolved" }
        : {}),
    };

    await this.save(updated);
  }
}
