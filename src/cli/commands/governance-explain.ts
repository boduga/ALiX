/**
 * P28.4 — Governance Explain CLI Handler.
 *
 * `alix governance explain` subcommands:
 *   trace   — render explanation for a single candidate trace
 *   window  — render aggregated explanation for a time window
 *
 * CLI invariants:
 *   - Read-only: no writes to any governance store or filesystem
 *   - No audit emitters, no execution adapters
 *   - No policy/readiness/approval writers
 *   - No auto-adoption or auto-close
 *   - No operator ranking
 *
 * @module
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { buildDriftOutcomeTraces } from "../../cli/commands/governance-learning-synthesis.js";
import { computeCorrelationAnalytics } from "../../governance/learning-synthesis-analytics.js";
import {
  buildTraceExplanation,
  buildWindowExplanation,
} from "../../governance/governance-explainability-builder.js";
import {
  renderExplanationText,
  renderExplanationJson,
} from "../../governance/governance-explainability-report.js";

import type { DriftOutcomeTrace } from "../../governance/learning-synthesis-types.js";

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
// Data load helpers (CLI-owned I/O)
// ---------------------------------------------------------------------------

function loadCandidates(cwd: string): Record<string, unknown> {
  const dir = join(cwd, ".alix", "governance", "policy-review-candidates");
  if (!existsSync(dir)) return {};
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const candidates: Record<string, unknown> = {};
  for (const f of files) {
    const candidate = readJson<Record<string, unknown>>(join(dir, f));
    if (candidate && typeof candidate === "object" && "id" in candidate) {
      candidates[(candidate as Record<string, unknown>).id as string] = candidate;
    }
  }
  return candidates;
}

function loadOutcomes(cwd: string): unknown[] {
  const dir = join(cwd, ".alix", "governance", "policy-review-outcomes");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const outcomes: unknown[] = [];
  for (const f of files) {
    const outcome = readJson<unknown>(join(dir, f));
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function handleTrace(args: string[], cwd: string, p24BundlePath: string): string {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: Usage: alix governance explain trace <candidateId> [--p24-bundle <path>] [--json]\n";
  }

  const jsonMode = hasFlag(args, "--json");

  // Load P24 bundle
  const bundle = readJson<Record<string, unknown>>(p24BundlePath);
  if (!bundle) return "ERROR: Could not load P24 bundle.\n";
  const signals = Array.isArray(bundle) ? (bundle as unknown[]) : ((bundle.signals as unknown[]) ?? []);
  if (signals.length === 0) return "ERROR: No P24 signals found in bundle.\n";

  // Load P25 candidates and P26 outcomes
  const candidates = loadCandidates(cwd) as Record<string, Record<string, unknown>>;
  const outcomes = loadOutcomes(cwd);

  // Build all traces
  const traces = buildDriftOutcomeTraces({ signals, candidates, outcomes });

  // Find the matching trace
  const trace = traces.find((t: DriftOutcomeTrace) => t.candidateId === candidateId);
  if (!trace) {
    return `ERROR: Candidate "${candidateId}" not found in traces.\n`;
  }

  // Build peer group from other traces
  const peers = traces.filter((t: DriftOutcomeTrace) => t.candidateId !== candidateId);

  // Build explanation
  const explanation = buildTraceExplanation(trace, peers);

  // Render
  if (jsonMode) {
    return renderExplanationJson(explanation) + "\n";
  }
  return renderExplanationText(explanation) + "\n";
}

function handleWindow(args: string[], cwd: string, p24BundlePath: string): string {
  const jsonMode = hasFlag(args, "--json");

  // Load P24 bundle
  const bundle = readJson<Record<string, unknown>>(p24BundlePath);
  if (!bundle) return "ERROR: Could not load P24 bundle.\n";
  const signals = Array.isArray(bundle) ? (bundle as unknown[]) : ((bundle.signals as unknown[]) ?? []);
  if (signals.length === 0) return "ERROR: No P24 signals found in bundle.\n";

  // Load P25 candidates and P26 outcomes
  const candidates = loadCandidates(cwd) as Record<string, Record<string, unknown>>;
  const outcomes = loadOutcomes(cwd);

  // Build all traces
  const traces = buildDriftOutcomeTraces({ signals, candidates, outcomes });

  if (traces.length === 0) {
    return "ERROR: No drift-outcome traces could be built from the available data.\n";
  }

  // Compute analytics
  const analytics = computeCorrelationAnalytics(traces);

  // Build explanation
  const explanation = buildWindowExplanation(traces, analytics);

  // Render
  if (jsonMode) {
    return renderExplanationJson(explanation) + "\n";
  }
  return renderExplanationText(explanation) + "\n";
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance explain <command> [<args>]\n" +
    "\n" +
    "Commands:\n" +
    "  trace <candidateId> --p24-bundle <path> [--json]\n" +
    "    Render explanation for a single candidate trace\n" +
    "\n" +
    "  window --p24-bundle <path> [--json]\n" +
    "    Render aggregated explanation for a time window\n"
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function handleGovernanceExplainCommand(
  args: string[],
  opts: { cwd: string },
): string {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  const p24BundlePath = flag(args, "--p24-bundle");
  if (!p24BundlePath) {
    return "ERROR: --p24-bundle <path> is required.\n";
  }

  switch (subcommand) {
    case "trace":
      return handleTrace(args.slice(1), cwd, p24BundlePath);
    case "window":
      return handleWindow(args.slice(1), cwd, p24BundlePath);
    default:
      return usage();
  }
}
