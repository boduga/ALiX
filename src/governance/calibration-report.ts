/**
 * P24.4 — Calibration Report Builder.
 *
 * Pure function: turns PolicyDriftSignal[] + CalibrationConfidenceBand[] into
 * a structured read-only report with text and JSON output. No stores, no CLI,
 * no audit emitters.
 */

import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { CalibrationConfidenceBand } from "./calibration-confidence-bands.js";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const START_DELIM = "P24-CALIBRATION-START";
const END_DELIM = "P24-CALIBRATION-END";

const FOOTER =
  "P24 calibration report is read-only. No policy, approval, readiness, handoff,\n" +
  "closure, audit, or execution state was mutated. Calibration drift signals\n" +
  "are advisory and require governed human review before any future adoption.\n" +
  "No policy was changed. No threshold was changed. No operator was ranked.\n" +
  "No recommendations were auto-adopted.";

const BOUNDARY_FLAGS = {
  readOnly: true as const,
  noPolicyMutation: true as const,
  noThresholdChange: true as const,
  noAutoAdoption: true as const,
  noRanking: true as const,
};

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface CalibrationReport {
  reportId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  signals: ReadonlyArray<{
    signalId: string;
    kind: string;
    direction: string;
    severity: string;
    confidence: number;
    sampleSize: { p22CalibrationCount: number; p23ReplayCount: number; pairedLifecycleCount: number };
    rates: Record<string, number | undefined>;
    rationale: readonly string[];
  }>;
  bands: ReadonlyArray<{
    label: string;
    confidence: number;
    signalCount: number;
    rationale: readonly string[];
  }>;
  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
  footer: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildCalibrationReport(
  signals: PolicyDriftSignal[],
  bands: CalibrationConfidenceBand[],
  opts?: { generatedAt?: string; windowStart?: string; windowEnd?: string },
): CalibrationReport {
  const windowStart = opts?.windowStart ?? (signals.length > 0 ? signals[0]!.windowStart : "");
  const windowEnd = opts?.windowEnd ?? (signals.length > 0 ? signals[0]!.windowEnd : "");

  return {
    reportId: createHash("sha256").update(["p24-cal", windowStart, windowEnd, String(signals.length), String(bands.length)].join("|")).digest("hex").slice(0, 16),
    generatedAt: opts?.generatedAt ?? now(),
    windowStart,
    windowEnd,
    signals: signals.map(s => ({
      signalId: s.signalId,
      kind: s.kind,
      direction: s.direction,
      severity: s.severity,
      confidence: s.confidence,
      sampleSize: { ...s.sampleSize },
      rates: { ...s.rates },
      rationale: [...s.rationale],
    })),
    bands: bands.map(b => ({
      label: b.label,
      confidence: b.confidence,
      signalCount: b.signalCount,
      rationale: [...b.rationale],
    })),
    ...BOUNDARY_FLAGS,
    footer: FOOTER,
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderCalibrationReportText(report: CalibrationReport): string {
  let out = "";

  out += `${START_DELIM}\n`;
  out += "Calibration Report — Governance Policy Drift\n";
  out += "=".repeat(50) + "\n";

  out += `\n  Report ID: ${report.reportId}`;
  out += `\n  Window: ${report.windowStart} → ${report.windowEnd}`;
  out += `\n  Generated: ${report.generatedAt}`;

  // Signals section
  out += "\n\n  Signals (" + report.signals.length + ")\n";
  if (report.signals.length === 0) {
    out += "    No calibration signals detected in this window.\n";
  } else {
    for (const s of report.signals) {
      out += `\n  [${s.kind}] ${s.direction} (${s.severity})\n`;
      out += `    Confidence: ${s.confidence}\n`;
      out += `    Sample: P22=${s.sampleSize.p22CalibrationCount} P23=${s.sampleSize.p23ReplayCount} paired=${s.sampleSize.pairedLifecycleCount}\n`;
      for (const r of s.rationale) {
        out += `    ${r}\n`;
      }
    }
  }

  // Bands section
  out += "\n  Confidence Bands (" + report.bands.length + ")\n";
  if (report.bands.length === 0) {
    out += "    No confidence bands computed.\n";
  } else {
    for (const b of report.bands) {
      out += `\n  [${b.label}] confidence=${b.confidence} signals=${b.signalCount}\n`;
      for (const r of b.rationale) {
        out += `    ${r}\n`;
      }
    }
  }

  // Boundary flags
  out += "\n  Boundary Flags\n";
  out += "    readOnly, noPolicyMutation, noThresholdChange, noAutoAdoption, noRanking\n";

  // Footer
  out += `\n${END_DELIM}\n`;
  out += `---\n${FOOTER}\n`;

  return out;
}
