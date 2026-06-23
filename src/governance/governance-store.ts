/**
 * P9.0a — GovernanceStore: append-only JSONL store for meta-governance artifacts.
 *
 * One JSONL file per artifact type under `.alix/governance/`. Mirrors the
 * P7.5p per-artifact JSONL pattern. Workers append, consumers list/query.
 *
 * P9 may write only GovernanceStore. All 6 P8 stores are structurally
 * unreachable from this module.
 *
 * @module
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  GovernanceHealthReport,
  GovernanceAssessment,
  GovernanceDriftReport,
  LensLifecycleReview,
  GovernanceIntegrityReport,
} from "./governance-types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const STORE_DIR = join(".alix", "governance");

const FILES: Record<string, string> = {
  health: "health.jsonl",
  assessment: "assessment.jsonl",
  drift: "drift.jsonl",
  lensReviews: "lens-reviews.jsonl",
  integrity: "integrity.jsonl",
};

type ArtifactType = keyof typeof FILES;

// ---------------------------------------------------------------------------
// GovernanceStore
// ---------------------------------------------------------------------------

export class GovernanceStore {
  constructor(
    private readonly storeDir: string = join(process.cwd(), STORE_DIR),
  ) {}

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) mkdirSync(this.storeDir, { recursive: true });
  }

  private filePath(type: ArtifactType): string {
    return join(this.storeDir, FILES[type]);
  }

  /** Resolve which JSONL file an artifact ID belongs to based on its prefix. */
  getTypeForId(id: string): "health" | "assessment" | "drift" | "lensReviews" | "integrity" | null {
    if (id.startsWith("health-")) return "health";
    if (id.startsWith("assessment-")) return "assessment";
    if (id.startsWith("drift-")) return "drift";
    if (id.startsWith("lens-review-")) return "lensReviews";
    if (id.startsWith("integrity-")) return "integrity";
    return null;
  }

  // -----------------------------------------------------------------------
  // append — overloaded per artifact type
  // -----------------------------------------------------------------------

  async append(type: "health", record: GovernanceHealthReport): Promise<void>;
  async append(type: "assessment", record: GovernanceAssessment): Promise<void>;
  async append(type: "drift", record: GovernanceDriftReport): Promise<void>;
  async append(type: "lensReviews", record: LensLifecycleReview): Promise<void>;
  async append(type: "integrity", record: GovernanceIntegrityReport): Promise<void>;
  async append(type: ArtifactType, record: any): Promise<void> {
    this.ensureDir();
    const line = JSON.stringify(record) + "\n";
    appendFileSync(this.filePath(type), line, "utf-8");
  }

  // -----------------------------------------------------------------------
  // list — overloaded per artifact type
  // -----------------------------------------------------------------------

  async list(type: "health"): Promise<GovernanceHealthReport[]>;
  async list(type: "assessment"): Promise<GovernanceAssessment[]>;
  async list(type: "drift"): Promise<GovernanceDriftReport[]>;
  async list(type: "lensReviews"): Promise<LensLifecycleReview[]>;
  async list(type: "integrity"): Promise<GovernanceIntegrityReport[]>;
  async list(type: ArtifactType): Promise<any[]> {
    const path = this.filePath(type);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    const results: any[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { results.push(JSON.parse(trimmed)); } catch { /* skip corrupt */ }
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // queryByWindow — filter by generatedAt within the last windowDays
  // -----------------------------------------------------------------------

  async queryByWindow(type: "health", windowDays: number): Promise<GovernanceHealthReport[]>;
  async queryByWindow(type: "assessment", windowDays: number): Promise<GovernanceAssessment[]>;
  async queryByWindow(type: "drift", windowDays: number): Promise<GovernanceDriftReport[]>;
  async queryByWindow(type: "lensReviews", windowDays: number): Promise<LensLifecycleReview[]>;
  async queryByWindow(type: "integrity", windowDays: number): Promise<GovernanceIntegrityReport[]>;
  async queryByWindow(type: ArtifactType, windowDays: number): Promise<any[]> {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const all = await (this.list as (t: ArtifactType) => Promise<any[]>)(type);
    return all.filter((r) => new Date(r.generatedAt).getTime() >= cutoff);
  }
}
