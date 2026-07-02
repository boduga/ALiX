/**
 * P10.10.3 — AgentRuntimeHealthProvider.
 *
 * Ephemeral health provider that observes runtime agent health
 * from the Executive agent health adapter. Baseline cached per process.
 *
 * @module
 */

import type { BaselineArtifact } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

export class AgentRuntimeHealthProvider implements BaselineProvider {
  readonly subsystem = "agents" as const;
  readonly version = "1.0.0";
  readonly description = "Agent runtime health provider — observes agent fleet health metrics";
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
      const { buildAgentHealth } = await import("../../executive/adapters/agent-health.js");
      const agentReport = await buildAgentHealth({ cwd: process.cwd() });
      report = {
        healthScore: agentReport.score ?? 0,
        issueCount: agentReport.topIssues?.length ?? 0,
      };
    } catch {
      report = { healthScore: 0, issueCount: 0 };
    }

    return {
      subsystem: "agents",
      capturedAt: new Date().toISOString(),
      data: report,
    };
  }
}
