/**
 * P26.4 — Policy Review Outcome CLI Handler.
 *
 * `alix governance policy-review-outcome` subcommands:
 *   record   — Record a human review outcome (append-only write)
 *   list     — Read-only outcome listing
 *   show     — Read-only single outcome
 *   report   — Read-only outcome analytics report
 *
 * CLI invariants:
 *   - record is an append-only write
 *   - list/show/report are read-only
 *   - No execution adapters, no audit emitters, no policy writers
 *   - No P25 candidate mutation
 *   - No lifecycle transitions
 *   - Store validates inputs (rationale, recordedBy)
 *   - record validates P25 candidate existence before writing
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPolicyReviewOutcomeLedger } from "../../governance/policy-review-outcome-ledger.js";
import { computeOutcomeAnalytics } from "../../governance/policy-review-outcome-analytics.js";
import { buildOutcomeReport, renderOutcomeReportText } from "../../governance/policy-review-outcome-report.js";

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

function getLedger(cwd: string) {
  return createPolicyReviewOutcomeLedger({
    rootDir: join(cwd, ".alix", "governance", "policy-review-outcomes"),
  });
}

// ---------------------------------------------------------------------------
// P25 candidate reader
// ---------------------------------------------------------------------------

function readP25Candidate(cwd: string, candidateId: string): { title: string; status: string } | null {
  const candidatePath = join(cwd, ".alix", "governance", "policy-review-candidates", candidateId + ".json");
  if (!existsSync(candidatePath)) {
    return null;
  }
  try {
    const raw = readFileSync(candidatePath, "utf-8");
    const data = JSON.parse(raw);
    return {
      title: data.title ?? "",
      status: data.status ?? "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Record handler
// ---------------------------------------------------------------------------

async function handleRecord(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> is required.\n" + usage();
  }

  const outcomeType = flag(args, "--outcome") as any;
  if (!outcomeType) {
    return "ERROR: --outcome <type> is required.\n" + usage();
  }

  const recordedBy = flag(args, "--recorded-by");
  if (!recordedBy) {
    return "ERROR: --recorded-by <operator> is required.\n" + usage();
  }

  const rationale = flag(args, "--rationale");
  if (!rationale) {
    return "ERROR: --rationale <text> is required.\n" + usage();
  }

  // Validate P25 candidate exists and read candidate metadata
  const candidateData = readP25Candidate(cwd, candidateId);
  if (!candidateData) {
    return `ERROR: P25 candidate not found: ${candidateId}\n`;
  }

  const evidenceFlag = flag(args, "--evidence");
  const evidenceRefs = evidenceFlag ? [evidenceFlag] : [];
  const notes = flag(args, "--notes") ?? "";

  const ledger = getLedger(cwd);
  try {
    const outcome = await ledger.recordOutcome({
      candidateId,
      candidateTitle: candidateData.title,
      candidateStateAtRecording: candidateData.status,
      outcomeType,
      recordedBy,
      rationale,
      evidenceRefs,
      notes,
    });
    return `Recorded outcome: ${outcome.outcomeId} (${outcome.outcomeType})\n`;
  } catch (err: any) {
    return `ERROR: ${err.message}\n`;
  }
}

// ---------------------------------------------------------------------------
// List handler
// ---------------------------------------------------------------------------

async function handleList(args: string[], cwd: string): Promise<string> {
  const ledger = getLedger(cwd);
  const filterCandidateId = flag(args, "--candidate-id") ?? undefined;
  const filterOutcomeType = flag(args, "--outcome") as any ?? undefined;
  const outcomes = await ledger.listOutcomes({
    candidateId: filterCandidateId,
    outcomeType: filterOutcomeType,
  });

  let out = "P26-LIST\n";
  out += "Policy Review Outcomes\n";
  out += `${outcomes.length} outcome(s)\n\n`;
  for (const o of outcomes) {
    out += `  [${o.outcomeType}] ${o.candidateId} — ${o.rationale.substring(0, 60)}\n`;
    out += `    ID: ${o.outcomeId} | By: ${o.recordedBy} | At: ${o.recordedAt}\n`;
  }
  out += "P26-LIST-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Show handler
// ---------------------------------------------------------------------------

async function handleShow(args: string[], cwd: string): Promise<string> {
  const outcomeId = args[0];
  if (!outcomeId) {
    return "ERROR: <outcomeId> is required.\n" + usage();
  }

  const ledger = getLedger(cwd);
  const outcome = await ledger.getOutcome(outcomeId);
  if (!outcome) {
    return `Outcome not found: ${outcomeId}\n`;
  }

  let out = "P26-SHOW\n";
  out += `  Outcome ID: ${outcome.outcomeId}\n`;
  out += `  Candidate: ${outcome.candidateId} (${outcome.candidateTitle})\n`;
  out += `  Type: ${outcome.outcomeType}\n`;
  out += `  Recorded by: ${outcome.recordedBy}\n`;
  out += `  Rationale: ${outcome.rationale}\n`;
  out += `  Evidence: ${outcome.evidenceRefs.join(", ") || "(none)"}\n`;
  out += `  Recorded at: ${outcome.recordedAt}\n`;
  out += "P26-SHOW-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Report handler
// ---------------------------------------------------------------------------

async function handleReport(args: string[], cwd: string): Promise<string> {
  const ledger = getLedger(cwd);
  const outcomes = await ledger.listOutcomes();
  const analytics = computeOutcomeAnalytics(outcomes);
  const report = buildOutcomeReport(outcomes, analytics);

  if (hasFlag(args, "--json")) {
    return JSON.stringify(report, null, 2) + "\n";
  }

  return renderOutcomeReportText(report);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance policy-review-outcome <command> [<args>]\n" +
    "\n" +
    "Commands:\n" +
    "  record <candidateId> --outcome <type> --recorded-by <op> --rationale <text>\n" +
    "    [--evidence <ref>] [--notes <text>]\n" +
    "\n" +
    "  list [--candidate-id <id>] [--outcome <type>]\n" +
    "\n" +
    "  show <outcomeId>\n" +
    "\n" +
    "  report [--json]\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function handleGovernancePolicyReviewOutcomeCommand(
  args: string[],
  opts: { cwd: string },
): Promise<string> {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "record":
      return await handleRecord(args.slice(1), cwd);
    case "list":
      return await handleList(args.slice(1), cwd);
    case "show":
      return await handleShow(args.slice(1), cwd);
    case "report":
      return await handleReport(args.slice(1), cwd);
    default:
      return usage();
  }
}
