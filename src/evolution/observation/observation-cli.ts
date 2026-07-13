// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation CLI Handler.
 *
 * CLI handler for `alix evolution observe <evolution-id>` command.
 * Dispatches observations via ObservationEngine, builds evidence,
 * stores in ledger.
 *
 * @module observation-cli
 */

import type { ObservationEngine } from "./observation-engine.js";
import type { Observation, ObservationResult } from "./contracts/observation-contract.js";
import { buildObservationEvidence } from "./observation-evidence-bridge.js";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import type { ExecutionEvidenceStore } from "../verification/evidence/evidence-store.js";
import type { ExecutionEvidence } from "../../runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// ObserveDeps
// ---------------------------------------------------------------------------

export interface ObserveDeps {
  /** The observation engine (with providers already registered). */
  engine: ObservationEngine;
  /** Evidence store for persisting observed evidence. */
  evidenceStore: ExecutionEvidenceStore;
}

// ---------------------------------------------------------------------------
// ObservedFlags
// ---------------------------------------------------------------------------

export interface ObserveFlags {
  jsonMode: boolean;
  /** Reserved: trigger A3 re-evaluation with observed evidence (not yet implemented). */
  reevaluate: boolean;
}

// ---------------------------------------------------------------------------
// runObserve
// ---------------------------------------------------------------------------

/**
 * Run observations for an evolution and produce VerificationEvidence.
 *
 * @param evolutionId - The evolution to observe.
 * @param deps - Dependencies (engine, evidenceStore).
 * @param flags - Optional flags (jsonMode, reevaluate).
 * @returns The produced VerificationEvidence.
 */
export async function runObserve(
  evolutionId: string,
  deps: ObserveDeps,
  flags?: Partial<ObserveFlags>,
): Promise<VerificationEvidence> {
  const { engine, evidenceStore } = deps;
  const jsonMode = flags?.jsonMode ?? false;

  // Build v1 observation set — one per registered provider
  const observations = buildObservationSet(evolutionId);

  // Dispatch to engine
  const results = await engine.observeAll(observations);

  // Enrich results with descriptions from the original observations
  const descMap = new Map(observations.map((o) => [o.observationId, o.description]));
  const enrichedResults: Array<ObservationResult & { description?: string }> = results.map((r) => {
    const desc = descMap.get(r.observationId);
    return desc ? { ...r, description: desc } : r;
  });

  // Build evidence
  const evidence = buildObservationEvidence({
    proposalId: evolutionId,
    evolutionId,
    environmentHash: "observation-v1",
    observations: enrichedResults,
  });

  // Store evidence in ledger
  await storeObservationEvidence(evidenceStore, evidence);

  // Output
  if (jsonMode) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    renderObservationResult(evidence);
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the default observation set for an evolution.
 * V1: one Observation per registered provider name.
 */
function buildObservationSet(evolutionId: string): Observation[] {
  return [
    {
      observationId: `cli-status-${evolutionId}`,
      provider: "cli",
      description: "ALiX status command",
      params: { command: "alix", args: ["status"] },
    },
    {
      observationId: `fs-evolution-${evolutionId}`,
      provider: "filesystem",
      description: "Evidence directory exists",
      params: { path: process.cwd(), check: "exists" },
    },
    {
      observationId: `git-branch-${evolutionId}`,
      provider: "git",
      description: "Git branch state",
      params: { check: "branch" },
    },
    {
      observationId: `ledger-count-${evolutionId}`,
      provider: "ledger",
      description: "Evidence record count",
      params: { check: "evidence_count" },
    },
  ];
}

function renderObservationResult(evidence: VerificationEvidence): void {
  console.log(`\n  A5 Observation Results for ${evidence.proposalId}`);
  console.log(`  ${"=".repeat(50)}`);
  console.log(`  Evidence ID:  ${evidence.evidenceId}`);
  console.log(`  Class:        ${evidence.evidenceClass}`);
  console.log(`  Confidence:   ${(evidence.confidenceProfile.overallConfidence * 100).toFixed(1)}%`);
  console.log(`  Observations: ${evidence.baselineMetrics.totalCount ?? "N/A"}`);
  console.log(`  Passed:       ${evidence.baselineMetrics.passCount ?? 0}`);
  console.log(`  Failed:       ${evidence.baselineMetrics.failCount ?? 0}`);
  console.log(`  Errors:       ${evidence.baselineMetrics.errorCount ?? 0}`);
  console.log(`  Inconclusive: ${evidence.baselineMetrics.inconclusiveCount ?? 0}`);
  console.log("");
}

/**
 * Store observation evidence in the evidence store.
 * Maps VerificationEvidence to ExecutionEvidence format for storage.
 */
async function storeObservationEvidence(
  store: ExecutionEvidenceStore,
  evidence: VerificationEvidence,
): Promise<void> {
  const errorCount = Number(evidence.baselineMetrics["errorCount"] ?? 0);
  const failCount = Number(evidence.baselineMetrics["failCount"] ?? 0);
  const inconclusiveCount = Number(evidence.baselineMetrics["inconclusiveCount"] ?? 0);
  const hasFailures = errorCount > 0 || failCount > 0 || inconclusiveCount > 0;

  const record: ExecutionEvidence = {
    evidenceId: evidence.evidenceId,
    intentId: evidence.proposalId,
    startedAt: evidence.verifiedAt,
    completedAt: evidence.verifiedAt,
    outcome: hasFailures ? "PARTIAL" : "SUCCESS",
    summary: `Observation: ${evidence.proposalId}`,
    artifacts: evidence.behavioralChanges,
    verificationPassed: !hasFailures,
    evidenceHash: "",
  };

  await store.append(record);
}
