/**
 * P10.5b — Outcome Report Store.
 *
 * Append-once immutable store for evaluation outcome reports. Uses the
 * same atomic-write pattern as PlanStore: .tmp → fsync → renameSync.
 * ContentHash is verified on every load.
 *
 * The store is disposable — deleting the outcomes directory loses
 * nothing from the execution layer.
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
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PersistedOutcomeReport {
  schemaVersion: "p10.5b.0";
  id: string;
  contentHash: string;
  report: ExecutiveOutcomeEvaluationReport;
}

export interface OutcomeReportMeta {
  reportId: string;
  planId: string;
  evaluationStatus: string;
  overallDelta: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}

function buildReportId(planId: string, generatedAt: string): string {
  return `outcome-${planId}-${sanitizeTimestamp(generatedAt)}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class OutcomeReportStore {
  constructor(private readonly dir: string) {}

  save(report: ExecutiveOutcomeEvaluationReport): string {
    const id = buildReportId(report.planId, report.generatedAt);
    const contentHash = sha256(JSON.stringify(report));

    const wrapper: PersistedOutcomeReport = {
      schemaVersion: "p10.5b.0",
      id,
      contentHash,
      report,
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

  load(reportId: string): ExecutiveOutcomeEvaluationReport | null {
    const targetPath = join(this.dir, `${reportId}.json`);
    if (!existsSync(targetPath)) return null;

    const raw = readFileSync(targetPath, "utf-8");
    let parsed: PersistedOutcomeReport;
    try {
      parsed = JSON.parse(raw) as PersistedOutcomeReport;
    } catch {
      throw new Error(`Outcome report ${reportId}: invalid JSON`);
    }

    if (parsed.schemaVersion !== "p10.5b.0") {
      throw new Error(`Outcome report ${reportId}: unknown schemaVersion "${parsed.schemaVersion}"`);
    }

    const expectedHash = sha256(JSON.stringify(parsed.report));
    if (parsed.contentHash !== expectedHash) {
      throw new Error(
        `Outcome report ${reportId}: contentHash mismatch — expected ${expectedHash}, got ${parsed.contentHash}`,
      );
    }

    return parsed.report;
  }

  list(): OutcomeReportMeta[] {
    if (!existsSync(this.dir)) return [];

    const files = readdirSync(this.dir).filter(f => f.startsWith("outcome-") && f.endsWith(".json"));
    const results: OutcomeReportMeta[] = [];

    for (const file of files) {
      const reportId = file.replace(/\.json$/, "");
      try {
        const report = this.load(reportId);
        if (!report) continue;
        results.push({
          reportId,
          planId: report.planId,
          evaluationStatus: report.evaluationStatus,
          overallDelta: report.overallDelta,
          generatedAt: report.generatedAt,
        });
      } catch (e: any) {
        console.warn(`Skipping corrupt outcome report: ${file} — ${e.message}`);
      }
    }

    results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return results;
  }
}
