/**
 * P10.10.2 — MemoryHealthProvider.
 *
 * Ephemeral health provider that observes runtime memory state
 * from the Executive memory health adapter.
 *
 * Baseline is captured once per process lifetime. Repeated calls to
 * captureBaseline() return the same artifact. captureCurrent()
 * calls the adapter each time for live data.
 *
 * @module
 */

import type { BaselineArtifact, DriftCategory } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

// ---------------------------------------------------------------------------
// MemoryHealthProvider
// ---------------------------------------------------------------------------

export class MemoryHealthProvider implements BaselineProvider {
  readonly subsystem = "memory" as const;
  readonly version = "1.0.0";
  readonly description = "Memory health provider — observes runtime vector store health metrics";
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

  /**
   * Classify drift by metric name for more specific categorization.
   * Used by NumericComparator.classifyDrift() via override.
   */
  classifyDrift(metric: string, _delta: number): DriftCategory {
    switch (metric) {
      case "healthScore":
        return "performance";
      case "issueCount":
        return "behavior";
      default:
        return "performance";
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async capture(): Promise<BaselineArtifact> {
    // Dynamically import the memory health adapter to avoid hard
    // dependency on Executive at module load time.
    let report: { healthScore: number; issueCount: number };
    try {
      const { buildMemoryHealth } = await import("../../executive/adapters/memory-health.js");
      const memoryReport = await buildMemoryHealth({ cwd: process.cwd() });
      report = {
        healthScore: memoryReport.score ?? 0,
        issueCount: memoryReport.topIssues?.length ?? 0,
      };
    } catch {
      // Memory adapter unavailable — return 0s
      report = { healthScore: 0, issueCount: 0 };
    }

    return {
      subsystem: "memory",
      capturedAt: new Date().toISOString(),
      data: report,
    };
  }
}
