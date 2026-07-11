/**
 * P30.3 — Lineage CLI Handler.
 *
 * `alix governance lineage` subcommands:
 *   show <candidateId> [--p24-bundle <path>] [--json]
 *   list [--kind <signalKind>] [--outcome <outcomeType>] [--json]
 *
 * CLI invariants:
 *   - No writes to any governance store (read-only)
 *   - Builds LineageIndex once from P24 bundle + stores, then queries
 *   - Unknown candidateId produces null-format output (never crashes)
 *   - Static imports only — no require()
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildLineageIndex,
  buildLineageRecord,
} from "../../governance/governance-lineage-builder.js";
import { createPolicyReviewCandidateStore } from "../../governance/policy-review-candidate-store.js";
import { createPolicyReviewOutcomeLedger } from "../../governance/policy-review-outcome-ledger.js";
import { buildCompliancePackage } from "../../governance/governance-reporting-builder.js";
import type { PolicyDriftSignal } from "../../governance/policy-drift-types.js";
import type { PolicyReviewCandidate } from "../../governance/policy-review-candidate-types.js";
import type { PolicyReviewOutcome } from "../../governance/policy-review-outcome-types.js";
import type { DriftOutcomeTrace } from "../../governance/governance-reporting-builder.js";
import type {
  GovernanceExplanation,
  CompliancePackage,
  DriftCorrelationAnalytics,
} from "../../governance/governance-reporting-types.js";
import type { LineageIndex, LineageRecord } from "../../governance/governance-lineage-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_START = "2026-01-01T00:00:00.000Z";

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

/** Build P27 DriftOutcomeTrace[] from P26 outcomes + P25 candidates. */
function buildTracesFromOutcomes(
  outcomes: PolicyReviewOutcome[],
  candidates: PolicyReviewCandidate[],
): DriftOutcomeTrace[] {
  const candidateMap = new Map<string, PolicyReviewCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.candidateId, c);
  }
  return outcomes.map((o) => {
    const cand = candidateMap.get(o.candidateId);
    const signalKind = cand?.source.signalKind ?? "unknown";
    const timeToOutcomeDays = cand
      ? Math.max(
          0,
          Math.round(
            (new Date(o.recordedAt).getTime() - new Date(cand.createdAt).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 0;
    return {
      outcomeId: o.outcomeId,
      candidateId: o.candidateId,
      signalKind,
      outcomeType: o.outcomeType,
      timeToOutcomeDays,
    } satisfies DriftOutcomeTrace;
  });
}

/** Build skeleton DriftCorrelationAnalytics from available signals. */
function buildSkeletonAnalytics(signals: PolicyDriftSignal[]): DriftCorrelationAnalytics {
  return {
    signalToOutcomeCorrelations: [],
    evidenceCoverage: {
      totalSignals: signals.length,
      withOutcome: 0,
      coverageRate: 0,
    },
    commonPatterns: [],
  };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface LoadedData {
  signals: PolicyDriftSignal[];
  candidates: PolicyReviewCandidate[];
  outcomes: PolicyReviewOutcome[];
  traces: DriftOutcomeTrace[];
  explanations: GovernanceExplanation[];
  compliancePackage: CompliancePackage | null;
}

async function loadData(cwd: string, p24BundlePath?: string | null): Promise<LoadedData> {
  // Load P24 signals from bundle file (if provided)
  let signals: PolicyDriftSignal[] = [];
  if (p24BundlePath && existsSync(p24BundlePath)) {
    const raw = readFileSync(p24BundlePath, "utf-8");
    const bundle = JSON.parse(raw) as unknown;
    signals = (Array.isArray(bundle) ? bundle : (bundle as Record<string, unknown>).signals ?? []) as PolicyDriftSignal[];
  }

  // Load P25 candidates from store
  const candidateStore = createPolicyReviewCandidateStore({
    rootDir: join(cwd, ".alix", "governance", "policy-review-candidates"),
  });
  const candidates = await candidateStore.listCandidates();

  // Load P26 outcomes from ledger
  const outcomeLedger = createPolicyReviewOutcomeLedger({
    rootDir: join(cwd, ".alix", "governance", "policy-review-outcomes"),
  });
  const outcomes = await outcomeLedger.listOutcomes();

  // Build P27 traces from outcomes + candidates
  const traces = buildTracesFromOutcomes(outcomes, candidates);

  // P28 explanations — not yet persisted; pass empty
  const explanations: GovernanceExplanation[] = [];

  // Build P29 compliance package if any data available
  let compliancePackage: CompliancePackage | null = null;
  if (
    signals.length > 0 ||
    candidates.length > 0 ||
    outcomes.length > 0 ||
    traces.length > 0
  ) {
    const windowEnd = new Date().toISOString();
    const analytics = buildSkeletonAnalytics(signals);
    compliancePackage = buildCompliancePackage({
      windowStart: candidates.length > 0 && candidates[0]?.source?.windowStart
        ? candidates[0].source.windowStart
        : DEFAULT_WINDOW_START,
      windowEnd,
      generatedAt: windowEnd,
      signals,
      candidates,
      outcomes,
      traces,
      correlationAnalytics: analytics,
      keyExplanations: explanations,
      executionEvidence: [],
    });
  }

  return { signals, candidates, outcomes, traces, explanations, compliancePackage };
}

// ---------------------------------------------------------------------------
// buildIndexFromStores — shared helper for show + list
// ---------------------------------------------------------------------------

async function buildIndexFromStores(
  cwd: string,
  p24BundlePath?: string | null,
): Promise<{ index: LineageIndex; data: LoadedData }> {
  const data = await loadData(cwd, p24BundlePath);

  const index = buildLineageIndex({
    signals: data.signals,
    candidates: data.candidates,
    outcomes: data.outcomes,
    traces: data.traces,
    explanations: data.explanations,
    compliancePackages: data.compliancePackage ? [data.compliancePackage] : undefined,
  });

  return { index, data };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleShow(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> required.\n" + usage();
  }

  const p24BundlePath = flag(args, "--p24-bundle");
  const jsonMode = hasFlag(args, "--json");

  const { index } = await buildIndexFromStores(cwd, p24BundlePath);
  const record = buildLineageRecord(candidateId, index);

  if (!record) {
    if (jsonMode) {
      return JSON.stringify({ candidateId, lineage: null, found: false }) + "\n";
    }
    return `Candidate not found: ${candidateId}\n`;
  }

  if (jsonMode) {
    return JSON.stringify(record, null, 2) + "\n";
  }

  return renderLineageShow(record);
}

async function handleList(args: string[], cwd: string): Promise<string> {
  const kindFilter = flag(args, "--kind");
  const outcomeFilter = flag(args, "--outcome");
  const p24BundlePath = flag(args, "--p24-bundle");
  const jsonMode = hasFlag(args, "--json");

  const { index } = await buildIndexFromStores(cwd, p24BundlePath);

  // Resolve matching lineageIds
  let matchedLineageIds: string[] | null = null;

  if (kindFilter) {
    const ids = index.bySignalKind.get(kindFilter);
    matchedLineageIds = ids ?? [];
  }

  if (outcomeFilter) {
    const ids = index.byOutcomeType.get(outcomeFilter);
    if (matchedLineageIds === null) {
      matchedLineageIds = ids ?? [];
    } else {
      // Intersect with existing filter
      const outcomeSet = new Set(ids ?? []);
      matchedLineageIds = matchedLineageIds.filter((id) => outcomeSet.has(id));
    }
  }

  // If no filters, show all candidates
  if (matchedLineageIds === null) {
    matchedLineageIds = [...index.byCandidateId.values()].flat();
  }

  // Deduplicate
  const uniqueIds = [...new Set(matchedLineageIds)];

  if (jsonMode) {
    return JSON.stringify({ lineageIds: uniqueIds, count: uniqueIds.length }, null, 2) + "\n";
  }

  return renderLineageList(uniqueIds, index);
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Render a single LineageRecord as terminal text. */
function renderLineageShow(record: LineageRecord): string {
  let out = "";

  out += `Lineage: ${record.lineageId}\n`;
  out += `Assembled: ${record.assembledAt}\n`;
  out += `\n`;

  // Phase presence
  out += `Phase Presence:\n`;
  out += `  P24 (signal):     ${record.phasePresence.p24 ? "YES" : "no"}\n`;
  out += `  P25 (candidate):  ${record.phasePresence.p25 ? "YES" : "no"}\n`;
  out += `  P26 (outcome):    ${record.phasePresence.p26 ? "YES" : "no"}\n`;
  out += `  P27 (trace):      ${record.phasePresence.p27 ? "YES" : "no"}\n`;
  out += `  P28 (explanation):${record.phasePresence.p28 ? "YES" : "no"}\n`;
  out += `  P29 (compliance): ${record.phasePresence.p29 ? "YES" : "no"}\n`;
  out += `\n`;

  // Phase refs
  if (record.signalRef) {
    out += `P24 Signal:\n`;
    out += `  ID:        ${record.signalRef.signalId}\n`;
    out += `  Kind:      ${record.signalRef.signalKind}\n`;
    out += `  WindowEnd: ${record.signalRef.windowEnd}\n`;
    out += `\n`;
  }

  if (record.candidateRef) {
    out += `P25 Candidate:\n`;
    out += `  ID:     ${record.candidateRef.candidateId}\n`;
    out += `  Title:  ${record.candidateRef.title}\n`;
    out += `  Status: ${record.candidateRef.status}\n`;
    out += `\n`;
  }

  if (record.outcomeRef) {
    out += `P26 Outcome:\n`;
    out += `  ID:           ${record.outcomeRef.outcomeId}\n`;
    out += `  Candidate:    ${record.outcomeRef.candidateId}\n`;
    out += `  OutcomeType:  ${record.outcomeRef.outcomeType}\n`;
    out += `\n`;
  }

  if (record.traceRef) {
    out += `P27 Trace:\n`;
    out += `  Outcome:   ${record.traceRef.outcomeId}\n`;
    out += `  Candidate: ${record.traceRef.candidateId}\n`;
    out += `  Signal:    ${record.traceRef.signalKind}\n`;
    out += `\n`;
  }

  if (record.explanationRef) {
    out += `P28 Explanation:\n`;
    out += `  ID:   ${record.explanationRef.explanationId}\n`;
    out += `  Type: ${record.explanationRef.type}\n`;
    out += `\n`;
  }

  if (record.complianceRef) {
    out += `P29 Compliance:\n`;
    out += `  Package:    ${record.complianceRef.packageId}\n`;
    out += `  Window:     ${record.complianceRef.windowStart} .. ${record.complianceRef.windowEnd}\n`;
    out += `\n`;
  }

  // Boundary flags
  out += `Boundary Flags:\n`;
  out += `  readOnly:          ${record.readOnly}\n`;
  out += `  noPolicyMutation:  ${record.noPolicyMutation}\n`;
  out += `  noThresholdChange: ${record.noThresholdChange}\n`;
  out += `  noAutoAdoption:    ${record.noAutoAdoption}\n`;
  out += `  noRanking:         ${record.noRanking}\n`;

  return out;
}

/** Render a list of lineageIds as terminal text. */
function renderLineageList(lineageIds: string[], index: LineageIndex): string {
  let out = "";

  out += `Lineage Records (${lineageIds.length})\n`;
  out += `\n`;

  // Build reverse lookup: lineageId -> candidateIds
  const lineageToCandidates = new Map<string, string[]>();
  for (const [candidateId, ids] of index.byCandidateId) {
    for (const lid of ids) {
      const list = lineageToCandidates.get(lid);
      if (list) {
        list.push(candidateId);
      } else {
        lineageToCandidates.set(lid, [candidateId]);
      }
    }
  }

  for (const lid of lineageIds) {
    const candidateIds = lineageToCandidates.get(lid) ?? [];
    out += `  ${lid.slice(0, 16)}...\n`;
    for (const cid of candidateIds) {
      out += `    Candidate: ${cid}\n`;
    }
  }

  if (lineageIds.length === 0) {
    out += `  (no matching lineage records)\n`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance lineage {show|list} [options]\n" +
    "\n" +
    "Subcommands:\n" +
    "  show <candidateId> [--p24-bundle <path>] [--json]\n" +
    "    Show lineage for a specific candidate\n" +
    "\n" +
    "  list [--kind <signalKind>] [--outcome <outcomeType>] [--json]\n" +
    "    List lineage records, optionally filtered by kind or outcome type\n" +
    "\n" +
    "Options:\n" +
    "  --p24-bundle <path>  Path to P24 signal bundle JSON\n" +
    "  --kind <signalKind>  Filter by signal kind (e.g. calibration_skew)\n" +
    "  --outcome <outcome>  Filter by outcome type (e.g. accepted_for_policy_work)\n" +
    "  --json               Output raw JSON\n"
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main entry point for the `alix governance lineage` CLI command.
 *
 * Dispatches to the appropriate subcommand handler. All handlers return
 * a string that the caller (governance.ts) prints to stdout.
 */
export async function handleGovernanceLineageCommand(
  args: string[],
  opts: { cwd: string },
): Promise<string> {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "show":
      return await handleShow(args.slice(1), cwd);
    case "list":
      return await handleList(args.slice(1), cwd);
    default:
      return usage();
  }
}
