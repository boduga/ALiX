/**
 * artifact-writer.ts — Write research report artifacts to disk.
 *
 * Each artifact is written to .alix/reports/<reportId>/.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface ReportArtifacts {
  finalReport: string;
  sources: Array<{ url: string; title: string; credibility: string }>;
  claims: Array<{ claim: string; sourceUrl: string }>;
  criticReview: string;
}

export async function writeReportArtifacts(
  cwd: string,
  reportId: string,
  artifacts: ReportArtifacts,
): Promise<string> {
  const dir = join(cwd, ".alix", "reports", reportId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  await writeFile(join(dir, "final_report.md"), artifacts.finalReport, "utf-8");
  await writeFile(join(dir, "sources.json"), JSON.stringify(artifacts.sources, null, 2), "utf-8");
  await writeFile(join(dir, "claims.json"), JSON.stringify(artifacts.claims, null, 2), "utf-8");
  await writeFile(join(dir, "critic_review.md"), artifacts.criticReview, "utf-8");

  const manifest = {
    reportId,
    createdAt: new Date().toISOString(),
    artifactCount: 4,
    artifacts: ["final_report.md", "sources.json", "claims.json", "critic_review.md"],
  };
  await writeFile(join(dir, "run_manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  return dir;
}
