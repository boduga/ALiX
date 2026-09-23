/**
 * render.ts — Pure formatters for `alix jev` output.
 *
 * Separated from the ops so the data layer stays testable without capturing
 * stdout.
 */

import type {
  CalibrationExport,
  ReliabilityReport,
  ThresholdProfile,
} from "../../../decision/index.js";
import type {
  DisagreementsReport,
  JevStatus,
  LabelPairResult,
  LabelPairStage,
} from "./ops.js";
import type { ReplayReport } from "./replay-ops.js";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderStatus(status: JevStatus): string {
  const lines: string[] = [];
  lines.push("Decision subsystem");
  lines.push(`  remote Jev enabled : ${status.remoteJevEnabled}`);
  lines.push(`  Jev key present    : ${status.keyPresent}`);
  lines.push(`  journal records    : ${status.journalRecords}`);
  lines.push(`  outcome labels     : ${status.labels}${status.malformedLabels > 0 ? ` (${status.malformedLabels} malformed)` : ""}`);
  lines.push(`  threshold profiles : ${status.profiles.length}`);
  lines.push("");
  lines.push("Routes");
  for (const route of status.routes) {
    lines.push(
      `  ${route.decision.padEnd(19)} engine=${route.engine.padEnd(16)} fallback=${route.fallback.padEnd(16)} enabled=${route.enabled}`,
    );
    lines.push(`  ${"".padEnd(19)} profile=${route.thresholdProfile}`);
  }
  if (status.shippedProfiles.length > 0) {
    lines.push("");
    lines.push("Shipped defaults (shadow, not promotable)");
    for (const profile of status.shippedProfiles) {
      lines.push(`  ${profile.id.padEnd(34)} threshold=${profile.threshold.toFixed(2)}`);
    }
  }
  if (status.profiles.length > 0) {
    lines.push("");
    lines.push("Profiles");
    for (const profile of status.profiles) {
      const scope = `${profile.decision}/${profile.engineId}${profile.risk !== undefined ? `/${profile.risk}` : ""}`;
      const provenance = profile.provenance !== undefined
        ? `provenance=${profile.provenance.metric}=${profile.provenance.value.toFixed(3)} n=${profile.provenance.sampleCount}`
        : "provenance=none";
      lines.push(
        `  ${profile.id.padEnd(34)} ${scope.padEnd(34)} threshold=${profile.threshold.toFixed(2)} ${profile.status.padEnd(8)} ${provenance}`,
      );
    }
  }
  return lines.join("\n");
}

export function renderDataset(dataset: CalibrationExport): string {
  const { skipped } = dataset;
  return [
    `Calibration dataset (exported ${new Date(dataset.exportedAt).toISOString()})`,
    `  filters : ${dataset.filters.decision ?? "all decisions"} / ${dataset.filters.engineId ?? "all engines"}`,
    `  samples : ${dataset.samples.length}`,
    `  skipped : unlabeled=${skipped.unlabeled} unknown=${skipped.unknownLabel} failure=${skipped.failureOutcome} duplicate=${skipped.duplicateDecisionId}`,
  ].join("\n");
}

export function renderReliability(report: ReliabilityReport): string {
  const lines: string[] = [];
  lines.push(
    `Reliability — ${report.decision} / ${report.engineId} (metric=${report.metric})`,
  );
  lines.push(`  samples=${report.sampleCount} excludedUnscored=${report.excludedUnscored}`);
  lines.push(`  ECE=${report.expectedCalibrationError.toFixed(4)} Brier=${report.brierScore.toFixed(4)}`);
  lines.push("");
  lines.push("  bin            count  meanScore  accuracy");
  for (const bin of report.bins) {
    if (bin.count === 0) continue;
    lines.push(
      `  ${bin.from.toFixed(1)}–${bin.to.toFixed(1)}   ${String(bin.count).padStart(5)}  ${bin.meanScore.toFixed(3).padStart(9)}  ${bin.accuracy.toFixed(3).padStart(8)}`,
    );
  }
  return lines.join("\n");
}

export function renderProfiles(
  profiles: readonly ThresholdProfile[],
  shipped: readonly ThresholdProfile[] = [],
): string {
  if (profiles.length === 0) {
    const shippedLines = shipped.map(
      (profile) => `  ${profile.id}  threshold=${profile.threshold.toFixed(2)}  (shadow, not promotable)`,
    );
    return [
      "No threshold profiles on disk.",
      ...(shippedLines.length > 0
        ? ["Shipped defaults (shadow — filtering stays off until a profile is derived and promoted):", ...shippedLines]
        : []),
    ].join("\n");
  }
  return profiles
    .map((profile) => {
      const scope = `${profile.decision}/${profile.engineId}${profile.risk !== undefined ? `/${profile.risk}` : ""}`;
      const provenance = profile.provenance !== undefined
        ? `${profile.provenance.metric}=${profile.provenance.value.toFixed(3)} n=${profile.provenance.sampleCount} dataset=${profile.provenance.datasetId}`
        : "no provenance (not promotable)";
      return `${profile.id}  [${profile.status}]  ${scope}  threshold=${profile.threshold.toFixed(2)}\n    ${provenance}${profile.approvedBy !== undefined ? ` approvedBy=${profile.approvedBy}` : ""}`;
    })
    .join("\n");
}

