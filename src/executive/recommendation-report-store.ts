/**
 * P10.7b — Recommendation Report Store.
 *
 * Append-once immutable store for RecommendationReport artifacts. Mirrors
 * OutcomeReportStore pattern: .tmp → fsync → renameSync atomic write,
 * contentHash verified on every load, list() filters corrupt files.
 *
 * Storage: .alix/executive/recommendations/recommendation-<id>.json
 *
 * This store is the ONLY writer in P10.7b. It does not invoke the proposal
 * store, approval gate, or outcome evaluation. Reserved fields
 * (proposalId, governanceStatus, disposition, outcomeConfidence,
 * outcomeSummary) live in the schema but are never populated in P10.7b —
 * population belongs to P10.7c and P10.8.
 *
 * @module
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { RecommendationDraft } from "./recommendation-engine.js";
import { buildRecommendationReportId } from "./recommendation-report-id.js";

export { buildRecommendationReportId };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-recommendation extension of the engine output with reserved fields for
 * P10.7c (proposal bridge) and P10.8 (effectiveness). None of the
 * reserved fields are populated in P10.7b.
 */
export interface ExecutiveRecommendation extends RecommendationDraft {
  // P10.7c bridge — reserved
  proposalId?: string;
  governanceStatus?:
    | "not_proposed"
    | "proposed"
    | "approved"
    | "rejected"
    | "applied";

  // P10.8 forward-compat — reserved
  disposition?:
    | "unreviewed"
    | "ignored"
    | "accepted"
    | "informally_acted_on"
    | "converted_to_proposal";
  outcomeConfidence?: number;
  outcomeSummary?: string;
}

export interface NewRecommendationReport {
  generatedAt: string;
  requestedWindow: number;
  recommendationStatus: "ok" | "insufficient_data";
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  evidenceReportIds: string[];
  recommendations: ExecutiveRecommendation[];
  warnings: string[];
  loadWarnings: string[];
}

export interface RecommendationReport {
  schemaVersion: "p10.7b.0";
  id: string;
  contentHash: string;
  report: NewRecommendationReport;
}

export interface RecommendationReportMeta {
  reportId: string;
  generatedAt: string;
  recommendationStatus: string;
  recommendationCount: number;
}

/**
 * Thrown by RecommendationReportStore.load() when the persisted report's
 * integrity cannot be verified: contentHash mismatch, malformed JSON, or
 * unknown schema version. Used by callers to detect and preserve corrupted
 * audit artifacts instead of overwriting them.
 */
export class RecommendationReportIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecommendationReportIntegrityError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class RecommendationReportStore {
  constructor(private readonly dir: string) {}

  save(payload: NewRecommendationReport): string {
    const id = buildRecommendationReportId(payload.generatedAt);
    const contentHash = sha256(JSON.stringify(payload));

    const wrapper: RecommendationReport = {
      schemaVersion: "p10.7b.0",
      id,
      contentHash,
      report: payload,
    };

    const targetPath = join(this.dir, `${id}.json`);
    const tmpPath = targetPath + ".tmp";

    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const fd = openSync(tmpPath, "w");
    try {
      writeFileSync(fd, JSON.stringify(wrapper, null, 2), "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, targetPath);

    return id;
  }

  load(reportId: string): RecommendationReport | null {
    const targetPath = join(this.dir, `${reportId}.json`);
    if (!existsSync(targetPath)) return null;

    const raw = readFileSync(targetPath, "utf-8");
    let parsed: RecommendationReport;
    try {
      parsed = JSON.parse(raw) as RecommendationReport;
    } catch {
      throw new RecommendationReportIntegrityError(
        `Recommendation report ${reportId}: invalid JSON`,
      );
    }

    if (parsed.schemaVersion !== "p10.7b.0") {
      throw new RecommendationReportIntegrityError(
        `Recommendation report ${reportId}: unknown schemaVersion "${parsed.schemaVersion}"`,
      );
    }

    const { schemaVersion, id, contentHash, report } = parsed;
    const expectedHash = sha256(JSON.stringify(report));
    if (contentHash !== expectedHash) {
      throw new RecommendationReportIntegrityError(
        `Recommendation report ${reportId}: contentHash mismatch — expected ${expectedHash}, got ${contentHash}`,
      );
    }

    return parsed;
  }

  list(): RecommendationReportMeta[] {
    if (!existsSync(this.dir)) return [];

    const files = readdirSync(this.dir).filter(
      (f) => f.startsWith("recommendation-") && f.endsWith(".json"),
    );
    const results: RecommendationReportMeta[] = [];

    for (const file of files) {
      const reportId = file.replace(/\.json$/, "");
      try {
        const report = this.load(reportId);
        if (!report) continue;
        results.push({
          reportId,
          generatedAt: report.report.generatedAt,
          recommendationStatus: report.report.recommendationStatus,
          recommendationCount: report.report.recommendations.length,
        });
      } catch (e: any) {
        console.warn(`Skipping corrupt recommendation report: ${file} — ${e.message}`);
      }
    }

    results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return results;
  }
}