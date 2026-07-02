/**
 * P10.10.3 — WorkflowRuntimeHealthProvider.
 *
 * Ephemeral health provider that observes runtime workflow health
 * from the Executive workflow health adapter. Baseline cached per process.
 *
 * @module
 */

import type { BaselineArtifact } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

export class WorkflowRuntimeHealthProvider implements BaselineProvider {
  readonly subsystem = "workflow" as const;
  readonly version = "1.0.0";
  readonly description = "Workflow runtime health provider — observes workflow pipeline health metrics";
  readonly state = "ready" as const;
  readonly capabilities = ["capture"];

  private baselineCache: BaselineArtifact | null = null;

  async captureBaseline(): Promise<BaselineArtifact> {
    if (this.baselineCache) return this.baselineCache;
    const artifact = await this.capture();
    this.baselineCache = artifact;
    return artifact;
  }

  async captureCurrent(): Promise<BaselineArtifact> {
    return this.capture();
  }

  private async capture(): Promise<BaselineArtifact> {
    let report: { healthScore: number; issueCount: number };
    try {
      const { buildWorkflowHealth } = await import("../../executive/adapters/workflow-health.js");
      const wfReport = await buildWorkflowHealth({ cwd: process.cwd() });
      report = {
        healthScore: wfReport.score ?? 0,
        issueCount: wfReport.topIssues?.length ?? 0,
      };
    } catch {
      report = { healthScore: 0, issueCount: 0 };
    }

    return {
      subsystem: "workflow",
      capturedAt: new Date().toISOString(),
      data: report,
    };
  }
}
