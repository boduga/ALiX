// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Curation CLI Handler.
 *
 * CLI handler for `alix governance evolution curate [--dimension <kind>] [--json]`.
 *
 * Curates ACROSS all knowledge stores — it takes NO evolution id (unlike
 * `observe <id>` / `execute <id>`, which operate on a single evolution). The
 * handler:
 *
 *   1. Parses `--dimension` (full `CurationFindingKind` names only) and `--json`.
 *   2. Runs the A6 `CurationEngine` with read-only store adapters over the
 *      `.alix` knowledge-store layout.
 *   3. Filters findings to the requested dimension (if any).
 *   4. Zero findings → prints "No curation findings" and returns WITHOUT an A3
 *      call (design spec §4.7 zero-findings invariant). Store availability is a
 *      diagnostic line, never a finding or a proposal.
 *   5. Non-empty findings → builds the A6 `CurationProposal`, the A2.5
 *      `GovernanceRecommendation`, and `VerificationEvidence`, then calls A3
 *      `generateDecision` and prints the decision.
 *
 * Store adapters wired from `CurationCLIDeps`:
 *   - learning, chronicle, failure_memory — constructed from `baseDir` (defaults
 *     to `process.cwd()`) `.alix` layout.
 *   - evidence — wired only when `deps.evidenceLedger` is present. The ledger
 *     exposes no list-all API, so evidence projection uses an empty proposal
 *     list (the store reports "available" with zero artifacts).
 *   - pattern_registry — wired only when `deps.patternRegistry` is present
 *     (the registry is memory-backed; the CLI deps carry no instance by default).
 *
 * @module curation-cli
 */

import { join } from "node:path";
import type {
  CurationFinding,
  CurationFindingKind,
  StoreStatus,
} from "./contracts/curation-contract.js";
import { DEFAULT_CURATION_CONFIG, VALID_CURATION_FINDING_KINDS } from "./contracts/curation-contract.js";
import { CurationEngine } from "./curation-engine.js";
import type { AdapterResult } from "./adapters/shared.js";
import { LearningStoreAdapter } from "./adapters/learning-store-adapter.js";
import { ChronicleAdapter } from "./adapters/chronicle-adapter.js";
import { FailureMemoryAdapter } from "./adapters/failure-memory-adapter.js";
import { PatternRegistryAdapter } from "./adapters/pattern-registry-adapter.js";
import { EvidenceAdapter } from "./adapters/evidence-adapter.js";
import { detectStale } from "./detectors/staleness-detector.js";
import { detectDuplicates } from "./detectors/dedup-detector.js";
import { detectContradictions } from "./detectors/contradiction-detector.js";
import { detectCompressible } from "./detectors/compression-detector.js";
import {
  buildCurationProposal,
  buildEvidenceFromFindings,
  buildGovernanceRecommendation,
} from "./curation-proposal-builder.js";
import { generateDecision } from "../governance/decision-engine.js";
import type { GovernanceDecision, GovernancePolicyConfig } from "../governance/contracts/decision-contract.js";
import type { VerificationEvidenceLedger } from "../verification/evidence/evidence-ledger.js";
import type { PatternRegistry } from "../../context/pattern-registry.js";

// ---------------------------------------------------------------------------
// CurationCLIDeps
// ---------------------------------------------------------------------------

/**
 * Dependencies for the `curate` CLI command.
 *
 * Structurally compatible with `EvolutionCLIDeps` (the evolution-cli wire
 * passes its deps object directly). Every field is optional so the handler is
 * self-contained; `baseDir`, `generateDecision` and `patternRegistry` are
 * test seams.
 */
