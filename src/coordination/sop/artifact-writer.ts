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

export interface WriteReportOpts {
  cwd: string;
  reportId: string;
  artifacts: ReportArtifacts;
  graphId: string;
  sopId: string;
  topic: string;
  nodeResults?: Array<{ nodeId: string; title: string; status: string }>;
}

export async function writeReportArtifacts(opts: WriteReportOpts): Promise<string> {
  const dir = join(opts.cwd, ".alix", "reports", opts.reportId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  await writeFile(join(dir, "final_report.md"), opts.artifacts.finalReport, "utf-8");
  await writeFile(join(dir, "sources.json"), JSON.stringify(opts.artifacts.sources, null, 2), "utf-8");
  await writeFile(join(dir, "claims.json"), JSON.stringify(opts.artifacts.claims, null, 2), "utf-8");
  await writeFile(join(dir, "critic_review.md"), opts.artifacts.criticReview, "utf-8");

  const manifest = {
    reportId: opts.reportId,
    sopId: opts.sopId,
    topic: opts.topic,
    graphId: opts.graphId,
    status: "completed",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    nodeResults: opts.nodeResults ?? [],
    artifacts: {
      finalReport: "final_report.md",
      sources: "sources.json",
      claims: "claims.json",
      criticReview: "critic_review.md",
    },
  };
  await writeFile(join(dir, "run_manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  return dir;
}
