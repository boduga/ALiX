/**
 * P24.4 — Governance Calibration CLI Handler.
 *
 * `alix governance calibration` subcommands:
 *   detect   — run policy drift detector over P22/P23 data
 *   report   — full calibration report (text or JSON)
 *   bands    — confidence bands only
 *
 * CLI invariants:
 *   - read-only: no writes to governance stores
 *   - no audit emitters
 *   - no execution adapters
 *   - no policy/readiness/approval/handoff/closure writers
 *   - no auto-adoption or auto-close
 *   - no operator ranking
 *   - no policy recommendations or threshold-change proposals
 */

import { readFileSync, existsSync } from "node:fs";
import { detectPolicyDrift } from "../../governance/policy-drift.js";
import type { CalibrationInput, ReplayDiffInput, CandidateLessonInput } from "../../governance/policy-drift.js";
import { buildConfidenceBands } from "../../governance/calibration-confidence-bands.js";
import { buildCalibrationReport, renderCalibrationReportText } from "../../governance/calibration-report.js";
import { toDriftFindings } from "../../governance/drift-finding-adapter.js";

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

function now(): string {
  return new Date().toISOString();
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Input bundle type
// ---------------------------------------------------------------------------

export interface CalibrationInputBundle {
  calibrations: CalibrationInput[];
  replayDiffs: ReplayDiffInput[];
  candidateLessons: CandidateLessonInput[];
  /** Optional previous-window data for trend detection */
  previousWindow?: {
    windowStart: string;
    windowEnd: string;
    calibrations: CalibrationInput[];
  };
  // Boundary marker — P24 reads, never writes
  readonly readOnly: true;
}

function loadInputBundle(filePath: string): CalibrationInputBundle | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CalibrationInputBundle;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Detect handler
// ---------------------------------------------------------------------------

function handleDetect(args: string[], _cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required. Provide a P24 input bundle JSON file.\n" + usage();
  }

  const bundle = loadInputBundle(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle. Verify the file exists and is valid JSON.\n" + usage();
  }

  const windowFlag = flag(args, "--window");
  const windowDays = windowFlag ? parseInt(windowFlag, 10) : 90;
  const since = flag(args, "--since") ?? isoDaysAgo(windowDays);
  const until = flag(args, "--until") ?? now();

  const signals = detectPolicyDrift({
    calibrations: bundle.calibrations,
    replayDiffs: bundle.replayDiffs,
    candidateLessons: bundle.candidateLessons,
    windowStart: since,
    windowEnd: until,
    previousWindowStart: bundle.previousWindow?.windowStart,
    previousWindowEnd: bundle.previousWindow?.windowEnd,
    previousCalibrations: bundle.previousWindow?.calibrations,
  });

  const bands = buildConfidenceBands(signals, { windowStart: since, windowEnd: until });
  const findings = toDriftFindings(signals);

  // Text output
  let out = `P24-DETECT-START\n`;
  out += `Policy Drift Detection — ${windowDays}d window\n`;
  out += `Window: ${since} → ${until}\n`;
  out += `Signals: ${signals.length}\n`;
  for (const s of signals) {
    out += `  [${s.kind}] ${s.direction} (${s.severity}) conf=${s.confidence}\n`;
  }
  out += `\nBands:\n`;
  for (const b of bands) {
    out += `  [${b.label}] conf=${b.confidence} signals=${b.signalCount}\n`;
  }
  out += `\nDriftFindings: ${findings.length}\n`;
  for (const f of findings) {
    out += `  policy_drift: ${f.severity} — ${f.description}\n`;
  }
  out += `P24-DETECT-END\n`;

  return out;
}

// ---------------------------------------------------------------------------
// Report handler
// ---------------------------------------------------------------------------

function handleReport(args: string[], _cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required.\n" + usage();
  }

  const bundle = loadInputBundle(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const windowFlag = flag(args, "--window");
  const windowDays = windowFlag ? parseInt(windowFlag, 10) : 90;
  const since = flag(args, "--since") ?? isoDaysAgo(windowDays);
  const until = flag(args, "--until") ?? now();

  const signals = detectPolicyDrift({
    calibrations: bundle.calibrations,
    replayDiffs: bundle.replayDiffs,
    candidateLessons: bundle.candidateLessons,
    windowStart: since,
    windowEnd: until,
  });

  const bands = buildConfidenceBands(signals, { windowStart: since, windowEnd: until });
  const report = buildCalibrationReport(signals, bands, { windowStart: since, windowEnd: until });

  if (hasFlag(args, "--json")) {
    return JSON.stringify(report, null, 2) + "\n";
  }

  return renderCalibrationReportText(report);
}

// ---------------------------------------------------------------------------
// Bands handler
// ---------------------------------------------------------------------------

function handleBands(args: string[], _cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required.\n" + usage();
  }

  const bundle = loadInputBundle(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const windowFlag = flag(args, "--window");
  const windowDays = windowFlag ? parseInt(windowFlag, 10) : 90;
  const since = flag(args, "--since") ?? isoDaysAgo(windowDays);
  const until = flag(args, "--until") ?? now();

  const signals = detectPolicyDrift({
    calibrations: bundle.calibrations,
    replayDiffs: bundle.replayDiffs,
    candidateLessons: bundle.candidateLessons,
    windowStart: since,
    windowEnd: until,
  });

  const bands = buildConfidenceBands(signals, { windowStart: since, windowEnd: until });

  if (hasFlag(args, "--json")) {
    return JSON.stringify(bands, null, 2) + "\n";
  }

  let out = `P24-BANDS-START\n`;
  out += `Confidence Bands — ${windowDays}d window\n`;
  out += `Window: ${since} → ${until}\n`;
  for (const b of bands) {
    out += `\n[${b.label}]\n`;
    out += `  confidence: ${b.confidence}\n`;
    out += `  signals: ${b.signalCount}\n`;
    for (const r of b.rationale) {
      out += `  ${r}\n`;
    }
  }
  out += `P24-BANDS-END\n`;

  return out;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance calibration {detect|report|bands} --input <bundle.json> [--window N] [--since <iso>] [--until <iso>] [--json]\n" +
    "\n" +
    "Subcommands:\n" +
    "  detect      Run policy drift detector, show signal summary\n" +
    "  report      Full calibration report (text, or --json for JSON)\n" +
    "  bands       Confidence bands only (text, or --json for JSON)\n" +
    "\n" +
    "Flags:\n" +
    "  --input     Path to P24 input bundle JSON (calibrations + replay diffs)\n" +
    "  --window N  Look back N days (default: 90)\n" +
    "  --since     Explicit window start (overrides --window)\n" +
    "  --until     Explicit window end (default: now)\n" +
    "  --json      JSON output (report and bands only)\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export function handleGovernanceCalibrationCommand(args: string[], opts: { cwd: string }): string {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "detect":
      return handleDetect(args.slice(1), cwd);
    case "report":
      return handleReport(args.slice(1), cwd);
    case "bands":
      return handleBands(args.slice(1), cwd);
    default:
      return usage();
  }
}