export interface CurationCLIDeps {
  /** A3 governance policy config (defaults to DEFAULT_GOVERNANCE_POLICY). */
  policyConfig?: GovernancePolicyConfig;
  /** Optional A5 evidence ledger — wires the evidence adapter when present. */
  evidenceLedger?: VerificationEvidenceLedger;
  /** Override the A3 decision engine (test seam). Defaults to generateDecision. */
  generateDecision?: typeof generateDecision;
  /** Base dir for the `.alix` knowledge-store layout. Defaults to process.cwd(). */
  baseDir?: string;
  /** Pattern registry instance — wires the pattern_registry adapter when present. */
  patternRegistry?: PatternRegistry;
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

/** Consume a `--json` flag from args, returning whether it was present. */
function consumeJsonFlag(args: string[]): boolean {
  const idx = args.indexOf("--json");
  if (idx >= 0) {
    args.splice(idx, 1);
    return true;
  }
  return false;
}

type DimensionParse =
  | { ok: true; kind: CurationFindingKind | undefined }
  | { ok: false; error: string };

/**
 * Consume the `--dimension` flag from args.
 *
 * Only full `CurationFindingKind` names are accepted (`stale`, `duplicate`,
 * `contradiction`, `compressible`). Aliases (`dup`, `compress`) and unknown
 * values are usage errors. `--dimension` without a value is also a usage error.
 */
function parseDimensionFlag(args: string[]): DimensionParse {
  const idx = args.indexOf("--dimension");
  if (idx === -1) return { ok: true, kind: undefined };
  if (idx + 1 >= args.length) {
    return { ok: false, error: "--dimension requires a value" };
  }
  const value = args[idx + 1];
  args.splice(idx, 2);
  if (!(VALID_CURATION_FINDING_KINDS as readonly string[]).includes(value)) {
    return { ok: false, error: `Unknown curation dimension: ${value}` };
  }
  return { ok: true, kind: value as CurationFindingKind };
}

// ---------------------------------------------------------------------------
// Engine construction
// ---------------------------------------------------------------------------

/**
 * Build the A6 curation engine from deps, wiring every store adapter that can
 * be constructed. See the module doc for which adapters are wired and why.
 */
function buildCurationEngine(deps: CurationCLIDeps): CurationEngine {
  const baseDir = deps.baseDir ?? process.cwd();

  const adapters: Array<() => Promise<AdapterResult>> = [
    () => new LearningStoreAdapter(join(baseDir, ".alix", "learning")).read(),
    () => new ChronicleAdapter(baseDir).read(),
    () => new FailureMemoryAdapter(join(baseDir, ".alix", "governance")).read(),
  ];

  if (deps.patternRegistry) {
    adapters.push(() => new PatternRegistryAdapter(deps.patternRegistry!).read());
  }

  if (deps.evidenceLedger) {
    // The ledger cannot enumerate proposals, so evidence projection uses an
    // empty proposal list — the store reports "available" with zero artifacts.
    adapters.push(() => new EvidenceAdapter(deps.evidenceLedger!, []).read());
  }

  return new CurationEngine({
    adapters,
    detectors: [detectStale, detectDuplicates, detectContradictions, detectCompressible],
  });
}

// ---------------------------------------------------------------------------
// handleCurationCommand
// ---------------------------------------------------------------------------

/**
 * Execute the `alix governance evolution curate` command.
 *
 * @param deps - Decoupled dependencies (policy, ledger, test seams).
 * @param args - Remaining CLI args after the `curate` subcommand.
 * @param jsonModeOverride - Pre-parsed `--json` state (evolution-cli's
 *   isJsonMode already consumes `--json` before this handler runs; when absent
 *   the handler parses `--json` from args itself).
 */
export async function handleCurationCommand(
  deps: CurationCLIDeps,
  args: string[],
  jsonModeOverride?: boolean,
): Promise<void> {
  const jsonMode = jsonModeOverride ?? consumeJsonFlag(args);

  const dimension = parseDimensionFlag(args);
  if (!dimension.ok) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: dimension.error }));
    } else {
      console.log(red(dimension.error));
      console.log(
        red("Usage: alix governance evolution curate [--dimension <stale|duplicate|contradiction|compressible>] [--json]"),
      );
    }
    process.exitCode = 1;
    return;
  }

  const engine = buildCurationEngine(deps);
  const result = await engine.curateAll(DEFAULT_CURATION_CONFIG);

  const findings = dimension.kind
    ? result.findings.filter((f) => f.kind === dimension.kind)
    : result.findings;

  if (findings.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ findings: [], proposal: null }, null, 2));
    } else {
      renderStoreStatus(result.storeStatus);
      console.log("No curation findings");
    }
    return;
  }

  const proposal = buildCurationProposal(findings);
  if (!proposal) {
    // Invariant: non-empty findings always produce a proposal.
    console.log(red("Curation proposal could not be built"));
    process.exitCode = 1;
    return;
  }

  const evidence = buildEvidenceFromFindings(proposal.findings);
  const recommendation = buildGovernanceRecommendation(proposal);
  const decide = deps.generateDecision ?? generateDecision;
  const decision = decide(evidence, recommendation, { policyConfig: deps.policyConfig });

  if (jsonMode) {
    console.log(JSON.stringify({ findings, proposal, decision }, null, 2));
  } else {
    renderStoreStatus(result.storeStatus);
    renderFindings(findings);
    renderProposal(proposal);
    renderDecision(decision);
  }
}

// ---------------------------------------------------------------------------
// Terminal renderers
// ---------------------------------------------------------------------------

/** Render per-store availability — a diagnostic, never a finding or proposal. */
function renderStoreStatus(statuses: StoreStatus[]): void {
  console.log(bold("Knowledge stores:"));
  for (const s of statuses) {
    if (s.status === "available") {
      console.log(`  ${s.store.padEnd(18)} available`);
    } else {
      console.log(`  ${s.store.padEnd(18)} unavailable${s.reason ? ` — ${s.reason}` : ""}`);
    }
  }
  console.log("");
}

/** Render the filtered curation findings. */
function renderFindings(findings: CurationFinding[]): void {
  console.log(bold(`Curation Findings (${findings.length}):`));
  for (const f of findings) {
    const target = f.targetId ? ` → ${f.targetId}` : "";
    console.log(`  [${f.kind}] ${f.store}:${f.artifactId}${target} (conf ${f.confidence.toFixed(2)})`);
    console.log(`      ${f.rationale}`);
  }
  console.log("");
}

/** Render the A6 curation proposal. */
function renderProposal(proposal: NonNullable<ReturnType<typeof buildCurationProposal>>): void {
  console.log(bold(`Curation Proposal: ${proposal.proposalId}`));
  console.log(`  Summary:    ${proposal.summary}`);
  console.log(`  Dimensions: ${proposal.dimension.join(", ")}`);
  console.log("");
}

/** Render the A3 governance decision. */
function renderDecision(decision: GovernanceDecision): void {
  console.log(bold("Governance Decision:"));
  console.log(`  Decision:     ${decision.kind}`);
  console.log(`  Decision ID:  ${decision.decisionId}`);
  console.log(`  Confidence:   ${(decision.confidence * 100).toFixed(1)}%`);
  console.log(`  Reasoning:    ${decision.reasoning}`);
  console.log(`  Target State: ${decision.targetState}`);
  console.log("");
}

// ---------------------------------------------------------------------------
// ANSI helpers (mirrors evolution-cli.ts pattern)
// ---------------------------------------------------------------------------

function red(msg: string): string {
  return `\x1b[31m${msg}\x1b[0m`;
}

function bold(msg: string): string {
  return `\x1b[1m${msg}\x1b[0m`;
}
