/**
 * P10.10.2 — GovernanceBaselineProvider.
 *
 * Observes persisted governance state from the governance store
 * (currently JSON-backed files in .alix/governance/).
 *
 * Persistent baseline provider — file state survives process restarts.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BaselineArtifact } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOV_DIR = join(".alix", "governance");

// ---------------------------------------------------------------------------
// GovernanceBaselineProvider
// ---------------------------------------------------------------------------

export class GovernanceBaselineProvider implements BaselineProvider {
  readonly subsystem = "governance" as const;
  readonly version = "1.0.0";
  readonly description = "Governance baseline provider — observes calibration, lens, and policy state";
  readonly state = "ready" as const;
  readonly capabilities = ["capture"];

  async captureBaseline(): Promise<BaselineArtifact> {
    return this.capture();
  }

  async captureCurrent(): Promise<BaselineArtifact> {
    return this.capture();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async capture(): Promise<BaselineArtifact> {
    const govDir = join(process.cwd(), GOV_DIR);
    const data: Record<string, number> = {};

    // 1. Calibration file
    const calPath = join(govDir, "calibration.json");
    if (existsSync(calPath)) {
      try {
        const cal = JSON.parse(readFileSync(calPath, "utf-8")) as Record<string, unknown>;
        const calibrations = Array.isArray(cal.calibrations) ? (cal.calibrations as Record<string, unknown>[]) : [];
        data.calibrationCount = calibrations.length;
        data.activeCalibrations = calibrations.filter((c) => c.target).length;
        const avg = calibrations
          .map((c) => Number(c.value))
          .filter((v) => !isNaN(v));
        data.avgCalibrationValue = avg.length > 0
          ? Math.round((avg.reduce((a, b) => a + b, 0) / avg.length) * 100) / 100
          : 0;
      } catch {
        // Malformed JSON — return 0s
        data.calibrationCount = 0;
        data.activeCalibrations = 0;
        data.avgCalibrationValue = 0;
      }
    } else {
      data.calibrationCount = 0;
      data.activeCalibrations = 0;
      data.avgCalibrationValue = 0;
    }

    // 2. Lens registry file
    const lensPath = join(govDir, "lens-registry.json");
    if (existsSync(lensPath)) {
      try {
        const lensData = JSON.parse(readFileSync(lensPath, "utf-8")) as Record<string, unknown>;
        const lenses = Array.isArray(lensData.lenses) ? (lensData.lenses as Record<string, unknown>[]) : [];
        data.totalLenses = lenses.length;
        data.activeLenses = lenses.filter((l) => l.status === "active" || l.enabled === true).length;
        data.demotedLenses = lenses.filter((l) => l.status === "demoted").length;
        data.retiredLenses = lenses.filter((l) => l.status === "retired").length;
      } catch {
        data.totalLenses = 0;
        data.activeLenses = 0;
        data.demotedLenses = 0;
        data.retiredLenses = 0;
      }
    } else {
      data.totalLenses = 0;
      data.activeLenses = 0;
      data.demotedLenses = 0;
      data.retiredLenses = 0;
    }

    // 3. Policy coverage file
    const policyPath = join(govDir, "policy-coverage.json");
    if (existsSync(policyPath)) {
      try {
        const policy = JSON.parse(readFileSync(policyPath, "utf-8")) as Record<string, unknown>;
        data.currentCoverage = Number(policy.currentCoverage) || 0;
        const target = Number(policy.targetCoverage) || 0;
        data.coverageGap = target - data.currentCoverage;
      } catch {
        data.currentCoverage = 0;
        data.coverageGap = 0;
      }
    } else {
      data.currentCoverage = 0;
      data.coverageGap = 0;
    }

    return {
      subsystem: "governance",
      capturedAt: new Date().toISOString(),
      data,
    };
  }
}