export function renderReplay(report: ReplayReport): string {
  const lines: string[] = [];
  lines.push(`Replay — ${report.engineId} over ${report.fixtures} fixtures`);
  lines.push(`  malformed=${report.malformed}`);
  if (report.accuracy !== undefined) lines.push(`  accuracy=${pct(report.accuracy)}`);
  const failed = report.runs.filter((run) => run.outcome.kind === "failure");
  if (failed.length > 0) {
    lines.push("");
    lines.push("  failures");
    for (const run of failed.slice(0, 10)) {
      lines.push(`    ${run.fixtureId}: ${run.outcome.kind === "failure" ? run.outcome.error : ""}`);
    }
  }
  if (report.comparison !== undefined) {
    const comparison = report.comparison;
    lines.push("");
    lines.push(`Comparison — baseline ${comparison.baseline.engineId} vs candidate ${comparison.candidate.engineId}`);
    lines.push(
      `  paired=${comparison.paired} agreement=${pct(comparison.agreement)} (continuous tolerance ±${comparison.continuousTolerance})`,
    );
    if (comparison.meanAbsoluteDelta !== undefined) {
      lines.push(`  mean|delta|=${comparison.meanAbsoluteDelta.toFixed(4)}`);
    }
    const side = (label: string, report: typeof comparison.baseline): string => {
      const tokens =
        report.reportedInputTokens !== undefined
          ? ` tokens=${report.reportedInputTokens}/${report.reportedOutputTokens ?? 0}`
          : " tokens=estimated";
      return `  ${label} runs=${report.runs} malformed=${report.malformed}${report.accuracy !== undefined ? ` accuracy=${pct(report.accuracy)}` : ""} p95=${report.p95LatencyMs}ms${tokens} cost=$${report.totalCostUsd.toFixed(6)}`;
    };
    lines.push(side("baseline ", comparison.baseline));
    lines.push(side("candidate", comparison.candidate));
    lines.push(
      `  delta     latency=${comparison.latencyDeltaMs.toFixed(0)}ms cost=$${comparison.costDeltaUsd.toFixed(6)}`,
    );
  }
  if (report.gate !== undefined) {
    lines.push("");
    lines.push(`Promotion gate: ${report.gate.pass ? "PASS" : "FAIL"}`);
    for (const reason of report.gate.reasons) lines.push(`  - ${reason}`);
  }
  return lines.join("\n");
}

export function renderDisagreements(report: DisagreementsReport): string {
  const lines: string[] = [`Disagreements — ${report.decision}`];
  if (report.paired === 0) {
    lines.push("  no disagreement data available");
    if (report.invocations > 0) {
      lines.push(`  (${report.invocations} invocation(s) produced no comparable pair — engine not remote, remote disabled, or attempts failed)`);
    }
    return lines.join("\n");
  }

  for (const pair of report.pairs) {
    lines.push("");
    lines.push(`PAIR ${pair.projectionHash}`);
    lines.push("");
    for (const side of pair.sides) {
      const label = side.engineId === "jev" ? "Jev" : side.engineId === "local" ? "Baseline" : side.engineId;
      lines.push(`${label}:`);
      lines.push(`  verdict: ${side.verdict}`);
      lines.push(`  decision: ${side.decisionId}`);
      lines.push("");
    }
    const allLabelled = pair.sides.every((side) => side.label !== undefined);
    if (allLabelled) {
      lines.push("labels:");
      for (const side of pair.sides) lines.push(`  ${side.engineId}: ${side.label}`);
    } else {
      lines.push("label: unlabelled");
    }
  }

  lines.push("");
  lines.push(`invocations=${report.invocations}`);
  lines.push(`paired=${report.paired}`);
  lines.push(`comparable_pairs=${report.paired}`);
  lines.push(`agreements=${report.agreements}`);
  lines.push(`disagreements=${report.disagreements}`);
  lines.push(`disagreement_rate=${report.disagreementRate}`);
  lines.push("");
  lines.push(`labelled=${report.labelled}`);
  lines.push(`unlabelled=${report.unlabelled}`);
  lines.push("");
  lines.push(`jev_correct=${report.jevCorrect}`);
  lines.push(`baseline_correct=${report.baselineCorrect}`);
  lines.push(`both_wrong=${report.bothWrong}`);
  if (report.disagreements > 0 && report.agreements > 0) {
    lines.push("");
    lines.push(`the engines agree on ${report.agreements} of ${report.paired} comparable pairs`);
  }
  return lines.join("\n");
}

/**
 * Stage 1 output — claim + evidence only (§18.1). MUST NOT contain verdict
 * direction: no engine names, no verdict words, no arrows, no "Truth" (§18.2).
 * tests/cli/jev-ops.test.ts pins these absences.
 */
export function renderLabelPairEvidence(stage: LabelPairStage): string {
  const lines: string[] = [
    `Evidence for ${stage.projectionHash}`,
    "",
    "Claim:",
    `  ${stage.projection.claim}`,
    "",
    "Evidence:",
  ];
  if (stage.projection.evidence.length === 0) {
    lines.push("  (none)");
  }
  stage.projection.evidence.forEach((item, index) => {
    if (item.source !== undefined) lines.push(`  [${index + 1}] ${item.source}`);
    lines.push(`  [${index + 1}] ${item.excerpt}`);
  });
  return lines.join("\n");
}

/**
 * Stage 2 output — only ever called AFTER truth is committed (§18: "after truth
 * is committed, the CLI may reveal truth, verdicts, derived labels").
 */
export function renderLabelPairReveal(result: LabelPairResult): string {
  const lines: string[] = [`Truth: ${result.truth}`, ""];
  for (const side of result.labels) {
    const name = side.engineId === "jev" ? "Jev" : "Baseline";
    lines.push(`${name}:`.padEnd(10) + side.verdict.padEnd(15) + `-> ${side.label}`);
  }
  return lines.join("\n");
}
