/**
 * P10.10.4 — AdaptationBaselineProvider.
 *
 * Observes adaptation proposal state from `.alix/adaptation/proposals/*.json`.
 * Persistent baseline — file state survives process restarts.
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BaselineArtifact } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");

export class AdaptationBaselineProvider implements BaselineProvider {
  readonly subsystem = "adaptation" as const;
  readonly version = "1.0.0";
  readonly description = "Adaptation baseline provider — observes adaptation proposal state";
  readonly state = "ready" as const;
  readonly capabilities = ["capture"];

  private baselineCache: BaselineArtifact | null = null;

  async captureBaseline(): Promise<BaselineArtifact> {
    if (this.baselineCache) return this.baselineCache;
    const artifact = this.capture();
    this.baselineCache = artifact;
    return artifact;
  }

  async captureCurrent(): Promise<BaselineArtifact> {
    return this.capture();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private capture(): BaselineArtifact {
    const dir = join(process.cwd(), PROPOSALS_DIR);
    let proposalCount = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let appliedCount = 0;
    let rejectedCount = 0;
    let failedCount = 0;

    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const content = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Record<string, unknown>;
            proposalCount++;
            const status = String(content.status ?? "");
            switch (status) {
              case "pending":   pendingCount++;   break;
              case "approved":  approvedCount++;  break;
              case "applied":   appliedCount++;   break;
              case "rejected":  rejectedCount++;  break;
              case "failed":    failedCount++;    break;
              default: proposalCount--; break;
            }
          } catch {
            // Malformed file — skip entirely
          }
        }
      } catch {
        // Directory read error — all stay 0
      }
    }

    return {
      subsystem: "adaptation",
      capturedAt: new Date().toISOString(),
      data: {
        proposalCount,
        pendingCount,
        approvedCount,
        appliedCount,
        rejectedCount,
        failedCount,
      },
    };
  }
}
