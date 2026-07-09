/**
 * P25.4 — Governance Policy Review CLI Handler.
 *
 * `alix governance policy-review` subcommands:
 *   build       — read-only candidate preview from P24 bundle
 *   open        — persist candidate (explicit write)
 *   list        — read-only store inspection
 *   show        — read-only candidate detail + event log
 *   transition  — explicit state transition (validated by store)
 *   note        — add annotation
 *   report      — read-only candidate summary
 *
 * CLI invariants:
 *   - build is read-only: no writes to any store
 *   - open/transition/note are explicit writes
 *   - list/show/report are read-only
 *   - no execution adapters, no audit emitters, no policy writers
 *   - store validates transition legality — CLI never decides it
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCandidates } from "../../governance/policy-review-candidate-builder.js";
import { createPolicyReviewCandidateStore } from "../../governance/policy-review-candidate-store.js";
import {
  buildCandidateReport,
  renderCandidateReportText,
  renderCandidateReportJson,
} from "../../governance/policy-review-candidate-report.js";
import type { PolicyReviewCandidateStatus } from "../../governance/policy-review-candidate-types.js";

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

function getStore(cwd: string) {
  return createPolicyReviewCandidateStore({
    rootDir: join(cwd, ".alix", "governance", "policy-review-candidates"),
  });
}

function loadSignals(bundlePath: string) {
  if (!existsSync(bundlePath)) return null;
  const raw = readFileSync(bundlePath, "utf-8");
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Build handler (read-only)
// ---------------------------------------------------------------------------

function handleBuild(args: string[], cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> required.\n" + usage();
  }

  const bundle = loadSignals(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const signals = Array.isArray(bundle) ? bundle : (bundle.signals ?? []);
  const candidates = buildCandidates(signals);

  if (hasFlag(args, "--json")) {
    return JSON.stringify(candidates, null, 2) + "\n";
  }

  let out = "P25-BUILD\n";
  out += "Policy Review Candidate Preview\n";
  out += `${candidates.length} candidate(s) generated from input bundle.\n\n`;
  for (const c of candidates) {
    out += `  [${c.status}] ${c.title}\n`;
    out += `  ID: ${c.candidateId} | Source: ${c.source.signalKind} (${c.source.signalSeverity})\n`;
    out += `  Summary: ${c.summary}\n`;
    out += `  Read-only preview  use 'open' to persist.\n\n`;
  }
  out += "P25-BUILD-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Open handler (explicit write)
// ---------------------------------------------------------------------------

async function handleOpen(args: string[], cwd: string): Promise<string> {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> required.\n" + usage();
  }

  const bundle = loadSignals(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const signals = Array.isArray(bundle) ? bundle : (bundle.signals ?? []);
  const candidates = buildCandidates(signals);

  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> required.\n" + usage();
  }

  const candidate = candidates.find(c => c.candidateId === candidateId);
  if (!candidate) {
    return `ERROR: Candidate ${candidateId} not found in input bundle.\n`;
  }

  const store = getStore(cwd);
  try {
    const saved = await store.openCandidate({
      candidate,
      rationale: flag(args, "--rationale") ?? undefined,
    });
    return `Opened candidate: ${saved.candidateId} (${saved.status})\n`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: ${message}\n`;
  }
}

// ---------------------------------------------------------------------------
// List handler (read-only)
// ---------------------------------------------------------------------------

async function handleList(args: string[], cwd: string): Promise<string> {
  const store = getStore(cwd);
  const status = (flag(args, "--status") ?? undefined) as PolicyReviewCandidateStatus | undefined;
  const candidates = await store.listCandidates({ status });

  if (hasFlag(args, "--json")) {
    return JSON.stringify(candidates, null, 2) + "\n";
  }

  let out = "P25-LIST\n";
  out += "Policy Review Candidates\n";
  out += `${candidates.length} candidate(s)\n\n`;
  for (const c of candidates) {
    out += `  [${c.status}] ${c.title}\n`;
    out += `  ID: ${c.candidateId} | Updated: ${c.updatedAt}\n`;
  }
  out += "P25-LIST-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Show handler (read-only)
// ---------------------------------------------------------------------------

async function handleShow(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> required.\n" + usage();
  }

  const store = getStore(cwd);
  const { candidate, events } = await store.showCandidate(candidateId);

  if (!candidate) {
    return `Candidate not found: ${candidateId}\n`;
  }

  if (hasFlag(args, "--json")) {
    return JSON.stringify({ candidate, events }, null, 2) + "\n";
  }

  let out = "P25-SHOW\n";
  out += `Candidate: ${candidate.candidateId}\n`;
  out += `Title: ${candidate.title}\n`;
  out += `Status: ${candidate.status}\n`;
  out += `Created: ${candidate.createdAt}\n`;
  out += `Updated: ${candidate.updatedAt}\n`;
  out += `Events: ${events.length}\n`;
  for (const e of events) {
    out += `  [${e.type}] ${e.occurredAt}`;
    if (e.rationale) out += `  ${e.rationale}`;
    out += "\n";
  }
  out += "P25-SHOW-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Transition handler (explicit write, store validates)
// ---------------------------------------------------------------------------

async function handleTransition(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> required.\n" + usage();
  }

  const nextStatus = flag(args, "--status");
  if (!nextStatus) {
    return "ERROR: --status <status> required.\n" + usage();
  }

  const rationale = flag(args, "--rationale");
  if (!rationale) {
    return "ERROR: --rationale <text> required.\n" + usage();
  }

  const store = getStore(cwd);
  try {
    const updated = await store.transitionCandidate({
      candidateId,
      nextStatus: nextStatus as PolicyReviewCandidateStatus,
      rationale,
    });
    return `Transitioned ${candidateId}: ${updated.status}\n`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: ${message}\n`;
  }
}

// ---------------------------------------------------------------------------
// Note handler (explicit write)
// ---------------------------------------------------------------------------

async function handleNote(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> required.\n" + usage();
  }

  const note = flag(args, "--note");
  if (!note) {
    return "ERROR: --note <text> required.\n" + usage();
  }

  const store = getStore(cwd);
  try {
    const updated = await store.addNote({ candidateId, note });
    return `Note added to ${candidateId} (${updated.review.notes.length} total notes)\n`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: ${message}\n`;
  }
}

// ---------------------------------------------------------------------------
// Report handler (read-only)
// ---------------------------------------------------------------------------

async function handleReport(args: string[], cwd: string): Promise<string> {
  const store = getStore(cwd);
  const status = (flag(args, "--status") ?? undefined) as PolicyReviewCandidateStatus | undefined;
  const candidates = await store.listCandidates({ status });
  const report = buildCandidateReport(candidates);

  if (hasFlag(args, "--json")) {
    return renderCandidateReportJson(report);
  }

  return renderCandidateReportText(report);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance policy-review {build|open|list|show|transition|note|report} [options]\n" +
    "\n" +
    "Subcommands:\n" +
    "  build --input <bundle.json> [--json]\n" +
    "  Read-only candidate preview from P24 bundle\n" +
    "\n" +
    "  open <candidateId> --input <bundle.json> [--rationale \"...\"]\n" +
    "  Persist candidate (explicit write)\n" +
    "\n" +
    "  list [--status <status>] [--json]\n" +
    "  Read-only candidate list\n" +
    "\n" +
    "  show <candidateId> [--json]\n" +
    "  Candidate detail + event log\n" +
    "\n" +
    "  transition <candidateId> --status <next> --rationale \"...\"\n" +
    "  State transition (validated by store)\n" +
    "\n" +
    "  note <candidateId> --note \"...\"\n" +
    "  Add annotation\n" +
    "\n" +
    "  report [--status <status>] [--json]\n" +
    "  Read-only candidate summary\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function handleGovernancePolicyReviewCommand(
  args: string[],
  opts: { cwd: string },
): Promise<string> {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "build":
      return handleBuild(args.slice(1), cwd);
    case "open":
      return await handleOpen(args.slice(1), cwd);
    case "list":
      return await handleList(args.slice(1), cwd);
    case "show":
      return await handleShow(args.slice(1), cwd);
    case "transition":
      return await handleTransition(args.slice(1), cwd);
    case "note":
      return await handleNote(args.slice(1), cwd);
    case "report":
      return await handleReport(args.slice(1), cwd);
    default:
      return usage();
  }
}
