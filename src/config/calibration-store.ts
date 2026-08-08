import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SAFETY_FACTOR } from "./context-limits.js";

export const CALIBRATION_CLAMP = { min: 0.8, max: 2.0 } as const;

export type CalibrationData = {
  /** provider → calibration factor (p95(actual/raw), clamped). */
  providerCalibration?: Record<string, number>;
  /** §6: learned context-rot threshold — UNSET this cycle. */
  contextRotThreshold?: unknown;
  lastRecalibrated?: string;
  sampleCounts?: Record<string, number>;
};

export function calibrationStorePath(storeDir?: string): string {
  return join(storeDir ?? join(homedir(), ".alix"), "calibration.json");
}

export async function loadCalibration(storeDir?: string): Promise<CalibrationData> {
  try {
    const raw = readFileSync(calibrationStorePath(storeDir), "utf8");
    return JSON.parse(raw) as CalibrationData;
  } catch {
    return {};
  }
}

export async function saveCalibration(data: CalibrationData, storeDir?: string): Promise<void> {
  const path = calibrationStorePath(storeDir);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * p95 of actual/raw ratios, clamped to [0.8, 2.0]. Deterministic.
 *
 * p95 convention (documented per task-4 brief note): the 95th-percentile
 * position over the sorted ratio array is `floor(0.95 * n)` (0-based index),
 * so with 12 samples idx = 11 → the max sample. This is the inclusive upper
 * percentile bound, i.e. "95% of samples lie at or below this factor".
 */
export function deriveCalibrationFactor(samples: ReadonlyArray<{ actual: number; raw: number }>): number {
  if (samples.length === 0) return SAFETY_FACTOR;
  const ratios = samples.map((s) => (s.raw > 0 ? s.actual / s.raw : SAFETY_FACTOR)).sort((a, b) => a - b);
  const idx = Math.min(ratios.length - 1, Math.floor(0.95 * ratios.length));
  const p95 = ratios[Math.max(0, idx)]!;
  return Math.min(CALIBRATION_CLAMP.max, Math.max(CALIBRATION_CLAMP.min, p95));
}

/** Resolve a provider's calibration factor, defaulting to 1.2 until burn-in
 *  data exists. */
export function getCalibrationFactor(provider: string, calibration?: CalibrationData): number {
  return calibration?.providerCalibration?.[provider] ?? SAFETY_FACTOR;
}
