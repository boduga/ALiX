import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCalibration, saveCalibration, deriveCalibrationFactor, getCalibrationFactor } from "../../src/config/calibration-store.js";

describe("calibration store", () => {
  it("defaults to a 1.2 factor when no calibration exists", () => {
    expect(getCalibrationFactor("anthropic", undefined)).toBe(1.2);
  });

  it("round-trips a calibration file through a temp store dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cal-store-"));
    await saveCalibration({ providerCalibration: { anthropic: 1.3 } }, dir);
    const loaded = await loadCalibration(dir);
    expect(loaded.providerCalibration?.anthropic).toBe(1.3);
  });

  it("derives p95 of actual/raw ratios and clamps to [0.8, 2.0]", () => {
    // ratios: 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 5.0
    const samples = [1.0,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.0,5.0].map((r) => ({ actual: r * 100, raw: 100 }));
    expect(deriveCalibrationFactor(samples)).toBeLessThanOrEqual(2.0);
    expect(deriveCalibrationFactor(samples)).toBeGreaterThanOrEqual(0.8);
    expect(deriveCalibrationFactor([{ actual: 50, raw: 100 }])).toBe(0.8); // clamped up to 0.8
  });
});
