/**
 * P27.4 — Learning Synthesis CLI Handler.
 *
 * `alix governance learning-synthesis` subcommands:
 *   build   — Read-only: load P24 bundle + P25 candidates + P26 outcomes,
 *             compute traces and analytics, output trace set
 *   report  — Read-only: compute traces + analytics + render report
 *
 * CLI invariants:
 *   - No write path — no files are created or modified
 *   - No store persistence — all computation is in-memory
 *   - No execution adapters, no audit emitters, no policy writers
 *   - Descriptive output only — no prescriptive recommendations
 *   - No predictive scores or likelihood estimates
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeCorrelationAnalytics } from "../../governance/learning-synthesis-analytics.js";
import { buildSynthesisReport, renderSynthesisReportText } from "../../governance/learning-synthesis-report.js";
import type { DriftOutcomeTrace, DriftCorrelationAnalytics, LearningSynthesisReport } from "../../governance/learning-synthesis-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure trace builder — extracted from CLI, independently testable
// ---------------------------------------------------------------------------

export function buildDriftOutcomeTraces(opts: {
  signals: any[];
  candidates: Record<string, any>;
  outcomes: any[];
}): DriftOutcomeTrace[] {
  const { signals, candidates, outcomes } = opts;
  return outcomes.map((outcome: any) => {
    const candidate = candidates[outcome.candidateId];
    const signal = signals.find((s: any) =>
      s.signalId === candidate?.source?.signalId,
    );

    // Fallback: match by kind + window if signalId doesn't link
    const resolvedSignal = signal ?? (candidate ? signals.find((s: any) =>
      s.kind === candidate.source?.signalKind &&
      s.windowStart === candidate.source?.windowStart,
    ) : undefined);

    const candidateCreated = candidate?.createdAt ?? outcome.createdAt ?? "";
    const candidateClosed = candidate?.updatedAt ?? "";
    const outcomeRecorded = outcome.recordedAt ?? outcome.createdAt ?? "";

    const createMs = candidateCreated ? new Date(candidateCreated).getTime() : 0;
    const closeMs = candidateClosed ? new Date(candidateClosed).getTime() : 0;
    const outcomeMs = outcomeRecorded ? new Date(outcomeRecorded).getTime() : 0;

    return {
      outcomeId: outcome.outcomeId ?? "",
      candidateId: outcome.candidateId ?? "",
      signalId: resolvedSignal?.signalId ?? candidate?.source?.signalId ?? "",
      signalKind: candidate?.source?.signalKind ?? resolvedSignal?.kind ?? "",
      signalSeverity: candidate?.source?.signalSeverity ?? resolvedSignal?.severity ?? "",
      signalDirection: candidate?.source?.signalDirection ?? resolvedSignal?.direction ?? "",
      windowStart: candidate?.source?.windowStart ?? resolvedSignal?.windowStart ?? "",
      windowEnd: candidate?.source?.windowEnd ?? resolvedSignal?.windowEnd ?? "",
      candidateTitle: candidate?.title ?? "",
      candidateStatus: candidate?.status ?? "",
      candidateCreatedAt: candidateCreated,
      candidateClosedAt: candidateClosed,
      outcomeType: outcome.outcomeType ?? "",
      outcomeRecordedAt: outcomeRecorded,
      outcomeRationale: outcome.rationale ?? "",
      timeToReviewDays: (closeMs && createMs) ? Math.round((closeMs - createMs) / (1000 * 60 * 60 * 24)) : 0,
      timeToOutcomeDays: (outcomeMs && createMs) ? Math.round((outcomeMs - createMs) / (1000 * 60 * 60 * 24)) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Load helpers (CLI-owned I/O)
// ---------------------------------------------------------------------------

function loadCandidates(cwd: string): Record<string, any> {
  const dir = join(cwd, ".alix", "governance", "policy-review-candidates");
  const result: Record<string, any> = {};
  if (!existsSync(dir)) return result;
  try {
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".json") && !file.endsWith(".events.jsonl")) {
        const data = readJson<any>(join(dir, file));
        if (data) result[file.replace(/\.json$/, "")] = data;
      }
    }
  } catch {}
  return result;
}

function loadOutcomes(cwd: string): any[] {
  const dir = join(cwd, ".alix", "governance", "policy-review-outcomes");
  const result: any[] = [];
  if (!existsSync(dir)) return result;
  try {
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".json")) {
        const data = readJson<any>(join(dir, file));
        if (data) result.push(data);
      }
    }
  } catch {}
  return result;
}

// ---------------------------------------------------------------------------
// CLI orchestration — load → buildDriftOutcomeTraces → analytics → report
// ---------------------------------------------------------------------------

interface BuildResult {
  traces: DriftOutcomeTrace[];
  analytics: DriftCorrelationAnalytics;
  report: LearningSynthesisReport;
}

function build(cwd: string, p24BundlePath: string): BuildResult | string {
  // 1. Load P24 bundle
  const bundle = readJson<any>(p24BundlePath);
  if (!bundle) return "ERROR: Could not load P24 bundle.\n";
  const signals = Array.isArray(bundle) ? bundle : (bundle.signals ?? []);
  if (signals.length === 0) return "ERROR: No P24 signals found in bundle.\n";

  // 2. Load data + build traces via pure helper
  const candidates = loadCandidates(cwd);
  const outcomes = loadOutcomes(cwd);
  const traces = buildDriftOutcomeTraces({ signals, candidates, outcomes });

  // 3. Compute terminal candidate counts for completeness
  const terminalStatuses = new Set(["dismissed", "closed", "accepted_for_policy_review"]);
  const terminalCandidates = Object.values(candidates).filter(
    (c: any) => terminalStatuses.has(c.status),
  ).length;
  const terminalWithOutcomes = new Set(traces.filter(
    (t: DriftOutcomeTrace) => terminalStatuses.has(t.candidateStatus),
  ).map((t: DriftOutcomeTrace) => t.candidateId)).size;

  // 4. Compute analytics + report
  const analytics = computeCorrelationAnalytics(traces);
  const report = buildSynthesisReport(traces, analytics, {
    totalTerminalCandidates: terminalCandidates,
    terminalCandidatesWithOutcomes: terminalWithOutcomes,
  });

  return { traces, analytics, report };
}

// ---------------------------------------------------------------------------
// Build handler
// ---------------------------------------------------------------------------

function handleBuild(args: string[], cwd: string): string {
  const p24BundlePath = flag(args, "--p24-bundle");
  if (!p24BundlePath) {
    return "ERROR: --p24-bundle <path> is required.\n" + usage();
  }

  const result = build(cwd, p24BundlePath);
  if (typeof result === "string") return result;

  if (hasFlag(args, "--json")) {
    return JSON.stringify({ traces: result.traces, analytics: result.analytics }, null, 2) + "\n";
  }

  let out = "P27-BUILD\n";
  out += "Learning Synthesis — Trace Build\n";
  out += `${result.traces.length} trace(s) built\n`;
  out += `Window: ${result.report.windowStart} → ${result.report.windowEnd}\n`;
  out += "P27-BUILD-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Report handler
// ---------------------------------------------------------------------------

function handleReport(args: string[], cwd: string): string {
  const p24BundlePath = flag(args, "--p24-bundle");
  if (!p24BundlePath) {
    return "ERROR: --p24-bundle <path> is required.\n" + usage();
  }

  const result = build(cwd, p24BundlePath);
  if (typeof result === "string") return result;

  const report = result.report;

  if (hasFlag(args, "--json")) {
    return JSON.stringify(report, null, 2) + "\n";
  }

  return renderSynthesisReportText(report);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance learning-synthesis <command> [<args>]\n" +
    "\n" +
    "Commands:\n" +
    "  build --p24-bundle <path> [--json]\n" +
    "    Read-only: build traces from P24 bundle + P25 candidates + P26 outcomes\n" +
    "\n" +
    "  report --p24-bundle <path> [--json]\n" +
    "    Read-only: compute analytics + render learning synthesis report\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export function handleGovernanceLearningSynthesisCommand(
  args: string[],
  opts: { cwd: string },
): string {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "build":
      return handleBuild(args.slice(1), cwd);
    case "report":
      return handleReport(args.slice(1), cwd);
    default:
      return usage();
  }
}
