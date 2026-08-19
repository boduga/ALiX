/**
 * A9 — CLI handler for `alix governance evolution forecast [--dimension ...] [--json]`.
 *
 * Mirrors the A8 `learn` CLI surface (`src/evolution/learning/learning-cli.ts`).
 * Composes the forecast pipeline over the standard `.alix` layout:
 *
 *   ProposalEventsAdapter (EventLog capability.governance.proposal.*)
 *   EnrichedProposalsAdapter (P10.8a EnrichedProposal[])
 *   ForecastEngine ({ proposalEvents, enrichedProposals })
 *   ForecastsStore (.alix/governance/forecasts.jsonl)  ← A9-owned persistence
 *
 * Flow:
 *   raw adapters → detectors → Forecast → forecast JSONL (append-only)
 *   → A9 bridge → A2.5 GovernanceRecommendation (RISK_GATED_REVIEW for
 *   high/critical) → printed for the operator.
 *
 * Correlation is AUTOMATIC and is NOT exposed as an operator mutation command —
 * this CLI never constructs or invokes the CorrelationEngine.
 *
 * `--dimension` is a forward-compatible filter (accepted, no effect in v1) —
 * matches the A8 `learn` documented pattern. `--json` emits structured output.
 *
 * ---------------------------------------------------------------------------
 * Phase 20 locked failure behavior
 * ---------------------------------------------------------------------------
 *
 * - Adapter failure: a failed adapter does not destroy the run. The engine
 *   continues with available evidence (the failed source contributes nothing)
 *   and the source unavailability is surfaced in the CLI output (`warnings`).
 *   The Forecast contract carries no source-unavailable field, so the
 *   operator surface (this output) is where unavailability is explicit.
 * - Detector failure: the engine's `forecastDetailed` isolates each detector;
 *   a failing detector is surfaced (never silently success) while the other
 *   detectors still run.
 * - JSONL write failure: FAILS the operation (exitCode 1). An artifact is
 *   never reported as persisted when its write failed.
 * - Identity collision: the ForecastsStore append THROWS on a different-content
 *   same-id collision (fatal; no overwrite, no merge, no silent continue).
 *
 * @module evolution/forecast/forecast-cli
 */

import { ForecastEngine } from "./forecast-engine.js";
import { ProposalEventsAdapter } from "./adapters/proposal-events-adapter.js";
import { EnrichedProposalsAdapter } from "./adapters/enriched-proposals-adapter.js";
import { ForecastsStore } from "./forecasts-store.js";
import { buildGovernanceRecommendation } from "./bridge.js";
import type { ForecastAdapter, Forecast, ForecastKind } from "./contracts/contract.js";
import type { GovernanceRecommendation } from "../verification/contracts/recommendation-contract.js";
import type { EventLog } from "../../events/event-log.js";
import type { EnrichedProposal } from "../../adaptation/intelligence-types.js";
import {
  recommendationKindToDecisionKind,
  decisionKindToTargetState,
} from "../governance/decision-engine.js";

export interface RunForecastCliOpts {
  readonly eventLog: EventLog;
  /** P10.8a EnrichedProposal[] pipeline (source for the enriched adapter). */
  readonly enrichedProposals: ReadonlyArray<EnrichedProposal>;
  /** Directory holding the A9-owned forecasts.jsonl (.alix/governance). */
  readonly storeDir: string;
  readonly json: boolean;
  /** Optional detector-dimension filter: restricts output to forecasts of this
   *  kind (`trust-velocity` | `evidence-completeness` | `fingerprint-coincidence`). */
  readonly dimension?: ForecastKind;
}

/** The A3 decision a recommendation routes to (kind + target state). */
export interface DecisionSurface {
  readonly recommendationKind: string;
  readonly decisionKind: string;
  readonly targetState: string;
}

/** Structured forecast-run output so `--json` and tests can assert shape. */
export interface ForecastCliResult {
  readonly noFindings?: boolean;
  readonly forecasts?: ReadonlyArray<Forecast>;
  readonly recommendations?: ReadonlyArray<GovernanceRecommendation>;
  /** Per-forecast A3 decision surface (the decision each recommendation
   *  routes to), so the operator sees RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE
   *  → UNDER_REVIEW without a separate A3 invocation. */
  readonly decisions?: ReadonlyArray<DecisionSurface>;
  readonly warnings?: ReadonlyArray<string>;
  readonly detectorFailures?: ReadonlyArray<{ detector: string; error: string }>;
}

/** Map a governance recommendation to the A3 decision kind + target state it
 *  routes to (pure; ESCALATE has no A3 equivalent → undefined). */
export function recommendationToDecision(
  rec: GovernanceRecommendation,
): DecisionSurface | undefined {
  const decisionKind = recommendationKindToDecisionKind(rec.kind);
  if (!decisionKind) return undefined;
  return {
    recommendationKind: rec.kind,
    decisionKind,
    targetState: decisionKindToTargetState(decisionKind),
  };
}

/**
 * CLI handler for `alix governance evolution forecast [--dimension ...] [--json]`.
 *
 * Returns a structured `{ output, exitCode }` pair. The caller (seam file)
 * prints `output` and exits with `exitCode`. No implicit clock — the caller
 * passes `now`. Persists each generated forecast to the A9-owned
 * forecasts.jsonl store (append-only); a write failure fails the operation.
 */
