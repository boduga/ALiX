/**
 * P10.10 — Demo baseline provider for framework testing.
 *
 * Pure in-memory fixture. No I/O. No real subsystem data.
 *
 * @module
 */

import type { BaselineArtifact } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

/** Fixture baseline data. */
const BASELINE_DATA = { uptime: 100, responseTime: 200, errorRate: 0 };
/** Fixture current state (slightly degraded). */
const CURRENT_DATA = { uptime: 95, responseTime: 350, errorRate: 2 };

export class DemoBaselineProvider implements BaselineProvider {
  readonly subsystem = "demo" as const;
  readonly version = "1.0.0";
  readonly description = "Demo baseline provider for framework testing";
  readonly state = "ready" as const;
  readonly capabilities = ["capture"];

  async captureBaseline(): Promise<BaselineArtifact> {
    return {
      subsystem: "demo",
      capturedAt: new Date().toISOString(),
      data: { ...BASELINE_DATA },
    };
  }

  async captureCurrent(): Promise<BaselineArtifact> {
    return {
      subsystem: "demo",
      capturedAt: new Date().toISOString(),
      data: { ...CURRENT_DATA },
    };
  }
}
