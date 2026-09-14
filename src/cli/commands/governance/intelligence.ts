/**
 * P9.0f — `alix governance` CLI dispatcher + terminal renderers.
 *
 * Five subcommands, each consuming one or more P9 builders:
 *   - health  — buildGovernanceHealth + buildGovernanceAssessment
 *   - drift   — detectGovernanceDrift
 *   - lens-review — reviewLenses
 *   - integrity — buildGovernanceIntegrity
 *   - recommend — generateRecommendations (P9.1)
 *
 * Each subcommand stores its artifact via GovernanceStore.append() and renders
 * either ANSI-colored terminal output or raw JSON.
 *
 * CORE INVARIANT: this module NEVER writes any P8 store. It only calls P9
 * builders (which are read-only analysers) and GovernanceStore (the single
 * permitted P9 write target). Sentinel-enforced.
 *
 * @module
 */

import "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";

// P21-CLOSURE-END

// P22-INTELLIGENCE-START
// ---------------------------------------------------------------------------
// P22 — Intelligence CLI (read-only)
// ---------------------------------------------------------------------------

export async function runIntelligence(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    const inputPath = intelligenceFlag(args, "--input") ?? intelligenceFlag(args, "-i");
    if (!inputPath) throw new Error("--input is required");
    const { readFileSync, existsSync } = await import("node:fs");
    if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

    const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));
    const handoffRefs = bundle.handoffRefs ?? [];
    const evidenceRefs = bundle.evidenceRefs ?? [];
    const closureReviews = bundle.closureReviews ?? [];
    const now = new Date().toISOString();

    if (subcommand === "outcomes") {
      const { aggregateClosureOutcomes } = await import("../../../governance/handoff-outcome-aggregate.js");
      const since = intelligenceFlag(args, "--since") ?? new Date(Date.parse(now) - 7 * 86400000).toISOString();
      const until = intelligenceFlag(args, "--until") ?? now;
      const result = aggregateClosureOutcomes(handoffRefs, evidenceRefs, closureReviews, since, until);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Closure Outcomes (${result.periodStart} — ${result.periodEnd})`);
        console.log(`  Total handoffs: ${result.totalHandoffs}`);
        console.log(`  Accepted: ${result.byStatus.accepted}`);
        console.log(`  Rejected: ${result.byStatus.rejected}`);
        console.log(`  Incomplete: ${result.byStatus.incomplete}`);
        console.log(`  Needs follow-up: ${result.byStatus.needsFollowUp}`);
        console.log(`  Awaiting evidence: ${result.byStatus.awaitingEvidence}`);
      }
      return;
    }

    if (subcommand === "signals") {
      const { detectHandoffQualitySignals } = await import("../../../governance/handoff-quality-signals.js");
      const slowClosureDays = Number(intelligenceFlag(args, "--slow-closure-days") ?? "14");
      const signals = detectHandoffQualitySignals(handoffRefs, evidenceRefs, closureReviews, {
        slowClosureDays, detectedAt: now,
      });
      const severityFilter = intelligenceFlag(args, "--severity");
      const filtered = severityFilter ? signals.filter((s: any) => s.severity === severityFilter) : signals;

      if (jsonMode) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        console.log(`Quality Signals (${filtered.length})`);
        for (const s of filtered) {
          console.log(`  [${s.severity}] ${s.signalCode} — ${s.handoffId}`);
          console.log(`    ${s.summary}`);
        }
      }
      return;
    }

    if (subcommand === "calibration") {
      const { calibrateReadiness } = await import("../../../governance/handoff-readiness-calibration.js");
      const result = calibrateReadiness(handoffRefs, closureReviews);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Readiness Calibration (${result.length} signals)`);
        const over = result.filter((s: any) => s.calibration === "overconfident").length;
        const under = result.filter((s: any) => s.calibration === "underconfident").length;
        const acc = result.filter((s: any) => s.calibration === "accurate").length;
        console.log(`  Overconfident: ${over}`);
        console.log(`  Underconfident: ${under}`);
        console.log(`  Accurate: ${acc}`);
      }
      return;
    }

    if (subcommand === "report") {
      const { buildHandoffIntelligenceReport } = await import("../../../governance/handoff-intelligence-report.js");
      const since = intelligenceFlag(args, "--since") ?? undefined;
      const until = intelligenceFlag(args, "--until") ?? undefined;
      const slowClosureDays = Number(intelligenceFlag(args, "--slow-closure-days") ?? "14");
      const report = buildHandoffIntelligenceReport(handoffRefs, evidenceRefs, closureReviews, {
        since, until, now, slowClosureDays,
      });
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Intelligence Report v${report.schemaVersion}`);
        console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
        console.log(`  Total handoffs: ${report.outcomeAggregate.totalHandoffs}`);
        console.log(`  Quality signals: ${report.summary.totalQualitySignals} (${report.summary.criticalSignals} critical, ${report.summary.warningSignals} warning, ${report.summary.infoSignals} info)`);
        console.log(`  Calibration: ${report.summary.totalCalibrationSignals} (${report.summary.overconfidentCount} overconfident, ${report.summary.underconfidentCount} underconfident, ${report.summary.accurateCount} accurate)`);
      }
      return;
    }

    throw new Error("usage: alix governance intelligence {outcomes|signals|calibration|report} --input <path> [--json] [--since <iso>] [--until <iso>]");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "intelligence_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}


export function intelligenceFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}
