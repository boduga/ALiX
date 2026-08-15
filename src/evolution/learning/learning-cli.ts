/**
 * A8 T7 — CLI handler for `alix governance evolution learn [--dimension ...] [--json]`.
 *
 * Constructs `LearningEngine` with FOUR read-only adapters
 * (A8 wayfinder map #517 locked ruling, T4/T6 reconciliation):
 *   1. ProposalEventsAdapter   — over EventLog capability.governance.proposal.*
 *   2. MeasurementEventsAdapter — over EventLog capability.governance.measurement.measured
 *   3. EnrichedProposalsAdapter — over P10.8a EnrichedProposal[]
 *   4. RecommendationsAdapter  — over governance-store recommendations.jsonl (A2.5)
 *
 * The brief's published code block referenced only 3 adapters; the 4th
 * (RecommendationsAdapter) is the T4-fix ruling (4-adapter pattern) and
 * was confirmed by the T6 commit (`547f90d`). This module honours that
 * ruling — NEVER construct the engine with 3 adapters.
 *
 * Architectural progression (locked, do not modify):
 *   adapters (read-only) → pure detectors → LearningFinding[]
 *   → LearningProposal (or null if 0 findings) → A2.5 bridge
 *   → GovernanceRecommendation(kind: "MONITOR")
 *
 * Single namespace. The detector taxonomy is internal; the operator
 * surface is `learn`. `--dimension` is a forward-compatible filter
 * (no effect in v1, accepted for forward compatibility with a
 * future per-detector CLI; documented as such).
 *
 * @module
 */

import { LearningEngine } from "./learning-engine.js";
import { ProposalEventsAdapter } from "./adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "./adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "./adapters/enriched-proposals-adapter.js";
import { RecommendationsAdapter } from "./adapters/recommendations-adapter.js";
import { buildGovernanceRecommendation } from "./a2-bridge.js";
import type { EventLog } from "../../events/event-log.js";
import type { EnrichedProposal } from "../../adaptation/intelligence-types.js";
import type { GovernanceStore } from "../../governance/governance-store.js";

export interface RunLearnCliOpts {
  readonly eventLog: EventLog;
  /** A2.5 verification-framework recommendations (source for 4th adapter). */
  readonly recommendations: GovernanceStore;
  /** P10.8a EnrichedProposal[] pipeline (currently consumed + void-discarded). */
  readonly enrichedProposals: ReadonlyArray<EnrichedProposal>;
  readonly json: boolean;
  readonly dimension?: string;
}

/**
 * CLI handler for `alix governance evolution learn [--dimension ...] [--json]`.
 *
 * Returns a structured `{ output, exitCode }` pair. Caller (seam file)
 * prints `output` and exits with `exitCode`. Pure: no I/O beyond the
 * 4 adapter `.list()` calls, no implicit clock (caller passes `now`).
 */
export async function runLearnCli(
  opts: RunLearnCliOpts,
  now: string = new Date().toISOString(),
): Promise<{ readonly output: string; readonly exitCode: 0 | 1 }> {
  void opts.dimension; // accepted but unused in v1

  // FOUR-ADAPTER CONSTRUCTION — locked ruling, do not regress to 3.
  const engine = new LearningEngine(
    new ProposalEventsAdapter(opts.eventLog),
    new MeasurementEventsAdapter(opts.eventLog),
    new EnrichedProposalsAdapter(opts.enrichedProposals),
    new RecommendationsAdapter(opts.recommendations),
  );

  const proposal = await engine.learn(now);

  if (!proposal) {
    return {
      output: opts.json
        ? JSON.stringify({ noFindings: true })
        : "No organizational patterns detected.",
      exitCode: 0,
    };
  }

  const recommendation = buildGovernanceRecommendation(proposal);

  if (opts.json) {
    return {
      output: JSON.stringify({ proposal, recommendation }, null, 2),
      exitCode: 0,
    };
  }

  return {
    output:
      `A8 detected ${proposal.findings.length} organizational pattern(s).\n` +
      proposal.findings.map((f) => `  - [${f.kind}] ${f.summary}`).join("\n") +
      `\nRecommendation: ${recommendation.kind}`,
    exitCode: 0,
  };
}