export async function runForecastCli(
  opts: RunForecastCliOpts,
  now: string = new Date().toISOString(),
): Promise<{ readonly output: string; readonly exitCode: 0 | 1 }> {
  const warnings: string[] = [];
  const engine = new ForecastEngine({
    // Phase 20 — adapter failure: wrap each read so a failed source yields []
    // (available evidence) and the failure is surfaced, not fatal.
    proposalEvents: resilientAdapter(
      new ProposalEventsAdapter(opts.eventLog),
      "proposal-events",
      warnings,
    ),
    enrichedProposals: resilientAdapter(
      new EnrichedProposalsAdapter(opts.enrichedProposals),
      "enriched-proposals",
      warnings,
    ),
  });

  // Detector failures are surfaced (never silently success) while other
  // detectors continue — `forecastDetailed` isolates each detector.
  const detail = await engine.forecastDetailed(now);
  const { forecasts: allForecasts, detectorFailures } = detail;

  // Optional --dimension filter (locked operator option, spec §33): restrict
  // the run to forecasts of one detector kind. A dimension that yields no
  // forecasts is a deterministic no-findings result for that dimension.
  const forecasts =
    opts.dimension !== undefined
      ? allForecasts.filter((f) => f.prediction.kind === opts.dimension)
      : allForecasts;

  if (forecasts.length === 0) {
    // Deterministic no-findings output. A detector failure with zero findings
    // is NOT reported as a clean "no findings" — the run is incomplete.
    if (detectorFailures.length > 0) {
      return {
        output: opts.json
          ? JSON.stringify({
              noFindings: true,
              detectorFailures,
              ...(warnings.length > 0 ? { warnings } : {}),
            }, null, 2)
          : "No pre-execution risk forecasts detected — but detector(s) failed, so findings may be incomplete.\n" +
            formatFailures(detectorFailures, warnings),
        exitCode: 1,
      };
    }
    return {
      output: opts.json
        ? JSON.stringify(
            { noFindings: true, ...(warnings.length > 0 ? { warnings } : {}) },
            null,
            2,
          )
        : "No pre-execution risk forecasts detected." +
          formatWarningsSuffix(warnings),
      exitCode: 0,
    };
  }

  // Persist each forecast (append-only, A9-owned). A JSONL write failure
  // FAILS the operation — never report an artifact as persisted when the
  // write failed. The append is atomic (tmp-then-rename), so a failure
  // leaves prior persisted state intact.
  const store = new ForecastsStore(opts.storeDir);
  const recommendations: GovernanceRecommendation[] = [];
  try {
    for (const forecast of forecasts) {
      await store.append(forecast);
      recommendations.push(buildGovernanceRecommendation(forecast));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: opts.json
        ? JSON.stringify(
            { error: `forecast persistence failed: ${message}`, ...(warnings.length > 0 ? { warnings } : {}) },
            null,
            2,
          )
        : `Forecast persistence failed: ${message}` + formatWarningsSuffix(warnings),
      exitCode: 1,
    };
  }

  // Surface the A3 decision each recommendation routes to (spec §33: high/
  // critical forecasts surface RISK_GATED_REVIEW AND the resulting A3 decision
  // — REQUEST_MORE_EVIDENCE → UNDER_REVIEW — without fabricating evidence).
  const decisions = recommendations
    .map((rec) => recommendationToDecision(rec))
    .filter((d): d is DecisionSurface => d !== undefined);

  if (opts.json) {
    const result: ForecastCliResult = {
      forecasts,
      recommendations,
      ...(decisions.length > 0 ? { decisions } : {}),
      ...(detectorFailures.length > 0 ? { detectorFailures } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    return { output: JSON.stringify(result, null, 2), exitCode: 0 };
  }

  const lines: string[] = [];
  lines.push(`A9 generated ${forecasts.length} pre-execution risk forecast(s).`);
  for (let i = 0; i < forecasts.length; i++) {
    const f = forecasts[i]!;
    const rec = recommendations[i]!;
    lines.push(
      `  - [${f.prediction.band.toUpperCase()}] ${f.subject} -> ${f.subjectCapability}` +
        ` (kind=${f.prediction.kind}, score=${f.prediction.internalScore.toFixed(2)}, confidence=${f.confidence.toFixed(2)})`,
    );
    // High/critical must visibly surface RISK_GATED_REVIEW.
    lines.push(`    Recommendation: ${rec.kind}`);
    // ... and the resulting A3 decision.
    const decision = decisions[i];
    if (decision) {
      lines.push(`    A3 decision: ${decision.decisionKind} → ${decision.targetState}`);
    }
    lines.push(`    Forecast id: ${f.forecastId}`);
  }
  if (detectorFailures.length > 0) {
    lines.push(`Detector failure(s) — surfaced, not silent:`);
    for (const df of detectorFailures) lines.push(`  - ${df.detector}: ${df.error}`);
  }
  if (warnings.length > 0) {
    lines.push(`Source warning(s):`);
    for (const w of warnings) lines.push(`  - ${w}`);
  }
  return { output: lines.join("\n"), exitCode: 0 };
}

/** Wrap an adapter so a failed `list()` yields [] and records a warning. */
function resilientAdapter<T>(
  adapter: ForecastAdapter<T>,
  source: string,
  warnings: string[],
): ForecastAdapter<T> {
  return {
    name: adapter.name,
    list: async () => {
      try {
        return await adapter.list();
      } catch (err) {
        warnings.push(
          `${source} source unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      }
    },
  };
}

function formatFailures(
  detectorFailures: ReadonlyArray<{ detector: string; error: string }>,
  warnings: ReadonlyArray<string>,
): string {
  const lines = detectorFailures.map((f) => `  - ${f.detector}: ${f.error}`);
  for (const w of warnings) lines.push(`  - ${w}`);
  return lines.join("\n");
}

function formatWarningsSuffix(warnings: ReadonlyArray<string>): string {
  if (warnings.length === 0) return "";
  return `\nSource warning(s):\n${warnings.map((w) => `  - ${w}`).join("\n")}`;
}
