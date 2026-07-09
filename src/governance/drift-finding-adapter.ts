/**
 * P24.4 -- DriftFinding Adapter.
 *
 * Maps PolicyDriftSignal[] into DriftFinding-compatible output projection.
 * Only signals with severity "low", "medium", or "high" are projected.
 *
 * This adapter does not write to any store. It produces a projection that
 * the CLI/report layer may optionally present alongside P9.0d output.
 *
 * The adapter is NOT a P9.0d dependency. P9.0d remains unchanged.
 */

import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { DriftFinding } from "./governance-types.js";

// ---------------------------------------------------------------------------
// toDriftFindings
// ---------------------------------------------------------------------------

export function toDriftFindings(signals: PolicyDriftSignal[]): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const signal of signals) {
    // Skip signals with severity "none" -- they carry no actionable information
    if (signal.severity === "none") continue;

    const evidenceRefs = signal.evidenceRefs.map(
      r => r.basis ?? `${r.source}:${r.handoffId ?? r.replayId ?? r.lifecycleId ?? ""}`
    );

    findings.push({
      driftType: "policy_drift",
      detectedAt: signal.windowEnd,
      severity:
        signal.severity === "high"
          ? "high" as const
          : signal.severity === "medium"
            ? "medium" as const
            : "low" as const,
      confidence: signal.confidence,
      evidenceRefs,
      description:
        `${signal.kind} -- ${signal.direction} (severity: ${signal.severity}): ${signal.rationale.join("; ")}`,
      recommendation:
        "No policy change is proposed. This policy_drift projection is read-only " +
        "and may be reviewed through the governed human process.",
    });
  }

  // Deterministic sort: severity order (high first) then detection time
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 99;
    const sb = severityOrder[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.detectedAt.localeCompare(b.detectedAt);
  });

  return findings;
}
